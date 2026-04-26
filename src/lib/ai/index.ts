import 'server-only';

/**
 * Provider-agnostic AI chat adapter.
 *
 * The community assistant (and any future AI feature) calls `callAi()` with
 * a message list and gets back a text reply. The actual provider (Gemini,
 * OpenAI, Groq, …) is selected at deploy time via env vars:
 *
 *   AI_PROVIDER       gemini | openai | groq | none
 *   AI_API_KEY        provider API key
 *   AI_MODEL          provider-specific model id (optional, has defaults)
 *
 * Why this lives behind an interface:
 *   - We started on Ollama (local, can't run on Vercel) and have already
 *     migrated once. Lock-in to any single provider would burn us again.
 *   - Providers' rate limits / pricing change. Being able to swap without
 *     touching call sites means a one-line env change instead of a PR.
 *   - Free-tier signups die without warning (Google, OpenAI, etc.). If the
 *     primary provider is unreachable, callers get a clean structured error
 *     and can fall back to a canned response rather than blowing up.
 *
 * We deliberately do NOT support streaming yet. The assistant page fits in
 * one short turn and a non-streaming JSON response keeps the route handler
 * trivially serverless-friendly. Add streaming when there's a real UX win.
 */

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiCallOptions {
  /** Hard timeout in ms. Defaults to 30s — enough for Gemini Flash + slack. */
  timeoutMs?: number;
  /** Sampling temperature. Default 0.2 (factual, terse). */
  temperature?: number;
}

export type AiResult =
  | { ok: true; provider: string; model: string; content: string }
  | { ok: false; provider: string; model: string; error: string; status: number };

// ---- Tool-calling types -------------------------------------------------

/** Single tool call emitted by the model. We mirror OpenAI's wire shape. */
export interface AiToolCall {
  id: string;
  name: string;
  /** JSON-stringified arguments (the model returns a string here, not parsed JSON). */
  arguments: string;
}

/** Assistant turn with optional tool calls. `content` may be empty when the
 *  model only returned tool calls. */
export interface AiAssistantTurn {
  role: 'assistant';
  content: string;
  tool_calls?: AiToolCall[];
}

/** Result of a tool execution that we feed back to the model as the next turn. */
export interface AiToolResult {
  role: 'tool';
  tool_call_id: string;
  /** Stringified JSON output of the tool. */
  content: string;
}

/** Extended message type for tool-calling conversations. */
export type AiToolMessage = AiMessage | AiAssistantTurn | AiToolResult;

export interface AiToolDescriptor {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiToolCallOptions extends AiCallOptions {
  tools: AiToolDescriptor[];
  /** 'auto' (default), 'none', or 'required'. */
  tool_choice?: 'auto' | 'none' | 'required';
}

export type AiToolResultMessage =
  | { ok: true; provider: string; model: string; content: string; tool_calls: AiToolCall[] }
  | { ok: false; provider: string; model: string; error: string; status: number };

export type AiProvider = 'gemini' | 'openai' | 'groq' | 'none';

interface ResolvedConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

// Gemini 1.5-* aliases were retired from the v1beta API in late 2025.
// 2.0-flash is the free, current "fast" tier. 2.5-flash is also free
// and has slightly better quality but tighter free-tier rate limits.
// Override per-deployment via AI_MODEL env var if you want to switch.
const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.1-8b-instant',
  none: 'none',
};

function resolveConfig(): ResolvedConfig | { error: string } {
  const raw = (process.env.AI_PROVIDER ?? 'none').toLowerCase().trim();
  const provider = (['gemini', 'openai', 'groq', 'none'] as const).includes(raw as AiProvider)
    ? (raw as AiProvider)
    : 'none';

  if (provider === 'none') {
    return { error: 'AI assistant is not configured. Set AI_PROVIDER and AI_API_KEY in env.' };
  }

  const apiKey = process.env.AI_API_KEY ?? '';
  if (!apiKey) {
    return { error: `AI_PROVIDER=${provider} but AI_API_KEY is missing.` };
  }

  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODELS[provider];
  return { provider, apiKey, model };
}

/** Public probe so the UI / health checks can render a sensible "not configured" message. */
export function getAiProviderInfo(): { provider: AiProvider; model: string; configured: boolean } {
  const cfg = resolveConfig();
  if ('error' in cfg) {
    const provider = (process.env.AI_PROVIDER ?? 'none').toLowerCase() as AiProvider;
    return {
      provider: (['gemini', 'openai', 'groq'] as const).includes(provider as 'gemini') ? provider : 'none',
      model: DEFAULT_MODELS[provider] ?? 'none',
      configured: false,
    };
  }
  return { provider: cfg.provider, model: cfg.model, configured: true };
}

export async function callAi(
  messages: AiMessage[],
  options: AiCallOptions = {},
): Promise<AiResult> {
  const cfg = resolveConfig();
  if ('error' in cfg) {
    return { ok: false, provider: 'none', model: 'none', error: cfg.error, status: 503 };
  }

  if (cfg.provider === 'gemini') {
    const { callGemini } = await import('./gemini');
    return callGemini({ ...cfg, messages, ...options });
  }
  if (cfg.provider === 'openai') {
    const { callOpenAi } = await import('./openai');
    return callOpenAi({ ...cfg, messages, ...options });
  }
  if (cfg.provider === 'groq') {
    const { callGroq } = await import('./groq');
    return callGroq({ ...cfg, messages, ...options });
  }
  return {
    ok: false,
    provider: cfg.provider,
    model: cfg.model,
    error: `Unsupported provider: ${cfg.provider}`,
    status: 500,
  };
}

/**
 * Tool-calling chat. Currently supported only for OpenAI-compatible providers
 * (OpenAI itself + Groq). Gemini's tool-calling shape is different enough that
 * we'd need a separate adapter; we'll add it when there's a real reason.
 *
 * Returns the assistant turn including any tool_calls the model wants to make.
 * Callers are responsible for executing the tool calls and looping back with
 * the results until the model produces a final text reply.
 */
export async function callAiWithTools(
  messages: AiToolMessage[],
  options: AiToolCallOptions,
): Promise<AiToolResultMessage> {
  const cfg = resolveConfig();
  if ('error' in cfg) {
    return { ok: false, provider: 'none', model: 'none', error: cfg.error, status: 503 };
  }

  if (cfg.provider === 'openai' || cfg.provider === 'groq') {
    const { openAiCompatibleChatWithTools } = await import('./openai-compatible');
    const endpoint =
      cfg.provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    return openAiCompatibleChatWithTools({
      provider: cfg.provider,
      endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      tools: options.tools,
      tool_choice: options.tool_choice ?? 'auto',
      timeoutMs: options.timeoutMs,
      temperature: options.temperature,
    });
  }

  // Gemini tool-calling has a meaningfully different protocol; not wired yet.
  return {
    ok: false,
    provider: cfg.provider,
    model: cfg.model,
    error: `Tool-calling is not supported for provider "${cfg.provider}". Use AI_PROVIDER=groq or openai.`,
    status: 501,
  };
}
