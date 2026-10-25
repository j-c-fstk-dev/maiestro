import { initStrudel, initAudio, samples, getAudioContext, getSuperdoughAudioController } from '@strudel/web';
import { switchAt } from './switchAt';
import { installArrangeHelpers } from './arrange';

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

  constructor(private events: EngineEvents = {}) {}

  init(): Promise<void> {
    this.initPromise ??= (async () => {
      installArrangeHelpers();
      this.repl = await initStrudel({
        prebake: () =>
          Promise.all([
            samples('github:tidalcycles/dirt-samples'),
            samples('https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json'),
          ]),
        editPattern: (pat: any) => this.onEvaluated(pat),
        onEvalError: (err: Error) => this.events.onError?.(err),
      });
      // O Strudel só carrega os AudioWorklets (supersaw, DJ filter…) num clique do mouse.
      // Como o play também vem do teclado, carregamos aqui (init é chamado num gesto do usuário).
      await Promise.all([initAudio(), getAudioContext().resume()]);
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

  /** Liga um nó na saída master (depois de todos os efeitos), para gravar. */
  connectOutput(node: AudioNode) {
    masterNode().connect(node);
  }

  disconnectOutput(node: AudioNode) {
    try {
      masterNode().disconnect(node);
    } catch {
      // já desconectado (ex.: o Strudel recriou a saída)
    }
  }

  dispose() {
    this.stop();
    if (this.timer) clearInterval(this.timer);
  }

  /** Avaliações em série: `target` é compartilhado com o hook editPattern. */
  private run(target: number | null, code: string): Promise<boolean> {
    const job = this.queue.then(async () => {
      this.target = target;
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
