import { createHash } from 'node:crypto';
import { configInt, configList, configValue } from '@/lib/config';
import { db, nowIso, uid } from '@/lib/db';
import type { AiInvocationOptions, AiOutcome, AiProvider } from './types';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';
import { geminiProvider } from './providers/gemini';

export const AI_PROVIDERS: AiProvider[] = [openaiProvider, anthropicProvider, geminiProvider];

export const HEURISTIC_PROVIDER = 'heuristic-local';

/**
 * Provider order is configurable. `AI_PROVIDER=auto` (default) picks the first provider
 * that has credentials; otherwise the named provider is used exclusively.
 */
export function resolveProvider(): AiProvider | null {
  const configured = configValue('ai.provider').trim().toLowerCase();
  const order = configList('ai.provider_order');

  // "none" means exactly that: no provider, so the deterministic local engine answers. (It was
  // previously handled like "auto", which quietly kept using whichever provider had a key.)
  if (configured === 'none') return null;
  const pool = configured === 'auto' ? order : [configured, ...order.filter((o) => o !== configured)];
  for (const id of pool) {
    const provider = AI_PROVIDERS.find((p) => p.id === id);
    if (provider?.isConfigured()) return provider;
  }
  return null;
}

export function aiStatus(): {
  configured: boolean;
  provider: string | null;
  model: string | null;
  available: { id: string; label: string; configured: boolean }[];
} {
  const provider = resolveProvider();
  return {
    configured: Boolean(provider),
    provider: provider?.id ?? null,
    model: provider?.configuredModel() ?? null,
    available: AI_PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() })),
  };
}

/** Tolerant JSON extraction — models wrap JSON in prose or ```json fences all the time. */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fall through to brace scanning */
  }
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const openChar = candidate[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Runs one AI task with: provider resolution → strict output validation → one repair
 * retry → deterministic local fallback. Every invocation (including failures and
 * fallbacks) is recorded in `ai_analysis` for the admin usage panel.
 *
 * Nothing here invents data: if the model output fails validation we do not guess, we
 * fall back to the local computation and set `usedFallback: true` so callers and the UI
 * can label the result honestly.
 */
export async function runAi<T>(options: AiInvocationOptions<T>): Promise<AiOutcome<T>> {
  const started = Date.now();
  const provider = resolveProvider();
  const userPayload = JSON.stringify(options.input, null, 2);

  const record = async (
    providerId: string,
    model: string,
    status: 'ok' | 'failed' | 'fallback',
    error: string | null,
    tokensIn: number,
    tokensOut: number,
    output: unknown,
  ) => {
    if (!options.userId) return;
    try {
      await db.run(
        `INSERT INTO ai_analysis (id, user_id, kind, provider, model, input_digest, output,
                                  tokens_in, tokens_out, latency_ms, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid(),
          options.userId,
          options.task,
          providerId,
          model,
          digest(userPayload),
          safeStringify(output),
          tokensIn,
          tokensOut,
          Date.now() - started,
          status,
          error,
          nowIso(),
        ],
      );
    } catch (err) {
      console.error('[ai] failed to record ai_analysis:', err);
    }
  };

  const fallbackOutcome = async (error?: string): Promise<AiOutcome<T>> => {
    const data = await options.fallback(options.input as any);
    if (error) await record(HEURISTIC_PROVIDER, 'local-rules', 'fallback', error, 0, 0, data);
    return {
      data,
      provider: HEURISTIC_PROVIDER,
      model: 'local-rules',
      usedFallback: true,
      latencyMs: Date.now() - started,
      error,
      tokensIn: 0,
      tokensOut: 0,
    };
  };

  if (!provider) return fallbackOutcome();

  // Cost control: a user who has used their daily allowance of real AI calls is answered by the
  // local rule engine instead, and the outcome says so.
  if (options.userId) {
    const limit = configInt('ai.max_daily_calls');
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const used = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ai_analysis WHERE user_id = ? AND status = 'ok' AND created_at > ?`, [options.userId, since]);
    if (Number(used?.n ?? 0) >= limit) {
      return fallbackOutcome(`Daily AI call limit (${limit}) reached; answered by the local rule engine instead.`);
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const system =
        attempt === 1
          ? options.system
          : `${options.system}\n\nYour previous reply was not valid JSON matching the required schema. Reply again with ONLY the corrected JSON object, no prose.`;
      const response = await provider.complete({
        system,
        user: userPayload,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });
      const parsed = extractJson<unknown>(response.text);
      if (parsed === null) throw new Error('Model response was not parseable JSON');
      if (options.schema) {
        const result = options.schema.safeParse(parsed);
        if (!result.success) throw new Error(`Model output failed schema validation: ${String(result.error).slice(0, 200)}`);
        await record(provider.id, response.model, 'ok', null, response.tokensIn, response.tokensOut, result.data);
        return {
          data: result.data as T,
          provider: provider.id,
          model: response.model,
          usedFallback: false,
          latencyMs: Date.now() - started,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
        };
      }
      await record(provider.id, response.model, 'ok', null, response.tokensIn, response.tokensOut, parsed);
      return {
        data: parsed as T,
        provider: provider.id,
        model: response.model,
        usedFallback: false,
        latencyMs: Date.now() - started,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2) return fallbackOutcome(message);
    }
  }
  return fallbackOutcome('unreachable');
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function safeStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 60_000 ? `${text.slice(0, 60_000)}…` : text;
  } catch {
    return '{}';
  }
}
