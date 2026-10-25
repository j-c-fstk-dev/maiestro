import { compile } from '../compiler/compile';
import { applyOp, type Op } from '../song/ops';
import { resolveWhen, type When } from '../song/time';
import type { SongState } from '../song/types';

/**
 * Linha do tempo de mudanças. Guarda o estado efetivado e as mudanças agendadas
 * (cada uma num ciclo). O estado num ciclo qualquer = efetivado + mudanças até ali.
 * A cada agendamento, recompila os estados afetados e entrega ao motor.
 *
 * Não conhece o Strudel: fala com o motor pela interface EngineLike.
 */

export interface EngineLike {
  readonly isPlaying: boolean;
  now(): number;
  minCycle(): number;
  play(code: string): Promise<boolean>;
  schedule(code: string, cycle: number): Promise<boolean>;
  cancelPending(fromCycle?: number): void;
  stop(): void;
  setBpm(bpm: number): void;
}

export type Source = 'user' | 'ai' | 'autopilot';

export interface Entry {
  id: number;
  cycle: number;
  ops: Op[];
  label: string;
  source: Source;
}

interface BpmRamp {
  from: number;
  to: number;
  start: number;
  bars: number;
}

export interface TimelineSnapshot {
  state: SongState;
  pending: Entry[];
  playing: boolean;
  code: string;
}

export class Timeline {
  private committed: SongState;
  private pending: Entry[] = [];
  private nextId = 1;
  private ramp: BpmRamp | null = null;
  private listeners = new Set<(s: TimelineSnapshot) => void>();
  private onError: (msg: string) => void;
  private onApplied: (entry: Entry) => void;

  constructor(
    private engine: EngineLike,
    initial: SongState,
    opts: { onError?: (msg: string) => void; onApplied?: (entry: Entry) => void } = {},
  ) {
    this.committed = initial;
    this.onError = opts.onError ?? (() => {});
    this.onApplied = opts.onApplied ?? (() => {});
  }

  subscribe(fn: (s: TimelineSnapshot) => void) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): TimelineSnapshot {
    return { state: this.committed, pending: [...this.pending], playing: this.engine.isPlaying, code: compile(this.committed) };
  }

  get state() {
    return this.committed;
  }

  /** Estado em vigor no ciclo `cycle` (efetivado + pendentes até ali). */
  stateAt(cycle: number): SongState {
    return this.pending.filter((e) => e.cycle <= cycle).reduce((s, e) => applyAll(s, e.ops, e.cycle), this.committed);
  }

  async play(state: SongState = this.committed) {
    this.committed = { ...state, anchor: 0 };
    this.pending = [];
    this.ramp = null;
    this.engine.setBpm(this.committed.bpm);
    const ok = await this.engine.play(compile(this.committed));
    if (!ok) this.onError('o código gerado tem erro; nada foi tocado');
    this.emit();
  }

  stop() {
    this.engine.stop();
    // o que estava agendado entra já no rascunho, para não se perder
    this.committed = this.stateAt(Infinity);
    this.pending = [];
    this.ramp = null;
    this.emit();
  }

  /**
   * Agenda ops para um momento musical. Parado: aplica direto no rascunho.
   * Lança OpError se as ops não fizerem sentido no estado daquele momento.
   */
  async schedule(ops: Op[], when: When, label: string, source: Source = 'user'): Promise<number | null> {
    if (!this.engine.isPlaying) {
      this.committed = applyAll(this.committed, ops, 0);
      this.emit();
      return null;
    }
    const min = this.engine.minCycle();
    const cycle = resolveWhen(this.stateAt(min), when, min);
    applyAll(this.stateAt(cycle), ops, cycle); // valida antes de agendar (lança OpError)

    this.pending = [...this.pending, { id: this.nextId++, cycle, ops, label, source }].sort((a, b) => a.cycle - b.cycle);
    await this.reschedule(cycle);
    this.emit();
    return cycle;
  }

  /** Cancela tudo que está agendado. */
  panic() {
    this.engine.cancelPending();
    this.pending = [];
    this.emit();
  }

  /** Chamar com frequência (~50 ms): efetiva o que já passou e conduz rampas de BPM. */
  tick() {
    if (!this.engine.isPlaying) return;
    const now = this.engine.now();
    let changed = false;
    while (this.pending.length && this.pending[0].cycle <= now) {
      const e = this.pending.shift()!;
      const before = this.committed.bpm;
      this.committed = applyAll(this.committed, e.ops, e.cycle);
      const bpmOp = e.ops.find((o) => o.op === 'set_bpm');
      if (bpmOp && bpmOp.op === 'set_bpm') {
        if (bpmOp.rampBars) this.ramp = { from: before, to: bpmOp.bpm, start: e.cycle, bars: bpmOp.rampBars };
        else {
          this.ramp = null;
          this.engine.setBpm(bpmOp.bpm);
        }
      }
      changed = true;
      this.onApplied(e);
    }
    if (this.ramp) {
      const x = Math.min(1, (now - this.ramp.start) / this.ramp.bars);
      this.engine.setBpm(this.ramp.from + (this.ramp.to - this.ramp.from) * x);
      if (x >= 1) this.ramp = null;
    }
    if (changed) this.emit();
  }

  /** Recompila e reenvia ao motor todos os limites a partir de `fromCycle`. */
  private async reschedule(fromCycle: number) {
    const cycles = [...new Set(this.pending.filter((e) => e.cycle >= fromCycle).map((e) => e.cycle))];
    for (const c of cycles) {
      let code: string;
      try {
        code = compile(this.stateAt(c));
      } catch (err) {
        // uma mudança posterior ficou inválida (ex.: mexe numa camada removida antes): descarta
        const dropped = this.pending.filter((e) => e.cycle === c);
        this.pending = this.pending.filter((e) => e.cycle !== c);
        this.onError(`descartado (${dropped.map((d) => d.label).join(', ')}): ${(err as Error).message}`);
        continue;
      }
      const ok = await this.engine.schedule(code, c);
      if (!ok) {
        this.pending = this.pending.filter((e) => e.cycle !== c);
        this.engine.cancelPending(c);
        this.onError(`o código do compasso ${c} tem erro; mudança descartada`);
      }
    }
  }

  private emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}

function applyAll(state: SongState, ops: Op[], cycle: number): SongState {
  return ops.reduce((s, op) => applyOp(s, op, cycle), state);
}
