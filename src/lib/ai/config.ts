/**
 * AI assistant configuration — everything bounded and env-driven.
 * Secrets are read here on the server only and never logged.
 *
 * Default provider is Amazon Bedrock (AI_PROVIDER=bedrock) running
 * Claude Haiku 4.5. Bedrock is authenticated by the standard AWS SDK
 * credential chain (env AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
 * shared config, or an IAM role) — there is NO provider API key.
 * The OpenAI-compatible adapter remains available with
 * AI_PROVIDER=openai-compatible + AI_API_KEY.
 *
 * Kill switch: AI_ASSISTANT_ENABLED=false turns the endpoint and the
 * page off immediately (rollback = set the flag + redeploy, or just the
 * flag where the platform supports runtime env changes).
 */
export interface AiConfig {
  enabled: boolean;
  providerKind: string;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  /** AWS region for Bedrock (and the SDK credential chain). */
  awsRegion: string;
  maxToolExecutions: number;
  maxEvidenceRounds: number;
  maxModelRounds: number;
  toolTimeoutMs: number;
  requestTimeoutMs: number;
  modelTimeoutMs: number;
  /** Optional USD prices per 1M tokens for cost ESTIMATES; null →
   * cost is reported as unknown, never as 0. */
  pricePerMillion: { input: number; output: number } | null;
}

export const BEDROCK_DEFAULT_MODEL = "anthropic.claude-haiku-4-5-20251001-v1:0";
/** Published Bedrock price for Claude Haiku 4.5, global routing,
 * USD per 1M tokens — used only for cost ESTIMATES in traces. */
export const BEDROCK_HAIKU_45_PRICE_PER_MILLION = { input: 1, output: 5 };

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const providerKind = env.AI_PROVIDER ?? "bedrock";
  const priceIn = env.AI_PRICE_INPUT_PER_MILLION ? Number(env.AI_PRICE_INPUT_PER_MILLION) : NaN;
  const priceOut = env.AI_PRICE_OUTPUT_PER_MILLION ? Number(env.AI_PRICE_OUTPUT_PER_MILLION) : NaN;
  const envPrice =
    Number.isFinite(priceIn) && Number.isFinite(priceOut)
      ? { input: priceIn, output: priceOut }
      : null;
  return {
    enabled: env.AI_ASSISTANT_ENABLED !== "false",
    providerKind,
    apiKey: env.AI_API_KEY ?? null,
    baseUrl: (env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env.AI_MODEL ?? (providerKind === "bedrock" ? BEDROCK_DEFAULT_MODEL : "gpt-4o-mini"),
    awsRegion:
      env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || "us-east-1",
    maxToolExecutions: intEnv("AI_MAX_TOOL_EXECUTIONS", 10),
    maxEvidenceRounds: intEnv("AI_MAX_EVIDENCE_ROUNDS", 1),
    maxModelRounds: intEnv("AI_MAX_MODEL_ROUNDS", 5),
    toolTimeoutMs: intEnv("AI_TOOL_TIMEOUT_MS", 5_000),
    requestTimeoutMs: intEnv("AI_REQUEST_TIMEOUT_MS", 30_000),
    modelTimeoutMs: intEnv("AI_MODEL_TIMEOUT_MS", 20_000),
    pricePerMillion:
      envPrice ??
      (providerKind === "bedrock" ? BEDROCK_HAIKU_45_PRICE_PER_MILLION : null),
  };
}

/**
 * Resolve the identifier Bedrock must be invoked with.
 *
 * Claude Haiku 4.5 does NOT support on-demand invocation by its bare
 * foundation-model ID on the bedrock-runtime endpoint (AWS model card:
 * "the bedrock-runtime endpoint requires a geo or global inference
 * profile ID. The bare model ID isn't supported for on-demand
 * throughput"). So a bare `anthropic.…` ID is resolved to the geo
 * inference profile matching the configured region — the SAME model,
 * routed inside that geography. IDs that are already inference
 * profiles (`us.`/`eu.`/`au.`/`jp.`/`in.`/`global.` prefixed) or ARNs
 * pass through unchanged, as do non-Anthropic model IDs.
 */
export function resolveBedrockModelId(model: string, region: string): string {
  if (model.startsWith("arn:") || !model.startsWith("anthropic.")) return model;
  let geo = "global";
  if (region.startsWith("us-") || region.startsWith("ca-")) geo = "us";
  else if (region.startsWith("eu-")) geo = "eu";
  else if (region === "ap-southeast-2") geo = "au";
  else if (region === "ap-northeast-1") geo = "jp";
  else if (region === "ap-south-1") geo = "in";
  else if (region.startsWith("ap-")) geo = "global";
  return `${geo}.${model}`;
}

/** Whether a usable model is configured. There is deliberately NO
 * silent fallback to a fake provider in production paths: absence of
 * configuration is a clear, user-visible config error. For Bedrock the
 * AWS credential chain can only be fully verified at call time, so
 * "configured" means enabled + provider selected; a missing credential
 * then surfaces as a typed provider error on the first turn. */
export function modelConfigured(cfg: AiConfig): boolean {
  if (!cfg.enabled) return false;
  if (cfg.providerKind === "bedrock") return true;
  return cfg.providerKind === "openai-compatible" && Boolean(cfg.apiKey);
}
