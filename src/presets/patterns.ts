import type { LayerId } from '../song/types';

/**
 * Catálogo de padrões. `src` é a origem do pattern em Strudel:
 * - bateria: s("...") com nomes de sample do banco (bd, cp, sd, hh, oh, rim, lt, mt, cr)
 * - melódicos: n("...") em graus da escala (0 = tônica); o compiler aplica a escala e a oitava
 *
 * Progressão padrão em graus: i – VI – iv – VII  →  "<0 -2 -4 -1>" (um acorde por compasso)
 */

export interface PatternDef {
  id: string;
  layer: LayerId;
  label: string;
  src: string;
}

const PROG = '<0 -2 -4 -1>';
const CHORDS = '<[0,2,4] [-2,0,2] [-4,-2,0] [-1,1,3]>';
const CHORDS7 = '<[0,2,4,6] [-2,0,2,4] [-4,-2,0,2] [-1,1,3,5]>';

export const PATTERNS: PatternDef[] = [
  // kick
  { id: 'four', layer: 'kick', label: 'quatro no chão', src: 's("bd*4")' },
  { id: 'four_fill', layer: 'kick', label: 'quatro com virada', src: 's("<bd*4 bd*4 bd*4 [bd bd bd [bd bd]]>")' },
  { id: 'broken', layer: 'kick', label: 'quebrado', src: 's("bd ~ ~ bd ~ ~ bd ~")' },
  { id: 'dnb', layer: 'kick', label: 'drum & bass', src: 's("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~")' },
  { id: 'lofi', layer: 'kick', label: 'lo-fi', src: 's("bd ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~ ~")' },
  { id: 'sparse', layer: 'kick', label: 'esparso', src: 's("bd ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~ ~ ~")' },

  // clap / snare
  { id: 'backbeat', layer: 'clap', label: 'clap no 2 e 4', src: 's("~ cp ~ cp")' },
  { id: 'snare_backbeat', layer: 'clap', label: 'caixa no 2 e 4', src: 's("~ sd ~ sd")' },
  { id: 'clap_shuffle', layer: 'clap', label: 'clap com ghost', src: 's("~ cp ~ [cp ~ ~ cp?]")' },
  { id: 'dnb_snare', layer: 'clap', label: 'caixa drum & bass', src: 's("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ [~ sd?]")' },
  { id: 'lofi_snare', layer: 'clap', label: 'caixa lo-fi', src: 's("~ sd ~ sd").velocity(0.7)' },
  { id: 'snare_roll', layer: 'clap', label: 'rufada (build)', src: 's("sd*16").velocity(saw.range(0.3, 1))' },

  // hats
  { id: 'offbeat', layer: 'hats', label: 'contratempo', src: 's("[~ hh]*4")' },
  { id: 'eighth', layer: 'hats', label: 'colcheias', src: 's("hh*8").velocity("[0.6 1]*4")' },
  { id: 'sixteenth', layer: 'hats', label: 'semicolcheias', src: 's("hh*16").velocity("[0.5 0.8 0.6 1]*4")' },
  { id: 'open_offbeat', layer: 'hats', label: 'aberto no contratempo', src: 's("[~ oh]*4")' },
  { id: 'rolling16', layer: 'hats', label: 'rolante 16', src: 's("hh*16").velocity("[0.4 0.9 0.6 1]*4").degradeBy(0.08)' },
  { id: 'swing', layer: 'hats', label: 'swing', src: 's("hh*8").velocity("[1 0.5]*4").late("[0 0.02]*4")' },
  { id: 'shuffle', layer: 'hats', label: 'swing aleatório', src: 's("[hh hh? hh hh?]*4").velocity("[1 0.6]*8")' },

  // percussão
  { id: 'rim_sync', layer: 'perc', label: 'aro sincopado', src: 's("~ rim ~ ~ rim ~ ~ rim")' },
  { id: 'toms', layer: 'perc', label: 'tons', src: 's("~ ~ lt ~ ~ mt ~ ~").velocity(0.8)' },
  { id: 'crash8', layer: 'perc', label: 'prato a cada 8', src: 's("<cr ~ ~ ~ ~ ~ ~ ~>")' },

  // baixo
  { id: 'offbeat_bass', layer: 'bass', label: 'contratempo', src: `n("${PROG}").struct("[~ x]*4")` },
  { id: 'rolling', layer: 'bass', label: 'rolante', src: `n("${PROG}").struct("[~ x x x]*4")` },
  { id: 'acid_line', layer: 'bass', label: 'linha acid', src: `n("0 0 7 0 [0 3] 0 6 [0 7]".add("${PROG}"))` },
  { id: 'house_walk', layer: 'bass', label: 'house', src: `n("0 ~ 0 7 ~ 0 ~ 0".add("${PROG}"))` },
  { id: 'dnb_reese', layer: 'bass', label: 'reese drum & bass', src: `n("${PROG}").struct("x ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ ~")` },
  { id: 'long', layer: 'bass', label: 'nota longa', src: `n("${PROG}")` },

  // acordes
  { id: 'pad_long', layer: 'chords', label: 'acorde por compasso', src: `n("${CHORDS}")` },
  { id: 'stab_offbeat', layer: 'chords', label: 'stab no contratempo', src: `n("${CHORDS}").struct("[~ x]*4")` },
  { id: 'house_stab', layer: 'chords', label: 'stab house', src: `n("${CHORDS}").struct("~ x ~ [~ x] ~ x ~ ~")` },
  { id: 'jazz7', layer: 'chords', label: 'acordes com sétima', src: `n("${CHORDS7}")` },
  { id: 'lofi_keys', layer: 'chords', label: 'teclas lo-fi', src: `n("${CHORDS7}").struct("x ~ ~ [~ x] ~ ~ x ~")` },
  { id: 'pulse', layer: 'chords', label: 'pulsando', src: `n("${CHORDS}").struct("x*8")` },

  // lead
  { id: 'arp_up', layer: 'lead', label: 'arpejo', src: `n("0 2 4 7 4 2 4 7".add("${PROG}")).fast(2)` },
  { id: 'hook', layer: 'lead', label: 'gancho', src: `n("<[4 ~ 4 2 ~ 4 ~ 7] [4 ~ 4 2 ~ 1 ~ 0]>".add("${PROG}"))` },
  { id: 'sparse_melody', layer: 'lead', label: 'melodia esparsa', src: `n("<[0 ~ ~ 4 ~ ~ 2 ~] [~ ~ 7 ~ ~ 4 ~ ~]>".add("${PROG}"))` },
  { id: 'acid_riff', layer: 'lead', label: 'riff acid', src: `n("0 0 7 0 [0 3] 0 6 [0 7]".add("${PROG}"))` },
  { id: 'sequence', layer: 'lead', label: 'sequência 16', src: `n("0 7 4 2 0 4 7 9 0 7 4 2 9 7 4 2".add("${PROG}"))` },

  // voz
  { id: 'vox_long', layer: 'vocal', label: 'notas longas', src: `n("<[0,4] [-2,2] [-4,0] [-1,3]>")` },
  { id: 'vox_rise', layer: 'vocal', label: 'frase subindo', src: `n("<[0 ~ 2 ~ 4 ~ ~ ~] [4 ~ 2 ~ 7 ~ ~ ~]>".add("${PROG}")).slow(2)` },
  { id: 'vox_chops', layer: 'vocal', label: 'picotado', src: `n("[~ 4] [~ 7] [~ 4 ~ 2] ~".add("${PROG}"))` },

  // fx
  { id: 'riser', layer: 'fx', label: 'riser', src: 's("white*16")' },
  { id: 'noise_hits', layer: 'fx', label: 'ruído no 1', src: 's("white ~ ~ ~").decay(0.4)' },
];

export const PATTERNS_BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

export const patternsFor = (layer: LayerId) => PATTERNS.filter((p) => p.layer === layer);
