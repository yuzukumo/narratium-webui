import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invokeLLM,
  isContextOverflowError,
  LLMStreamError,
  streamLLM,
} from "@/utils/llm-api";

const sseResponse = (...events: Record<string, unknown>[]): Response => {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("backend LLM client", () => {
  it("sends only a backend model ID and normalizes usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(
      { type: "delta", delta: "hello" },
      {
        type: "completed",
        text: "hello",
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          total_tokens: 25,
          reasoning_tokens: 2,
          cache_read_input_tokens: 11,
          cache_creation_input_tokens: 3,
          duration_ms: 3000,
          first_token_ms: 1000,
        },
        billing: {
          cost_microusd: "1234",
        },
      },
    )));

    const result = await invokeLLM({
      modelId: "model-uuid",
      systemMessage: "stable",
      userMessage: "hi",
      maxTokens: 128,
    });

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
    expect(call[0]).toBe("/api/v1/chat");
    expect(body).toMatchObject({
      model_id: "model-uuid",
      system: "stable",
      input: "hi",
      max_output_tokens: 128,
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("stream");
    expect(JSON.stringify(body)).not.toMatch(/api.?key|base.?url|provider/i);
    expect(result.text).toBe("hello");
    expect(result.usage.cacheReadInputTokens).toBe(11);
    expect(result.usage.cacheCreationInputTokens).toBe(3);
    expect(result.usage.firstTokenMs).toBe(1000);
    expect(result.usage.tokensPerSecond).toBe(2.5);
    expect(result.usage.costMicrousd).toBe("1234");
  });

  it("parses fragmented normalized SSE events", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "data: {\"type\":\"delta\",\"del",
      "ta\":\"hel\"}\n\ndata: {\"type\":\"delta\",\"delta\":\"lo\"}\n\n",
      "data: {\"type\":\"completed\",\"text\":\"hello\",\"usage\":{\"output_tokens\":2,\"duration_ms\":1000}}\n\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })));

    const events = [];
    for await (const event of streamLLM({
      modelId: "model-uuid",
      systemMessage: "system",
      userMessage: "input",
      maxTokens: 64,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "delta", delta: "hel" },
      { type: "delta", delta: "lo" },
      expect.objectContaining({ type: "completed", text: "hello" }),
    ]);
  });

  it("surfaces a terminal SSE error after HTTP 200", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          "data: {\"type\":\"error\",\"code\":\"provider_error\",\"message\":\"stream failed\"}\n\n",
        ));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));

    const consume = async () => {
      for await (const event of streamLLM({
        modelId: "model-uuid",
        systemMessage: "system",
        userMessage: "input",
        maxTokens: 64,
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      name: "LLMStreamError",
      code: "provider_error",
      message: "stream failed",
    });
  });

  it("preserves provider error codes used for context overflow retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse({
      type: "error",
      code: "context_length_exceeded",
      message: "Maximum context length exceeded",
      request_id: "request-1",
    })));

    let thrown: unknown;
    try {
      for await (const event of streamLLM({
        modelId: "model-uuid",
        systemMessage: "system",
        userMessage: "input",
        maxTokens: 64,
      })) {
        void event;
      }
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LLMStreamError);
    expect(thrown).toMatchObject({
      code: "context_length_exceeded",
      requestId: "request-1",
    });
    expect(isContextOverflowError(thrown)).toBe(true);
  });
});
