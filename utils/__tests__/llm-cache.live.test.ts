import { describe, expect, it } from "vitest";
import { invokeAnthropicMessages } from "@/utils/anthropic-messages";
import { invokeGeminiContent } from "@/utils/gemini-content";
import { invokeOpenAIResponses } from "@/utils/openai-responses";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
} from "@/utils/api-config";

const liveTestsEnabled = process.env.RUN_LIVE_LLM_CACHE_TESTS === "1";

const buildLongStablePrompt = (provider: string): string => {
  const repeatedLore = Array.from({ length: 360 }, (_, index) => (
    `Stable ${provider} cache line ${index + 1}: The archive room contains the same brass key, blue ledger, and quiet lantern.`
  )).join("\n");

  return [
    "You are testing provider-side prompt caching for Narratium.",
    "This whole block is intentionally stable across repeated calls.",
    repeatedLore,
  ].join("\n");
};

const expectLiveCacheHit = (
  provider: string,
  firstReadTokens: number,
  secondReadTokens: number,
) => {
  console.log(`${provider} cache read tokens: first=${firstReadTokens}, second=${secondReadTokens}`);
  expect(secondReadTokens).toBeGreaterThan(0);
};

describe.runIf(liveTestsEnabled)("live provider cache probes", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)("checks OpenAI prompt cache hit with repeated stable instructions", async () => {
    const systemMessage = buildLongStablePrompt("openai");

    const first = await invokeOpenAIResponses({
      baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      systemMessage,
      userMessage: "Reply with exactly: cache probe one",
      maxTokens: 32,
      reasoningEffort: "low",
    });

    const second = await invokeOpenAIResponses({
      baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      systemMessage,
      userMessage: "Reply with exactly: cache probe two",
      maxTokens: 32,
      reasoningEffort: "low",
    });

    expectLiveCacheHit("OpenAI", first.usage.cacheReadInputTokens, second.usage.cacheReadInputTokens);
  }, 60000);

  it.skipIf(!process.env.ANTHROPIC_API_KEY)("checks Anthropic prompt cache hit with repeated stable system block", async () => {
    const systemMessage = buildLongStablePrompt("anthropic");

    const first = await invokeAnthropicMessages({
      baseUrl: process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL,
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      systemMessage,
      userMessage: "Reply with exactly: cache probe one",
      maxTokens: 32,
    });

    const second = await invokeAnthropicMessages({
      baseUrl: process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL,
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      systemMessage,
      userMessage: "Reply with exactly: cache probe two",
      maxTokens: 32,
    });

    expectLiveCacheHit("Anthropic", first.usage.cacheReadInputTokens, second.usage.cacheReadInputTokens);
  }, 60000);

  it.skipIf(!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY)("checks Gemini implicit cache hit with repeated stable system instruction", async () => {
    const systemMessage = buildLongStablePrompt("gemini");
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

    const first = await invokeGeminiContent({
      baseUrl: process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL,
      apiKey,
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      systemMessage,
      userMessage: "Reply with exactly: cache probe one",
      maxTokens: 32,
      reasoningEffort: "low",
    });

    const second = await invokeGeminiContent({
      baseUrl: process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL,
      apiKey,
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      systemMessage,
      userMessage: "Reply with exactly: cache probe two",
      maxTokens: 32,
      reasoningEffort: "low",
    });

    expectLiveCacheHit("Gemini", first.usage.cacheReadInputTokens, second.usage.cacheReadInputTokens);
  }, 60000);
});

describe.skipIf(liveTestsEnabled)("live provider cache probes", () => {
  it("is skipped unless RUN_LIVE_LLM_CACHE_TESTS=1", () => {
    expect(true).toBe(true);
  });
});
