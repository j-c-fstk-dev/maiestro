import { z } from 'zod';
import { section } from '../presets/sections';
import type { Op } from '../song/ops';
import type { When } from '../song/time';
import { LayerIdSchema, NOTE_NAMES, SCALES, SectionTypeSchema } from '../song/types';
import { DeckIdSchema, TransitionStyleSchema } from '../song/mix';
import { STYLES_BY_ID } from '../presets/styles';
import { TRANSITIONS_BY_ID } from '../presets/transitions';

/**
 * Formato que a IA devolve. É mais "achatado" e tolerante que as Ops internas
 * (números podem vir como texto, seções só com tipo e compassos) e é convertido por `toOps`.
 */

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const bars = z.coerce.number().int().min(1).max(128);
const AiSectionSchema = z.object({ type: SectionTypeSchema, bars });

const NoteSchema = z.string().transform((s, ctx) => {
  const n = NOTE_NAMES.find((x) => x.toLowerCase() === s.trim().toLowerCase());
  if (!n) ctx.addIssue({ code: 'custom', message: `nota inválida: ${s}` });
  return n!;
});
const ScaleSchema = z.string().transform((s, ctx) => {
  const sc = SCALES.find((x) => x === s.trim().toLowerCase());
  if (!sc) ctx.addIssue({ code: 'custom', message: `escala inválida: ${s} (use ${SCALES.join(', ')})` });
  return sc!;
});

/** deck alvo; sem ele, o deck no ar */
const DeckRef = z.string().transform((s) => s.trim().toUpperCase()).pipe(DeckIdSchema);
const deck = { deck: DeckRef.optional() };

const StyleIdSchema = z.string().refine((s) => s in STYLES_BY_ID, { message: `estilo inválido (use ${Object.keys(STYLES_BY_ID).join(', ')})` });

export const AiOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_bpm'), bpm: num(60, 200), rampBars: z.coerce.number().int().min(0).max(64).optional(), ...deck }),
  z.object({ op: z.literal('set_key'), root: NoteSchema, scale: ScaleSchema, ...deck }),
  z.object({ op: z.literal('set_mood'), darkness: num(0, 1).optional(), energy: num(0, 1).optional(), ...deck }),
  z.object({ op: z.literal('mute'), layer: LayerIdSchema, ...deck }),
  z.object({ op: z.literal('unmute'), layer: LayerIdSchema, ...deck }),
  z.object({ op: z.literal('set_gain'), layer: LayerIdSchema, gain: num(0, 1.5), ...deck }),
  z.object({ op: z.literal('set_pattern'), layer: LayerIdSchema, pattern: z.string(), ...deck }),
  z.object({ op: z.literal('set_instrument'), layer: LayerIdSchema, instrument: z.string(), ...deck }),
  z.object({
    op: z.literal('set_fx'),
    layer: LayerIdSchema,
    lpf: num(40, 20000).optional(),
    hpf: num(20, 10000).optional(),
    room: num(0, 1).optional(),
    delay: num(0, 1).optional(),
    pan: num(0, 1).optional(),
    distort: num(0, 5).optional(),
    ...deck,
  }),
  z.object({ op: z.literal('set_master'), filter: num(0, 1).optional(), reverb: num(0, 1).optional(), gain: num(0, 1.5).optional(), ...deck }),
  z.object({ op: z.literal('add_layer'), layer: LayerIdSchema, instrument: z.string(), pattern: z.string(), gain: num(0, 1.5).optional(), ...deck }),
  z.object({ op: z.literal('remove_layer'), layer: LayerIdSchema, ...deck }),
  z.object({ op: z.literal('insert_sections'), sections: z.array(AiSectionSchema).min(1).max(8), ...deck }),
  z.object({ op: z.literal('set_arrangement'), sections: z.array(AiSectionSchema).min(1).max(16), ...deck }),
  z.object({ op: z.literal('jump_to'), section: SectionTypeSchema, ...deck }),
  // mixagem
  z.object({ op: z.literal('load_style'), style: StyleIdSchema, ...deck }),
  z.object({ op: z.literal('copy_deck'), from: DeckRef, to: DeckRef }),
  z.object({
    op: z.literal('transition'),
    to: DeckRef.optional(),
    bars: z.coerce.number().int().min(1).max(128).optional(),
    style: TransitionStyleSchema.default('filter_swap'),
    enterAt: SectionTypeSchema.optional(),
  }),
]);
export type AiOp = z.infer<typeof AiOpSchema>;

/** "bar" | "phrase" | "section" | {"section": "drop"} | {"after": 8} */
export const AiWhenSchema = z.union([
  z.enum(['bar', 'now', 'phrase', 'section']),
  z.object({ section: SectionTypeSchema }),
  z.object({ after: z.coerce.number().int().min(0).max(256) }),
]);
export type AiWhen = z.infer<typeof AiWhenSchema>;

export const AiPlanSchema = z.object({
  when: AiWhenSchema,
  ops: z.array(AiOpSchema).min(1).max(12),
  label: z.string().max(200).default(''),
  /** desfaz estas ops depois de N compassos */
  forBars: z.coerce.number().int().min(1).max(128).optional(),
});
export type AiPlan = z.infer<typeof AiPlanSchema>;

export const AiResponseSchema = z.object({
  reply: z.string().max(600).default(''),
  plans: z.array(AiPlanSchema).max(8).default([]),
  /** "desfaz", "volta como estava" */
  undo: z.boolean().optional(),
});
export type AiResponse = z.infer<typeof AiResponseSchema>;

export function toOp(a: AiOp): Op {
  switch (a.op) {
    case 'set_key':
      return { op: 'set_key', key: { root: a.root, scale: a.scale }, deck: a.deck };
    case 'set_fx': {
      const { op: _op, layer, deck, ...fx } = a;
      return { op: 'set_fx', layer, fx, deck };
    }
    case 'add_layer':
      return { op: 'add_layer', layer: a.layer, value: { instrument: a.instrument, pattern: a.pattern, gain: a.gain ?? 1, muted: false, fx: {} }, deck: a.deck };
    case 'insert_sections':
    case 'set_arrangement':
      return { op: a.op, sections: a.sections.map((s) => section(s.type, s.bars)), deck: a.deck };
    case 'load_style':
      return { op: 'load', state: STYLES_BY_ID[a.style].build(), deck: a.deck };
    case 'transition':
      return { op: 'transition', to: a.to, style: a.style, bars: a.bars ?? TRANSITIONS_BY_ID[a.style].defaultBars, enterAt: a.enterAt };
    default:
      return a;
  }
}

/** Converte o "quando" da IA. `after` é relativo ao plano anterior (ou ao próximo compasso). */
export function toWhen(w: AiWhen, previousCycle: number | null, nextBar: number): When {
  if (typeof w === 'string') return w === 'now' ? { at: 'bar' } : { at: w };
  if ('section' in w) return { at: 'section_type', type: w.section };
  return { at: 'cycle', cycle: (previousCycle ?? nextBar) + w.after };
}

/** Texto curto de um erro do Zod, para mostrar e para devolver à IA. */
export function zodMessage(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ');
}
