export type AiTask =
  | 'resume_analysis'
  | 'opportunity_queries'
  | 'match_explanation'
  | 'roadmap'
  | 'chat'
  | 'resume_optimization'
  | 'digest'
  | 'trust_assessment'
  | 'eligibility_reasoning';

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresKey: boolean;
  isConfigured(): boolean;
  configuredModel(): string;
  complete(request: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; model: string; tokensIn: number; tokensOut: number }>;
}

export interface AiOutcome<T> {
  data: T;
  provider: string;
  model: string;
  usedFallback: boolean;
  latencyMs: number;
  error?: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiInvocationOptions<T> {
  task: AiTask;
  system: string;
  input: unknown;
  /** zod schema (or any object with `.safeParse`) used to validate model output. */
  schema?: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } };
  /** Deterministic local computation used when no provider is configured or the call fails. */
  fallback: (input: any) => Promise<T> | T;
  maxTokens?: number;
  temperature?: number;
  userId?: string | null;
}
