import type { Section, SectionType, SongState } from './types';

/** Funções de tempo musical. 1 ciclo = 1 compasso. Nada aqui conhece o Strudel. */

export const PHRASE_BARS = 8;

export const loopLength = (arrangement: Section[]) => arrangement.reduce((sum, s) => sum + s.bars, 0);

/** Início (em compassos, relativo ao arranjo) de cada seção. */
export function sectionStarts(arrangement: Section[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const s of arrangement) {
    starts.push(acc);
    acc += s.bars;
  }
  return starts;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export interface Position {
  index: number;
  section: Section;
  /** ciclo absoluto em que esta ocorrência da seção começou */
  startCycle: number;
  /** compasso dentro da seção (0-based, fracionário) */
  barInSection: number;
}

export function positionAt(state: Pick<SongState, 'arrangement' | 'anchor'>, cycle: number): Position {
  const { arrangement, anchor } = state;
  const len = loopLength(arrangement);
  const pos = mod(cycle - anchor, len);
  const starts = sectionStarts(arrangement);
  let index = arrangement.length - 1;
  for (let i = 0; i < starts.length; i++) {
    if (pos < starts[i] + arrangement[i].bars) {
      index = i;
      break;
    }
  }
  const barInSection = pos - starts[index];
  // limites de seção são sempre ciclos inteiros (anchor e compassos são inteiros)
  return { index, section: arrangement[index], startCycle: Math.round(cycle - barInSection), barInSection };
}

export type When =
  | { at: 'bar' }
  | { at: 'phrase' }
  | { at: 'section' }
  | { at: 'section_type'; type: SectionType }
  | { at: 'cycle'; cycle: number };
