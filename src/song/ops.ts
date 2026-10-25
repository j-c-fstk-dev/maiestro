import { z } from 'zod';
import {
  KeySchema,
  LayerFxSchema,
  LayerIdSchema,
  LayerSchema,
  SectionSchema,
  SongStateSchema,
  SectionTypeSchema,
  type SongState,
} from './types';
import { DeckIdSchema, MixStateSchema, TransitionStyleSchema, other, type DeckId, type MixState } from './mix';
import { INSTRUMENTS_BY_ID } from '../presets/instruments';
import { PATTERNS_BY_ID } from '../presets/patterns';
import { sectionStarts, positionAt } from './time';

/**
 * Operações: mudanças atômicas na mixagem. É o vocabulário único dos /comandos e da IA.
 * - ops de deck mexem num deck (campo `deck`; sem ele, o deck no ar)
 * - ops de mixagem mexem nos dois (transição, copiar deck, desfazer)
 * Todas são validadas e aplicadas por `applyOp`.
 */
const deck = { deck: DeckIdSchema.optional() };

const DeckOpSchemas = [
  z.object({ op: z.literal('set_bpm'), bpm: z.number().min(60).max(200), rampBars: z.number().int().min(0).max(64).optional(), ...deck }),
  z.object({ op: z.literal('set_key'), key: KeySchema, ...deck }),
  z.object({ op: z.literal('set_mood'), darkness: z.number().min(0).max(1).optional(), energy: z.number().min(0).max(1).optional(), ...deck }),
  z.object({ op: z.literal('mute'), layer: LayerIdSchema, ...deck }),
  z.object({ op: z.literal('unmute'), layer: LayerIdSchema, ...deck }),
  z.object({ op: z.literal('set_gain'), layer: LayerIdSchema, gain: z.number().min(0).max(1.5), ...deck }),
  z.object({ op: z.literal('set_pattern'), layer: LayerIdSchema, pattern: z.string(), ...deck }),
  z.object({ op: z.literal('set_instrument'), layer: LayerIdSchema, instrument: z.string(), ...deck }),
  z.object({ op: z.literal('set_fx'), layer: LayerIdSchema, fx: LayerFxSchema, ...deck }),
  z.object({
    op: z.literal('set_master'),
    filter: z.number().min(0).max(1).optional(),
    reverb: z.number().min(0).max(1).optional(),
    gain: z.number().min(0).max(1.5).optional(),
    ...deck,
  }),
  z.object({ op: z.literal('add_layer'), layer: LayerIdSchema, value: LayerSchema, ...deck }),
  z.object({ op: z.literal('remove_layer'), layer: LayerIdSchema, ...deck }),
  /** substitui o arranjo; ele recomeça do início no ciclo em que a op for aplicada */
  z.object({ op: z.literal('set_arrangement'), sections: z.array(SectionSchema).min(1), ...deck }),
  /** toca estas seções uma vez a partir do ciclo da op; depois o arranjo segue de onde estava
   *  (o agendador agenda sozinho o `remove_sections` correspondente) */
  z.object({ op: z.literal('insert_sections'), sections: z.array(SectionSchema).min(1).max(8), ...deck }),
  /** remove as N primeiras seções e reancora o arranjo no ciclo da op (fim de um insert_sections) */
  z.object({ op: z.literal('remove_sections'), count: z.number().int().min(1), ...deck }),
  /** pula para a próxima seção desse tipo (a partir do ciclo em que a op for aplicada) */
  z.object({ op: z.literal('jump_to'), section: SectionTypeSchema, ...deck }),
  /** troca a música inteira do deck (ex.: carregar outro estilo); o arranjo recomeça no ciclo da op */
  z.object({ op: z.literal('load'), state: SongStateSchema, ...deck }),
] as const;

const MixOpSchemas = [
  /** começa a transição para o deck `to` (padrão: o que não está no ar). A Timeline agenda o fim. */
  z.object({
    op: z.literal('transition'),
    to: DeckIdSchema.optional(),
    bars: z.number().int().min(1).max(128),
    style: TransitionStyleSchema,
    enterAt: SectionTypeSchema.optional(),
  }),
  /** fim da transição: o deck que entrou fica no ar */
  z.object({ op: z.literal('end_transition') }),
  /** copia um deck inteiro para o outro (para preparar uma variação) */
  z.object({ op: z.literal('copy_deck'), from: DeckIdSchema, to: DeckIdSchema }),
  /** volta a mixagem a um estado anterior exatamente como era (desfazer) */
  z.object({ op: z.literal('restore'), state: MixStateSchema }),
] as const;

