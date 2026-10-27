/**
 * Bedrock provider — unit tests with a fake Converse client.
 *
 * Covers: config defaults (Bedrock + Claude Haiku 4.5), the
 * inference-profile resolution the bedrock-runtime endpoint requires
 * for this model, Converse message conversion (system extraction,
 * tool→user, same-role merge), usage mapping, one bounded retry on
 * throttling, and typed errors for missing AWS credentials and
 * non-retryable validation failures. No AWS account is touched.
 */
import { describe, expect, it } from "vitest";
import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import {
  BEDROCK_DEFAULT_MODEL,
  loadAiConfig,
  modelConfigured,
  resolveBedrockModelId,
} from "@/lib/ai/config";
import { BedrockModel, ProviderError, type BedrockConverseClient } from "@/lib/ai/provider";

const bedrockCfg = (env: Record<string, string> = {}) =>
  loadAiConfig(env as unknown as NodeJS.ProcessEnv);

describe("config — Bedrock defaults", () => {
  it("defaults to Bedrock with Claude Haiku 4.5 in us-east-1", () => {
    const cfg = bedrockCfg();
    expect(cfg.providerKind).toBe("bedrock");
    expect(cfg.model).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(cfg.model).toBe(BEDROCK_DEFAULT_MODEL);
    expect(cfg.awsRegion).toBe("us-east-1");
    expect(cfg.pricePerMillion).toEqual({ input: 1, output: 5 });
    // Bedrock needs no provider API key — the AWS credential chain decides.
    expect(modelConfigured(cfg)).toBe(true);
  });

  it("treats an empty AWS_REGION value as missing (Vercel empty-var trap)", () => {
    expect(bedrockCfg({ AWS_REGION: "" }).awsRegion).toBe("us-east-1");
    expect(bedrockCfg({ AWS_REGION: "eu-west-1" }).awsRegion).toBe("eu-west-1");
  });

  it("keeps the OpenAI-compatible path keyed on AI_API_KEY", () => {
    expect(modelConfigured(bedrockCfg({ AI_PROVIDER: "openai-compatible" }))).toBe(false);
    expect(
      modelConfigured(bedrockCfg({ AI_PROVIDER: "openai-compatible", AI_API_KEY: "k" })),
    ).toBe(true);
  });
});

describe("resolveBedrockModelId", () => {
  const bare = "anthropic.claude-haiku-4-5-20251001-v1:0";
  it("resolves a bare foundation ID to the region's geo inference profile", () => {
    expect(resolveBedrockModelId(bare, "us-east-1")).toBe(`us.${bare}`);
    expect(resolveBedrockModelId(bare, "us-west-2")).toBe(`us.${bare}`);
    expect(resolveBedrockModelId(bare, "eu-west-1")).toBe(`eu.${bare}`);
    expect(resolveBedrockModelId(bare, "ap-southeast-2")).toBe(`au.${bare}`);
    expect(resolveBedrockModelId(bare, "ap-northeast-1")).toBe(`jp.${bare}`);
    expect(resolveBedrockModelId(bare, "ap-southeast-1")).toBe(`global.${bare}`);
  });
  it("passes profiles, ARNs and other models through unchanged", () => {
    expect(resolveBedrockModelId(`us.${bare}`, "eu-west-1")).toBe(`us.${bare}`);
    expect(resolveBedrockModelId(`global.${bare}`, "us-east-1")).toBe(`global.${bare}`);
    const arn = "arn:aws:bedrock:us-east-1:123456789012:inference-profile/xyz";
    expect(resolveBedrockModelId(arn, "us-east-1")).toBe(arn);
    expect(resolveBedrockModelId("amazon.titan-text-express-v1", "us-east-1")).toBe(
      "amazon.titan-text-express-v1",
    );
  });
});

interface Captured {
  input: ConverseCommand["input"];
}

function fakeClient(handler: (call: number) => Promise<ConverseCommandOutput>, captured: Captured[]) {
  let call = 0;
  const client: BedrockConverseClient = {
    async send(command: ConverseCommand) {
      captured.push({ input: command.input });
      call += 1;
      return handler(call);
    },
  };
  return client;
}

