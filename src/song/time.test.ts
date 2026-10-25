import { describe, expect, it } from 'vitest';
import { positionAt } from './time';
import { section } from '../presets/sections';
import { applyOp } from './ops';
import { STYLES } from '../presets/styles';

const arr = { arrangement: [section('intro', 16), section('build', 8), section('drop', 16)], anchor: 0 };

describe('time', () => {
  it('posição dentro do arranjo, com loop', () => {
    expect(positionAt(arr, 0).section.type).toBe('intro');
    expect(positionAt(arr, 20).section.type).toBe('build');
    expect(positionAt(arr, 20).barInSection).toBe(4);
    expect(positionAt(arr, 24).section.type).toBe('drop');
    expect(positionAt(arr, 40).section.type).toBe('intro'); // loop de 40
    expect(positionAt(arr, 45.5).barInSection).toBe(5.5);
  });

  it('jump_to reposiciona o arranjo sem mexer no relógio', () => {
    const s = { ...STYLES[0].build(), anchor: 0 };
    const next = applyOp(s, { op: 'jump_to', section: 'drop' }, 5);
    const p = positionAt(next, 5);
    expect(p.section.type).toBe('drop');
    expect(p.barInSection).toBe(0);
  });

  it('set_arrangement recomeça o arranjo no ciclo da op', () => {
    const s = STYLES[0].build();
    const next = applyOp(s, { op: 'set_arrangement', sections: [section('breakdown', 8), section('drop', 8)] }, 33);
    expect(positionAt(next, 33).section.type).toBe('breakdown');
    expect(positionAt(next, 41).section.type).toBe('drop');
  });
});
