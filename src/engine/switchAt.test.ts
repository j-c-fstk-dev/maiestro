import { describe, expect, it } from 'vitest';
import { pure } from '@strudel/core';
import { switchAt } from './switchAt';

// "a" e "b" com 4 eventos por ciclo
const a = pure('a').fast(4);
const b = pure('b').fast(4);

const onsets = (pat: any, begin: number, end: number) =>
  pat
    .queryArc(begin, end)
    .filter((h: any) => h.hasOnset())
    .map((h: any) => [h.whole.begin.valueOf(), h.value]);

describe('switchAt', () => {
  it('toca o antigo antes do limite e o novo a partir dele', () => {
    const p = switchAt(a, b, 2);
    expect(onsets(p, 1, 3)).toEqual([
      [1, 'a'], [1.25, 'a'], [1.5, 'a'], [1.75, 'a'],
      [2, 'b'], [2.25, 'b'], [2.5, 'b'], [2.75, 'b'],
    ]);
  });

  it('funciona quando a consulta do scheduler atravessa o limite', () => {
    // o scheduler consulta pedaços pequenos e irregulares; simulamos isso
    const p = switchAt(a, b, 2);
    const chunks: [number, number][] = [[1.9, 1.97], [1.97, 2.03], [2.03, 2.3]];
    const got = chunks.flatMap(([s, e]) => onsets(p, s, e));
    expect(got).toEqual([[2, 'b'], [2.25, 'b']]);
  });

  it('encadeia várias trocas agendadas', () => {
    const c = pure('c').fast(4);
    const p = switchAt(switchAt(a, b, 1), c, 2);
    const vals = onsets(p, 0, 3).map(([, v]: any) => v).join('');
    expect(vals).toBe('aaaabbbbcccc');
  });
});
