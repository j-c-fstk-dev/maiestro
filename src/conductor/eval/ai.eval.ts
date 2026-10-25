import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from 'vite';
import { callLlm } from '../../../server/llmProxy';
import { Conductor, type ChatFn } from '../conductor';
import { Timeline } from '../../scheduler/timeline';
import { FakeEngine } from '../../test/fakeEngine';
import { testMix } from '../../test/mix';
import { PROMPT_VERSION } from '../prompt';
import { CASES } from './cases';

/**
 * Avaliação do maestro com o LLM de verdade (usa a chave do .env).
 * `npm run eval:ai` — roda os casos em sequência e imprime um relatório.
 */

const env = loadEnv('development', process.cwd(), '');
const chat: ChatFn = (messages, opts) => callLlm(env, { messages, ...opts });
const PAUSE_MS = Number(env.EVAL_PAUSE_MS ?? 1500); // respeita o limite por minuto dos modelos grátis

const rows: { name: string; ok: boolean; detail: string; attempts: number; ms: number; tokens: number }[] = [];

describe(`maestro ${PROMPT_VERSION} · ${env.LLM_MODEL ?? 'glm-4.7-flash'}`, () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const engine = new FakeEngine();
      const tl = new Timeline(engine, testMix());
      await tl.play();
      for (const op of c.setup ?? []) await tl.schedule([op], { at: 'bar' }, 'setup');
      engine.cycle = 45;
      tl.tick();
      for (const op of c.pendingSetup ?? []) await tl.schedule([op], { at: 'phrase' }, 'setup');

      const conductor = new Conductor(tl, chat);
      let detail = '';
      let ok = false;
      let attempts = 0;
      let ms = 0;
      let tokens = 0;
      try {
        const r = await conductor.ask(c.prompt);
        attempts = r.attempts;
        ms = r.latencyMs;
        tokens = r.tokens;
        const problem = c.check(r, tl);
        ok = !problem;
        detail = problem ?? r.reply;
      } catch (err) {
        detail = `falhou: ${(err as Error).message}`;
      }
      rows.push({ name: c.name, ok, detail, attempts, ms, tokens });
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      expect(ok, detail).toBe(true);
    });
  }

  afterAll(() => {
    const passed = rows.filter((r) => r.ok).length;
    const avg = (k: 'ms' | 'tokens') => Math.round(rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length));
    const lines = rows.map(
      (r) => `${r.ok ? '✔' : '✘'} ${r.name.padEnd(38)} ${String(r.attempts || '-').padStart(1)}x ${String(r.ms).padStart(6)}ms  ${r.detail.slice(0, 110)}`,
    );
    console.log(
      `\n=== MAESTRO ${PROMPT_VERSION} · ${env.LLM_MODEL ?? 'glm-4.7-flash'} ===\n${lines.join('\n')}\n` +
        `--- ${passed}/${rows.length} ok · latência média ${avg('ms')}ms · ${avg('tokens')} tokens/pedido\n`,
    );
  });
});
