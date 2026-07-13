import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acknowledgeChatRun,
  createChatRun,
  getPendingChatRuns,
  streamChatRun,
} = vi.hoisted(() => ({
  acknowledgeChatRun: vi.fn(),
  createChatRun: vi.fn(),
  getPendingChatRuns: vi.fn(),
  streamChatRun: vi.fn(),
}));

vi.mock("@/utils/chat-runs", () => ({
  acknowledgeChatRun,
  createChatRun,
  getPendingChatRuns,
  streamChatRun,
}));

import {
  acknowledgePersistentLLMRuns,
  invokePersistentLLM,
  PersistentLLMRunError,
} from "@/utils/llm-api";

const run = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  user_id: "user-1",
  character_id: "__ctxc_v2__:namespace",
  node_id: "context-compaction:job-1",
  parent_node_id: "root",
  user_message: "Narrative context compaction",
  model_id: "model-1",
  model_name: "model-1",
  provider: "openai",
  request_id: "run-1",
  status: "completed",
  response_text: "validated summary",
  provider_response_id: "response-1",
  finish_reason: "stop",
  usage: {
    input_tokens: 1_200,
    output_tokens: 300,
    total_tokens: 1_500,
    reasoning_tokens: 20,
    cache_read_input_tokens: 500,
    cache_creation_input_tokens: 100,
    duration_ms: 2_000,
    first_token_ms: 200,
  },
  billing: { cost_microusd: "1234" },
  cancel_requested: false,
  acknowledged: false,
  revision: 2,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const options = {
  modelId: "model-1",
  systemMessage: "system",
  stableSystemPrefix: "system",
  userMessage: "source",
  maxTokens: 2_000,
  temperature: 0,
  runNamespace: "__ctxc_v2__:namespace",
  runKey: "job-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  acknowledgeChatRun.mockResolvedValue(undefined);
  getPendingChatRuns.mockResolvedValue([]);
});

describe("persistent internal model runs", () => {
  it("resumes a completed unacknowledged run and reports upstream usage", async () => {
    getPendingChatRuns.mockResolvedValue([run()]);

    const result = await invokePersistentLLM(options);

    expect(createChatRun).not.toHaveBeenCalled();
    expect(streamChatRun).not.toHaveBeenCalled();
    expect(result.runId).toBe("run-1");
    expect(result.text).toBe("validated summary");
    expect(result.usage).toMatchObject({
      inputTokens: 1_200,
      outputTokens: 300,
      reasoningTokens: 20,
      cacheReadInputTokens: 500,
      cacheCreationInputTokens: 100,
      costMicrousd: "1234",
    });
  });

  it("creates a backend-owned run and waits for its persisted terminal snapshot", async () => {
    const running = run({ status: "running", response_text: "" });
    const completed = run();
    createChatRun.mockResolvedValue(running);
    streamChatRun.mockImplementation(async function* () {
      yield running;
      yield completed;
    });

    const result = await invokePersistentLLM(options);

    expect(createChatRun).toHaveBeenCalledWith(expect.objectContaining({
      characterId: options.runNamespace,
      nodeId: "context-compaction:job-1",
      modelId: "model-1",
      systemMessage: "system",
      userPrompt: "source",
      maxTokens: 2_000,
    }));
    expect(result.text).toBe("validated summary");
  });

  it("surfaces a stored failed run with its provider error code", async () => {
    getPendingChatRuns.mockResolvedValue([run({
      status: "failed",
      response_text: "",
      error_code: "context_window_exceeded",
      error_message: "Prompt too long.",
    })]);

    await expect(invokePersistentLLM(options)).rejects.toEqual(expect.objectContaining({
      name: "PersistentLLMRunError",
      code: "context_window_exceeded",
      runId: "run-1",
    } satisfies Partial<PersistentLLMRunError>));
  });

  it("acknowledges only compaction runs after their snapshot is committed", async () => {
    getPendingChatRuns.mockResolvedValue([
      run(),
      run({ id: "run-2", node_id: "ordinary-chat-node" }),
      run({ id: "run-3", node_id: "context-compaction:other-job" }),
    ]);

    await acknowledgePersistentLLMRuns(options.runNamespace, "job-1");

    expect(acknowledgeChatRun).toHaveBeenCalledTimes(1);
    expect(acknowledgeChatRun).toHaveBeenCalledWith("run-1");
  });
});
