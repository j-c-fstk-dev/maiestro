import { initStrudel, initAudio, samples, getAudioContext, getSuperdoughAudioController, transpiler } from '@strudel/web';
import { evaluate as evaluateCode, stack, silence } from '@strudel/core';
import { switchAt } from './switchAt';
import { installArrangeHelpers, maestroArrange } from './arrange';
import { forbiddenIn } from './safety';
import type { MixParts } from '../compiler/compile';

/**
 * Adapter do motor de áudio. É a única parte do app (junto com o compiler)
 * que conhece o Strudel. Convenção: 1 ciclo = 1 compasso (4 tempos).
 *
 * Linha do tempo: um pattern "efetivado" + trocas pendentes, cada uma num ciclo.
 * O pattern no scheduler é sempre switchAt(…switchAt(efetivado, p1, c1)…, pn, cn),
 * reconstruído a cada mudança — por isso dá para agendar/cancelar em qualquer ordem.
 *
 * Desempenho: o scheduler do Strudel roda na thread principal e só olha ~0,2 s à frente.
 * Se a página travar mais que isso, ele PULA notas (silêncio enquanto a tela segue).
 * Por isso a música chega em partes (MixParts) e cada expressão de camada é interpretada
 * uma vez só (cache); entre interpretações novas devolvemos a vez ao navegador.
 */

/** Antecedência mínima (em segundos) para agendar uma troca com segurança.
 *  O scheduler do Strudel consulta ~0.2 s à frente; deixamos folga. */
const MIN_LEAD_SECONDS = 0.35;

/** Bancos de samples carregados no início. VCSL é CC0 (livre até para uso comercial). */
const SAMPLE_BANKS = [
  'github:tidalcycles/dirt-samples',
  'https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json',
  'https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json',
];
/** Samples do próprio usuário (opcional): public/samples/strudel.json */
const USER_SAMPLES = '/samples/strudel.json';

/** sem anotações de posição no texto (só servem para destacar código num editor e custam caro) */
const TRANSPILE = { emitMiniLocations: false, emitWidgets: false };
const CACHE_LIMIT = 2000;

export interface EngineEvents {
  onError?: (err: Error) => void;
}

interface Pending {
  cycle: number;
  pattern: any;
}

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

export class StrudelEngine {
  private repl: any = null;
  private initPromise: Promise<void> | null = null;
  private committed: any = null;
  private pending: Pending[] = [];
  private bpm = 128;
  private timer: ReturnType<typeof setInterval> | null = null;
  private master: { limiter: DynamicsCompressorNode; out: GainNode } | null = null;
  /** expressão (texto) → pattern/valor já interpretado */
  private cache = new Map<string, unknown>();
  /** samples do usuário encontrados em public/samples */
  userSamples = false;
  /** mensagem do último código recusado */
  lastError: string | null = null;
  /** estatística: interpretações novas vs reaproveitadas */
  readonly stats = { evaluated: 0, cached: 0, lastBuildMs: 0, skips: 0, lastSkipAt: 0 };

  constructor(private events: EngineEvents = {}) {}

  init(): Promise<void> {
    this.initPromise ??= (async () => {
      installArrangeHelpers();
      this.watchSkips();
      this.repl = await initStrudel({
        // um banco que falhar (rede) não impede os outros nem o app
        prebake: () =>
          Promise.all([
            ...SAMPLE_BANKS.map((b) => samples(b).catch((e: Error) => console.warn('samples', b, e))),
            this.loadUserSamples(),
          ]),
      });
      // O Strudel só carrega os AudioWorklets (supersaw, DJ filter…) num clique do mouse.
      // Como o play também vem do teclado, carregamos aqui (init é chamado num gesto do usuário).
      await Promise.all([initAudio(), getAudioContext().resume()]);
      this.installLimiter();
      this.setBpm(this.bpm);
      this.timer = setInterval(() => this.promote(), 250);
    })();
    return this.initPromise;
  }

  get isPlaying(): boolean {
    return !!this.repl?.scheduler.started;
  }

  /** Posição atual em ciclos (= compassos). */
  now(): number {
    return this.isPlaying ? this.repl.scheduler.now() : 0;
  }

  /** Primeiro ciclo em que ainda dá para agendar uma troca com segurança. */
  minCycle(): number {
    return this.now() + MIN_LEAD_SECONDS / this.secondsPerCycle();
  }

  getBpm() {
    return this.bpm;
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
    this.repl?.scheduler.setCps(bpm / 4 / 60);
  }

  secondsPerCycle() {
    return 240 / this.bpm;
  }

  /** Começa a tocar do ciclo 0. Devolve false se o código tiver erro. */
  async play(parts: MixParts): Promise<boolean> {
    await this.init();
    const pat = await this.build(parts, 0);
    if (!pat) return false;
    if (this.isPlaying) this.repl.stop();
    this.committed = pat;
    this.pending = [];
    await this.repl.scheduler.setPattern(pat, true);
    return true;
  }

  /** Agenda a música para entrar exatamente no ciclo `cycle`. Se houver troca nesse ciclo, substitui. */
  async schedule(parts: MixParts, cycle: number): Promise<boolean> {
    if (!this.isPlaying) return this.play(parts);
    const pat = await this.build(parts, cycle);
    if (!pat) return false;
    this.pending = [...this.pending.filter((p) => p.cycle !== cycle), { cycle, pattern: pat }].sort((a, b) => a.cycle - b.cycle);
    this.repl.scheduler.setPattern(this.chain());
    return true;
  }

