import type { AiProvider } from '../types';

/**
 * OpenAI-compatible provider. Works with OpenAI, Azure OpenAI, Groq, Together, OpenRouter,
 * LM Studio and any other service exposing `/v1/chat/completions` — selected purely by
 * environment variables, so the app is never hard-wired to one vendor.
 */
export const openaiProvider: AiProvider = {
  id: 'openai',
  label: 'OpenAI-compatible (OpenAI / Azure / Groq / OpenRouter / local)',
  requiresKey: true,

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  configuredModel() {
    return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  },

  async complete({ system, user, maxTokens = 2000, temperature = 0.2 }) {
    const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.OPENAI_API_KEY ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}),
        ...(process.env.OPENAI_ORG_ID ? { 'openai-organization': process.env.OPENAI_ORG_ID } : {}),
      },
      body: JSON.stringify({
        model: this.configuredModel(),
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as any;
    return {
      text: json?.choices?.[0]?.message?.content ?? '',
      model: json?.model ?? this.configuredModel(),
      tokensIn: json?.usage?.prompt_tokens ?? 0,
      tokensOut: json?.usage?.completion_tokens ?? 0,
    };
  },
};
