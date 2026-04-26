import 'server-only';
import type { AiMessage, AiResult } from './index';

/**
 * Google Gemini chat completion adapter.
 *
 * Why Gemini Flash is our default:
 *   - Free tier: 15 req/min, 1M tokens/day, no credit card. For a society
 *     of a few hundred residents this is effectively unlimited.
 *   - Quality is good enough for our use cases (booking drafts, issue
 *     write-ups, weekly summaries — all short, structured tasks).
 *   - One env var to flip on, one to flip off.
 *
 * API docs:
 *   https://ai.google.dev/api/generate-content
 *
 * The Gemini API has a non-OpenAI-shaped request format: messages are
 * called `contents`, the role enum is `user|model` instead of
 * `user|assistant`, and the system prompt goes in `systemInstruction` at
 * the top level rather than as a `system` message in the array. This
 * adapter does the translation so callers can stay agnostic.
 */

interface GeminiCallParams {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  timeoutMs?: number;
  temperature?: number;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequestBody {
  systemInstruction?: GeminiContent;
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  safetySettings?: Array<{ category: string; threshold: string }>;
}

interface GeminiResponseBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function callGemini(p: GeminiCallParams): Promise<AiResult> {
  const { apiKey, model, messages } = p;
  const timeoutMs = p.timeoutMs ?? 30_000;
  const temperature = p.temperature ?? 0.2;

  // Translate our normalized message list into Gemini's request shape.
  // - First-pass `system` message becomes `systemInstruction`.
  // - Subsequent `system` messages are flattened into the user turn that
  //   follows them (Gemini doesn't accept multiple system blocks).
  let systemInstruction: GeminiContent | undefined;
  const contents: GeminiContent[] = [];
  let pendingSystemPrefix = '';
  for (const m of messages) {
    if (m.role === 'system') {
      if (!systemInstruction) {
        systemInstruction = { role: 'user', parts: [{ text: m.content }] };
      } else {
        pendingSystemPrefix += (pendingSystemPrefix ? '\n\n' : '') + m.content;
      }
      continue;
    }
    const text = pendingSystemPrefix
      ? `${pendingSystemPrefix}\n\n${m.content}`
      : m.content;
    pendingSystemPrefix = '';
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  }
  if (contents.length === 0) {
    return {
      ok: false,
      provider: 'gemini',
      model,
      error: 'No user messages were provided.',
      status: 400,
    };
  }

  const body: GeminiRequestBody = {
    systemInstruction,
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 1024,
    },
    // Loosen the default safety filters one notch each — Gemini's defaults
    // sometimes refuse to draft things like "issue: parking dispute" or
    // "complaint: noisy neighbour" as "harmful." We still keep all four
    // categories on; we just allow medium-confidence content through.
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let msg = `Gemini request failed (${res.status})`;
      try {
        const errJson = (await res.json()) as GeminiResponseBody;
        msg = errJson.error?.message ?? msg;
      } catch {
        // body wasn't JSON; keep the generic message
      }
      return {
        ok: false,
        provider: 'gemini',
        model,
        error: msg,
        status: res.status,
      };
    }

    const data = (await res.json()) as GeminiResponseBody;
    if (data.promptFeedback?.blockReason) {
      return {
        ok: false,
        provider: 'gemini',
        model,
        error: `Gemini blocked the prompt: ${data.promptFeedback.blockReason}`,
        status: 400,
      };
    }
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!text) {
      return {
        ok: false,
        provider: 'gemini',
        model,
        error: 'Gemini returned an empty response.',
        status: 502,
      };
    }
    return { ok: true, provider: 'gemini', model, content: text };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        provider: 'gemini',
        model,
        error: 'Assistant timed out. Try a shorter prompt.',
        status: 504,
      };
    }
    const msg = err instanceof Error ? err.message : 'Network error talking to Gemini.';
    return { ok: false, provider: 'gemini', model, error: msg, status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}
