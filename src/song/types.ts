import { z } from 'zod';

/**
 * Modelo de dados da música. É a fonte da verdade: o código Strudel é compilado daqui
 * (src/compiler). Os mesmos schemas validam o que a IA mandar na Fase 2.
 */

/** Slots fixos de camada. Uma camada pode estar ausente do deck. */
export const LAYER_IDS = ['kick', 'clap', 'hats', 'perc', 'bass', 'chords', 'lead', 'vocal', 'fx'] as const;
export const LayerIdSchema = z.enum(LAYER_IDS);
export type LayerId = z.infer<typeof LayerIdSchema>;

export const SECTION_TYPES = ['intro', 'verse', 'build', 'drop', 'breakdown', 'outro'] as const;
export const SectionTypeSchema = z.enum(SECTION_TYPES);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const NOTE_NAMES = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'] as const;
export const SCALES = ['minor', 'major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'harmonic minor', 'minor pentatonic', 'major pentatonic'] as const;

export const KeySchema = z.object({
  root: z.enum(NOTE_NAMES),
  scale: z.enum(SCALES),
});
export type Key = z.infer<typeof KeySchema>;

/** Efeitos por camada. Sobrescrevem os padrões do instrumento. */
export const LayerFxSchema = z.object({
  lpf: z.number().min(40).max(20000).optional(),
  hpf: z.number().min(20).max(10000).optional(),
  room: z.number().min(0).max(1).optional(),
  delay: z.number().min(0).max(1).optional(),
  pan: z.number().min(0).max(1).optional(),
  distort: z.number().min(0).max(5).optional(),
});
export type LayerFx = z.infer<typeof LayerFxSchema>;

export const LayerSchema = z.object({
  instrument: z.string(),
  pattern: z.string(),
  gain: z.number().min(0).max(1.5).default(1),
  muted: z.boolean().default(false),
  fx: LayerFxSchema.default({}),
  /** camada "raw": código Strudel livre no lugar de instrumento + padrão */
  code: z.string().max(2000).optional(),
});
export type Layer = z.infer<typeof LayerSchema>;

export const SectionSchema = z.object({
  type: SectionTypeSchema,
  bars: z.number().int().min(1).max(128),
  /** camadas silenciadas nesta seção */
  mute: z.array(LayerIdSchema),
  /** build: filtro master varre para agudos e a camada fx sobe ao longo da seção */
  rise: z.boolean().optional(),
  /** filtro master fixo nesta seção (DJ filter: <0.5 grave, 0.5 neutro, >0.5 agudo) */
  filter: z.number().min(0).max(1).optional(),
});
export type Section = z.infer<typeof SectionSchema>;

export const SongStateSchema = z.object({
  name: z.string(),
  style: z.string(),
  bpm: z.number().min(60).max(200),
  key: KeySchema,
  /** macros 0..1 que mexem em vários parâmetros ao mesmo tempo */
  mood: z.object({ darkness: z.number().min(0).max(1), energy: z.number().min(0).max(1) }),
  layers: z.partialRecord(LayerIdSchema, LayerSchema),
  arrangement: z.array(SectionSchema).min(1),
  /** ciclo absoluto em que a posição 0 do arranjo cai (o arranjo repete a partir daqui) */
  anchor: z.number().int(),
  master: z.object({
    /** DJ filter: <0.5 passa-baixa, 0.5 neutro, >0.5 passa-alta */
    filter: z.number().min(0).max(1),
    /** reverb somado a todas as camadas */
    reverb: z.number().min(0).max(1),
    gain: z.number().min(0).max(1.5),
  }),
});
export type SongState = z.infer<typeof SongStateSchema>;