  /** Cancela as trocas pendentes a partir de `fromCycle` (pânico = todas). */
  cancelPending(fromCycle = -Infinity) {
    this.pending = this.pending.filter((p) => p.cycle < fromCycle);
    if (this.isPlaying) this.repl.scheduler.setPattern(this.chain());
  }

  stop() {
    this.repl?.stop();
    this.committed = null;
    this.pending = [];
  }

  getAudioContext(): AudioContext {
    return getAudioContext();
  }

  /** Liga um nó na saída final (depois do limitador), para gravar exatamente o que se ouve. */
  connectOutput(node: AudioNode) {
    (this.master?.out ?? masterNode()).connect(node);
  }

  disconnectOutput(node: AudioNode) {
    try {
      (this.master?.out ?? masterNode()).disconnect(node);
    } catch {
      // já desconectado (ex.: o Strudel recriou a saída)
    }
  }

  dispose() {
    this.stop();
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Monta o pattern da mixagem a partir das partes. Erro (código proibido, que não interpreta
   * ou que quebra ao ser consultado) → null + onError; o que estava tocando continua.
   */
  private async build(parts: MixParts, cycle: number): Promise<any | null> {
    const started = performance.now();
    this.lastError = null;
    try {
      const decks = [];
      for (const d of parts.decks) {
        const sections: [number, any][] = [];
        for (const s of d.sections) {
          const layers = [];
          for (const expr of s.layers) layers.push(await this.expr(expr));
          const djf = await this.expr(s.djf);
          sections.push([s.bars, layers.length ? stack(...layers).djf(djf) : silence]);
        }
        let deck = maestroArrange(d.anchor, sections);
        if (d.wrap) deck = ((await this.expr(`(p) => p${d.wrap}`)) as (p: any) => any)(deck);
        decks.push(deck);
      }
      const pat = decks.length === 1 ? decks[0] : stack(...decks);
      // Um pattern que quebra ao ser consultado derrubaria o som a cada tick do scheduler:
      // testamos um trecho antes de aceitar.
      pat.queryArc(cycle, cycle + 0.25);
      return pat;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.events.onError?.(err as Error);
      return null;
    } finally {
      this.stats.lastBuildMs = performance.now() - started;
    }
  }

  /**
   * O scheduler do Strudel avisa no console quando pula um trecho por chegar atrasado
   * ("skip query: too late"): é o sinal de engasgo. Contamos para mostrar na tela.
   */
  private watchSkips() {
    const original = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('too late')) {
        this.stats.skips++;
        this.stats.lastSkipAt = performance.now();
        return;
      }
      original(...args);
    };
  }

  /** Interpreta uma expressão uma vez só; repetições vêm do cache. */
  private async expr(code: string): Promise<unknown> {
    if (this.cache.has(code)) {
      this.stats.cached++;
      return this.cache.get(code);
    }
    const bad = forbiddenIn(code);
    if (bad) throw new Error(`código recusado: usa "${bad}", que não é permitido`);
    // número puro (ex.: djf 0.5) não precisa do interpretador
    const value = /^-?\d+(\.\d+)?$/.test(code) ? Number(code) : (await evaluateCode(code, transpiler, TRANSPILE)).pattern;
    if (value && typeof (value as any).queryArc === 'function') (value as any).queryArc(0, 0.25);
    if (this.cache.size > CACHE_LIMIT) this.cache.clear();
    this.cache.set(code, value);
    this.stats.evaluated++;
    // devolve a vez ao navegador: o scheduler do Strudel precisa rodar entre interpretações
    await yieldToBrowser();
    return value;
  }

  private chain() {
    return this.pending.reduce((acc, p) => switchAt(acc, p.pattern, p.cycle), this.committed);
  }

  /** Trocas que já passaram viram o pattern efetivado (a cadeia não cresce). */
  private promote() {
    if (!this.isPlaying || this.pending.length === 0) return;
    const now = this.now();
    let changed = false;
    while (this.pending.length && now > this.pending[0].cycle + 0.5) {
      this.committed = this.pending.shift()!.pattern;
      changed = true;
    }
    if (changed) this.repl.scheduler.setPattern(this.chain());
  }

  /**
   * Limitador na saída master: segura os picos (drops com muitas camadas estouravam)
   * e deixa ~1 dB de folga para a gravação nunca bater no teto.
   */
  private installLimiter() {
    const ctx = getAudioContext();
    const src = masterNode();
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -4, knee: 2, ratio: 20, attack: 0.002, release: 0.12 });
    const out = new GainNode(ctx, { gain: 0.89 });
    src.disconnect();
    src.connect(limiter).connect(out).connect(ctx.destination);
    this.master = { limiter, out };
  }

  private async loadUserSamples() {
    try {
      const res = await fetch(USER_SAMPLES, { method: 'HEAD' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
      await samples(location.origin + USER_SAMPLES);
      this.userSamples = true;
    } catch {
      // sem samples do usuário: tudo bem
    }
  }
}

/** Último nó antes dos alto-falantes no Strudel (soma de todos os orbits). */
function masterNode(): AudioNode {
  return getSuperdoughAudioController().output.destinationGain;
}
