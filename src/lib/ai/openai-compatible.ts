import 'server-only';
import type { AiMessage, AiResult } from './index';

/**
 * Shared adapter for any provider that speaks OpenAI's
 * `/v1/chat/completions` shape: OpenAI itself, Groq, Together, DeepInfra,
 * Cerebras, Fireworks, Novita, etc.
 *
 * Keep this file dumb: it only translates one wire format. Provider-specific
 * quirks (different default models, different endpoints) live in the small
 * wrapper files (`openai.ts`, `groq.ts`).
 */

interface ChatCompletionRequest {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string };
}

interface CallParams {
  provider: 'openai' | 'groq';
  endpoint: string;
  apiKey: string;
  model: string;
  messages: AiMessage[];
  timeoutMs?: number;
  temperature?: number;
}

export async function openAiCompatibleChat(p: CallParams): Promise<AiResult> {
  const timeoutMs = p.timeoutMs ?? 30_000;
  const temperature = p.temperature ?? 0.2;

  const body: ChatCompletionRequest = {
    model: p.model,
    messages: p.messages,
    temperature,
    max_tokens: 1024,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(p.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = `${p.provider} request failed (${res.status})`;
      try {
        const j = (await res.json()) as ChatCompletionResponse;
        msg = j.error?.message ?? msg;
      } catch { /* keep generic message */ }
      return { ok: false, provider: p.provider, model: p.model, error: msg, status: res.status };
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        ok: false,
        provider: p.provider,
        model: p.model,
        error: `${p.provider} returned an empty response.`,
        status: 502,
      };
    }
    return { ok: true, provider: p.provider, model: p.model, content };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        provider: p.provider,
        model: p.model,
        error: 'Assistant timed out. Try a shorter prompt.',
        status: 504,
      };
    }
    const msg = err instanceof Error ? err.message : `Network error talking to ${p.provider}.`;
    return { ok: false, provider: p.provider, model: p.model, error: msg, status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}
