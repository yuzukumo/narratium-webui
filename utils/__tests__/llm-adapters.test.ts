import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyApiConfig,
  getDefaultModel,
  getGeminiInteractionsEndpoint,
} from "@/utils/api-config";
import {
  extractTextFromResponsesPayload,
  invokeOpenAIResponses,
} from "@/utils/openai-responses";
import { invokeAnthropicMessages } from "@/utils/anthropic-messages";
import {
  extractTextFromGeminiPayload,
  invokeGeminiContent,
} from "@/utils/gemini-content";

const mockJsonResponse = (payload: Record<string, any>, init?: ResponseInit) => (
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  })
);

const getFetchBody = (): Record<string, any> => {
  const firstCall = vi.mocked(fetch).mock.calls[0];
  return JSON.parse(firstCall[1]?.body as string) as Record<string, any>;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LLM adapter configuration", () => {
  it("uses current default models for new provider configs", () => {
    expect(createEmptyApiConfig("openai").model).toBe("gpt-5.5");
    expect(createEmptyApiConfig("anthropic").model).toBe("claude-fable-5");
    expect(createEmptyApiConfig("gemini").model).toBe("gemini-3.1-pro-preview");
    expect(getDefaultModel("gemini")).toBe("gemini-3.1-pro-preview");
  });

  it("uses the Gemini Interactions API endpoint", () => {
    expect(getGeminiInteractionsEndpoint()).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  });
});

describe("OpenAI Responses adapter", () => {
  it("extracts text after leading reasoning items", () => {
    const text = extractTextFromResponsesPayload({
      output: [
        {
          type: "reasoning",
          summary: [],
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "hello",
            },
          ],
        },
      ],
    });

    expect(text).toBe("hello");
  });

  it("sends GPT-5.5 Responses payload without sampling params and normalizes cache usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockJsonResponse({
      output_text: "ok",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: {
          cached_tokens: 64,
        },
        output_tokens_details: {
          reasoning_tokens: 7,
        },
      },
    })));

    const result = await invokeOpenAIResponses({
      baseUrl: "",
      apiKey: "sk-test",
      model: "gpt-5.5",
      systemMessage: "stable system",
      userMessage: "hello",
      maxTokens: 128,
      temperature: 0.7,
      reasoningEffort: "medium",
    });

    const body = getFetchBody();
    expect(body).toMatchObject({
      model: "gpt-5.5",
      instructions: "stable system",
      input: "hello",
      max_output_tokens: 128,
      reasoning: {
        effort: "medium",
      },
      text: {
        verbosity: "medium",
      },
    });
    expect(body.temperature).toBeUndefined();
    expect(body.prompt_cache_key).toMatch(/^narratium:gpt-5\.5:/);
    expect(result.usage.cachedInputTokens).toBe(64);
    expect(result.usage.reasoningTokens).toBe(7);
  });
});

describe("Anthropic Messages adapter", () => {
  it("adds cache control to long system content and normalizes cache usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockJsonResponse({
      content: [
        {
          type: "text",
          text: "ok",
        },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        cache_creation: {
          ephemeral_5m_input_tokens: 7,
          ephemeral_1h_input_tokens: 3,
        },
        cached_tokens: 11,
      },
    })));

    const longSystem = "x".repeat(2050);
    const result = await invokeAnthropicMessages({
      baseUrl: "",
      apiKey: "sk-ant-test",
      model: "claude-fable-5",
      systemMessage: longSystem,
      userMessage: "hello",
      maxTokens: 128,
      temperature: 0.7,
    });

    const body = getFetchBody();
    expect(body).toMatchObject({
      model: "claude-fable-5",
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: "hello",
        },
      ],
    });
    expect(body.temperature).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.system[0]).toMatchObject({
      type: "text",
      text: longSystem,
      cache_control: {
        type: "ephemeral",
      },
    });
    expect(result.usage.cacheCreationInputTokens).toBe(10);
    expect(result.usage.cacheReadInputTokens).toBe(11);
    expect(result.usage.totalTokens).toBe(38);
  });

  it("falls back to cached_tokens when Anthropic cache_read_input_tokens is zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockJsonResponse({
      content: [
        {
          type: "text",
          text: "ok",
        },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cached_tokens: 9,
      },
    })));

    const result = await invokeAnthropicMessages({
      baseUrl: "",
      apiKey: "sk-ant-test",
      model: "claude-fable-5",
      systemMessage: "",
      userMessage: "hello",
      maxTokens: 128,
    });

    expect(result.usage.cacheReadInputTokens).toBe(9);
  });
});

describe("Gemini Interactions adapter", () => {
  it("extracts text from Interactions and legacy candidate payloads", () => {
    expect(extractTextFromGeminiPayload({ output_text: "interaction text" })).toBe("interaction text");
    expect(extractTextFromGeminiPayload({
      candidates: [
        {
          content: {
            parts: [
              {
                text: "candidate text",
              },
            ],
          },
        },
      ],
    })).toBe("candidate text");
  });

  it("sends Interactions payload and reads implicit cache usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockJsonResponse({
      output_text: "ok",
      usage: {
        inputTokens: 40,
        outputTokens: 9,
        totalCachedTokens: 17,
      },
    })));

    const result = await invokeGeminiContent({
      baseUrl: "",
      apiKey: "gemini-test",
      model: "models/gemini-3.1-pro-preview",
      systemMessage: "system",
      userMessage: "hello",
      maxTokens: 128,
      temperature: 0.6,
      reasoningEffort: "low",
    });

    const body = getFetchBody();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(body).toMatchObject({
      model: "gemini-3.1-pro-preview",
      input: "hello",
      system_instruction: "system",
      generation_config: {
        max_output_tokens: 128,
        temperature: 0.6,
        thinking_level: "low",
      },
    });
    expect(result.usage.inputTokens).toBe(40);
    expect(result.usage.outputTokens).toBe(9);
    expect(result.usage.cachedInputTokens).toBe(17);
  });
});
