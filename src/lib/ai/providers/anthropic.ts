import type { AiProvider } from '../types';

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  requiresKey: true,

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  configuredModel() {
    return process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';
  },

  async complete({ system, user, maxTokens = 2000, temperature = 0.2 }) {
    const base = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.configuredModel(),
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 60_000)),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as any;
    const text = Array.isArray(json?.content)
      ? json.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      : '';
    return {
      text,
      model: json?.model ?? this.configuredModel(),
      tokensIn: json?.usage?.input_tokens ?? 0,
      tokensOut: json?.usage?.output_tokens ?? 0,
    };
  },
};
