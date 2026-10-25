/** Cliente do LLM no navegador. Só conversa com o proxy local (/api/llm). */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  content: string;
  model: string;
  latencyMs: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export async function chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}) {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, ...opts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `erro ${res.status}`);
  return data as LlmResult;
}

/** Extrai o primeiro objeto JSON da resposta (alguns modelos embrulham em ```json). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('resposta sem JSON');
  return JSON.parse(raw.slice(start, end + 1));
}
