import { OpError } from '../song/ops';
import type { Source, Timeline } from '../scheduler/timeline';
import { extractJson, type ChatMessage, type LlmResult } from './llmClient';
import { describeContext, systemPrompt } from './prompt';
import { AiResponseSchema, toOp, toWhen, zodMessage, type AiResponse } from './schema';

/**
 * O maestro: recebe um pedido em linguagem natural, pergunta ao LLM, valida a resposta
 * e agenda os planos na Timeline. Se a resposta vier inválida (JSON quebrado, op que não
 * existe, padrão que não serve pra camada…), devolve o erro ao LLM e tenta mais uma vez.
 * Nada disso toca no áudio: no pior caso, nada muda.
 */

export type ChatFn = (messages: ChatMessage[], opts: { json?: boolean; temperature?: number }) => Promise<LlmResult>;

export interface Scheduled {
  cycle: number | null;
  label: string;
}

export interface AskResult {
  reply: string;
  scheduled: Scheduled[];
  undone: string | null;
  attempts: number;
  latencyMs: number;
  tokens: number;
  model: string;
  /** a resposta já convertida (útil para avaliação e debug) */
  response: AiResponse;
}

export class ConductorError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
  }
}

export interface AskOptions {
  /** quem pediu (aparece em "agendado" e no log da sessão) */
  source?: Source;
  /** só estas ops são aceitas (piloto automático); outras voltam como erro para a IA */
  allowedOps?: ReadonlySet<string>;
  /** guardar na memória de conversa (padrão: sim) */
  remember?: boolean;
}

const MAX_ATTEMPTS = 2;
/** pares pedido/resposta lembrados, para "volta como estava", "mais um pouco" etc. */
const MEMORY = 4;

export class Conductor {
  private memory: ChatMessage[] = [];

  constructor(
    private timeline: Timeline,
    private chat: ChatFn,
  ) {}

  async ask(text: string, opts: AskOptions = {}): Promise<AskResult> {
    const snap = this.timeline.snapshot();
    const context = describeContext(this.timeline.stateAt(Infinity), this.timeline.now(), snap.playing, snap.pending);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt() },
      ...this.memory,
      { role: 'user', content: `${context}\n\nPEDIDO: ${text}` },
    ];

    let latencyMs = 0;
    let tokens = 0;
    let lastError = '';
    // o "desfazer" pedido pela IA roda uma vez só, mesmo que a resposta precise ser refeita
    let undone: string | null | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await this.chat(messages, { json: true, temperature: 0.3 });
      latencyMs += res.latencyMs;
      tokens += res.usage?.total_tokens ?? 0;

      const parsed = parse(res.content, opts.allowedOps);
      if (!parsed.ok) {
        lastError = parsed.error;
      } else {
        if (parsed.value.undo && undone === undefined) undone = await this.timeline.undo();
        const outcome = await this.execute(parsed.value, opts.source ?? 'ai');
        if (outcome.ok) {
          if (opts.remember !== false) this.remember(text, res.content);
          return {
            reply: parsed.value.reply,
            scheduled: outcome.scheduled,
            undone: undone ?? null,
            attempts: attempt,
            latencyMs,
            tokens,
            model: res.model,
            response: parsed.value,
          };
        }
        lastError = outcome.error;
      }
      messages.push(
        { role: 'assistant', content: res.content },
        { role: 'user', content: `Sua resposta não pôde ser usada: ${lastError}. Corrija e responda de novo SOMENTE com o JSON.` },
      );
    }
    throw new ConductorError(lastError, MAX_ATTEMPTS);
  }

  private async execute(
    resp: AiResponse,
    source: Source,
  ): Promise<{ ok: true; scheduled: Scheduled[] } | { ok: false; error: string }> {
    const group = this.timeline.newGroup();
    const scheduled: Scheduled[] = [];
    let previous: number | null = null;
    const nextBar = this.timeline.resolve({ at: 'bar' });

    for (const [i, plan] of resp.plans.entries()) {
      try {
        const cycle = await this.timeline.schedule(
          plan.ops.map(toOp),
          toWhen(plan.when, previous, nextBar),
          plan.label || resp.reply.slice(0, 60),
          { source, group, revertAfterBars: plan.forBars },
        );
        previous = cycle ?? previous;
        scheduled.push({ cycle, label: plan.label });
      } catch (err) {
        if (!(err instanceof OpError)) throw err;
        await this.timeline.cancelGroup(group);
        return { ok: false, error: `plano ${i + 1} ("${plan.label}"): ${err.message}` };
      }
    }
    return { ok: true, scheduled };
  }

  private remember(text: string, answer: string) {
    this.memory.push({ role: 'user', content: `PEDIDO: ${text}` }, { role: 'assistant', content: answer });
    this.memory = this.memory.slice(-MEMORY * 2);
  }
}

function parse(content: string, allowed?: ReadonlySet<string>): { ok: true; value: AiResponse } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(content);
  } catch (e) {
    return { ok: false, error: `JSON inválido (${(e as Error).message})` };
  }
  const r = AiResponseSchema.safeParse(json);
  if (!r.success) return { ok: false, error: `formato inválido: ${zodMessage(r.error)}` };
  if (allowed) {
    const bad = [...new Set(r.data.plans.flatMap((p) => p.ops.map((o) => o.op)).filter((op) => !allowed.has(op)))];
    if (bad.length) return { ok: false, error: `operações não permitidas agora: ${bad.join(', ')} (permitidas: ${[...allowed].join(', ')})` };
  }
  return { ok: true, value: r.data };
}
