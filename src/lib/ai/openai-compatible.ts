import 'server-only';
import type {
  AiMessage,
  AiResult,
  AiToolCall,
  AiToolDescriptor,
  AiToolMessage,
  AiToolResultMessage,
} from './index';

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

// ---- Tool-calling variant -----------------------------------------------

interface ToolCallParams {
  provider: 'openai' | 'groq';
  endpoint: string;
  apiKey: string;
  model: string;
  messages: AiToolMessage[];
  tools: AiToolDescriptor[];
  tool_choice: 'auto' | 'none' | 'required';
  timeoutMs?: number;
  temperature?: number;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ToolChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
  error?: { message?: string };
}

/**
 * Convert our internal AiToolMessage shapes into the wire shape OpenAI/Groq
 * expect. The trick is that an "assistant" turn that includes tool_calls
 * must have `content: null` (or empty), and tool results must have
 * `role: 'tool'` with a `tool_call_id`.
 */
function toWire(m: AiToolMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: m.tool_call_id,
      content: m.content,
    };
  }
  if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls && m.tool_calls.length > 0) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.tool_calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

export async function openAiCompatibleChatWithTools(p: ToolCallParams): Promise<AiToolResultMessage> {
  const timeoutMs = p.timeoutMs ?? 30_000;
  const temperature = p.temperature ?? 0.2;

  const body = {
    model: p.model,
    messages: p.messages.map(toWire),
    tools: p.tools,
    tool_choice: p.tool_choice,
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
        const j = (await res.json()) as ToolChatResponse;
        msg = j.error?.message ?? msg;
      } catch { /* keep generic message */ }
      return { ok: false, provider: p.provider, model: p.model, error: msg, status: res.status };
    }
    const data = (await res.json()) as ToolChatResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;
    const content = (message?.content ?? '').trim();
    const rawCalls = Array.isArray(message?.tool_calls) ? message?.tool_calls ?? [] : [];
    const tool_calls: AiToolCall[] = rawCalls
      .filter((c) => c && c.type === 'function' && typeof c.function?.name === 'string')
      .map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
      }));

    if (!content && tool_calls.length === 0) {
      return {
        ok: false,
        provider: p.provider,
        model: p.model,
        error: `${p.provider} returned an empty response.`,
        status: 502,
      };
    }
    return { ok: true, provider: p.provider, model: p.model, content, tool_calls };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        provider: p.provider,
        model: p.model,
        error: 'Assistant timed out. Try again.',
        status: 504,
      };
    }
    const msg = err instanceof Error ? err.message : `Network error talking to ${p.provider}.`;
    return { ok: false, provider: p.provider, model: p.model, error: msg, status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

// Suppress unused-variable warning while we keep the AiMessage type re-export
// path consistent. (Imported above purely so callers see one source of truth.)
export type { AiMessage, AiResult };
