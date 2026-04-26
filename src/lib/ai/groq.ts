import 'server-only';
import { openAiCompatibleChat } from './openai-compatible';
import type { AiMessage, AiResult } from './index';

interface GroqParams {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  timeoutMs?: number;
  temperature?: number;
}

export async function callGroq(p: GroqParams): Promise<AiResult> {
  return openAiCompatibleChat({
    provider: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    ...p,
  });
}
