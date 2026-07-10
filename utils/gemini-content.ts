import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import {
  GeminiThinkingLevel,
  getGeminiInteractionsEndpoint,
  getGeminiStreamInteractionsEndpoint,
} from "@/utils/api-config";

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
}

interface GeminiInteractionPayload {
  model: string;
  input: string;
  system_instruction?: string;
  generation_config?: {
    temperature?: number;
    max_output_tokens?: number;
    maxOutputTokens?: number;
    thinking_level?: GeminiThinkingLevel;
    thinkingLevel?: GeminiThinkingLevel;
    thinking_config?: {
      thinking_budget?: number;
      thinking_level?: GeminiThinkingLevel;
    };
  };
}

interface GeminiErrorShape {
  error?: {
    message?: string;
  } | string;
  message?: string;
}

export interface InvokeGeminiContentOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: GeminiThinkingLevel;
}

export interface GeminiContentResult {
  raw: Record<string, any>;
  text: string;
  usage: ResponseUsageMetrics;
}

export type GeminiStreamEvent =
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

const getErrorMessage = (payload: GeminiErrorShape, fallback: string) => {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && error.message) {
    return error.message;
  }
  return payload.message || fallback;
};

const extractTextFromCandidate = (candidate: GeminiCandidate | undefined): string => {
  const parts = Array.isArray(candidate?.content?.parts) ? candidate?.content?.parts || [] : [];
  return parts
    .map((part) => part.text || "")
    .join("");
};

const collectTextBlocks = (value: unknown, depth = 0): string[] => {
  if (depth > 8 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextBlocks(item, depth + 1));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  const textValue = typeof record.text === "string" ? record.text : "";
  const outputTextValue = typeof record.output_text === "string" ? record.output_text : "";
  const outputTextCamelValue = typeof record.outputText === "string" ? record.outputText : "";
  const shouldUseText = textValue
    && !["error", "function_call", "tool_call", "thinking", "thought"].includes(type)
    && role !== "user";
  const ownText = [
    outputTextValue,
    outputTextCamelValue,
    shouldUseText ? textValue : "",
  ].filter(Boolean);

  const nestedKeys = [
    "content",
    "parts",
    "steps",
    "output",
    "model_output",
    "modelOutput",
    "candidates",
    "message",
    "messages",
  ];
  const nestedText = nestedKeys.flatMap((key) => collectTextBlocks(record[key], depth + 1));

  return [...ownText, ...nestedText];
};

const buildUsageMetrics = (
  payload: Record<string, any>,
  startedAt: number,
): ResponseUsageMetrics => {
  const usage = asRecord(payload.usageMetadata) || asRecord(payload.usage) || {};
  const durationMs = Math.max(1, Date.now() - startedAt);
  const inputTokens = numberOrZero(usage.promptTokenCount ?? usage.input_tokens ?? usage.inputTokens);
  const outputTokens = numberOrZero(usage.candidatesTokenCount ?? usage.output_tokens ?? usage.outputTokens);
  const cacheReadInputTokens = firstPositiveNumber(
    usage.total_cached_tokens,
    usage.totalCachedTokens,
    usage.cachedContentTokenCount,
    usage.cached_content_token_count,
    usage.cached_tokens,
  );
  const cacheCreationInputTokens = firstPositiveNumber(usage.cache_creation_input_tokens);
  const totalTokens = numberOrZero(usage.totalTokenCount ?? usage.total_tokens)
    || inputTokens + outputTokens;
  const reasoningTokens = numberOrZero(usage.thoughtsTokenCount ?? usage.reasoning_tokens);
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

export const extractTextFromGeminiPayload = (payload: Record<string, any>): string => {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (typeof payload.outputText === "string" && payload.outputText.trim()) {
    return payload.outputText.trim();
  }

  const candidates = Array.isArray(payload.candidates) ? payload.candidates as GeminiCandidate[] : [];
  const candidateText = candidates
    .map((candidate) => extractTextFromCandidate(candidate))
    .join("")
    .trim();
  if (candidateText) {
    return candidateText;
  }

  return Array.from(new Set(collectTextBlocks(payload)))
    .join("")
    .trim();
};

const getGeminiThinkingConfig = (
  model: string,
  reasoningEffort: GeminiThinkingLevel,
): NonNullable<GeminiInteractionPayload["generation_config"]> => {
  const normalizedModel = model.trim().replace(/^models\//i, "").toLowerCase();
  const isGemini25 = normalizedModel.startsWith("gemini-2.5");

  if (isGemini25) {
    return {
      thinking_config: {
        thinking_budget: reasoningEffort === "medium"
          ? 8192
          : reasoningEffort === "high"
            ? 24576
            : 1024,
      },
    };
  }

  return {
    thinking_level: reasoningEffort,
  };
};

const buildPayload = ({
  model,
  systemMessage,
  userMessage,
  maxTokens,
  temperature,
  reasoningEffort,
}: Omit<InvokeGeminiContentOptions, "baseUrl" | "apiKey">): GeminiInteractionPayload => {
  const payload: GeminiInteractionPayload = {
    model: model.trim().replace(/^models\//i, ""),
    input: userMessage,
    generation_config: {
      max_output_tokens: maxTokens,
    },
  };

  if (systemMessage.trim()) {
    payload.system_instruction = systemMessage;
  }

  if (typeof temperature === "number") {
    payload.generation_config = {
      ...payload.generation_config,
      temperature,
    };
  }

  if (reasoningEffort) {
    payload.generation_config = {
      ...payload.generation_config,
      ...getGeminiThinkingConfig(model, reasoningEffort),
    };
  }

  return payload;
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

export const invokeGeminiContent = async (
  options: InvokeGeminiContentOptions,
): Promise<GeminiContentResult> => {
  const endpoint = getGeminiInteractionsEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey.trim(),
    },
    body: JSON.stringify(buildPayload(options)),
  });

  const json = await parseJsonOrThrow(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(json as GeminiErrorShape, `Gemini API request failed with status ${response.status}`));
  }

  const text = extractTextFromGeminiPayload(json);
  if (!text) {
    throw new Error("The API returned an empty response.");
  }

  return {
    raw: json,
    text,
    usage: buildUsageMetrics(json, startedAt),
  };
};

export async function* streamGeminiContent(
  options: InvokeGeminiContentOptions,
): AsyncGenerator<GeminiStreamEvent, void, unknown> {
  const endpoint = getGeminiStreamInteractionsEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey.trim(),
    },
    body: JSON.stringify(buildPayload(options)),
  });

  if (!response.ok) {
    const json = await parseJsonOrThrow(response);
    throw new Error(getErrorMessage(json as GeminiErrorShape, `Gemini API request failed with status ${response.status}`));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to read the response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
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
      const dataLines = frame
        .split("\n")
        .map((line) => line.trim())
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

      if (payload.error) {
        throw new Error(getErrorMessage(payload as GeminiErrorShape, "Gemini API stream failed."));
      }

      const extractedText = extractTextFromGeminiPayload(payload);
      const chunkText = extractedText.startsWith(accumulatedText)
        ? extractedText.slice(accumulatedText.length)
        : extractedText;

      if (chunkText) {
        accumulatedText += chunkText;
        yield {
          type: "delta",
          delta: chunkText,
        };
      }
      lastPayload = payload;
    }
  }

  yield {
    type: "completed",
    raw: lastPayload,
    text: accumulatedText.trim(),
    usage: buildUsageMetrics(lastPayload, startedAt),
  };
}
