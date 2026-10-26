import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import { compileDeck as compile, compile as compileMix } from './compile';
import { testMix } from '../test/mix';
import { STYLES } from '../presets/styles';
import { INSTRUMENTS } from '../presets/instruments';
import { PATTERNS } from '../presets/patterns';
import { installArrangeHelpers } from '../engine/arrange';
import { applyDeckOp as applyOp, applyOp as applyMix } from '../song/ops';
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
  }, 60_000);
});

describe('compile — mixagem', () => {
  const mixWith = (style: 'crossfade' | 'filter_swap' | 'cut') => {
    const m = applyMix(testMix(), { op: 'transition', bars: 16, style }, 64);
    return m;
  };

  it('sem transição só o deck no ar é compilado', async () => {
    const pat = await evalCode(compileMix(testMix()));
    const orbits = new Set<number>(onsets(pat, 0, 4).map((h: any) => h.value.orbit));
    expect([...orbits].every((o) => o < 10)).toBe(true);
  });

  it('crossfade: os dois decks soam, volumes cruzam ao longo da transição', async () => {
    const pat = await evalCode(compileMix(mixWith('crossfade')));
    const gains = (c: number) => {
      const hs = onsets(pat, c, c + 0.25);
      const a = hs.find((h: any) => h.value.orbit < 10)?.value.postgain;
      const b = hs.find((h: any) => h.value.orbit > 10)?.value.postgain;
      return { a, b };
    };
    expect(gains(64).a).toBeCloseTo(1);
    expect(gains(64).b).toBeCloseTo(0);
    expect(gains(72).a).toBeCloseTo(0.71, 1);
    expect(gains(72).b).toBeCloseTo(0.71, 1);
    expect(gains(79.75).a).toBeLessThan(0.1);
  });

  it('filter_swap: o deck que entra começa abafado e abre; o deck B começa do intro', async () => {
    const m = mixWith('filter_swap');
    expect(m.decks.B.anchor).toBe(64);
    const pat = await evalCode(compileMix(m));
    const djfB = (c: number) => onsets(pat, c, c + 0.25).find((h: any) => h.value.orbit > 10)?.value.djf;
    expect(djfB(64)).toBeCloseTo(0.12);
    expect(djfB(76.8)).toBeCloseTo(0.5, 1);
  });

  it('cut: troca seca', async () => {
    const pat = await evalCode(compileMix(mixWith('cut')));
    const hs = onsets(pat, 64, 64.25);
    expect(hs.filter((h: any) => h.value.orbit < 10).every((h: any) => h.value.postgain === 0)).toBe(true);
    expect(hs.some((h: any) => h.value.orbit > 10 && h.value.postgain === 1)).toBe(true);
  });
});

describe('compile — camada raw', () => {
  it('código livre toca, com ganho e orbit do app', async () => {
    const s = applyOp(STYLES[0].build(), { op: 'set_raw', layer: 'perc', code: 's("[~ cp]*2").bank("RolandTR808")', gain: 0.5 }, 0);
    const drop = { ...s, arrangement: [{ type: 'drop' as const, bars: 8, mute: [] }] };
    const code = compile(drop);
    expect(code).toContain('(s("[~ cp]*2").bank("RolandTR808")).gain(0.4).orbit(1)');
    const pat = await evalCode(code);
    expect(onsets(pat, 0, 1).filter((h: any) => h.value.s === 'cp' && h.value.bank === 'RolandTR808').length).toBe(2);
  });

  it('trocar o padrão de uma camada raw volta a ser camada normal', () => {
    const raw = applyOp(STYLES[0].build(), { op: 'set_raw', layer: 'perc', code: 's("cp")' }, 0);
    const back = applyOp(raw, { op: 'set_pattern', layer: 'perc', pattern: 'toms' }, 0);
    expect(back.layers.perc).toMatchObject({ pattern: 'toms', instrument: 'tr909' });
    expect(back.layers.perc!.code).toBeUndefined();
  });
});

describe('compile — modo leve', () => {
  it('supersaw vira serra e camadas perdem delay/reverb (menos acordes e voz)', () => {
    const m = testMix();
    const normal = compileMix(m);
    const light = compileMix(m, { light: true });
    expect(normal).toContain('.s("supersaw")');
    expect(light).not.toContain('supersaw');
    expect(light).not.toContain('.delay(');
    expect((light.match(/\.room\(/g) ?? []).length).toBeLessThan((normal.match(/\.room\(/g) ?? []).length);
  });
});