const okOutput = (text: string): ConverseCommandOutput =>
  ({
    output: { message: { role: "assistant", content: [{ text }] } },
    usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 },
    stopReason: "end_turn",
  }) as ConverseCommandOutput;

function namedError(name: string, status?: number): Error {
  const e = new Error(`${name} happened`) as Error & { $metadata?: { httpStatusCode?: number } };
  e.name = name;
  if (status != null) e.$metadata = { httpStatusCode: status };
  return e;
}

const MESSAGES = [
  { role: "system", content: "SYSTEM RULES" },
  { role: "user", content: "Tìm sân cầu lông Thủ Đức" },
  { role: "assistant", content: '{"kind":"tool_call"}' },
  { role: "tool", content: '{"tool":"search_venues","data":{}}' },
  { role: "user", content: "tiếp đi" },
] as const;

describe("BedrockModel (Converse)", () => {
  it("sends the resolved profile ID, extracts system, merges roles, maps usage", async () => {
    const captured: Captured[] = [];
    const model = new BedrockModel(bedrockCfg(), fakeClient(async () => okOutput('{"kind":"final"}'), captured));
    const out = await model.complete([...MESSAGES], { timeoutMs: 5_000 });
    expect(model.resolvedModelId).toBe("us.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(model.id).toBe("bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0");
    const input = captured[0].input;
    expect(input.modelId).toBe("us.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(input.system).toEqual([{ text: "SYSTEM RULES" }]);
    expect(input.messages?.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // tool result and the following user line merge into one user turn
    const lastUser = input.messages?.[2];
    expect(lastUser?.content?.map((b) => ("text" in b ? b.text : ""))).toEqual([
      '{"tool":"search_venues","data":{}}',
      "tiếp đi",
    ]);
    expect(input.inferenceConfig).toMatchObject({ temperature: 0.2 });
    expect(out.text).toBe('{"kind":"final"}');
    expect(out.usage).toEqual({ inputTokens: 123, outputTokens: 45 });
  });

  it("retries once on throttling, then succeeds", async () => {
    const captured: Captured[] = [];
    const model = new BedrockModel(
      bedrockCfg(),
      fakeClient(async (call) => {
        if (call === 1) throw namedError("ThrottlingException", 429);
        return okOutput("ok");
      }, captured),
    );
    const out = await model.complete([...MESSAGES], { timeoutMs: 5_000 });
    expect(out.text).toBe("ok");
    expect(captured.length).toBe(2);
  }, 10_000);

  it("maps missing AWS credentials to a typed config error without retrying", async () => {
    const captured: Captured[] = [];
    const model = new BedrockModel(
      bedrockCfg(),
      fakeClient(async () => {
        throw namedError("CredentialsProviderError");
      }, captured),
    );
    await expect(model.complete([...MESSAGES], { timeoutMs: 5_000 })).rejects.toMatchObject({
      name: "ProviderError",
      kind: "config",
    } satisfies Partial<ProviderError> as object);
    expect(captured.length).toBe(1);
  });

  it("does not retry a Bedrock validation error", async () => {
    const captured: Captured[] = [];
    const model = new BedrockModel(
      bedrockCfg(),
      fakeClient(async () => {
        throw namedError("ValidationException", 400);
      }, captured),
    );
    await expect(model.complete([...MESSAGES], { timeoutMs: 5_000 })).rejects.toMatchObject({
      kind: "http",
      status: 400,
    });
    expect(captured.length).toBe(1);
  });

  it("treats an empty completion as a bad response", async () => {
    const model = new BedrockModel(
      bedrockCfg(),
      fakeClient(async () => ({ output: { message: { role: "assistant", content: [] } } }) as unknown as ConverseCommandOutput, []),
    );
    await expect(model.complete([...MESSAGES], { timeoutMs: 5_000 })).rejects.toMatchObject({
      kind: "bad_response",
    });
  });
});
