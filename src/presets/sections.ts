import type { LayerId, Section, SectionType } from '../song/types';

/** Modelos de seção: o que cada tipo silencia por padrão. */
const TEMPLATES: Record<SectionType, Omit<Section, 'bars'>> = {
  intro: { type: 'intro', mute: ['bass', 'chords', 'lead', 'fx'] },
  verse: { type: 'verse', mute: ['lead', 'fx'] },
  build: { type: 'build', mute: ['kick', 'bass'], rise: true },
  drop: { type: 'drop', mute: ['fx'] },
  breakdown: { type: 'breakdown', mute: ['kick', 'clap', 'hats', 'perc', 'bass', 'fx'], filter: 0.42 },
  outro: { type: 'outro', mute: ['bass', 'chords', 'lead', 'fx'] },
};

export function section(type: SectionType, bars: number, extraMute: LayerId[] = []): Section {
  const t = TEMPLATES[type];
  return { ...t, bars, mute: [...new Set([...t.mute, ...extraMute])] };
}

/** Atalho: "intro:16 build:8 drop:32" → seções */
export function parseArrangement(text: string): Section[] {
  return text
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [type, bars] = tok.split(':');
      if (!(type in TEMPLATES)) throw new Error(`seção desconhecida: ${type}`);
      const n = Number(bars ?? 8);
      if (!Number.isInteger(n) || n < 1 || n > 128) throw new Error(`compassos inválidos em ${tok}`);
      return section(type as SectionType, n);
    });
}