export const OpSchema = z.discriminatedUnion('op', [...DeckOpSchemas, ...MixOpSchemas]);
export type Op = z.infer<typeof OpSchema>;
type MixOpName = 'transition' | 'end_transition' | 'copy_deck' | 'restore';
export type DeckOp = Exclude<Op, { op: MixOpName }>;

const MIX_OPS = new Set<string>(['transition', 'end_transition', 'copy_deck', 'restore']);
export const isDeckOp = (op: Op): op is DeckOp => !MIX_OPS.has(op.op);

export class OpError extends Error {}

/** Aplica uma op e devolve uma nova mixagem (não muta). `cycle` = ciclo em que a op entra. */
export function applyOp(mix: MixState, op: Op, cycle: number): MixState {
  if (isDeckOp(op)) {
    const id = op.deck ?? mix.live;
    return { ...mix, decks: { ...mix.decks, [id]: applyDeckOp(mix.decks[id], op, cycle) } };
  }
  switch (op.op) {
    case 'transition': {
      if (mix.transition) throw new OpError('já existe uma transição em andamento');
      const to = op.to ?? other(mix.live);
      if (to === mix.live) throw new OpError(`o deck ${to} já está no ar`);
      const incoming = structuredClone(mix.decks[to]);
      const start = Math.round(cycle);
      // o deck que entra começa do início do arranjo (ou da seção pedida) junto com a transição
      const idx = op.enterAt ? incoming.arrangement.findIndex((s) => s.type === op.enterAt) : 0;
      if (idx < 0) throw new OpError(`o deck ${to} não tem seção ${op.enterAt}`);
      incoming.anchor = start - sectionStarts(incoming.arrangement)[idx];
      return {
        ...mix,
        decks: { ...mix.decks, [to]: incoming },
        transition: { from: mix.live, to, start, bars: op.bars, style: op.style, enterAt: op.enterAt },
      };
    }
    case 'end_transition':
      if (!mix.transition) return mix;
      return { ...mix, live: mix.transition.to, transition: null };
    case 'copy_deck':
      if (op.from === op.to) throw new OpError('escolha decks diferentes');
      if (mix.transition) throw new OpError('não dá para copiar deck durante uma transição');
      if (op.to === mix.live) throw new OpError(`o deck ${op.to} está no ar; copie para o outro`);
      return { ...mix, decks: { ...mix.decks, [op.to]: structuredClone(mix.decks[op.from]) } };
    case 'restore':
      return structuredClone(op.state);
  }
}

