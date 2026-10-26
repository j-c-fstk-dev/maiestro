import { describe, expect, it } from 'vitest';
import { Timeline } from './timeline';
import { FakeEngine } from '../test/fakeEngine';
import { STYLES } from '../presets/styles';
import { testMix } from '../test/mix';
import { OpError } from '../song/ops';

const setup = async () => {
  const engine = new FakeEngine();
  const errors: string[] = [];
  const tl = new Timeline(engine, testMix(), { onError: (m) => errors.push(m) });
  await tl.play();
  return { engine, tl, errors };
};

describe('Timeline', () => {
  it('agenda no próximo compasso e efetiva quando o tempo passa', async () => {
    const { engine, tl } = await setup();
    engine.cycle = 2.5;
    const c = await tl.schedule([{ op: 'mute', layer: 'kick' }], { at: 'bar' }, 'mute kick');
    expect(c).toBe(3);
    expect(engine.scheduled.map((s) => s.cycle)).toEqual([3]);
    expect(tl.state.decks.A.layers.kick!.muted).toBe(false);
    engine.cycle = 3.01;
    tl.tick();
    expect(tl.state.decks.A.layers.kick!.muted).toBe(true);
  });

  it('mudança agendada antes de outra recompila a posterior', async () => {
    const { engine, tl } = await setup();
    engine.cycle = 1.2;
    await tl.schedule([{ op: 'set_key', key: { root: 'F', scale: 'minor' } }], { at: 'phrase' }, 'tom');
    await tl.schedule([{ op: 'mute', layer: 'kick' }], { at: 'bar' }, 'mute');
    expect(engine.scheduled.map((s) => s.cycle).sort((a, b) => a - b)).toEqual([2, 8]);
    // o código do compasso 8 tem que conter o tom novo E o kick mutado
    const at8 = engine.scheduled.find((s) => s.cycle === 8)!.code;
    expect(at8).toContain('F2:minor');
    expect(at8).not.toContain('"bd*4"');
  });

  it('BPM com rampa', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'set_bpm', bpm: 140, rampBars: 4 }], { at: 'bar' }, 'bpm');
    engine.cycle = 1;
    tl.tick();
    engine.cycle = 3;
    tl.tick();
    expect(engine.bpm).toBeCloseTo(128 + 12 * 0.5);
    engine.cycle = 6;
    tl.tick();
    expect(engine.bpm).toBe(140);
  });

  it('op inválida é recusada sem agendar nada', async () => {
    const { engine, tl } = await setup();
    await expect(tl.schedule([{ op: 'set_pattern', layer: 'kick', pattern: 'nao_existe' }], { at: 'bar' }, 'x')).rejects.toThrow(OpError);
    expect(engine.scheduled).toEqual([]);
  });

  it('se o motor recusar o código, só a mudança nova sai e quem pediu fica sabendo', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'mute', layer: 'bass' }], { at: 'bar' }, 'boa');
    engine.failCode = (code) => code.includes('quebrado()');
    await expect(tl.schedule([{ op: 'set_raw', layer: 'perc', code: 's("cp").quebrado()' }], { at: 'bar' }, 'ruim')).rejects.toThrow(/código quebrado/);
    // a mudança boa do mesmo compasso continua agendada e no motor
    expect(tl.snapshot().pending.map((e) => e.label)).toEqual(['boa']);
    expect(engine.scheduled.map((s) => s.cycle)).toEqual([1]);
    expect(engine.scheduled[0].code).not.toContain('quebrado');
  });

  it('pânico cancela tudo', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'mute', layer: 'kick' }], { at: 'bar' }, 'mute');
    tl.panic();
    expect(engine.scheduled).toEqual([]);
    expect(tl.snapshot().pending).toEqual([]);
  });

  it('parado: comandos editam o rascunho direto', async () => {
    const engine = new FakeEngine();
    const tl = new Timeline(engine, testMix());
    await tl.schedule([{ op: 'set_gain', layer: 'bass', gain: 0.3 }], { at: 'bar' }, 'g');
    expect(tl.state.decks.A.layers.bass!.gain).toBe(0.3);
    expect(engine.scheduled).toEqual([]);
  });
});

