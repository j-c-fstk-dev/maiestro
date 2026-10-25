import { instrumentsFor } from '../presets/instruments';
import { patternsFor } from '../presets/patterns';
import { section } from '../presets/sections';
import { STYLES } from '../presets/styles';
import { TRANSITIONS } from '../presets/transitions';
import type { Op } from '../song/ops';
import type { When } from '../song/time';
import { other, type MixState } from '../song/mix';
import type { LayerId } from '../song/types';

/**
 * Movimentos locais do piloto automático: variações geradas sem IA, sempre válidas.
 * Usados quando a IA não está disponível (sem chave, limite de taxa, erro) ou para
 * economizar chamadas. Cada movimento é um pequeno plano para a Timeline.
 */

export type Tier = 'micro' | 'medium' | 'large';

export interface Move {
  label: string;
  ops: Op[];
  when: When;
  revertAfterBars?: number;
}

export type Rng = () => number;

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

type Gen = (mix: MixState, rng: Rng) => Move | null;

const MICRO: Gen[] = [
  // troca o padrão de uma camada de ritmo
  (mix, rng) => {
    const d = mix.decks[mix.live];
    const layer = pick(rng, (['hats', 'perc', 'clap'] as LayerId[]).filter((l) => d.layers[l]));
    if (!layer) return null;
    const options = patternsFor(layer).filter((p) => p.id !== d.layers[layer]!.pattern && p.id !== 'snare_roll');
    if (!options.length) return null;
    const p = pick(rng, options);
    return { label: `${layer} → ${p.label}`, ops: [{ op: 'set_pattern', layer, pattern: p.id }], when: { at: 'phrase' } };
  },
  // tira uma camada por alguns compassos
  (mix, rng) => {
    const d = mix.decks[mix.live];
    const layer = pick(rng, (['hats', 'perc', 'lead', 'chords', 'clap'] as LayerId[]).filter((l) => d.layers[l] && !d.layers[l]!.muted));
    if (!layer) return null;
    const bars = pick(rng, [4, 8]);
    return { label: `respiro: ${layer} sai por ${bars}c`, ops: [{ op: 'mute', layer }], when: { at: 'phrase' }, revertAfterBars: bars };
  },
  // varredura de filtro
  (_mix, rng) => {
    const v = pick(rng, [0.3, 0.35, 0.65, 0.7]);
    return { label: v < 0.5 ? 'abafa por 4 compassos' : 'afina por 4 compassos', ops: [{ op: 'set_master', filter: v }], when: { at: 'phrase' }, revertAfterBars: 4 };
  },
  // eco no lead
  (mix) => {
    if (!mix.decks[mix.live].layers.lead) return null;
    return { label: 'eco no lead por 8 compassos', ops: [{ op: 'set_fx', layer: 'lead', fx: { delay: 0.5 } }], when: { at: 'phrase' }, revertAfterBars: 8 };
  },
];

const MEDIUM: Gen[] = [
  ...MICRO,
  // build + drop
  () => ({
    label: 'build e drop',
    ops: [{ op: 'insert_sections', sections: [section('build', 8), section('drop', 16)] }],
    when: { at: 'section' },
  }),
  // breakdown
  () => ({ label: 'breakdown', ops: [{ op: 'insert_sections', sections: [section('breakdown', 16)] }], when: { at: 'section' } }),
  // troca de timbre de lead/acordes
  (mix, rng) => {
    const d = mix.decks[mix.live];
    const layer = pick(rng, (['lead', 'chords'] as LayerId[]).filter((l) => d.layers[l]));
    if (!layer) return null;
    const options = instrumentsFor(layer).filter((i) => i.id !== d.layers[layer]!.instrument);
    if (!options.length) return null;
    const i = pick(rng, options);
    return { label: `${layer} → ${i.label}`, ops: [{ op: 'set_instrument', layer, instrument: i.id }], when: { at: 'phrase' } };
  },
  // coro etéreo, se não houver voz
  (mix) => {
    if (mix.decks[mix.live].layers.vocal) return null;
    return {
      label: 'entra um coro etéreo',
      ops: [{ op: 'add_layer', layer: 'vocal', value: { instrument: 'choir_aah', pattern: 'vox_long', gain: 0.8, muted: false, fx: {} } }],
      when: { at: 'section' },
    };
  },
  // humor
  (mix, rng) => {
    const d = mix.decks[mix.live].mood.darkness;
    const darker = d < 0.5 ? rng() < 0.7 : rng() < 0.3;
    const v = Math.round(Math.min(0.9, Math.max(0.1, d + (darker ? 0.2 : -0.2))) * 100) / 100;
    return { label: darker ? 'mais sombrio' : 'mais claro', ops: [{ op: 'set_mood', darkness: v }], when: { at: 'phrase' } };
  },
];

const RELATED_SCALES: Record<string, string[]> = {
  minor: ['dorian', 'phrygian', 'harmonic minor'],
  dorian: ['minor', 'mixolydian'],
  phrygian: ['minor', 'harmonic minor'],
  'harmonic minor': ['minor', 'phrygian'],
  major: ['lydian', 'mixolydian'],
  lydian: ['major'],
  mixolydian: ['major', 'dorian'],
  'minor pentatonic': ['minor', 'dorian'],
  'major pentatonic': ['major'],
};

const LARGE: Gen[] = [
  ...MEDIUM,
  // muda a escala mantendo a tônica
  (mix, rng) => {
    const k = mix.decks[mix.live].key;
    const scale = pick(rng, RELATED_SCALES[k.scale] ?? ['minor']) as typeof k.scale;
    return { label: `escala → ${k.root} ${scale}`, ops: [{ op: 'set_key', key: { root: k.root, scale } }], when: { at: 'section' } };
  },
];

export const GENERATORS: Record<Tier, Gen[]> = { micro: MICRO, medium: MEDIUM, large: LARGE };

/** Um movimento aleatório do nível (tenta algumas vezes até achar um que se aplique). */
export function localMove(tier: Tier, mix: MixState, rng: Rng): Move | null {
  for (let i = 0; i < 8; i++) {
    const m = pick(rng, GENERATORS[tier])(mix, rng);
    if (m) return m;
  }
  return null;
}

/** Troca de música sem IA: outro estilo no deck fora do ar + transição na próxima seção. */
export function localRotation(mix: MixState, rng: Rng): Move[] {
  const off = other(mix.live);
  const current = mix.decks[mix.live].style;
  const style = pick(rng, STYLES.filter((s) => s.id !== current));
  const tr = pick(rng, TRANSITIONS.filter((t) => t.id !== 'cut'));
  return [
    { label: `próxima música no deck ${off}: ${style.label}`, ops: [{ op: 'load', state: style.build(), deck: off }], when: { at: 'bar' } },
    { label: `transição ${tr.label} para o deck ${off}`, ops: [{ op: 'transition', to: off, bars: tr.defaultBars, style: tr.id }], when: { at: 'section' } },
  ];
}

/** Gerador pseudoaleatório com semente (para testes reproduzíveis). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
