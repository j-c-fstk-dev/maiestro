import { initStrudel, initAudio, samples, getAudioContext, getSuperdoughAudioController } from '@strudel/web';
import { switchAt } from './switchAt';
import { installArrangeHelpers } from './arrange';
import { forbiddenIn } from './safety';

/**
 * Adapter do motor de áudio. É a única parte do app (junto com o compiler)
 * que conhece o Strudel. Convenção: 1 ciclo = 1 compasso (4 tempos).
 *
 * Linha do tempo: um pattern "efetivado" + trocas pendentes, cada uma num ciclo.
 * O pattern no scheduler é sempre switchAt(…switchAt(efetivado, p1, c1)…, pn, cn),
 * reconstruído a cada mudança — por isso dá para agendar/cancelar em qualquer ordem.
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


export interface EngineEvents {
  onError?: (err: Error) => void;
}

interface Pending {
  cycle: number;
  pattern: any;
}

export class StrudelEngine {
  private repl: any = null;
  private initPromise: Promise<void> | null = null;
  private committed: any = null;
  private pending: Pending[] = [];
  /** ciclo alvo da avaliação em andamento (null = tocar já) */
  private target: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private bpm = 128;
  private timer: ReturnType<typeof setInterval> | null = null;
  private master: { limiter: DynamicsCompressorNode; out: GainNode } | null = null;
  /** samples do usuário encontrados em public/samples */
  userSamples = false;
  /** mensagem do último código recusado */
  lastError: string | null = null;

  constructor(private events: EngineEvents = {}) {}

  init(): Promise<void> {
    this.initPromise ??= (async () => {
      installArrangeHelpers();
      this.repl = await initStrudel({
        // um banco que falhar (rede) não impede os outros nem o app
        prebake: () =>
          Promise.all([
            ...SAMPLE_BANKS.map((b) => samples(b).catch((e: Error) => console.warn('samples', b, e))),
            this.loadUserSamples(),
          ]),
        editPattern: (pat: any) => this.onEvaluated(pat),
        onEvalError: (err: Error) => {
          this.lastError = err.message;
          this.events.onError?.(err);
        },
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
  async play(code: string): Promise<boolean> {
    await this.init();
    if (this.isPlaying) this.repl.stop();
    this.pending = [];
    return this.run(null, code);
  }

  /** Agenda o código para entrar exatamente no ciclo `cycle`. Se houver troca nesse ciclo, substitui. */
  async schedule(code: string, cycle: number): Promise<boolean> {
    if (!this.isPlaying) return this.play(code);
    return this.run(cycle, code);
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

  dispose() {
    this.stop();
    if (this.timer) clearInterval(this.timer);
  }

  /** Avaliações em série: `target` é compartilhado com o hook editPattern. */
  private run(target: number | null, code: string): Promise<boolean> {
    const bad = forbiddenIn(code);
    if (bad) {
      this.lastError = `usa "${bad}", que não é permitido`;
      this.events.onError?.(new Error(`código recusado: ${this.lastError}`));
      return Promise.resolve(false);
    }
    const job = this.queue.then(async () => {
      this.target = target;
      this.lastError = null;
      try {
        const result = await this.repl.evaluate(code, true);
        return !!result; // undefined = erro de avaliação (o que tocava continua)
      } finally {
        this.target = null;
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }

  private onEvaluated(pat: any) {
    // Um pattern que quebra ao ser consultado derrubaria o som a cada tick do scheduler:
    // testamos alguns compassos antes de aceitar. Lançar aqui = erro de avaliação (o que tocava continua).
    const from = this.target ?? 0;
    pat.queryArc(from, from + 4);
    if (this.target === null || !this.committed) {
      this.committed = pat;
      this.pending = [];
    } else {
      const cycle = this.target;
      this.pending = [...this.pending.filter((p) => p.cycle !== cycle), { cycle, pattern: pat }].sort(
        (a, b) => a.cycle - b.cycle,
      );
    }
    return this.chain();
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
}

/** Último nó antes dos alto-falantes no Strudel (soma de todos os orbits). */
function masterNode(): AudioNode {
  return getSuperdoughAudioController().output.destinationGain;
}
