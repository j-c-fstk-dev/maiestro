import { describe, expect, it } from 'vitest';
import { Conductor, ConductorError, type ChatFn } from './conductor';
import { Timeline } from '../scheduler/timeline';
import { FakeEngine } from '../test/fakeEngine';
import { STYLES } from '../presets/styles';
import { systemPrompt, describeContext } from './prompt';

/** LLM de mentira: devolve as respostas na ordem e guarda as mensagens recebidas. */
function scripted(...answers: unknown[]) {
  const calls: { role: string; content: string }[][] = [];
  const chat: ChatFn = async (messages) => {
    calls.push(messages.map((m) => ({ ...m })));
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { content: typeof a === 'string' ? a : JSON.stringify(a), model: 'fake', latencyMs: 5, usage: { total_tokens: 100 } };
  };
  return { chat, calls };
}

async function setup(...answers: unknown[]) {
  const engine = new FakeEngine();
  const tl = new Timeline(engine, STYLES[0].build());
  await tl.play();
  engine.cycle = 3.2;
  const llm = scripted(...answers);
  return { engine, tl, llm, conductor: new Conductor(tl, llm.chat) };
}

const EXAMPLE = {
  reply: 'ok',
  plans: [
    { when: 'section', label: 'sem beat', forBars: 8, ops: [{ op: 'mute', layer: 'kick' }] },
    { when: { after: 0 }, label: 'coro', ops: [{ op: 'add_layer', layer: 'vocal', instrument: 'choir_aah', pattern: 'vox_long' }] },
    { when: { after: 8 }, label: 'build e drop', ops: [{ op: 'insert_sections', sections: [{ type: 'build', bars: 8 }, { type: 'drop', bars: 16 }] }] },
    { when: { section: 'drop' }, label: 'sombrio', ops: [{ op: 'set_key', root: 'a', scale: 'phrygian' }, { op: 'set_mood', darkness: '0.85' }] },
  ],
};

describe('Conductor', () => {
  it('o pedido de exemplo vira planos encadeados no tempo certo', async () => {
    const { conductor, tl } = await setup(EXAMPLE);
    const r = await conductor.ask('na próxima seção tira o beat, põe voz etérea, faz build e drop e deixa sombrio');
    expect(r.attempts).toBe(1);
    expect(r.scheduled.map((s) => s.cycle)).toEqual([16, 16, 24, 32]);
    expect(tl.stateAt(16).layers.kick!.muted).toBe(true);
    expect(tl.stateAt(16).layers.vocal?.instrument).toBe('choir_aah');
    expect(tl.stateAt(24).layers.kick!.muted).toBe(false); // forBars 8
    expect(tl.stateAt(32).key).toEqual({ root: 'A', scale: 'phrygian' });
    expect(tl.stateAt(32).mood.darkness).toBe(0.85);
  });

  it('JSON quebrado → devolve o erro à IA e aceita a correção', async () => {
    const { conductor, llm } = await setup('isso não é json', EXAMPLE);
    const r = await conductor.ask('x');
    expect(r.attempts).toBe(2);
    expect(llm.calls[1].at(-1)!.content).toMatch(/JSON inválido/);
  });

  it('padrão inexistente → erro volta para a IA, nada fica agendado da tentativa ruim', async () => {
    const bad = { reply: 'x', plans: [{ when: 'bar', label: 'a', ops: [{ op: 'mute', layer: 'kick' }] }, { when: 'bar', label: 'b', ops: [{ op: 'set_pattern', layer: 'hats', pattern: 'tumbadora' }] }] };
    const good = { reply: 'ok', plans: [{ when: 'bar', label: 'hats', ops: [{ op: 'set_pattern', layer: 'hats', pattern: 'offbeat' }] }] };
    const { conductor, tl, llm } = await setup(bad, good);
    const r = await conductor.ask('muda o chimbal');
    expect(r.attempts).toBe(2);
    expect(llm.calls[1].at(-1)!.content).toMatch(/tumbadora/);
    expect(tl.snapshot().pending.map((e) => e.label)).toEqual(['hats']);
  });

  it('desiste depois de 2 tentativas sem mexer na música', async () => {
    const { conductor, tl } = await setup({ plans: [{ when: 'bar', ops: [{ op: 'explodir' }] }] });
    await expect(conductor.ask('x')).rejects.toThrow(ConductorError);
    expect(tl.snapshot().pending).toEqual([]);
  });

  it('undo pedido pela IA', async () => {
    const { conductor, tl } = await setup({ reply: 'desfeito', plans: [], undo: true });
    await tl.schedule([{ op: 'mute', layer: 'bass' }], { at: 'bar' }, 'mute bass');
    const r = await conductor.ask('volta como estava');
    expect(r.undone).toMatch(/mute bass/);
    expect(tl.snapshot().pending).toEqual([]);
  });

  it('lembra as últimas conversas', async () => {
    const { conductor, llm } = await setup(EXAMPLE);
    await conductor.ask('primeiro');
    await conductor.ask('segundo');
    const second = llm.calls[1];
    expect(second.some((m) => m.content.includes('PEDIDO: primeiro'))).toBe(true);
  });

  it('prompt e contexto citam o catálogo e o estado', async () => {
    const { tl, engine } = await setup(EXAMPLE);
    const sys = systemPrompt();
    expect(sys).toContain('choir_aah');
    expect(sys).toContain('four_fill');
    const ctx = describeContext(tl.state, engine.now(), true, []);
    expect(ctx).toContain('[intro:16]');
    expect(ctx).toContain('vocal: (vazia)');
  });
});
