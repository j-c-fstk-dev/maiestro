import { initStrudel, samples, getAudioContext } from '@strudel/web';
import { switchAt } from './switchAt';

/**
 * Adapter do motor de áudio. É a única parte do app (junto com o compiler)
 * que conhece o Strudel. Convenção: 1 ciclo = 1 compasso (4 tempos).
 */

/** Antecedência mínima (em segundos) para agendar uma troca com segurança.
 *  O scheduler do Strudel consulta ~0.2 s à frente; deixamos folga. */
const MIN_LEAD_SECONDS = 0.35;

export interface SwitchReport {
  /** ciclo (compasso) em que a troca acontece */
  atCycle: number;
  /** quanto tempo antes do limite o código ficou pronto (s). Negativo = atrasou */
  leadSeconds: number;
  /** quanto tempo levou para avaliar o código (ms) */
  evalMs: number;
}

export interface EngineEvents {
  onError?: (err: Error) => void;
  onSwitch?: (report: SwitchReport) => void;
}

export class StrudelEngine {
  private repl: any = null;
  private playing: any = null; // pattern que está de fato no scheduler
  private latestRaw: any = null; // último pattern "puro" (sem switchAt em volta)
  private lastBoundary = -Infinity;
  private pendingBoundary: number | null = null;
  private bpm = 128;
  private unwrapTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private events: EngineEvents = {}) {}

  async init() {
    if (this.repl) return;
    this.repl = await initStrudel({
      prebake: () => samples('github:tidalcycles/dirt-samples'),
      editPattern: (pat: any) => this.wrapForSwitch(pat),
      onEvalError: (err: Error) => this.events.onError?.(err),
    });
    this.setBpm(this.bpm);
    // Depois que a troca passou, tiramos o switchAt de volta para a cadeia não crescer.
    this.unwrapTimer = setInterval(() => this.unwrap(), 500);
  }

  get isPlaying(): boolean {
    return !!this.repl?.scheduler.started;
  }

  /** Posição atual em ciclos (= compassos). */
  now(): number {
    return this.repl?.scheduler.now() ?? 0;
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

  /** Próximo limite múltiplo de `every` compassos com antecedência segura. */
  nextBoundary(every = 1): number {
    const minCycle = this.now() + MIN_LEAD_SECONDS / this.secondsPerCycle();
    return Math.ceil(minCycle / every) * every;
  }

  /** Começa a tocar imediatamente (ou troca na hora, sem quantizar). */
  async play(code: string) {
    await this.init();
    this.pendingBoundary = null;
    await this.repl.evaluate(code, true);
  }

  /**
   * Agenda a troca para o ciclo `atCycle`. O código é avaliado agora; se tiver erro,
   * nada muda e a música segue (onError é chamado).
   */
  async scheduleSwitch(code: string, atCycle: number): Promise<SwitchReport | null> {
    if (!this.isPlaying) {
      await this.play(code);
      return null;
    }
    const started = performance.now();
    this.pendingBoundary = atCycle;
    const result = await this.repl.evaluate(code, true);
    this.pendingBoundary = null;
    if (!result) return null; // erro de avaliação: o pattern antigo continua
    const report: SwitchReport = {
      atCycle,
      leadSeconds: (atCycle - this.now()) * this.secondsPerCycle(),
      evalMs: performance.now() - started,
    };
    this.events.onSwitch?.(report);
    return report;
  }

  stop() {
    this.repl?.stop();
    this.playing = this.latestRaw = null;
    this.lastBoundary = -Infinity;
  }

  /** Para a gravação (Fase 3). */
  getAudioContext(): AudioContext {
    return getAudioContext();
  }

  dispose() {
    this.stop();
    if (this.unwrapTimer) clearInterval(this.unwrapTimer);
  }

  private wrapForSwitch(pat: any) {
    const boundary = this.pendingBoundary;
    this.latestRaw = pat;
    if (boundary === null || !this.playing) {
      this.playing = pat;
      this.lastBoundary = -Infinity;
      return pat;
    }
    // envolve o que está tocando (que pode já ter outra troca agendada)
    this.playing = switchAt(this.playing, pat, boundary);
    this.lastBoundary = Math.max(this.lastBoundary, boundary);
    return this.playing;
  }

  private unwrap() {
    if (!this.isPlaying || this.playing === this.latestRaw) return;
    if (this.now() > this.lastBoundary + 0.5) {
      this.playing = this.latestRaw;
      this.repl.scheduler.setPattern(this.latestRaw);
    }
  }
}
