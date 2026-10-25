import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import { compile } from './compile';
import { STYLES } from '../presets/styles';
import { INSTRUMENTS } from '../presets/instruments';
import { PATTERNS } from '../presets/patterns';
import { installArrangeHelpers } from '../engine/arrange';
import { applyOp } from '../song/ops';
import { sectionStarts } from '../song/time';
import type { SongState } from '../song/types';

// Avalia o código gerado com o Strudel real (sem áudio) e devolve o pattern.
async function evalCode(code: string) {
  const { pattern } = await core.evaluate(code, transpiler);
  return pattern;
}

const onsets = (pat: any, from: number, to: number) => pat.queryArc(from, to).filter((h: any) => h.hasOnset());

beforeAll(async () => {
  await core.evalScope(core, mini, tonal);
  mini.miniAllStrings();
  installArrangeHelpers();
});

describe('compile', () => {
  for (const style of STYLES) {
    it(`estilo ${style.id}: compila e toca em todas as seções`, async () => {
      const state = style.build();
      const pat = await evalCode(compile(state));
      const starts = sectionStarts(state.arrangement);
      for (let i = 0; i < state.arrangement.length; i++) {
        const haps = onsets(pat, starts[i], starts[i] + 1);
        expect(haps.length, `seção ${state.arrangement[i].type}`).toBeGreaterThan(0);
      }
    });
  }

  it('breakdown do techno não tem kick, drop tem', async () => {
    const state = STYLES[0].build();
    const pat = await evalCode(compile(state));
    const starts = sectionStarts(state.arrangement);
    const sounds = (i: number) => onsets(pat, starts[i], starts[i] + 1).map((h: any) => h.value.s);
    const drop = state.arrangement.findIndex((s) => s.type === 'drop');
    const breakdown = state.arrangement.findIndex((s) => s.type === 'breakdown');
    expect(sounds(drop)).toContain('bd');
    expect(sounds(breakdown)).not.toContain('bd');
  });

  it('build: filtro master sobe ao longo da seção', async () => {
    const state = STYLES[0].build();
    const pat = await evalCode(compile(state));
    const b = state.arrangement.findIndex((s) => s.type === 'build');
    const start = sectionStarts(state.arrangement)[b];
    const djf = (c: number) => onsets(pat, c, c + 0.25)[0].value.djf;
    expect(djf(start)).toBeCloseTo(0.5);
    expect(djf(start + 4)).toBeGreaterThan(0.55);
    expect(djf(start + 7.75)).toBeGreaterThan(djf(start + 4));
  });

  it('o arranjo repete em loop a partir do anchor', async () => {
    const state: SongState = { ...STYLES[0].build(), anchor: 10 };
    const pat = await evalCode(compile(state));
    const len = state.arrangement.reduce((a, s) => a + s.bars, 0);
    const kickAt = (c: number) => onsets(pat, c, c + 1).some((h: any) => h.value.s === 'bd');
    // intro (tem kick) começa no anchor; build (sem kick) começa em anchor + 32
    expect(kickAt(10)).toBe(true);
    expect(kickAt(10 + 32)).toBe(false);
    expect(kickAt(10 + 32 + len)).toBe(false);
  });

  it('mudança de tom transpõe as notas', async () => {
    const a = STYLES[0].build();
    const f = applyOp(a, { op: 'set_key', key: { root: 'C', scale: 'minor' } }, 0);
    const notes = async (s: SongState) =>
      onsets(await evalCode(compile(s)), 80, 81)
        .filter((h: any) => h.value.note !== undefined)
        .map((h: any) => h.value.note);
    expect(await notes(a)).not.toEqual(await notes(f));
  });

  it('todo instrumento e todo padrão do catálogo compilam', async () => {
    const base = STYLES[0].build();
    for (const p of PATTERNS) {
      for (const inst of INSTRUMENTS.filter((i) => i.layers.includes(p.layer))) {
        const s = applyOp(base, { op: 'add_layer', layer: p.layer, value: { instrument: inst.id, pattern: p.id, gain: 1, muted: false, fx: {} } }, 0);
        const drop = { ...s, arrangement: [{ type: 'drop' as const, bars: 8, mute: [] }] };
        const pat = await evalCode(compile(drop));
        expect(onsets(pat, 0, 4).length, `${p.id} + ${inst.id}`).toBeGreaterThan(0);
      }
    }
  });
});
