import type { TransitionStyle } from '../song/mix';

/**
 * Transições entre decks como envelopes ao longo da transição (x de 0 a 1).
 * - gain: volume do deck (postgain, depois dos efeitos; 1 = normal)
 * - filter: DJ filter do deck (0.5 neutro, <0.5 abafado/grave, >0.5 fino/agudo)
 * - room / delay: efeitos extras no deck que sai (eco)
 * Todo envelope do deck que entra termina neutro (gain 1, filter 0.5).
 */

export type Env = [x: number, value: number][];

export interface DeckEnvs {
  gain: Env;
  filter?: Env;
  room?: Env;
  delay?: Env;
}

export interface TransitionDef {
  id: TransitionStyle;
  label: string;
  description: string;
  defaultBars: number;
  out: DeckEnvs;
  in: DeckEnvs;
}

// curva de potência constante (cos/sin) aproximada por pontos
const fadeOut: Env = [[0, 1], [0.25, 0.92], [0.5, 0.71], [0.75, 0.38], [1, 0]];
const fadeIn: Env = fadeOut.map(([x, v]) => [1 - x, v] as [number, number]).reverse();

export const TRANSITIONS: TransitionDef[] = [
  {
    id: 'crossfade',
    label: 'crossfade',
    description: 'um entra enquanto o outro sai, suave',
    defaultBars: 16,
    out: { gain: fadeOut },
    in: { gain: fadeIn },
  },
  {
    id: 'filter_swap',
    label: 'troca de filtro',
    description: 'o novo entra abafado e vai abrindo; o atual vai ficando fino e some',
    defaultBars: 32,
    out: { gain: [[0, 1], [0.6, 1], [1, 0]], filter: [[0, 0.5], [0.3, 0.5], [1, 0.85]] },
    in: { gain: [[0, 0], [0.2, 1]], filter: [[0, 0.12], [0.8, 0.5]] },
  },
  {
    id: 'bass_swap',
    label: 'troca de graves',
    description: 'o novo entra sem grave; no meio os graves trocam de deck (clássico de DJ)',
    defaultBars: 32,
    out: { gain: [[0, 1], [0.75, 1], [1, 0]], filter: [[0, 0.5], [0.499, 0.5], [0.5, 0.68]] },
    in: { gain: [[0, 0], [0.12, 1]], filter: [[0, 0.68], [0.499, 0.68], [0.5, 0.5]] },
  },
  {
    id: 'echo_out',
    label: 'saída em eco',
    description: 'o atual se desfaz em eco e reverb; o novo entra na metade',
    defaultBars: 16,
    out: { gain: [[0, 1], [0.5, 0.75], [1, 0]], room: [[0, 0.2], [0.5, 0.9]], delay: [[0, 0], [0.15, 0.7]] },
    in: { gain: [[0, 0], [0.499, 0], [0.5, 1]] },
  },
  {
    id: 'cut',
    label: 'corte seco',
    description: 'troca de uma vez no começo do compasso',
    defaultBars: 1,
    out: { gain: [[0, 0]] },
    in: { gain: [[0, 1]] },
  },
];

export const TRANSITIONS_BY_ID = Object.fromEntries(TRANSITIONS.map((t) => [t.id, t])) as Record<TransitionStyle, TransitionDef>;