/** Aplica uma op de deck num SongState. */
export function applyDeckOp(state: SongState, op: DeckOp, cycle: number): SongState {
  const s: SongState = structuredClone(state);
  const layerOf = (id: z.infer<typeof LayerIdSchema>) => {
    const l = s.layers[id];
    if (!l) throw new OpError(`a camada ${id} não existe neste deck (use /add ${id})`);
    return l;
  };

  switch (op.op) {
    case 'set_bpm':
      s.bpm = op.bpm;
      break;
    case 'set_key':
      s.key = op.key;
      break;
    case 'set_mood':
      if (op.darkness !== undefined) s.mood.darkness = op.darkness;
      if (op.energy !== undefined) s.mood.energy = op.energy;
      break;
    case 'mute':
      layerOf(op.layer).muted = true;
      break;
    case 'unmute':
      layerOf(op.layer).muted = false;
      break;
    case 'set_gain':
      layerOf(op.layer).gain = op.gain;
      break;
    case 'set_pattern': {
      const p = PATTERNS_BY_ID[op.pattern];
      if (!p || p.layer !== op.layer) throw new OpError(`padrão ${op.pattern} não existe para ${op.layer}`);
      layerOf(op.layer).pattern = op.pattern;
      break;
    }
    case 'set_instrument': {
      const i = INSTRUMENTS_BY_ID[op.instrument];
      if (!i || !i.layers.includes(op.layer)) throw new OpError(`instrumento ${op.instrument} não serve para ${op.layer}`);
      layerOf(op.layer).instrument = op.instrument;
      break;
    }
    case 'set_fx':
      Object.assign(layerOf(op.layer).fx, op.fx);
      break;
    case 'set_master':
      if (op.filter !== undefined) s.master.filter = op.filter;
      if (op.reverb !== undefined) s.master.reverb = op.reverb;
      if (op.gain !== undefined) s.master.gain = op.gain;
      break;
    case 'add_layer': {
      const i = INSTRUMENTS_BY_ID[op.value.instrument];
      const p = PATTERNS_BY_ID[op.value.pattern];
      if (!i || !i.layers.includes(op.layer)) throw new OpError(`instrumento ${op.value.instrument} não serve para ${op.layer}`);
      if (!p || p.layer !== op.layer) throw new OpError(`padrão ${op.value.pattern} não existe para ${op.layer}`);
      s.layers[op.layer] = op.value;
      break;
    }
    case 'remove_layer':
      delete s.layers[op.layer];
      break;
    case 'set_arrangement':
      s.arrangement = op.sections;
      s.anchor = Math.round(cycle);
      break;
    case 'insert_sections': {
      const current = positionAt(state, cycle).index;
      const rest = [...s.arrangement.slice(current), ...s.arrangement.slice(0, current)];
      s.arrangement = [...op.sections, ...rest];
      s.anchor = Math.round(cycle);
      break;
    }
    case 'remove_sections':
      if (op.count >= s.arrangement.length) throw new OpError('não dá para remover todas as seções');
      s.arrangement = s.arrangement.slice(op.count);
      s.anchor = Math.round(cycle);
      break;
    case 'jump_to': {
      const idx = s.arrangement.findIndex((sec) => sec.type === op.section);
      if (idx < 0) throw new OpError(`o arranjo não tem seção ${op.section}`);
      // procura a ocorrência a partir da seção atual, para manter a ordem natural
      const current = positionAt(state, cycle).index;
      const order = [...s.arrangement.keys()].map((k) => (current + k) % s.arrangement.length);
      const target = order.find((k) => s.arrangement[k].type === op.section) ?? idx;
      s.anchor = Math.round(cycle) - sectionStarts(s.arrangement)[target];
      break;
    }
    case 'load':
      return { ...structuredClone(op.state), anchor: Math.round(cycle) };
  }
  return s;
}

/**
 * Ops que desfazem `ops` a partir da mixagem `before` (usado em "por N compassos").
 * Só cobre o que tem volta direta; o resto é ignorado.
 */
export function inverseOps(before: MixState, ops: Op[]): Op[] {
  const inv: Op[] = [];
  for (const op of ops) {
    if (!isDeckOp(op)) continue;
    const id: DeckId = op.deck ?? before.live;
    const d = before.decks[id];
    const layer = 'layer' in op ? d.layers[op.layer] : undefined;
    const push = (o: DeckOp) => inv.push({ ...o, deck: id });
    switch (op.op) {
      case 'mute':
      case 'unmute':
        if (layer) push({ op: layer.muted ? 'mute' : 'unmute', layer: op.layer });
        break;
      case 'set_gain':
        if (layer) push({ op: 'set_gain', layer: op.layer, gain: layer.gain });
        break;
      case 'set_pattern':
        if (layer) push({ op: 'set_pattern', layer: op.layer, pattern: layer.pattern });
        break;
      case 'set_instrument':
        if (layer) push({ op: 'set_instrument', layer: op.layer, instrument: layer.instrument });
        break;
      case 'set_key':
        push({ op: 'set_key', key: d.key });
        break;
      case 'set_bpm':
        push({ op: 'set_bpm', bpm: d.bpm, rampBars: op.rampBars });
        break;
      case 'set_mood':
        push({ op: 'set_mood', ...d.mood });
        break;
      case 'set_master':
        push({ op: 'set_master', ...d.master });
        break;
      case 'add_layer':
        push(layer ? { op: 'add_layer', layer: op.layer, value: layer } : { op: 'remove_layer', layer: op.layer });
        break;
      case 'remove_layer':
        if (layer) push({ op: 'add_layer', layer: op.layer, value: layer });
        break;
    }
  }
  return inv;
}
