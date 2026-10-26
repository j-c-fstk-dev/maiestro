import { beforeAll, describe, expect, it } from 'vitest';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import { Autopilot, tierOf } from './autopilot';
import { seeded } from './moves';
import { Timeline } from '../scheduler/timeline';
import { Conductor, type ChatFn } from '../conductor/conductor';
import { FakeEngine } from '../test/fakeEngine';
import { testMix } from '../test/mix';
import { installArrangeHelpers } from '../engine/arrange';
import { renderParts } from '../compiler/compile';

async function setup(opts: { chat?: ChatFn; autonomy?: number; rng?: () => number; clock?: () => number } = {}) {
  const engine = new FakeEngine();
  const errors: string[] = [];
  const tl = new Timeline(engine, testMix(), { onError: (m) => errors.push(m) });
  await tl.play();
  const conductor = opts.chat ? new Conductor(tl, opts.chat) : null;
  const events: string[] = [];
  const ap = new Autopilot(tl, conductor, {
    rng: opts.rng ?? (() => 0),
    clock: opts.clock ?? (() => 0),
    minAiIntervalSec: 20,
    onEvent: (e) => events.push(`${e.kind}: ${e.text}`),
  });
  ap.autonomy = opts.autonomy ?? 100;
  /** avança o relógio de `from` até `to` compassos, como o app faz */
  const run = async (from: number, to: number, step = 0.25) => {
    for (let c = from; c <= to; c += step) {
      engine.cycle = c;
      tl.tick();
      await ap.tick();
    }
  };
  return { engine, tl, ap, events, errors, run };
}

const answer = (ops: unknown[]) => JSON.stringify({ reply: 'ok', plans: [{ when: 'phrase', label: 'ia', ops }] });
const chatOf = (...contents: string[]): { chat: ChatFn; calls: number } => {
  const box = { calls: 0, chat: null as unknown as ChatFn };
  box.chat = async () => ({ content: contents[Math.min(box.calls++, contents.length - 1)], model: 'fake', latencyMs: 1, usage: { total_tokens: 50 } });
  return box;
};

describe('Autopilot', () => {
  it('níveis por autonomia', () => {
    expect([0, 10, 30, 31, 70, 71, 100].map(tierOf)).toEqual([null, 'micro', 'micro', 'medium', 'medium', 'large', 'large']);
  });

  it('autonomia 0 não faz nada', async () => {
    const { ap, run, tl } = await setup({ autonomy: 0 });
    await run(0, 40);
    expect(ap.stats.localMoves).toBe(0);
    expect(tl.snapshot().pending).toEqual([]);
  });

  it('age no máximo uma vez por frase (sem IA → movimento local)', async () => {
    const { ap, run, tl } = await setup({ autonomy: 20 });
    await run(0, 3);
    expect(ap.stats.localMoves).toBe(1);
    expect(tl.snapshot().pending.every((e) => e.source === 'autopilot')).toBe(true);
    await run(3.25, 7.75);
    expect(ap.stats.localMoves).toBe(1);
    await run(8, 11);
    expect(ap.stats.localMoves).toBe(2);
  });

  it('fica quieto quando o usuário mexeu há pouco ou tem mudança dele agendada', async () => {
    const { ap, run, tl, engine } = await setup({ autonomy: 100 });
    engine.cycle = 0.5;
    ap.noteUser();
    await run(1, 11);
    expect(ap.stats.localMoves).toBe(0);
    // fora da janela de silêncio, mas com uma mudança do usuário ainda agendada (compasso 32)
    engine.cycle = 20;
    await tl.schedule([{ op: 'mute', layer: 'bass' }], { at: 'section' }, 'do usuário');
    await run(24, 27);
    expect(ap.stats.localMoves).toBe(0);
    await run(32, 35); // já tocou: o piloto volta a agir
    expect(ap.stats.localMoves).toBe(1);
  });

  it('usa a IA com as ops do nível; a resposta vira mudança de origem "autopilot"', async () => {
    const llm = chatOf(answer([{ op: 'set_pattern', layer: 'hats', pattern: 'offbeat' }]));
    const { ap, run, tl } = await setup({ autonomy: 20, chat: llm.chat });
    await run(0, 3);
    expect(ap.stats.aiMoves).toBe(1);
    expect(ap.stats.aiTokens).toBe(50);
    expect(tl.snapshot().pending[0]).toMatchObject({ source: 'autopilot', label: 'ia' });
  });

  it('op fora do nível é recusada; depois de 2 tentativas cai para movimento local', async () => {
    const llm = chatOf(answer([{ op: 'set_key', root: 'C', scale: 'major' }]));
    const { ap, run, events } = await setup({ autonomy: 20, chat: llm.chat });
    await run(0, 3);
    expect(llm.calls).toBe(2);
    expect(ap.stats.aiMoves).toBe(0);
    expect(ap.stats.localMoves).toBe(1);
    expect(events.some((e) => e.startsWith('error:') && e.includes('set_key'))).toBe(true);
  });

  it('respeita o intervalo mínimo entre chamadas à IA', async () => {
    let ms = 0;
    const llm = chatOf(answer([{ op: 'set_master', filter: 0.4 }]));
    const { ap, run } = await setup({ autonomy: 20, chat: llm.chat, clock: () => ms });
    await run(0, 3);
    ms = 5_000; // 5 s depois: ainda dentro dos 20 s
    await run(8, 11);
    expect(llm.calls).toBe(1);
    expect([ap.stats.aiMoves, ap.stats.localMoves]).toEqual([1, 1]);
  });

  it('nível grande troca de música sozinho depois de um tempo', async () => {
    const { ap, run, tl } = await setup({ autonomy: 100, rng: () => 0.99 }); // 0.99: não sorteia variações
    await run(0, 170);
    expect(ap.stats.rotations).toBe(1);
    // carregou outra música no B e a transição já começou (ou vai começar) na próxima seção
    expect(tl.stateAt(Infinity).live).toBe('B');
    expect(tl.stateAt(Infinity).decks.B.style).not.toBe('melodic');
    const bpm = tl.stateAt(Infinity).decks.B.bpm;
    expect(bpm).toBeGreaterThanOrEqual(115); // techno 128 ± 10%
    expect(bpm).toBeLessThanOrEqual(141);
  });
});

describe('Autopilot — 30 minutos sozinho (simulação)', () => {
  beforeAll(async () => {
    await core.evalScope(core, mini, tonal);
    mini.miniAllStrings();
    installArrangeHelpers();
  });

  it('100% sem IA: varia, troca de música várias vezes e todo código gerado roda no Strudel', async () => {
    const { ap, run, engine, errors, tl } = await setup({ autonomy: 100, rng: seeded(42) });
    const codes = new Set<string>();
    const origSchedule = engine.schedule.bind(engine);
    engine.schedule = async (parts, cycle) => {
      codes.add(renderParts(parts));
      return origSchedule(parts, cycle);
    };
    const styles = new Set<string>();
    // 30 min a ~128 BPM ≈ 960 compassos
    for (let block = 0; block < 960; block += 32) {
      await run(block, block + 31.75);
      styles.add(tl.state.decks[tl.state.live].style);
    }
    expect(errors).toEqual([]);
    expect(ap.stats.rotations).toBeGreaterThanOrEqual(5);
    expect(ap.stats.localMoves).toBeGreaterThan(40);
    expect(styles.size).toBeGreaterThanOrEqual(3);
    for (const code of codes) {
      const { pattern } = await core.evaluate(code, transpiler);
      expect(pattern.queryArc(0, 1)).toBeDefined();
    }
  }, 60_000);
});
