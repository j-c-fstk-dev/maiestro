import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Proxy do LLM. Roda dentro do servidor de desenvolvimento do Vite:
 * o navegador chama POST /api/llm e a chave fica só aqui (lida do .env).
 * `callLlm` também é usado direto pelo `npm run eval:ai`.
 *
 * Corpo aceito: { messages: [{role, content}], temperature?, json? }
 * Resposta: { content, model, latencyMs, usage, retries } ou { error }
 */
export interface LlmEnv {
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  /** alternativa a LLM_API_KEY (nome usado na doc da z.ai) */
  ZAI_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_JSON_MODE?: string;
  LLM_EXTRA_BODY?: string;
}

export interface LlmInput {
  messages: { role: string; content: string }[];
  temperature?: number;
  json?: boolean;
}

export interface LlmOutput {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  latencyMs: number;
  retries: number;
}

export class LlmError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function llmProxy(env: LlmEnv): Plugin {
  return {
    name: 'maestro-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm', (req, res) => {
        handle(env, req, res).catch((err) =>
          send(res, err instanceof LlmError ? err.status : 500, { error: String(err?.message ?? err) }),
        );
      });
    },
  };
}

async function handle(env: LlmEnv, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
  const input = JSON.parse(await readBody(req)) as LlmInput;
  send(res, 200, await callLlm(env, input));
}

export async function callLlm(env: LlmEnv, input: LlmInput): Promise<LlmOutput> {
  const apiKey = env.LLM_API_KEY || env.ZAI_API_KEY;
  if (!apiKey || apiKey === 'coloque-sua-chave-aqui') {
    throw new LlmError(500, 'LLM_API_KEY (ou ZAI_API_KEY) não configurada no .env');
  }
  const baseUrl = (env.LLM_BASE_URL ?? 'https://api.z.ai/api/paas/v4').replace(/\/$/, '');
  const model = env.LLM_MODEL ?? 'glm-4.7-flash';
  let extra: Record<string, unknown> = {};
  if (env.LLM_EXTRA_BODY) {
    try {
      extra = JSON.parse(env.LLM_EXTRA_BODY);
    } catch {
      throw new LlmError(500, 'LLM_EXTRA_BODY não é um JSON válido');
    }
  }

  const body = {
    model,
    messages: input.messages,
    temperature: input.temperature ?? 0.4,
    ...(input.json && env.LLM_JSON_MODE !== 'false' ? { response_format: { type: 'json_object' } } : {}),
    ...extra,
  };

  const started = Date.now();
  let upstream: Response;
  let retries = 0;
  // os modelos Flash gratuitos têm limite de requisições por minuto: em 429, espera e tenta de novo
  for (;;) {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (upstream.status !== 429 || retries >= MAX_RETRIES) break;
    const retryAfter = Number(upstream.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * 2 ** retries);
    retries++;
  }
  const latencyMs = Date.now() - started;
  const text = await upstream.text();

  if (!upstream.ok) {
    throw new LlmError(upstream.status, `provedor respondeu ${upstream.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? model,
    usage: data.usage,
    latencyMs,
    retries,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data || '{}'));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}
