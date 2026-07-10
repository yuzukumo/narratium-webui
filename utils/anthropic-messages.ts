import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { getAnthropicMessagesEndpoint } from "@/utils/api-config";

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessageContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicMessagesPayload {
  model: string;
  max_tokens: number;
  system?: string | AnthropicMessageContentBlock[];
  messages: Array<{
    role: "user";
    content: string | AnthropicMessageContentBlock[];
  }>;
  stream?: boolean;
}

interface AnthropicErrorShape {
  error?: {
    message?: string;
  } | string;
  message?: string;
}

export interface InvokeAnthropicMessagesOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
}

export interface AnthropicMessagesResult {
  raw: Record<string, any>;
  text: string;
  usage: ResponseUsageMetrics;
}

export type AnthropicMessagesStreamEvent =
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

const getErrorMessage = (payload: AnthropicErrorShape, fallback: string) => {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object" && error.message) {
    return error.message;
  }
  return payload.message || fallback;
};

const shouldCacheText = (value: string): boolean => value.trim().length >= 2048;

const buildCacheableTextBlock = (text: string): AnthropicMessageContentBlock => {
  const block: AnthropicMessageContentBlock & {
    cache_control?: {
      type: "ephemeral";
    };
  } = {
    type: "text",
    text,
  };

  if (shouldCacheText(text)) {
    block.cache_control = {
      type: "ephemeral",
    };
  }

  return block;
};

const buildUsageMetrics = (
  usagePayload: Record<string, any> | undefined,
  startedAt: number,
): ResponseUsageMetrics => {
  const usage = usagePayload || {};
  const cacheCreation = asRecord(usage.cache_creation) || {};
  const cacheCreationInputTokens = firstPositiveNumber(
    usage.cache_creation_input_tokens,
    numberOrZero(cacheCreation.ephemeral_5m_input_tokens) + numberOrZero(cacheCreation.ephemeral_1h_input_tokens),
  );
  const cacheReadInputTokens = firstPositiveNumber(usage.cache_read_input_tokens, usage.cached_tokens);
  const durationMs = Math.max(1, Date.now() - startedAt);
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  const tokensPerSecond = outputTokens > 0
    ? Number((outputTokens / (durationMs / 1000)).toFixed(1))
    : 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens: 0,
    cachedInputTokens: cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    durationMs,
    tokensPerSecond,
  };
};

export const extractTextFromAnthropicPayload = (payload: Record<string, any>): string => {
  const content = Array.isArray(payload.content) ? payload.content as AnthropicMessageContentBlock[] : [];
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text || "")
    .join("")
    .trim();
};

const buildPayload = ({
  model,
  systemMessage,
  userMessage,
  maxTokens,
  stream,
}: InvokeAnthropicMessagesOptions & { stream?: boolean }): AnthropicMessagesPayload => {
  const payload: AnthropicMessagesPayload = {
    model: model.trim(),
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  };

  if (systemMessage.trim()) {
    payload.system = shouldCacheText(systemMessage)
      ? [buildCacheableTextBlock(systemMessage)]
      : systemMessage;
  }

  if (stream) {
    payload.stream = true;
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

export const invokeAnthropicMessages = async (
  options: InvokeAnthropicMessagesOptions,
): Promise<AnthropicMessagesResult> => {
  const endpoint = getAnthropicMessagesEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": options.apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(buildPayload(options)),
  });

  const json = await parseJsonOrThrow(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(json, `Anthropic Messages API request failed with status ${response.status}`));
  }

  const text = extractTextFromAnthropicPayload(json);
  if (!text) {
    throw new Error("The API returned an empty response.");
  }

  return {
    raw: json,
    text,
    usage: buildUsageMetrics(json.usage as Record<string, any> | undefined, startedAt),
  };
};

export async function* streamAnthropicMessages(
  options: InvokeAnthropicMessagesOptions,
): AsyncGenerator<AnthropicMessagesStreamEvent, void, unknown> {
  const endpoint = getAnthropicMessagesEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": options.apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(buildPayload({ ...options, stream: true })),
  });

  if (!response.ok) {
    const json = await parseJsonOrThrow(response);
    throw new Error(getErrorMessage(json, `Anthropic Messages API request failed with status ${response.status}`));
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to read the response stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let latestUsage: Record<string, any> = {};
  let completedPayload: Record<string, any> | null = null;
  let completed = false;

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

      const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "";
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

      let payloadData: Record<string, any>;
      try {
        payloadData = JSON.parse(rawData) as Record<string, any>;
      } catch {
        continue;
      }

      const eventType = eventName || String(payloadData.type || "");

      if (eventType === "error" || payloadData.error) {
        throw new Error(getErrorMessage(payloadData, "Anthropic Messages API stream failed."));
      }

      if (eventType === "message_start" && payloadData.message) {
        const message = payloadData.message as Record<string, any>;
        latestUsage = asRecord(message.usage) || latestUsage;
        completedPayload = message;
        continue;
      }

      if (
        eventType === "content_block_delta"
        && payloadData.delta?.type === "text_delta"
        && typeof payloadData.delta?.text === "string"
      ) {
        accumulatedText += payloadData.delta.text as string;
        yield {
          type: "delta",
          delta: payloadData.delta.text as string,
        };
        continue;
      }

      if (eventType === "message_delta" && payloadData.usage) {
        latestUsage = {
          ...latestUsage,
          ...payloadData.usage as Record<string, any>,
        };
        continue;
      }

      if (eventType === "message_stop") {
        const finalPayload = completedPayload || {
          content: [
            {
              type: "text",
              text: accumulatedText,
            },
          ],
          usage: latestUsage,
        };
        completed = true;
        yield {
          type: "completed",
          raw: finalPayload,
          text: extractTextFromAnthropicPayload(finalPayload) || accumulatedText.trim(),
          usage: buildUsageMetrics(latestUsage, startedAt),
        };
      }
    }
  }

  if (!completed && accumulatedText.trim()) {
    yield {
      type: "completed",
      raw: completedPayload || {},
      text: accumulatedText.trim(),
      usage: buildUsageMetrics(latestUsage, startedAt),
    };
  }
}