describe('Timeline — Fase 2', () => {
  it('"quando" musical em ciclos', async () => {
    const { engine, tl } = await setup();
    engine.cycle = 3.2; // techno: intro 16, verse 16, build 8, drop 32…
    expect(tl.resolve({ at: 'bar' })).toBe(4);
    expect(tl.resolve({ at: 'phrase' })).toBe(8);
    expect(tl.resolve({ at: 'section' })).toBe(16);
    expect(tl.resolve({ at: 'section_type', type: 'drop' })).toBe(40);
  });

  it('insert_sections toca uma vez e o arranjo volta de onde estava', async () => {
    const { engine, tl } = await setup();
    engine.cycle = 3.2;
    const sections = [
      { type: 'build' as const, bars: 8, mute: ['kick' as const], rise: true },
      { type: 'drop' as const, bars: 16, mute: [] },
    ];
    const c = await tl.schedule([{ op: 'insert_sections', sections }], { at: 'section' }, 'build+drop');
    expect(c).toBe(16);
    // o "próximo drop" agora é o inserido, não o do arranjo original
    expect(tl.resolve({ at: 'section_type', type: 'drop' })).toBe(24);
    const types = (cycle: number) => {
      const s = tl.stateAt(cycle).decks.A;
      const idx = s.arrangement.findIndex((_, i) => {
        const start = s.arrangement.slice(0, i).reduce((a, x) => a + x.bars, 0) + s.anchor;
        return cycle >= start && cycle < start + s.arrangement[i].bars;
      });
      return s.arrangement[idx]?.type;
    };
    expect(types(16)).toBe('build');
    expect(types(24)).toBe('drop');
    // depois das seções inseridas, volta ao que viria no compasso 16 do original (verse)
    expect(types(40)).toBe('verse');
    expect(tl.stateAt(40).decks.A.arrangement.length).toBe(STYLES[0].build().arrangement.length);
  });

  it('revertAfterBars desfaz sozinho', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'mute', layer: 'kick' }, { op: 'set_mood', darkness: 0.9 }], { at: 'bar' }, 'x', { revertAfterBars: 8 });
    expect(tl.stateAt(1).decks.A.layers.kick!.muted).toBe(true);
    expect(tl.stateAt(9).decks.A.layers.kick!.muted).toBe(false);
    expect(tl.stateAt(9).decks.A.mood.darkness).toBe(0.4);
    expect(engine.scheduled.map((s) => s.cycle).sort((a, b) => a - b)).toEqual([1, 9]);
  });

  it('desfazer: cancela o que não tocou; o que tocou volta ao estado anterior', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'mute', layer: 'bass' }], { at: 'bar' }, 'a');
    await tl.schedule([{ op: 'mute', layer: 'lead' }], { at: 'phrase' }, 'b');
    expect(await tl.undo()).toMatch(/cancelado: b/);
    expect(tl.snapshot().pending.map((e) => e.label)).toEqual(['a']);

    engine.cycle = 1.5;
    tl.tick();
    expect(tl.state.decks.A.layers.bass!.muted).toBe(true);
    expect(await tl.undo()).toMatch(/desfazendo: a/);
    engine.cycle = 2.1;
    tl.tick();
    expect(tl.state.decks.A.layers.bass!.muted).toBe(false);
  });

  it('cancelGroup remove o grupo e reagenda o resto', async () => {
    const { engine, tl } = await setup();
    const g = tl.newGroup();
    await tl.schedule([{ op: 'mute', layer: 'bass' }], { at: 'bar' }, 'a', { group: g });
    await tl.schedule([{ op: 'mute', layer: 'lead' }], { at: 'phrase' }, 'b');
    await tl.cancelGroup(g);
    expect(tl.snapshot().pending.map((e) => e.label)).toEqual(['b']);
    expect(engine.scheduled.map((s) => s.cycle)).toEqual([8]);
    expect(engine.scheduled[0].code).not.toContain('reese'); // b ainda muta só o lead; o bass voltou
  });
});

describe('Timeline — dois decks', () => {
  it('transição: B entra, BPM vai em rampa de 128 a 124 e no fim B fica no ar', async () => {
    const { engine, tl } = await setup();
    engine.cycle = 3.2;
    const c = await tl.schedule([{ op: 'transition', bars: 16, style: 'filter_swap' }], { at: 'phrase' }, 'xfade');
    expect(c).toBe(8);
    expect(tl.snapshot().pending.map((e) => [e.cycle, e.ops[0].op])).toEqual([
      [8, 'transition'],
      [24, 'end_transition'],
    ]);
    engine.cycle = 8.05;
    tl.tick();
    expect(tl.state.transition?.to).toBe('B');
    engine.cycle = 16;
    tl.tick();
    expect(engine.bpm).toBeCloseTo(126);
    engine.cycle = 24.05;
    tl.tick();
    expect(tl.state.live).toBe('B');
    expect(tl.state.transition).toBeNull();
    expect(engine.bpm).toBe(124);
    // o código no fim só tem o deck B (orbits 11+)
    const last = engine.scheduled.find((s) => s.cycle === 24)!.code;
    expect(last).not.toMatch(/\.orbit\([1-6]\)/);
  });

  it('ops no deck preparado não mudam o som do deck no ar, e valem quando ele entra', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'set_key', key: { root: 'E', scale: 'minor' }, deck: 'B' }], { at: 'bar' }, 'B em mi');
    expect(engine.scheduled[0].code).not.toContain('E1:minor');
    expect(tl.stateAt(2).decks.B.key.root).toBe('E');
    await tl.schedule([{ op: 'transition', bars: 8, style: 'crossfade' }], { at: 'phrase' }, 'x');
    expect(engine.scheduled.find((s) => s.cycle === 8)!.code).toContain('E1:minor');
  });

  it('ops sem deck valem para o deck no ar naquele momento (fixadas no agendamento)', async () => {
    const { tl } = await setup();
    await tl.schedule([{ op: 'mute', layer: 'kick' }], { at: 'bar' }, 'mute');
    expect(tl.snapshot().pending[0].ops[0]).toMatchObject({ deck: 'A' });
  });

  it('não deixa duas transições ao mesmo tempo', async () => {
    const { tl } = await setup();
    await tl.schedule([{ op: 'transition', bars: 16, style: 'crossfade' }], { at: 'bar' }, 'x');
    await expect(tl.schedule([{ op: 'transition', bars: 16, style: 'cut' }], { at: 'bar' }, 'y')).rejects.toThrow(OpError);
  });

  it('parar no meio da transição deixa o deck que entrava no ar', async () => {
    const { engine, tl } = await setup();
    await tl.schedule([{ op: 'transition', bars: 16, style: 'crossfade' }], { at: 'bar' }, 'x');
    engine.cycle = 2;
    tl.tick();
    tl.stop();
    expect(tl.state.live).toBe('B');
    expect(tl.state.transition).toBeNull();
  });
});
