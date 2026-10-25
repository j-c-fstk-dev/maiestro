import { z } from 'zod';
import { SongStateSchema, SectionTypeSchema, type SongState } from './types';

/**
 * A mixagem: dois decks no mesmo relógio, um deles "no ar". Durante uma transição os dois
 * tocam; no fim, o deck que entrou vira o deck no ar e o outro fica pronto para ser preparado.
 */

export const DECK_IDS = ['A', 'B'] as const;
export const DeckIdSchema = z.enum(DECK_IDS);
export type DeckId = z.infer<typeof DeckIdSchema>;

export const TRANSITION_STYLES = ['crossfade', 'filter_swap', 'bass_swap', 'echo_out', 'cut'] as const;
export const TransitionStyleSchema = z.enum(TRANSITION_STYLES);
export type TransitionStyle = z.infer<typeof TransitionStyleSchema>;

export const TransitionSchema = z.object({
  from: DeckIdSchema,
  to: DeckIdSchema,
  /** ciclo absoluto em que a transição começa */
  start: z.number().int(),
  bars: z.number().int().min(1).max(128),
  style: TransitionStyleSchema,
  /** seção do deck que entra que começa junto com a transição */
  enterAt: SectionTypeSchema.optional(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const MixStateSchema = z.object({
  decks: z.object({ A: SongStateSchema, B: SongStateSchema }),
  live: DeckIdSchema,
  transition: TransitionSchema.nullable(),
});
export type MixState = z.infer<typeof MixStateSchema>;

export const other = (d: DeckId): DeckId => (d === 'A' ? 'B' : 'A');

export const liveDeck = (m: MixState): SongState => m.decks[m.live];

export function createMix(a: SongState, b: SongState): MixState {
  return { decks: { A: a, B: b }, live: 'A', transition: null };
}

/** Decks que soam num ciclo (durante uma transição, os dois). */
export function audibleDecks(m: MixState): DeckId[] {
  return m.transition ? [m.transition.from, m.transition.to] : [m.live];
}
