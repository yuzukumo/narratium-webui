import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { getOpenAIResponsesEndpoint, OpenAIReasoningEffort } from "@/utils/api-config";

interface ResponseTextPart {
  type?: string;
  text?: string;
}

interface ResponseMessage {
  type?: string;
  content?: ResponseTextPart[];
}

interface ResponsesPayload {
  model: string;
  instructions?: string;
  input: string;
  max_output_tokens?: number;
  prompt_cache_key?: string;
  temperature?: number;
  text?: {
    verbosity?: "low" | "medium" | "high";
  };
  reasoning?: {
    effort: OpenAIReasoningEffort;
  };
  stream?: boolean;
}

interface ResponsesErrorShape {
  error?: {
    message?: string;
  } | string;
  message?: string;
  response?: {
    error?: {
      message?: string;
    } | string;
  };
}

export interface InvokeOpenAIResponsesOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: OpenAIReasoningEffort;
  promptCacheKey?: string;
}

export interface OpenAIResponsesResult {
  raw: Record<string, any>;
  text: string;
  usage: ResponseUsageMetrics;
}

export type OpenAIResponsesStreamEvent =
  | {
    type: "delta";
    delta: string;
  }
  | {
    type: "completed";
    raw: Record<string, any>;
    text: string;
    usage: ResponseUsageMetrics;
  };

const numberOrZero = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstPositiveNumber = (...values: unknown[]): number => {
  const positive = values
    .map((value) => numberOrZero(value))
    .find((value) => value > 0);
  return positive || 0;
};

const asRecord = (value: unknown): Record<string, any> | null => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null
);

const getNestedRecord = (value: unknown, key: string): Record<string, any> => (
  asRecord(asRecord(value)?.[key]) || {}
);

const getErrorMessage = (payload: ResponsesErrorShape, fallback: string) => {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && error.message) {
    return error.message;
  }

  const responseError = payload.response?.error;
  if (typeof responseError === "string" && responseError.trim()) {
    return responseError;
  }
  if (responseError && typeof responseError === "object" && responseError.message) {
    return responseError.message;
  }

  return payload.message || fallback;
};

const shouldOmitSamplingParameters = (model: string): boolean => {
  const normalized = model.trim().toLowerCase();
  return /^gpt-5(?:[.-]|$)/.test(normalized);
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const buildPromptCacheKey = (model: string, systemMessage: string): string => {
  const prefix = systemMessage.trim().slice(0, 8192);
  return `narratium:${model.trim().toLowerCase()}:${stableHash(prefix)}`;
};

const buildPayload = ({
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
  promptCacheKey,
  stream,
}: InvokeOpenAIResponsesOptions & { stream?: boolean }): ResponsesPayload => {
  const normalizedModel = model.trim();
  const payload: ResponsesPayload = {
    model: normalizedModel,
    input: userMessage,
    max_output_tokens: maxTokens,
    text: {
      verbosity: "medium",
    },
  };

  const instructions = systemMessage.trim();
  if (instructions) {
    payload.instructions = instructions;
  }

  const normalizedPromptCacheKey = promptCacheKey?.trim();
  payload.prompt_cache_key = normalizedPromptCacheKey || buildPromptCacheKey(normalizedModel, systemMessage);

  if (reasoningEffort) {
    payload.reasoning = {
      effort: reasoningEffort,
    };
  }

  if (typeof temperature === "number" && !shouldOmitSamplingParameters(normalizedModel)) {
    payload.temperature = temperature;
  }

  if (stream) {
    payload.stream = true;
  }

  return payload;
};

export const extractTextFromResponsesPayload = (payload: Record<string, any>): string => {
  const responsePayload = asRecord(payload.response) || payload;

  if (typeof responsePayload.output_text === "string" && responsePayload.output_text.trim()) {
    return responsePayload.output_text.trim();
  }

  const output = Array.isArray(responsePayload.output) ? responsePayload.output as ResponseMessage[] : [];
  const text = output
    .filter((item) => item.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content || [])
    .filter((part) => typeof part.text === "string" && (!part.type || part.type === "output_text" || part.type === "text"))
    .map((part) => part.text || "")
    .join("")
    .trim();

  return text;
};

const buildUsageMetrics = (
  payload: Record<string, any>,
  response: Response,
  startedAt: number,
): ResponseUsageMetrics => {
  const responsePayload = asRecord(payload.response) || payload;
  const usagePayload = asRecord(responsePayload.usage) || {};
  const inputDetails = getNestedRecord(usagePayload, "input_tokens_details");
  const promptDetails = getNestedRecord(usagePayload, "prompt_tokens_details");
  const outputDetails = getNestedRecord(usagePayload, "output_tokens_details");
  const completionDetails = getNestedRecord(usagePayload, "completion_tokens_details");
  const headerDurationMs = Number(response.headers.get("openai-processing-ms") || "");
  const durationMs = Number.isFinite(headerDurationMs) && headerDurationMs > 0
    ? Math.round(headerDurationMs)
    : Math.max(1, Date.now() - startedAt);
  const inputTokens = numberOrZero(usagePayload.input_tokens ?? usagePayload.prompt_tokens);
  const outputTokens = numberOrZero(usagePayload.output_tokens ?? usagePayload.completion_tokens);
  const totalTokens = numberOrZero(usagePayload.total_tokens) || inputTokens + outputTokens;
  const cacheReadInputTokens = firstPositiveNumber(
    inputDetails.cached_tokens,
    promptDetails.cached_tokens,
    usagePayload.cached_tokens,
    usagePayload.prompt_cache_hit_tokens,
    usagePayload.cache_read_input_tokens,
  );
  const cacheCreationInputTokens = firstPositiveNumber(
    inputDetails.cached_creation_tokens,
    promptDetails.cached_creation_tokens,
    usagePayload.cache_creation_input_tokens,
  );
  const reasoningTokens = numberOrZero(outputDetails.reasoning_tokens ?? completionDetails.reasoning_tokens);
  const tokensPerSecond = outputTokens > 0
    ? Number((outputTokens / (durationMs / 1000)).toFixed(1))
    : 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cachedInputTokens: cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    durationMs,
    tokensPerSecond,
  };
};

