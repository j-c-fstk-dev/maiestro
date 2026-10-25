import type { Layer, LayerId, SongState } from '../song/types';
import { section } from './sections';

/** Estilos prontos. Carregar um estilo gera um SongState completo, que depois pode ser ajustado. */

const layer = (instrument: string, pattern: string, gain = 1, fx: Layer['fx'] = {}): Layer => ({
  instrument,
  pattern,
  gain,
  muted: false,
  fx,
});

export interface StylePreset {
  id: string;
  label: string;
  description: string;
  build: () => SongState;
}

const base = (s: Omit<SongState, 'anchor' | 'master'> & { master?: Partial<SongState['master']> }): SongState => ({
  ...s,
  anchor: 0,
  master: { filter: 0.5, reverb: 0, gain: 1, ...s.master },
});

export const STYLES: StylePreset[] = [
  {
    id: 'techno',
    label: 'techno',
    description: '128 BPM · lá menor · 909, baixo rolante, acid e stabs',
    build: () =>
      base({
        name: 'techno',
        style: 'techno',
        bpm: 128,
        key: { root: 'A', scale: 'minor' },
        mood: { darkness: 0.4, energy: 0.7 },
        layers: {
          kick: layer('tr909', 'four'),
          clap: layer('tr909', 'backbeat', 0.7),
          hats: layer('tr909', 'sixteenth', 0.55),
          perc: layer('tr909', 'rim_sync', 0.5),
          bass: layer('reese', 'rolling'),
          chords: layer('stab', 'stab_offbeat'),
          lead: layer('acid', 'acid_riff', 0.8),
          fx: layer('noise_riser', 'riser'),
        } satisfies Partial<Record<LayerId, Layer>>,
        arrangement: [
          section('intro', 16),
          section('verse', 16),
          section('build', 8),
          section('drop', 32),
          section('breakdown', 16),
          section('build', 8),
          section('drop', 32),
        ],
      }),
  },
  {
    id: 'house',
    label: 'house',
    description: '124 BPM · fá menor · clap, chimbal aberto, órgão e baixo house',
    build: () =>
      base({
        name: 'house',
        style: 'house',
        bpm: 124,
        key: { root: 'F', scale: 'minor' },
        mood: { darkness: 0.2, energy: 0.65 },
        layers: {
          kick: layer('tr909', 'four'),
          clap: layer('tr909', 'clap_shuffle', 0.7),
          hats: layer('tr909', 'open_offbeat', 0.5),
          perc: layer('tr808', 'toms', 0.45),
          bass: layer('pluck_bass', 'house_walk'),
          chords: layer('organ', 'house_stab'),
          lead: layer('pluck', 'hook'),
          fx: layer('noise_riser', 'riser'),
        },
        arrangement: [
          section('intro', 16),
          section('verse', 16),
          section('build', 8),
          section('drop', 32),
          section('breakdown', 16),
          section('build', 8),
          section('drop', 32),
        ],
      }),
  },
  {
    id: 'trance',
    label: 'trance',
    description: '138 BPM · lá menor · supersaws, arpejo e breakdown longo',
    build: () =>
      base({
        name: 'trance',
        style: 'trance',
        bpm: 138,
        key: { root: 'A', scale: 'minor' },
        mood: { darkness: 0.1, energy: 0.85 },
        layers: {
          kick: layer('tr909', 'four_fill'),
          clap: layer('tr909', 'backbeat', 0.6),
          hats: layer('tr909', 'offbeat', 0.6),
          perc: layer('tr909', 'crash8', 0.4),
          bass: layer('sub', 'offbeat_bass'),
          chords: layer('warm_pad', 'pad_long'),
          lead: layer('saw_lead', 'arp_up'),
          fx: layer('noise_riser', 'riser'),
        },
        arrangement: [
          section('intro', 16),
          section('verse', 16),
          section('build', 8),
          section('drop', 32),
          section('breakdown', 32),
          section('build', 16),
          section('drop', 32),
        ],
      }),
  },
  {
    id: 'melodic',
    label: 'melodic techno',
    description: '124 BPM · ré menor · pad quente, arpejo, sub e coro',
    build: () =>
      base({
        name: 'melodic techno',
        style: 'melodic',
        bpm: 124,
        key: { root: 'D', scale: 'minor' },
        mood: { darkness: 0.5, energy: 0.6 },
        master: { reverb: 0.1 },
        layers: {
          kick: layer('tr909', 'four'),
          clap: layer('tr909', 'snare_backbeat', 0.5),
          hats: layer('tr909', 'offbeat', 0.5),
          perc: layer('tr808', 'rim_sync', 0.35),
          bass: layer('sub', 'offbeat_bass'),
          chords: layer('warm_pad', 'pad_long'),
          lead: layer('pluck', 'arp_up', 0.8),
          vocal: layer('choir_ooh', 'vox_long', 0.7),
          fx: layer('noise_riser', 'riser'),
        },
        arrangement: [
          section('intro', 16),
          section('verse', 16),
          section('breakdown', 16),
          section('build', 8),
          section('drop', 32),
          section('verse', 16),
        ],
      }),
  },
  {
    id: 'ambient',
    label: 'ambient',
    description: '90 BPM · ré dórico · pads de vidro, sinos e batida esparsa',
    build: () =>
      base({
        name: 'ambient',
        style: 'ambient',
        bpm: 90,
        key: { root: 'D', scale: 'dorian' },
        mood: { darkness: 0.3, energy: 0.25 },
        master: { reverb: 0.25 },
        layers: {
          kick: layer('tr808', 'sparse', 0.7),
          hats: layer('tr808', 'shuffle', 0.3),
          bass: layer('sub', 'long', 0.8),
          chords: layer('glass_pad', 'pad_long'),
          lead: layer('bell', 'sparse_melody'),
          fx: layer('noise_riser', 'noise_hits', 0.5),
        },
        arrangement: [section('intro', 16), section('verse', 32), section('breakdown', 16), section('verse', 32)],
      }),
  },
];

export const STYLES_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s]));
