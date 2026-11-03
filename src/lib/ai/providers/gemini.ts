import type { AiProvider } from '../types';

export const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  requiresKey: true,

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY);
  },

  configuredModel() {
    return process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
  },

  async complete({ system, user, maxTokens = 2000, temperature = 0.2 }) {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '';
    const base = (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const url = `${base}/v1beta/models/${this.configuredModel()}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as any;
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('\n') ?? '';
    return {
      text,
      model: json?.modelVersion ?? this.configuredModel(),
      tokensIn: json?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};