const parseJsonOrThrow = async (response: Response): Promise<Record<string, any>> => {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(text.trim());
  }
};

export const invokeOpenAIResponses = async (options: InvokeOpenAIResponsesOptions): Promise<OpenAIResponsesResult> => {
  const endpoint = getOpenAIResponsesEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey.trim()}`,
    },
    body: JSON.stringify(buildPayload(options)),
  });

  const json = await parseJsonOrThrow(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(json, `OpenAI Responses API request failed with status ${response.status}`));
  }

  const text = extractTextFromResponsesPayload(json);
  if (!text) {
    throw new Error("The API returned an empty response.");
  }

  return {
    raw: json,
    text,
    usage: buildUsageMetrics(json, response, startedAt),
  };
};

export async function* streamOpenAIResponses(
  options: InvokeOpenAIResponsesOptions,
): AsyncGenerator<OpenAIResponsesStreamEvent, void, unknown> {
  const endpoint = getOpenAIResponsesEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey.trim()}`,
    },
    body: JSON.stringify(buildPayload({ ...options, stream: true })),
  });

  if (!response.ok) {
    const json = await parseJsonOrThrow(response);
    throw new Error(getErrorMessage(json, `OpenAI Responses API request failed with status ${response.status}`));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to read the response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let completed = false;
  let lastPayload: Record<string, any> = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      const lines = frame
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) {
        continue;
      }

      const rawData = dataLines.join("\n");
      if (rawData === "[DONE]") {
        continue;
      }

      let payload: Record<string, any>;
      try {
        payload = JSON.parse(rawData) as Record<string, any>;
      } catch {
        continue;
      }

      lastPayload = payload;
      const eventType = String(payload.type || "");

      if (payload.error) {
        throw new Error(getErrorMessage(payload, "OpenAI Responses API stream failed."));
      }

      if (eventType === "response.output_text.delta" && typeof payload.delta === "string") {
        accumulatedText += payload.delta;
        yield {
          type: "delta",
          delta: payload.delta,
        };
        continue;
      }

      if (eventType === "response.failed") {
        const failedPayload = asRecord(payload.response) || payload;
        throw new Error(getErrorMessage(failedPayload, "OpenAI Responses API stream failed."));
      }

      if (
        eventType === "response.completed"
        || eventType === "response.done"
        || eventType === "response.incomplete"
      ) {
        const completedPayload = asRecord(payload.response) || payload;
        const text = extractTextFromResponsesPayload(completedPayload) || accumulatedText.trim();
        completed = true;
        yield {
          type: "completed",
          raw: completedPayload,
          text,
          usage: buildUsageMetrics(completedPayload, response, startedAt),
        };
      }
    }
  }

  if (!completed && accumulatedText.trim()) {
    yield {
      type: "completed",
      raw: lastPayload,
      text: accumulatedText.trim(),
      usage: buildUsageMetrics(lastPayload, response, startedAt),
    };
  }
}
