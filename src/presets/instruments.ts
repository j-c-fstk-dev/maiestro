import type { LayerId } from '../song/types';

/**
 * Catálogo de instrumentos. `params` são controles do Strudel aplicados à camada
 * (a camada pode sobrescrever via fx). Kits de bateria usam os bancos de
 * tidal-drum-machines; sintetizadores usam os osciladores embutidos do Strudel.
 */

export type InstrumentKind = 'drums' | 'synth';

export interface Instrument {
  id: string;
  label: string;
  kind: InstrumentKind;
  /** camadas em que o instrumento faz sentido */
  layers: LayerId[];
  /** banco de samples (drums) */
  bank?: string;
  /** oscilador/sample (synth) */
  sound?: string;
  /** oitava da tônica para escalas (synth) */
  octave?: number;
  /** ganho base do instrumento */
  gain: number;
  params: Record<string, number>;
}

const DRUM_LAYERS: LayerId[] = ['kick', 'clap', 'hats', 'perc'];

export const INSTRUMENTS: Instrument[] = [
  // bateria
  { id: 'tr909', label: 'Roland TR-909', kind: 'drums', layers: DRUM_LAYERS, bank: 'RolandTR909', gain: 1, params: {} },
  { id: 'tr808', label: 'Roland TR-808', kind: 'drums', layers: DRUM_LAYERS, bank: 'RolandTR808', gain: 1, params: {} },
  { id: 'tr707', label: 'Roland TR-707', kind: 'drums', layers: DRUM_LAYERS, bank: 'RolandTR707', gain: 1, params: {} },

  // baixo
  { id: 'acid', label: 'acid 303', kind: 'synth', layers: ['bass', 'lead'], sound: 'sawtooth', octave: 2, gain: 0.55,
    params: { lpf: 700, lpq: 14, lpenv: 3, decay: 0.16, sustain: 0 } },
  { id: 'sub', label: 'sub grave', kind: 'synth', layers: ['bass'], sound: 'sine', octave: 1, gain: 0.85,
    params: { decay: 0.35, sustain: 0.4, release: 0.1 } },
  { id: 'reese', label: 'reese', kind: 'synth', layers: ['bass'], sound: 'supersaw', octave: 1, gain: 0.45,
    params: { lpf: 450, detune: 0.4, release: 0.1 } },
  { id: 'pluck_bass', label: 'baixo pluck', kind: 'synth', layers: ['bass'], sound: 'square', octave: 2, gain: 0.4,
    params: { lpf: 1100, decay: 0.12, sustain: 0 } },

  // acordes / pads
  { id: 'warm_pad', label: 'pad quente', kind: 'synth', layers: ['chords'], sound: 'supersaw', octave: 3, gain: 0.22,
    params: { attack: 0.4, release: 1.4, lpf: 1600, room: 0.6 } },
  { id: 'glass_pad', label: 'pad de vidro', kind: 'synth', layers: ['chords'], sound: 'triangle', octave: 4, gain: 0.3,
    params: { attack: 0.25, release: 2, room: 0.7 } },
  { id: 'stab', label: 'stab', kind: 'synth', layers: ['chords'], sound: 'sawtooth', octave: 3, gain: 0.28,
    params: { lpf: 2200, decay: 0.18, sustain: 0, room: 0.4 } },
  { id: 'organ', label: 'órgão house', kind: 'synth', layers: ['chords'], sound: 'square', octave: 3, gain: 0.2,
    params: { lpf: 1800, decay: 0.25, sustain: 0.1, room: 0.3 } },

  // lead / arp
  { id: 'pluck', label: 'pluck', kind: 'synth', layers: ['lead'], sound: 'triangle', octave: 4, gain: 0.35,
    params: { decay: 0.2, sustain: 0, delay: 0.35, room: 0.4 } },
  { id: 'saw_lead', label: 'lead supersaw', kind: 'synth', layers: ['lead'], sound: 'supersaw', octave: 4, gain: 0.2,
    params: { lpf: 3200, release: 0.2, room: 0.4 } },
  { id: 'bell', label: 'sino FM', kind: 'synth', layers: ['lead'], sound: 'sine', octave: 5, gain: 0.3,
    params: { fm: 3, fmh: 2.01, decay: 0.5, sustain: 0, room: 0.6, delay: 0.25 } },
  { id: 'square_lead', label: 'lead quadrado', kind: 'synth', layers: ['lead'], sound: 'square', octave: 4, gain: 0.18,
    params: { lpf: 2500, decay: 0.15, sustain: 0.3 } },

  // efeitos
  { id: 'noise_riser', label: 'riser de ruído', kind: 'synth', layers: ['fx'], sound: 'white', gain: 0.25,
    params: { hpf: 1200, decay: 0.1, sustain: 0 } },
];

export const INSTRUMENTS_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

export const instrumentsFor = (layer: LayerId) => INSTRUMENTS.filter((i) => i.layers.includes(layer));
