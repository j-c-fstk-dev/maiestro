import { compile, compileParts, type CompileOptions, type MixParts } from '../compiler/compile';
import { OpError, applyOp, inverseOps, isDeckOp, type Op } from '../song/ops';
import { PHRASE_BARS, positionAt, type When } from '../song/time';
import { liveDeck, type MixState } from '../song/mix';

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
  play(parts: MixParts): Promise<boolean>;
  schedule(parts: MixParts, cycle: number): Promise<boolean>;
  cancelPending(fromCycle?: number): void;
  stop(): void;
  setBpm(bpm: number): void;
  getBpm?(): number;
  /** mensagem do último código recusado pelo motor */
  readonly lastError?: string | null;
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
  before: MixState;
}

export interface TimelineSnapshot {
  state: MixState;
  pending: Entry[];
  playing: boolean;
  code: string;
}

export class Timeline {
  private committed: MixState;
  private pending: Entry[] = [];
  private history: HistoryItem[] = [];
  private nextId = 1;
  private nextGroup = 1;
  private ramp: BpmRamp | null = null;
  private listeners = new Set<(s: TimelineSnapshot) => void>();
  private onError: (msg: string) => void;
  private onApplied: (entry: Entry) => void;
  private compileOpts: CompileOptions = {};

  constructor(
    private engine: EngineLike,
    initial: MixState,
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
    return { state: this.committed, pending: [...this.pending], playing: this.engine.isPlaying, code: compile(this.committed, this.compileOpts) };
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

  /** Mixagem em vigor no ciclo `cycle` (efetivado + pendentes até ali). */
  stateAt(cycle: number): MixState {
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
          const p = positionAt(liveDeck(this.stateAt(c)), c);
          const isStart = p.barInSection === 0;
          if (isStart && (when.at === 'section' || p.section.type === when.type)) return c;
          c = isStart ? c + p.section.bars : p.startCycle + p.section.bars;
        }
        // não achou (ex.: o arranjo não tem esse tipo): cai no próximo início de seção
        return this.resolve({ at: 'section' });
      }
    }
  }

  async play(mix: MixState = this.committed) {
    // começa do zero com o deck no ar (uma transição pela metade termina na hora)
    const live = mix.transition ? mix.transition.to : mix.live;
    this.committed = { ...mix, live, transition: null, decks: { ...mix.decks, [live]: { ...mix.decks[live], anchor: 0 } } };
    this.pending = [];
    this.history = [];
    this.ramp = null;
    this.engine.setBpm(liveDeck(this.committed).bpm);
    const ok = await this.engine.play(compileParts(this.committed, this.compileOpts));
    if (!ok) this.onError('o código gerado tem erro; nada foi tocado');
    this.emit();
  }

  stop() {
    this.engine.stop();
    // o que estava agendado entra já no rascunho, para não se perder
    const all = this.stateAt(Infinity);
    this.committed = all.transition ? { ...all, live: all.transition.to, transition: null } : all;
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
    // fixa o deck de cada op: "o deck no ar" é o daquele momento, não o de quando ela for reaplicada
    ops = ops.map((op) => (isDeckOp(op) && !op.deck ? { ...op, deck: before.live } : op));
    applyAll(before, ops, cycle); // valida antes de agendar (lança OpError)

    const source = opts.source ?? 'user';
    const added = new Set<number>();
    const add = (c: number, o: Op[], l: string) => {
      added.add(this.nextId);
      this.pending.push({ id: this.nextId++, group, cycle: c, ops: o, label: l, source });
    };
    add(cycle, ops, label);

    // seções inseridas tocam uma vez: no fim delas, o arranjo original volta
    for (const op of ops) {
      if (op.op === 'insert_sections') {
        const bars = op.sections.reduce((a, s) => a + s.bars, 0);
        add(cycle + bars, [{ op: 'remove_sections', count: op.sections.length, deck: op.deck }], 'arranjo segue de onde estava');
      }
      if (op.op === 'transition') {
        add(cycle + op.bars, [{ op: 'end_transition' }], `fim da transição (${op.style})`);
      }
    }
    if (opts.revertAfterBars) {
      const inv = inverseOps(before, ops);
      if (inv.length) add(cycle + opts.revertAfterBars, inv, `volta: ${label}`);
    }
    this.pending.sort((a, b) => a.cycle - b.cycle || a.id - b.id);

    const ok = await this.reschedule(cycle, added);
    this.emit();
    if (!ok) {
      // o motor recusou o código desta mudança: ela sai inteira e o resto continua como estava
      throw new OpError(`o código gerado não roda no motor${this.engine.lastError ? ` (${this.engine.lastError})` : ''}; nada mudou`);
    }
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

  get options(): CompileOptions {
    return this.compileOpts;
  }

  /** Muda opções de compilação (ex.: modo leve): vale a partir do próximo compasso, sem mudar a música. */
  async setOptions(opts: CompileOptions) {
    this.compileOpts = { ...this.compileOpts, ...opts };
    if (!this.engine.isPlaying) return this.emit();
    const c = this.resolve({ at: 'bar' });
    await this.engine.schedule(compileParts(this.stateAt(c), this.compileOpts), c);
    await this.reschedule(c + 0.001);
    this.emit();
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
      if (!this.history.some((h) => h.group === e.group) && !e.ops.some((o) => o.op === 'restore' || o.op === 'end_transition')) {
        this.history.push({ group: e.group, label: e.label, before });
        if (this.history.length > 50) this.history.shift();
      }
      this.committed = applyAll(this.committed, e.ops, e.cycle);
      this.followTempo(before, e);
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

  /** O relógio segue o BPM do deck no ar; numa transição, vai em rampa até o do deck que entra. */
  private followTempo(before: MixState, e: Entry) {
    const after = this.committed;
    const tr = e.ops.find((o) => o.op === 'transition');
    if (tr && after.transition) {
      const to = after.decks[after.transition.to].bpm;
      const from = this.engine.getBpm?.() ?? liveDeck(before).bpm;
      this.ramp = to !== from ? { from, to, start: e.cycle, bars: after.transition.bars } : null;
      return;
    }
    const bpmOp = e.ops.find((o) => o.op === 'set_bpm' && o.deck === after.live);
    if (bpmOp && bpmOp.op === 'set_bpm' && !after.transition) {
      if (bpmOp.rampBars) this.ramp = { from: liveDeck(before).bpm, to: bpmOp.bpm, start: e.cycle, bars: bpmOp.rampBars };
      else {
        this.ramp = null;
        this.engine.setBpm(bpmOp.bpm);
      }
      return;
    }
    // load/restore/fim de transição: garante o BPM exato do deck no ar
    if (!after.transition && (liveDeck(after).bpm !== liveDeck(before).bpm || after.live !== before.live)) {
      this.ramp = null;
      this.engine.setBpm(liveDeck(after).bpm);
    }
  }

  /**
   * Recompila e reenvia ao motor todos os limites a partir de `fromCycle`.
   * Se o motor recusar o código e houver uma mudança "suspeita" (`culprit`, a recém-agendada),
   * só ela é retirada e o resto é reenviado; devolve false nesse caso.
   */
  private async reschedule(fromCycle: number, culprit?: Set<number>): Promise<boolean> {
    const cycles = [...new Set(this.pending.filter((e) => e.cycle >= fromCycle).map((e) => e.cycle))];
    for (const c of cycles) {
      let parts: MixParts;
      try {
        parts = compileParts(this.stateAt(c), this.compileOpts);
      } catch (err) {
        // uma mudança posterior ficou inválida (ex.: mexe numa camada removida antes): descarta
        const dropped = this.pending.filter((e) => e.cycle === c);
        this.pending = this.pending.filter((e) => e.cycle !== c);
        this.onError(`descartado (${dropped.map((d) => d.label).join(', ')}): ${(err as Error).message}`);
        continue;
      }
      const ok = await this.engine.schedule(parts, c);
      if (ok) continue;
      if (culprit && this.pending.some((e) => culprit.has(e.id))) {
        const from = Math.min(...this.pending.filter((e) => culprit.has(e.id)).map((e) => e.cycle));
        this.pending = this.pending.filter((e) => !culprit.has(e.id));
        this.engine.cancelPending(from);
        await this.reschedule(from);
        return false;
      }
      this.pending = this.pending.filter((e) => e.cycle !== c);
      this.engine.cancelPending(c);
      this.onError(`o código do compasso ${c} tem erro; mudança descartada`);
    }
    return true;
  }

  private emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}

function applyAll(state: MixState, ops: Op[], cycle: number): MixState {
  return ops.reduce((s, op) => applyOp(s, op, cycle), state);
}
