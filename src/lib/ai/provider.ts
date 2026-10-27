/**
 * Model provider adapter.
 *
 * The interface is deliberately small so the provider can be swapped:
 * one completion call in, text + optional token usage out. The
 * orchestrator speaks a JSON protocol on top of it (see prompts.ts),
 * which keeps the integration provider-agnostic — no vendor-specific
 * function-calling dialect leaks into the agent logic.
 *
 * Failure behaviour: timeouts via AbortController; ONE bounded retry
 * for transient 429/5xx (never an infinite loop); other errors throw a
 * typed ProviderError the orchestrator maps to a structured answer.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { resolveBedrockModelId, type AiConfig } from "./config";

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelCompletion {
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface ChatModel {
  readonly id: string;
  complete(messages: ModelMessage[], opts: { timeoutMs: number }): Promise<ModelCompletion>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "http" | "network" | "bad_response" | "config",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class OpenAiCompatibleModel implements ChatModel {
  readonly id: string;
  constructor(private readonly cfg: AiConfig) {
    this.id = `${cfg.providerKind}:${cfg.model}`;
  }

  async complete(messages: ModelMessage[], opts: { timeoutMs: number }): Promise<ModelCompletion> {
    const body = JSON.stringify({
      model: this.cfg.model,
      messages: messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content })),
      temperature: 0.2,
    });
    let lastError: ProviderError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.cfg.apiKey}`,
          },
          body,
          signal: controller.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new ProviderError(`Model provider HTTP ${res.status}`, "http", res.status);
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (!res.ok) {
          throw new ProviderError(`Model provider HTTP ${res.status}`, "http", res.status);
        }
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = json.choices?.[0]?.message?.content;
        if (typeof text !== "string" || text.length === 0) {
          throw new ProviderError("Model returned an empty completion", "bad_response");
        }
        return {
          text,
          usage:
            json.usage?.prompt_tokens != null
              ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens ?? 0 }
              : null,
        };
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof Error && e.name === "AbortError") {
          throw new ProviderError("Model call timed out", "timeout");
        }
        lastError = new ProviderError(e instanceof Error ? e.message : "Network error", "network");
        await new Promise((r) => setTimeout(r, 800));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new ProviderError("Model call failed", "network");
  }
}

/** Minimal surface of BedrockRuntimeClient this adapter uses — a fake
 * implementing it is injected in tests; production uses the real SDK
 * client with the standard AWS credential chain. */
export interface BedrockConverseClient {
  send(
    command: ConverseCommand,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<ConverseCommandOutput>;
}

const BEDROCK_RETRYABLE = new Set([
  "ThrottlingException",
  "ServiceUnavailableException",
  "InternalServerException",
  "ModelTimeoutException",
  "ServiceQuotaExceededException",
]);

/**
 * Amazon Bedrock adapter (Converse API). The orchestrator's JSON
 * protocol maps onto Converse as: system messages → the Converse
 * `system` field; user/assistant/tool messages → text content blocks
 * (tool results are sent as user text, exactly like the OpenAI
 * adapter). Consecutive same-role messages are merged, which Converse
 * expects. No vendor tool-calling dialect leaks into the agent logic.
 *
 * Auth: AWS SDK default credential chain (AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY env vars, shared config, IAM role). A missing
 * credential surfaces as a typed "config" ProviderError, never as a
 * silent fallback.
 */
export class BedrockModel implements ChatModel {
  readonly id: string;
  /** The identifier actually sent to Bedrock (after inference-profile
   * resolution — see resolveBedrockModelId). Traces record this. */
  readonly resolvedModelId: string;
  private readonly client: BedrockConverseClient;

  constructor(
    private readonly cfg: AiConfig,
    client?: BedrockConverseClient,
  ) {
    this.resolvedModelId = resolveBedrockModelId(cfg.model, cfg.awsRegion);
    this.id = `bedrock:${this.resolvedModelId}`;
    this.client =
      client ??
      (new BedrockRuntimeClient({ region: cfg.awsRegion }) as unknown as BedrockConverseClient);
  }

  async complete(messages: ModelMessage[], opts: { timeoutMs: number }): Promise<ModelCompletion> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const convo: { role: "user" | "assistant"; content: { text: string }[] }[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      const last = convo[convo.length - 1];
      if (last && last.role === role) last.content.push({ text: m.content });
      else convo.push({ role, content: [{ text: m.content }] });
    }
    if (convo.length === 0 || convo[0].role !== "user") {
      convo.unshift({ role: "user", content: [{ text: "Xin chào" }] });
    }
    const command = new ConverseCommand({
      modelId: this.resolvedModelId,
      ...(system ? { system: [{ text: system }] } : {}),
      messages: convo,
      inferenceConfig: { temperature: 0.2, maxTokens: 2048 },
    });

    let lastError: ProviderError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const res = await this.client.send(command, { abortSignal: controller.signal });
        const text = (res.output?.message?.content ?? [])
          .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
          .join("");
        if (!text) throw new ProviderError("Bedrock returned an empty completion", "bad_response");
        return {
          text,
          usage:
            res.usage?.inputTokens != null
              ? {
                  inputTokens: res.usage.inputTokens,
                  outputTokens: res.usage.outputTokens ?? 0,
                }
              : null,
        };
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
          throw new ProviderError("Bedrock call timed out", "timeout");
        }
        const name = e instanceof Error ? e.name : "";
        const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (name === "CredentialsProviderError" || name === "NoCredentials" || /credential/i.test(name)) {
          throw new ProviderError(
            "AWS credentials not available to the Bedrock client (set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or an IAM role)",
            "config",
          );
        }
        const retryable =
          BEDROCK_RETRYABLE.has(name) || status === 429 || (status != null && status >= 500);
        if (!retryable) {
          throw new ProviderError(
            e instanceof Error ? `Bedrock ${name || "error"}: ${e.message}` : "Bedrock call failed",
            status != null ? "http" : "network",
            status,
          );
        }
        lastError = new ProviderError(
          e instanceof Error ? e.message : "Bedrock transient error",
          "http",
          status,
        );
        await new Promise((r) => setTimeout(r, 800));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new ProviderError("Bedrock call failed", "network");
  }
}

/** Build the production model for a config. Exactly one real provider
 * per deployment; an unknown provider kind is a config error. */
export function createModel(cfg: AiConfig): ChatModel {
  if (cfg.providerKind === "bedrock") return new BedrockModel(cfg);
  if (cfg.providerKind === "openai-compatible") return new OpenAiCompatibleModel(cfg);
  throw new ProviderError(`Unknown AI_PROVIDER "${cfg.providerKind}"`, "config");
}

/**
 * Deterministic scripted model — TESTS AND BENCHMARK ONLY. It is never
 * wired into the production route; the route constructs exactly one
 * real provider model from configuration (see createModel), or
 * reports the assistant as not configured.
 */
export class ScriptedModel implements ChatModel {
  readonly id = "scripted:test";
  private step = 0;
  constructor(
    private readonly handler: (messages: ModelMessage[], step: number) => string | Promise<string>,
  ) {}
  async complete(messages: ModelMessage[]): Promise<ModelCompletion> {
    const text = await this.handler(messages, this.step);
    this.step += 1;
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
