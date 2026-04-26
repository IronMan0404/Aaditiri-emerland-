import 'server-only';
import { openAiCompatibleChat } from './openai-compatible';
import type { AiMessage, AiResult } from './index';

interface OpenAiParams {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  timeoutMs?: number;
  temperature?: number;
}

export async function callOpenAi(p: OpenAiParams): Promise<AiResult> {
  return openAiCompatibleChat({
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    ...p,
  });
}
