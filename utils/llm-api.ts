import {
  ApiProvider,
  GeminiThinkingLevel,
  OpenAIReasoningEffort,
  ReasoningEffort,
} from "@/utils/api-config";
import {
  invokeOpenAIResponses,
  OpenAIResponsesResult,
  OpenAIResponsesStreamEvent,
  streamOpenAIResponses,
} from "@/utils/openai-responses";
import {
  AnthropicMessagesResult,
  AnthropicMessagesStreamEvent,
  invokeAnthropicMessages,
  streamAnthropicMessages,
} from "@/utils/anthropic-messages";
import {
  GeminiContentResult,
  GeminiStreamEvent,
  invokeGeminiContent,
  streamGeminiContent,
} from "@/utils/gemini-content";

export interface InvokeLLMOptions {
  provider: ApiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
}

export type LLMInvokeResult = OpenAIResponsesResult | AnthropicMessagesResult | GeminiContentResult;
export type LLMStreamEvent = OpenAIResponsesStreamEvent | AnthropicMessagesStreamEvent | GeminiStreamEvent;

export const invokeLLM = async (options: InvokeLLMOptions): Promise<LLMInvokeResult> => {
  if (options.provider === "anthropic") {
    return await invokeAnthropicMessages({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      systemMessage: options.systemMessage,
      userMessage: options.userMessage,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
  }

  if (options.provider === "gemini") {
    return await invokeGeminiContent({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      systemMessage: options.systemMessage,
      userMessage: options.userMessage,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort as GeminiThinkingLevel | undefined,
    });
  }

  return await invokeOpenAIResponses({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    systemMessage: options.systemMessage,
    userMessage: options.userMessage,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    reasoningEffort: options.reasoningEffort as OpenAIReasoningEffort | undefined,
  });
};

export async function* streamLLM(options: InvokeLLMOptions): AsyncGenerator<LLMStreamEvent, void, unknown> {
  if (options.provider === "anthropic") {
    yield* streamAnthropicMessages({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      systemMessage: options.systemMessage,
      userMessage: options.userMessage,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
    return;
  }

  if (options.provider === "gemini") {
    yield* streamGeminiContent({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      systemMessage: options.systemMessage,
      userMessage: options.userMessage,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort as GeminiThinkingLevel | undefined,
    });
    return;
  }

  yield* streamOpenAIResponses({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    systemMessage: options.systemMessage,
    userMessage: options.userMessage,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    reasoningEffort: options.reasoningEffort as OpenAIReasoningEffort | undefined,
  });
}
