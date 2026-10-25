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
import { INSTRUMENTS_BY_ID } from '../presets/instruments';
import { PATTERNS_BY_ID } from '../presets/patterns';
import { sectionStarts, positionAt } from './time';

/**
 * Operações: mudanças atômicas no SongState. É o mesmo vocabulário que os /comandos
 * usam agora e que a IA vai usar na Fase 2. Todas são validadas e aplicadas por `applyOp`.
 */
export const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_bpm'), bpm: z.number().min(60).max(200), rampBars: z.number().int().min(0).max(64).optional() }),
  z.object({ op: z.literal('set_key'), key: KeySchema }),
  z.object({ op: z.literal('set_mood'), darkness: z.number().min(0).max(1).optional(), energy: z.number().min(0).max(1).optional() }),
  z.object({ op: z.literal('mute'), layer: LayerIdSchema }),
  z.object({ op: z.literal('unmute'), layer: LayerIdSchema }),
  z.object({ op: z.literal('set_gain'), layer: LayerIdSchema, gain: z.number().min(0).max(1.5) }),
  z.object({ op: z.literal('set_pattern'), layer: LayerIdSchema, pattern: z.string() }),
  z.object({ op: z.literal('set_instrument'), layer: LayerIdSchema, instrument: z.string() }),
  z.object({ op: z.literal('set_fx'), layer: LayerIdSchema, fx: LayerFxSchema }),
  z.object({
    op: z.literal('set_master'),
    filter: z.number().min(0).max(1).optional(),
    reverb: z.number().min(0).max(1).optional(),
    gain: z.number().min(0).max(1.5).optional(),
  }),
  z.object({ op: z.literal('add_layer'), layer: LayerIdSchema, value: LayerSchema }),
  z.object({ op: z.literal('remove_layer'), layer: LayerIdSchema }),
  /** substitui o arranjo; ele recomeça do início no ciclo em que a op for aplicada */
  z.object({ op: z.literal('set_arrangement'), sections: z.array(SectionSchema).min(1) }),
  /** pula para a próxima seção desse tipo (a partir do ciclo em que a op for aplicada) */
  z.object({ op: z.literal('jump_to'), section: SectionTypeSchema }),
  /** troca a música inteira (ex.: carregar outro estilo) */
  z.object({ op: z.literal('load'), state: SongStateSchema }),
]);
export type Op = z.infer<typeof OpSchema>;

export class OpError extends Error {}

/** Aplica uma op e devolve um novo estado (não muta). `cycle` = ciclo em que a op entra. */
export function applyOp(state: SongState, op: Op, cycle: number): SongState {
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
