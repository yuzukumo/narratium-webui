import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { apiFetch, parseAPIError } from "@/utils/api-client";
import { APIError } from "@/utils/api-client";
import {
  acknowledgeChatRun,
  createChatRun,
  getPendingChatRuns,
  streamChatRun,
  type ChatRun,
} from "@/utils/chat-runs";

export interface InvokeLLMOptions {
  modelId: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  stableSystemPrefix?: string;
  signal?: AbortSignal;
}

interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  duration_ms?: number;
  first_token_ms?: number;
}

interface WireResponse {
  id?: string;
  model?: string;
  text: string;
  usage?: WireUsage;
}

interface WireBilling {
  cost_microusd?: string;
}

export interface LLMInvokeResult {
  raw: WireResponse;
  text: string;
  usage: ResponseUsageMetrics;
}

export interface PersistentLLMInvokeResult extends LLMInvokeResult {
  runId: string;
}

export interface PersistentLLMOptions extends InvokeLLMOptions {
  runNamespace: string;
  runKey: string;
  parentNodeId?: string;
}

export type LLMStreamEvent =
  | { type: "delta"; delta: string }
  | { type: "completed"; text: string; usage: ResponseUsageMetrics; raw?: WireResponse };

const buildRequest = (options: InvokeLLMOptions) => ({
  model_id: options.modelId,
  system: options.systemMessage,
  stable_system_prefix: options.stableSystemPrefix,
  input: options.userMessage,
  max_output_tokens: options.maxTokens,
  temperature: options.temperature,
});

const normalizeUsage = (
  usage: WireUsage | undefined,
  billing?: WireBilling,
): ResponseUsageMetrics => {
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const durationMs = usage?.duration_ms || 0;
  const cacheReadInputTokens = usage?.cache_read_input_tokens || 0;
  const firstTokenMs = usage?.first_token_ms || 0;
  const generationMs = Math.max(durationMs - firstTokenMs, 0);
  return {
    costMicrousd: billing?.cost_microusd,
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens || inputTokens + outputTokens,
    reasoningTokens: usage?.reasoning_tokens || 0,
    cachedInputTokens: cacheReadInputTokens,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens || 0,
    cacheReadInputTokens,
    durationMs,
    firstTokenMs,
    tokensPerSecond: outputTokens > 0 && generationMs > 0
      ? Number((outputTokens / (generationMs / 1000)).toFixed(1))
      : 0,
  };
};

export const invokeLLM = async (options: InvokeLLMOptions): Promise<LLMInvokeResult> => {
  let text = "";
  let usage = normalizeUsage(undefined);
  let raw: WireResponse = { text: "" };
  for await (const event of streamLLM(options)) {
	  if (event.type === "delta") {
      text += event.delta;
	  } else {
      text = event.text || text;
      usage = event.usage;
      raw = event.raw || { text, usage: undefined };
	  }
  }
  if (!text.trim()) {
    throw new Error("The model returned an empty response.");
  }
  return {
    raw,
    text,
    usage,
  };
};

export class LLMStreamError extends Error {
  code: string;
  requestId: string;

  constructor(message: string, code = "stream_error", requestId = "") {
    super(message);
    this.name = "LLMStreamError";
    this.code = code;
    this.requestId = requestId;
  }
}

export class PersistentLLMRunError extends LLMStreamError {
  runId: string;

  constructor(message: string, code: string, runId: string) {
    super(message, code, runId);
    this.name = "PersistentLLMRunError";
    this.runId = runId;
  }
}

export const isContextOverflowError = (reason: unknown): boolean => {
  if (!(reason instanceof Error)) {
    return false;
  }
  const codedError = reason as Error & { code?: unknown };
  const code = typeof codedError.code === "string"
	  ? codedError.code.toLowerCase()
	  : "";
  const message = reason.message.toLowerCase();
  return ["context_window_exceeded", "context_length_exceeded", "model_context_window_exceeded", "max_tokens"].some(
    (value) => code.includes(value) || message.includes(value.replaceAll("_", " ")) || message.includes(value),
  );
};

function persistentRunNodeId(runKey: string): string {
  const normalized = runKey.trim().replace(/[^a-zA-Z0-9:._-]+/g, "-");
  if (!normalized) {
    throw new Error("A persistent model run key is required.");
  }
  return `context-compaction:${normalized}`.slice(0, 256);
}

