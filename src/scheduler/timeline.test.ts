import { describe, expect, it } from 'vitest';
import { Timeline, type EngineLike } from './timeline';
import { STYLES } from '../presets/styles';
import { OpError } from '../song/ops';

class FakeEngine implements EngineLike {
  isPlaying = false;
  cycle = 0;
  bpm = 0;
  scheduled: { cycle: number; code: string }[] = [];
  played: string[] = [];
  failCode: ((code: string) => boolean) | null = null;
  now() {
    return this.cycle;
  }
  minCycle() {
    return this.cycle + 0.1;
  }
  async play(code: string) {
    this.isPlaying = true;
    this.played.push(code);
    return true;
  }
  async schedule(code: string, cycle: number) {
    if (this.failCode?.(code)) return false;
    this.scheduled = [...this.scheduled.filter((s) => s.cycle !== cycle), { cycle, code }];
    return true;
  }
  cancelPending(from = -Infinity) {
    this.scheduled = this.scheduled.filter((s) => s.cycle < from);
  }
  stop() {
    this.isPlaying = false;
  }
  setBpm(bpm: number) {
    this.bpm = bpm;
  }
}

const setup = async () => {
  const engine = new FakeEngine();
  const errors: string[] = [];
  const tl = new Timeline(engine, STYLES[0].build(), { onError: (m) => errors.push(m) });
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
    expect(tl.state.layers.kick!.muted).toBe(false);
    engine.cycle = 3.01;
    tl.tick();
    expect(tl.state.layers.kick!.muted).toBe(true);
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

  it('se o motor recusar o código, a mudança é descartada', async () => {
    const { engine, tl, errors } = await setup();
    engine.failCode = () => true;
    await tl.schedule([{ op: 'mute', layer: 'kick' }], { at: 'bar' }, 'mute');
    expect(tl.snapshot().pending).toEqual([]);
    expect(errors.length).toBe(1);
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
    const tl = new Timeline(engine, STYLES[0].build());
    await tl.schedule([{ op: 'set_gain', layer: 'bass', gain: 0.3 }], { at: 'bar' }, 'g');
    expect(tl.state.layers.bass!.gain).toBe(0.3);
    expect(engine.scheduled).toEqual([]);
  });
});
