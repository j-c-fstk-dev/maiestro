import { compile } from '../compiler/compile';
import { applyOp, inverseOps, type Op } from '../song/ops';
import { PHRASE_BARS, positionAt, type When } from '../song/time';
import type { SongState } from '../song/types';

/**
 * Linha do tempo de mudanças. Guarda o estado efetivado e as mudanças agendadas
 * (cada uma num ciclo). O estado num ciclo qualquer = efetivado + mudanças até ali.
 * A cada agendamento, recompila os estados afetados e entrega ao motor.
 *
 * Mudanças pertencem a um grupo (um comando ou um pedido à IA), que é a unidade do "desfazer".
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
  group: number;
  cycle: number;
  ops: Op[];
  label: string;
  source: Source;
}

export interface ScheduleOptions {
  source?: Source;
  /** agrupa com outras mudanças (desfazer desfaz o grupo inteiro) */
  group?: number;
  /** desfaz estas ops sozinho depois de N compassos (ex.: "tira o beat por 8 compassos") */
  revertAfterBars?: number;
}

interface BpmRamp {
  from: number;
  to: number;
  start: number;
  bars: number;
}

interface HistoryItem {
  group: number;
  label: string;
  before: SongState;
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
  private history: HistoryItem[] = [];
  private nextId = 1;
  private nextGroup = 1;
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

  get playing() {
    return this.engine.isPlaying;
  }

  now() {
    return this.engine.now();
  }

  newGroup() {
    return this.nextGroup++;
  }

  /** Estado em vigor no ciclo `cycle` (efetivado + pendentes até ali). */
  stateAt(cycle: number): SongState {
    return this.pending.filter((e) => e.cycle <= cycle).reduce((s, e) => applyAll(s, e.ops, e.cycle), this.committed);
  }

  /**
   * Converte um "quando" no ciclo do próximo limite, olhando o arranjo como ele
   * estará naquele momento (inclui seções inseridas por mudanças já agendadas).
   */
  resolve(when: When): number {
    const min = this.engine.minCycle();
    switch (when.at) {
      case 'cycle':
        return Math.max(when.cycle, Math.ceil(min));
      case 'bar':
        return Math.ceil(min);
      case 'phrase':
        return Math.ceil(min / PHRASE_BARS) * PHRASE_BARS;
      case 'section':
      case 'section_type': {
        let c = Math.ceil(min);
        for (let guard = 0; guard < 64; guard++) {
          const p = positionAt(this.stateAt(c), c);
          const isStart = p.barInSection === 0;
          if (isStart && (when.at === 'section' || p.section.type === when.type)) return c;
          c = isStart ? c + p.section.bars : p.startCycle + p.section.bars;
        }
        // não achou (ex.: o arranjo não tem esse tipo): cai no próximo início de seção
        return this.resolve({ at: 'section' });
      }
    }
  }

  async play(state: SongState = this.committed) {
    this.committed = { ...state, anchor: 0 };
    this.pending = [];
    this.history = [];
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
  async schedule(ops: Op[], when: When, label: string, opts: ScheduleOptions = {}): Promise<number | null> {
    const group = opts.group ?? this.newGroup();
    if (!this.engine.isPlaying) {
      const before = this.committed;
      this.committed = applyAll(this.committed, ops, 0);
      this.history.push({ group, label, before });
      this.emit();
      return null;
    }
    const cycle = this.resolve(when);
    const before = this.stateAt(cycle);
    applyAll(before, ops, cycle); // valida antes de agendar (lança OpError)

    const source = opts.source ?? 'user';
    const add = (c: number, o: Op[], l: string) =>
      this.pending.push({ id: this.nextId++, group, cycle: c, ops: o, label: l, source });
    add(cycle, ops, label);

    // seções inseridas tocam uma vez: no fim delas, o arranjo original volta
    for (const op of ops) {
      if (op.op === 'insert_sections') {
        const bars = op.sections.reduce((a, s) => a + s.bars, 0);
        add(cycle + bars, [{ op: 'remove_sections', count: op.sections.length }], 'arranjo segue de onde estava');
      }
    }
    if (opts.revertAfterBars) {
      const inv = inverseOps(before, ops);
      if (inv.length) add(cycle + opts.revertAfterBars, inv, `volta: ${label}`);
    }
    this.pending.sort((a, b) => a.cycle - b.cycle || a.id - b.id);

    await this.reschedule(cycle);
    this.emit();
    return cycle;
  }

  /** Remove todas as mudanças pendentes de um grupo. */
  async cancelGroup(group: number) {
    const removed = this.pending.filter((e) => e.group === group);
    if (!removed.length) return;
    const from = Math.min(...removed.map((e) => e.cycle));
    this.pending = this.pending.filter((e) => e.group !== group);
    this.engine.cancelPending(from);
    await this.reschedule(from);
    this.emit();
  }

  /**
   * Desfaz o último grupo: se ainda não tocou, cancela; se já tocou (mesmo que em parte),
   * cancela o resto e volta ao estado de antes dele no próximo compasso.
   */
  async undo(): Promise<string | null> {
    const lastPending = this.pending.reduce((m, e) => Math.max(m, e.group), 0);
    const lastApplied = this.history[this.history.length - 1];
    if (!lastPending && !lastApplied) return null;

    if (lastPending > (lastApplied?.group ?? 0)) {
      const label = this.pending.find((e) => e.group === lastPending)!.label;
      await this.cancelGroup(lastPending);
      return `cancelado: ${label}`;
    }
    this.history.pop();
    await this.cancelGroup(lastApplied.group);
    if (!this.engine.isPlaying) {
      this.committed = lastApplied.before;
      this.emit();
      return `desfeito: ${lastApplied.label}`;
    }
    // volta ao estado anterior por inteiro (o arranjo volta para onde estaria sem a mudança,
    // porque a posição vem do relógio); mudanças agendadas depois continuam valendo por cima
    const cycle = this.resolve({ at: 'bar' });
    this.pending.push({
      id: this.nextId++,
      group: this.newGroup(),
      cycle,
      ops: [{ op: 'restore', state: lastApplied.before }],
      label: `desfazer: ${lastApplied.label}`,
      source: 'user',
    });
    this.pending.sort((a, b) => a.cycle - b.cycle || a.id - b.id);
    await this.reschedule(cycle);
    this.emit();
    return `desfazendo: ${lastApplied.label}`;
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
      const before = this.committed;
      if (!this.history.some((h) => h.group === e.group) && !e.ops.some((o) => o.op === 'restore')) {
        this.history.push({ group: e.group, label: e.label, before });
        if (this.history.length > 50) this.history.shift();
      }
      this.committed = applyAll(this.committed, e.ops, e.cycle);
      const bpmOp = e.ops.find((o) => o.op === 'set_bpm');
      if (bpmOp && bpmOp.op === 'set_bpm') {
        if (bpmOp.rampBars) this.ramp = { from: before.bpm, to: bpmOp.bpm, start: e.cycle, bars: bpmOp.rampBars };
        else {
          this.ramp = null;
          this.engine.setBpm(bpmOp.bpm);
        }
      } else if (this.committed.bpm !== before.bpm) {
        this.engine.setBpm(this.committed.bpm); // load/restore trocam o BPM sem set_bpm
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