function completedRunResult(run: ChatRun): PersistentLLMInvokeResult {
  const text = run.response_text.trim();
  if (run.status !== "completed" || !text) {
    throw new PersistentLLMRunError(
      run.error_message || (run.status === "canceled"
        ? "The context compaction request was canceled."
        : "The context compaction request failed."),
      run.error_code || `persistent_run_${run.status}`,
      run.id,
    );
  }
  const usage = normalizeUsage({
    input_tokens: run.usage.input_tokens,
    output_tokens: run.usage.output_tokens,
    total_tokens: run.usage.total_tokens,
    reasoning_tokens: run.usage.reasoning_tokens,
    cache_read_input_tokens: run.usage.cache_read_input_tokens,
    cache_creation_input_tokens: run.usage.cache_creation_input_tokens,
    duration_ms: run.usage.duration_ms,
    first_token_ms: run.usage.first_token_ms,
  }, run.billing);
  return {
    runId: run.id,
    raw: {
      id: run.provider_response_id,
      model: run.model_name,
      text,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        reasoning_tokens: usage.reasoningTokens,
        cache_read_input_tokens: usage.cacheReadInputTokens,
        cache_creation_input_tokens: usage.cacheCreationInputTokens,
        duration_ms: usage.durationMs,
        first_token_ms: usage.firstTokenMs,
      },
    },
    text,
    usage,
  };
}

async function awaitPersistentRun(run: ChatRun, signal?: AbortSignal): Promise<ChatRun> {
  if (["completed", "failed", "canceled"].includes(run.status)) {
    return run;
  }
  let latest = run;
  for await (const snapshot of streamChatRun(run.id, { signal })) {
    latest = snapshot;
  }
  return latest;
}

/**
 * Runs an internal model request through the same persisted backend worker as
 * chat generation. Aborting the browser wait does not cancel the server job;
 * a later request with the same namespace and key resumes its stored result.
 */
export const invokePersistentLLM = async (
  options: PersistentLLMOptions,
): Promise<PersistentLLMInvokeResult> => {
  const runNamespace = options.runNamespace.trim();
  if (!runNamespace || runNamespace.length > 256) {
    throw new Error("A valid persistent model run namespace is required.");
  }
  const nodeId = persistentRunNodeId(options.runKey);
  const findExisting = async (): Promise<ChatRun | undefined> => {
    const runs = await getPendingChatRuns(runNamespace);
    return runs.find((run) => run.node_id === nodeId);
  };

  let run = await findExisting();
  if (!run) {
    try {
      run = await createChatRun({
        characterId: runNamespace,
        characterName: "Context compaction",
        nodeId,
        parentNodeId: options.parentNodeId || "root",
        userMessage: `Narrative context compaction (${options.runKey})`,
        modelName: options.modelId,
        modelId: options.modelId,
        systemMessage: options.systemMessage,
        userPrompt: options.userMessage,
        stableSystemPrefix: options.stableSystemPrefix,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });
    } catch (error) {
      if (!(error instanceof APIError) || !["chat_run_conflict", "billing_request_conflict"].includes(error.code)) {
        throw error;
      }
      run = await findExisting();
      if (!run) {
        throw error;
      }
    }
  }

  return completedRunResult(await awaitPersistentRun(run, options.signal));
};

export async function acknowledgePersistentLLMRuns(
  runNamespace: string,
  runKeyPrefix = "",
): Promise<void> {
  const nodePrefix = runKeyPrefix ? persistentRunNodeId(runKeyPrefix) : "context-compaction:";
  const runs = await getPendingChatRuns(runNamespace);
  await Promise.all(runs
    .filter((run) => run.node_id.startsWith(nodePrefix))
    .map((run) => acknowledgeChatRun(run.id)));
}

export async function* streamLLM(options: InvokeLLMOptions): AsyncGenerator<LLMStreamEvent, void, unknown> {
  const response = await apiFetch("/api/v1/chat", {
    method: "POST",
    body: JSON.stringify(buildRequest(options)),
    signal: options.signal,
  });
  if (!response.ok) {
    throw await parseAPIError(response);
  }
  if (!response.body) {
    throw new Error("Unable to read the model response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const parseFrame = (frame: string): LLMStreamEvent | Error | null => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") {
      return null;
    }
    const event = JSON.parse(data) as {
      type: "delta" | "completed" | "error";
      delta?: string;
      text?: string;
      usage?: WireUsage;
      response?: WireResponse;
      billing?: WireBilling;
      message?: string;
      code?: string;
      request_id?: string;
    };
    if (event.type === "error") {
	  return new LLMStreamError(
        event.message || `Model stream failed${event.code ? ` (${event.code})` : ""}.`,
        event.code,
        event.request_id,
	  );
    }
    if (event.type === "delta") {
      return { type: "delta", delta: event.delta || "" };
    }
    if (event.type === "completed") {
      completed = true;
      return {
        type: "completed",
        text: event.text || event.response?.text || "",
        usage: normalizeUsage(event.usage || event.response?.usage, event.billing),
        raw: event.response,
      };
    }
    return null;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event instanceof Error) {
        throw event;
      }
      if (event) {
        yield event;
      }
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    const event = parseFrame(buffer);
    if (event instanceof Error) {
      throw event;
    }
    if (event) {
      yield event;
    }
  }
  if (!completed) {
    throw new Error("The model stream ended without a completion event.");
  }
}
