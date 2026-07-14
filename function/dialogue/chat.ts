import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { PromptType } from "@/lib/models/character-prompts-model";
import { ParsedResponse, ResponseUsageMetrics } from "@/lib/models/parsed-response";
import {
  ContextCompactionError,
  ContextNodeTools,
} from "@/lib/nodeflow/ContextNode/ContextNodeTools";
import { PresetNodeTools } from "@/lib/nodeflow/PresetNode/PresetNodeTools";
import { responseLengthPreference } from "@/lib/core/preset-assembler";
import { RegexNodeTools } from "@/lib/nodeflow/RegexNode/RegexNodeTools";
import { WorldBookNodeTools } from "@/lib/nodeflow/WorldBookNode/WorldBookNodeTools";
import {
  calculateContextOutputReserve,
  calculateRequestMaxOutputTokens,
  DEFAULT_RESPONSE_LENGTH,
} from "@/utils/api-config";
import { RegexProcessor } from "@/lib/core/regex-processor";
import { RegexPlacement } from "@/lib/models/regex-script-model";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { Character } from "@/lib/core/character";
import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";
import {
  acknowledgeChatRun,
  cancelChatRun,
  createChatRun,
  streamChatRun,
  type ChatRun,
} from "@/utils/chat-runs";
import { APIError } from "@/utils/api-client";
import { isContextOverflowError } from "@/utils/llm-api";

export async function handleCharacterChatRequest(payload: {
  characterId: string;
  characterName: string;
  message: string;
  storedUserMessage?: string;
  promptDirectives?: string[];
  modelId: string;
  modelName: string;
  contextWindow?: number;
  compactionThreshold?: number;
  modelMaxOutputTokens?: number;
  language?: Language;
  promptType?: PromptType;
  /** Soft character-count preference; it never limits provider output tokens. */
  number?: number;
  nodeId: string;
  parentNodeId?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  try {
    const {
      characterId,
      message,
      storedUserMessage = message,
      promptDirectives = [],
      modelId,
      modelName,
      language = "zh",
      promptType = PromptType.EXPLICIT || PromptType.CUSTOM || PromptType.COMPANION,
      number = DEFAULT_RESPONSE_LENGTH,
      nodeId,
      parentNodeId,
      contextWindow = 128000,
      compactionThreshold = Math.floor(contextWindow * 0.95),
      modelMaxOutputTokens: configuredModelMaxOutputTokens,
      signal,
    } = payload;
    const modelMaxOutputTokens = typeof configuredModelMaxOutputTokens === "number"
      && Number.isSafeInteger(configuredModelMaxOutputTokens)
      && configuredModelMaxOutputTokens > 0
      ? configuredModelMaxOutputTokens
      : 0;

    if (!characterId || !message || !storedUserMessage.trim()) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    if (!modelId?.trim()) {
      return new Response(JSON.stringify({
        type: "error",
        message: "No model is selected or available.",
        success: false,
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (modelMaxOutputTokens === 0) {
      return new Response(JSON.stringify({
        type: "error",
        code: "invalid_model_configuration",
        message: "The selected model does not have a valid maximum output capability.",
        success: false,
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    const characterRecord = await LocalCharacterRecordOperations.getCharacterById(characterId);
    if (!characterRecord) {
      return new Response(JSON.stringify({ error: "Character not found" }), { status: 404 });
    }
    const character = new Character(characterRecord);
    const protagonistName = character.protagonistName || defaultProtagonistName(language);

    try {
      return await handleCharacterChatStreamingRequest({
	        protagonistName,
        characterName: payload.characterName || character.characterData.name,
        characterId,
        message,
        storedUserMessage,
        promptDirectives,
        modelId: modelId.trim(),
        modelName: modelName.trim() || modelId.trim(),
        language,
        number,
        promptType,
        nodeId,
        parentNodeId,
        contextWindow,
        compactionThreshold,
        modelMaxOutputTokens,
        signal,
      });

    } catch (error: any) {
      if (error instanceof APIError) throw error;
      console.error("Processing error:", error);
      const compactionError = error instanceof ContextCompactionError;
      return new Response(JSON.stringify({
        type: "error",
        code: compactionError ? error.code : "chat_request_failed",
        request_id: error instanceof APIError ? error.requestId : "",
        message: error.message || "Unknown error",
        success: false,
      }), { 
        status: error instanceof APIError ? error.status : compactionError ? 409 : 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

  } catch (error: any) {
    if (error instanceof APIError) throw error;
    console.error("Fatal error:", error);
    const compactionError = error instanceof ContextCompactionError;
    return new Response(JSON.stringify({
      type: "error",
      code: compactionError ? error.code : "chat_request_failed",
      request_id: error instanceof APIError ? error.requestId : "",
      error: `Failed to process request: ${error.message}`,
      message: error.message,
      success: false,
    }), {
      status: error instanceof APIError ? error.status : compactionError ? 409 : 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

async function buildDialoguePromptFramework(input: {
  characterId: string;
  message: string;
  language: Language;
  protagonistName: string;
  characterName: string;
  number: number;
	modelId: string;
	nodeId: string;
  contextWindow: number;
  compactionThreshold: number;
  modelMaxOutputTokens: number;
  forceCompaction?: boolean;
  signal?: AbortSignal;
}) {
  const presetResult = await PresetNodeTools.buildPromptFramework(
    input.characterId,
    input.language,
    undefined,
    input.number,
  );
  const dynamicMarker = "{{worldInfoBefore}}";
  const markerIndex = presetResult.systemMessage.indexOf(dynamicMarker);
  const stableSystemPrefix = markerIndex >= 0
	  ? presetResult.systemMessage.slice(0, markerIndex)
	  : presetResult.systemMessage;

  const expandPrompt = async (contextUserMessage: string) => {
    const result = await WorldBookNodeTools.assemblePromptWithWorldBook(
      input.characterId,
      presetResult.systemMessage,
      contextUserMessage,
      input.message,
      input.language,
      5,
      undefined,
      input.nodeId,
    );
    const promptSystem = await RegexProcessor.processFullContext(result.systemMessage, {
      ownerId: input.characterId,
      placement: RegexPlacement.WORLD_INFO,
      isPrompt: true,
      protagonistName: input.protagonistName,
	  charName: input.characterName,
    });
    const promptUserInput = await RegexProcessor.processFullContext(result.userMessage, {
      ownerId: input.characterId,
      placement: RegexPlacement.USER_INPUT,
      isPrompt: true,
	  protagonistName: input.protagonistName,
	  charName: input.characterName,
    });
    const promptAssistantHistory = await RegexProcessor.processFullContext(promptUserInput.replacedText, {
      ownerId: input.characterId,
      placement: RegexPlacement.AI_OUTPUT,
      isPrompt: true,
	  protagonistName: input.protagonistName,
	  charName: input.characterName,
    });
    return {
      systemMessage: promptSystem.replacedText,
      // Put the soft length preference after the fully expanded card,
      // world-book, history, and current input so it is not buried by them.
      userMessage: `${promptAssistantHistory.replacedText}\n\n${responseLengthPreference(input.language, input.number)}`,
      stableSystemPrefix,
    };
  };

  const responseOutputReserve = calculateContextOutputReserve(
    input.contextWindow,
    input.compactionThreshold,
    input.modelMaxOutputTokens,
  );
  const contextOptions = {
    contextWindow: input.contextWindow,
    compactionThreshold: input.compactionThreshold,
    maxOutputTokens: responseOutputReserve,
    modelMaxOutputTokens: input.modelMaxOutputTokens,
    staticPrompt: `${presetResult.systemMessage}\n${input.message}`,
    modelId: input.modelId,
    language: input.language,
    nodeId: input.nodeId,
    signal: input.signal,
  };
  let contextResult = await ContextNodeTools.assembleChatHistory(
    presetResult.userMessage,
    input.characterId,
    { ...contextOptions, deferCompaction: true },
  );
  let prompt = await expandPrompt(contextResult.userMessage);
  const inputBudget = Math.max(Math.min(
    input.compactionThreshold,
    input.contextWindow - responseOutputReserve,
  ), 0);
  let finalPromptTokens = ContextNodeTools.estimateTokens(
    `${prompt.systemMessage}\n${prompt.userMessage}`,
  );
  let shouldForceCompaction = Boolean(input.forceCompaction);
  for (let compactionPass = 0; compactionPass < 3; compactionPass += 1) {
    if (!shouldForceCompaction && finalPromptTokens <= inputBudget) break;
    const measuredOverhead = Math.max(finalPromptTokens - contextResult.historyTokenEstimate, 0);
    const exactHistoryBudget = Math.max(inputBudget - measuredOverhead - 128, 0);
    contextResult = await ContextNodeTools.assembleChatHistory(
      presetResult.userMessage,
      input.characterId,
      {
        ...contextOptions,
        historyTokenBudget: shouldForceCompaction
          ? Math.min(exactHistoryBudget, Math.max(contextResult.historyTokenEstimate - 1, 0))
          : exactHistoryBudget,
        forceCompaction: shouldForceCompaction,
      },
    );
    prompt = await expandPrompt(contextResult.userMessage);
    finalPromptTokens = ContextNodeTools.estimateTokens(`${prompt.systemMessage}\n${prompt.userMessage}`);
    shouldForceCompaction = false;
  }

  if (finalPromptTokens > inputBudget) {
    throw new Error(
      `The fully expanded prompt is still too large after safe context compaction (${finalPromptTokens} estimated input tokens; budget ${inputBudget}).`,
    );
  }
  return {
    ...prompt,
    requestMaxOutputTokens: calculateRequestMaxOutputTokens(
      input.contextWindow,
      finalPromptTokens,
      input.modelMaxOutputTokens,
    ),
  };
}

function extractVisibleStreamContent(rawResponse: string): string {
  return rawResponse
    .replace(/\n*\s*<think>[\s\S]*?(?:<\/think>|$)\s*\n*/g, "")
    .replace(/\n*\s*<thinking>[\s\S]*?(?:<\/thinking>|$)\s*\n*/g, "")
    .replace(/\s*<\/?output>\s*/g, "")
    .replace(/\s*<\/?outputFormat>\s*/g, "")
    .replace(/\n*\s*<next_prompts>[\s\S]*?(?:<\/next_prompts>|$)\s*\n*/g, "")
    .replace(/\n*\s*<events>[\s\S]*?(?:<\/events>|$)\s*\n*/g, "")
    .trim();
}

type GenerationStatus = "pending" | "completed" | "failed" | "canceled";

function generationMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function runParsedContent(input: {
  screenContent: string;
  status: GenerationStatus;
  modelId: string;
  modelName: string;
  promptDirectives?: string[];
  usage?: ResponseUsageMetrics;
  errorCode?: string;
  errorMessage?: string;
  nextPrompts?: string[];
  event?: string;
}): ParsedResponse {
  return {
    regexResult: input.screenContent,
    nextPrompts: input.nextPrompts,
    promptDirectives: input.promptDirectives?.length ? input.promptDirectives : undefined,
    compressedContent: input.event,
    usage: input.usage,
    modelId: input.modelId,
    modelName: input.modelName,
    generationStatus: input.status,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
}

async function persistDialogueGenerationState(input: {
  characterId: string;
  nodeId: string;
  parentNodeId: string;
  userMessage: string;
  fullResponse: string;
  screenContent: string;
  status: GenerationStatus;
  modelId: string;
  modelName: string;
  promptDirectives?: string[];
  usage?: ResponseUsageMetrics;
  errorCode?: string;
  errorMessage?: string;
  nextPrompts?: string[];
  event?: string;
}): Promise<void> {
  await LocalCharacterDialogueOperations.upsertNodeToDialogueTree(
    input.characterId,
    input.parentNodeId,
    input.userMessage,
    input.screenContent,
    input.fullResponse,
    runParsedContent(input),
    input.nodeId,
  );
}

async function persistRunFailure(input: {
  run: ChatRun;
  characterId: string;
  parentNodeId: string;
  promptDirectives?: string[];
  modelId: string;
  modelName: string;
  status: "failed" | "canceled";
  fallbackMessage: string;
}): Promise<ParsedResponse> {
  const rawResponse = input.run.response_text || "";
  const screenContent = extractVisibleStreamContent(rawResponse);
  const errorMessage = input.run.error_message || input.fallbackMessage;
  const parsedContent = runParsedContent({
    screenContent,
    status: input.status,
    modelId: input.modelId,
    modelName: input.modelName,
    promptDirectives: input.promptDirectives,
    usage: runUsageToMetrics(input.run.usage),
    errorCode: input.run.error_code,
    errorMessage,
  });
  await LocalCharacterDialogueOperations.upsertNodeToDialogueTree(
    input.characterId,
    input.parentNodeId,
    input.run.user_message,
    screenContent,
    rawResponse,
    parsedContent,
    input.run.node_id,
  );
  return parsedContent;
}

async function processDialogueResponse(
  llmResponse: string,
  characterId: string,
  protagonistName: string,
  characterName: string,
): Promise<{
  fullResponse: string;
  screenContent: string;
  nextPrompts: string[];
  event: string;
}> {
  const normalized = llmResponse
    .replace(/\n*\s*<think>[\s\S]*?<\/think>\s*\n*/g, "")
    .replace(/\n*\s*<thinking>[\s\S]*?<\/thinking>\s*\n*/g, "")
    .trim();

  const cleanedResponse = normalized
    .replace(/\s*<\/?output>\s*/g, "")
    .replace(/\s*<\/?outputFormat>\s*/g, "")
    .trim();

  const nextPromptsMatch = cleanedResponse.match(/<next_prompts>([\s\S]*?)<\/next_prompts>/);
  const nextPrompts = nextPromptsMatch
    ? nextPromptsMatch[1]
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\s*\[|\]\s*$/g, "").trim())
    : [];

  const eventsMatch = cleanedResponse.match(/<events>([\s\S]*?)<\/events>/);
  const event = eventsMatch ? eventsMatch[1].trim().replace(/\[|\]/g, "") : "";

  const mainContent = cleanedResponse
    .replace(/\n*\s*<next_prompts>[\s\S]*?<\/next_prompts>\s*\n*/g, "")
    .replace(/\n*\s*<events>[\s\S]*?<\/events>\s*\n*/g, "")
    .trim();

  const processedRegex = await RegexNodeTools.processRegex(
    mainContent,
    characterId,
    protagonistName,
    characterName,
  );

  return {
    fullResponse: normalized,
    screenContent: processedRegex.replacedText,
    nextPrompts,
    event,
  };
}

async function handleCharacterChatStreamingRequest(payload: {
  protagonistName: string;
  characterName: string;
  characterId: string;
  message: string;
  storedUserMessage: string;
  promptDirectives: string[];
  modelId: string;
  modelName: string;
  language: Language;
  promptType?: PromptType;
  number: number;
  nodeId: string;
  parentNodeId?: string;
  contextWindow: number;
  compactionThreshold: number;
  modelMaxOutputTokens: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(payload.characterId);
  const parentNodeId = payload.parentNodeId || dialogueTree?.current_node_id || "root";
  if (
    parentNodeId !== "root"
    && !dialogueTree?.nodes.some((node) => node.node_id === parentNodeId)
  ) {
    throw new Error("The selected dialogue branch no longer exists. Reload the conversation and try again.");
  }

  // Commit the user turn before any prompt assembly or provider request. The
  // node is updated in place as the run moves through its lifecycle, so an
  // error, stop, or browser disconnect cannot erase the submitted message.
  await persistDialogueGenerationState({
    characterId: payload.characterId,
    nodeId: payload.nodeId,
    parentNodeId,
    userMessage: payload.storedUserMessage,
    fullResponse: "",
    screenContent: "",
    status: "pending",
    modelId: payload.modelId,
    modelName: payload.modelName,
    promptDirectives: payload.promptDirectives,
  });

  try {
    let promptFramework = await buildDialoguePromptFramework({
      characterId: payload.characterId,
      message: payload.message,
      language: payload.language,
      protagonistName: payload.protagonistName,
      characterName: payload.characterName,
      number: payload.number,
      modelId: payload.modelId,
      nodeId: parentNodeId,
      contextWindow: payload.contextWindow,
      compactionThreshold: payload.compactionThreshold,
      modelMaxOutputTokens: payload.modelMaxOutputTokens,
      signal: payload.signal,
    });
    const startRun = () => createChatRun({
      characterId: payload.characterId,
      characterName: payload.characterName,
      nodeId: payload.nodeId,
      parentNodeId,
      userMessage: payload.storedUserMessage,
      modelName: payload.modelName,
      modelId: payload.modelId,
      systemMessage: promptFramework.systemMessage,
      userPrompt: promptFramework.userMessage,
      stableSystemPrefix: promptFramework.stableSystemPrefix,
      maxTokens: promptFramework.requestMaxOutputTokens,
      temperature: 0.7,
    });
    let run: ChatRun;
    try {
      run = await startRun();
    } catch (error) {
      if (!isContextOverflowError(error)) throw error;
      promptFramework = await buildDialoguePromptFramework({
        characterId: payload.characterId,
        message: payload.message,
        language: payload.language,
        protagonistName: payload.protagonistName,
        characterName: payload.characterName,
        number: payload.number,
        modelId: payload.modelId,
        nodeId: parentNodeId,
        contextWindow: payload.contextWindow,
        compactionThreshold: payload.compactionThreshold,
        modelMaxOutputTokens: payload.modelMaxOutputTokens,
        forceCompaction: true,
        signal: payload.signal,
      });
      run = await startRun();
    }
    return streamExistingCharacterChatRun({
      run,
      characterId: payload.characterId,
      protagonistName: payload.protagonistName,
      characterName: payload.characterName,
      modelId: payload.modelId,
      modelName: payload.modelName,
      message: payload.storedUserMessage,
      storedUserMessage: payload.storedUserMessage,
      promptDirectives: payload.promptDirectives,
      nodeId: payload.nodeId,
      parentNodeId,
      signal: payload.signal,
    });
  } catch (error) {
    const canceled = payload.signal?.aborted === true;
    const message = canceled
      ? "Generation stopped."
      : generationMessage(error, "The generation could not be started.");
    await persistDialogueGenerationState({
      characterId: payload.characterId,
      nodeId: payload.nodeId,
      parentNodeId,
      userMessage: payload.storedUserMessage,
      fullResponse: "",
      screenContent: "",
      status: canceled ? "canceled" : "failed",
      modelId: payload.modelId,
      modelName: payload.modelName,
      promptDirectives: payload.promptDirectives,
      errorMessage: message,
      errorCode: canceled ? "canceled" : error instanceof APIError ? error.code : "chat_request_failed",
    });
    throw error;
  }
}

export async function resumeCharacterChatRun(payload: {
	run: ChatRun;
	characterId: string;
	protagonistName: string;
	characterName: string;
	modelId?: string;
	modelName?: string;
	signal?: AbortSignal;
}): Promise<Response> {
  return streamExistingCharacterChatRun({
    run: payload.run,
    characterId: payload.characterId,
    protagonistName: payload.protagonistName,
    characterName: payload.characterName,
    modelId: payload.modelId || payload.run.model_id,
    modelName: payload.modelName || payload.run.model_name,
    message: payload.run.user_message,
    storedUserMessage: payload.run.user_message,
    promptDirectives: [],
    nodeId: payload.run.node_id,
    parentNodeId: payload.run.parent_node_id,
    signal: payload.signal,
  });
}

async function streamExistingCharacterChatRun(payload: {
	run: ChatRun;
	characterId: string;
	protagonistName: string;
	characterName: string;
	modelId: string;
	modelName: string;
	message: string;
	storedUserMessage: string;
	promptDirectives: string[];
	nodeId: string;
	parentNodeId: string;
	signal?: AbortSignal;
}): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, any>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let latestVisibleContent = "";
      let latestRun = payload.run;
      let cancellationStarted = false;
      const cancelIfRequested = () => {
        if (cancellationStarted) return;
        cancellationStarted = true;
        void cancelChatRun(payload.run.id).catch((error) => {
          console.warn("Failed to stop persisted chat run:", error);
        });
      };
      if (payload.signal?.aborted) cancelIfRequested();
      else payload.signal?.addEventListener("abort", cancelIfRequested, { once: true });

      try {
        for await (const run of streamChatRun(payload.run.id, {
          onSnapshot: (snapshot) => {
            const visible = extractVisibleStreamContent(snapshot.response_text || "");
            if (visible !== latestVisibleContent) {
              latestVisibleContent = visible;
              send({ type: "delta", content: visible });
            }
          },
        })) {
          latestRun = run;
          if (run.status === "running" || run.status === "queued") continue;
          if (run.status === "failed") {
            const parsedContent = await persistRunFailure({
              run,
              characterId: payload.characterId,
              parentNodeId: payload.parentNodeId,
              promptDirectives: payload.promptDirectives,
              modelId: payload.modelId,
              modelName: payload.modelName,
              status: "failed",
              fallbackMessage: "The model provider request failed.",
            });
            send({
              type: "error", success: false,
              code: run.error_code || "chat_run_failed",
              message: run.error_message || "The model provider request failed.",
              content: parsedContent.regexResult || "",
              parsedContent,
              run_id: run.id,
              acknowledge: true,
            });
            return;
          }

          const rawResponse = run.response_text || "";
          const usage = runUsageToMetrics(run.usage);
          if (!rawResponse.trim()) {
            const isCanceled = run.status === "canceled";
            const parsedContent = await persistRunFailure({
              run,
              characterId: payload.characterId,
              parentNodeId: payload.parentNodeId,
              promptDirectives: payload.promptDirectives,
              modelId: payload.modelId,
              modelName: payload.modelName,
              status: isCanceled ? "canceled" : "failed",
              fallbackMessage: isCanceled ? "Generation stopped." : "The generation returned no content.",
            });
            await acknowledgeChatRun(run.id);
            send({
              type: isCanceled ? "stopped" : "error",
              success: isCanceled,
              content: "",
              parsedContent,
              message: parsedContent.errorMessage,
              code: parsedContent.errorCode,
              run_id: run.id,
            });
            continue;
          }
          const processed = await processDialogueResponse(
            rawResponse,
            payload.characterId,
            payload.protagonistName,
            payload.characterName,
          );
          const branchMeta = await processPostResponseAsync({
            characterId: payload.characterId,
            message: payload.storedUserMessage,
            fullResponse: processed.fullResponse,
            screenContent: processed.screenContent,
            event: processed.event,
            nextPrompts: processed.nextPrompts,
            nodeId: payload.nodeId,
            parentNodeId: payload.parentNodeId,
            modelId: payload.modelId,
            modelName: payload.modelName,
            responseUsage: usage,
            promptDirectives: payload.promptDirectives,
            generationStatus: run.status === "canceled" ? "canceled" : "completed",
            generationError: run.status === "canceled" ? "Generation stopped." : undefined,
          });
          await acknowledgeChatRun(run.id);
          const parsedContent = {
            ...runParsedContent({
              screenContent: processed.screenContent,
              status: run.status === "canceled" ? "canceled" : "completed",
              modelId: payload.modelId,
              modelName: payload.modelName,
              promptDirectives: payload.promptDirectives,
              usage,
              nextPrompts: processed.nextPrompts,
              event: processed.event,
              errorMessage: run.status === "canceled" ? "Generation stopped." : undefined,
            }),
            ...branchMeta,
          };
          if (run.status === "canceled") {
            send({ type: "stopped", success: true, content: processed.screenContent, parsedContent, run_id: run.id });
          } else {
            send({ type: "complete", success: true, content: processed.screenContent, parsedContent, isRegexProcessed: true, run_id: run.id });
          }
        }
      } catch (error: any) {
        if (payload.signal?.aborted) return;
        const errorMessage = error?.message || "The generation could not be completed.";
        if (latestRun.status === "canceled") {
          const parsedContent = await persistRunFailure({
            run: latestRun,
            characterId: payload.characterId,
            parentNodeId: payload.parentNodeId,
            promptDirectives: payload.promptDirectives,
            modelId: payload.modelId,
            modelName: payload.modelName,
            status: "canceled",
            fallbackMessage: "Generation stopped.",
          });
          await acknowledgeChatRun(latestRun.id).catch(() => undefined);
          send({
            type: "stopped",
            success: true,
            content: parsedContent.regexResult || "",
            parsedContent,
            run_id: latestRun.id,
          });
          return;
        }
        await persistDialogueGenerationState({
          characterId: payload.characterId,
          nodeId: payload.nodeId,
          parentNodeId: payload.parentNodeId,
          userMessage: payload.storedUserMessage,
          fullResponse: latestRun.response_text || "",
          screenContent: extractVisibleStreamContent(latestRun.response_text || ""),
          status: "failed",
          modelId: payload.modelId,
          modelName: payload.modelName,
          promptDirectives: payload.promptDirectives,
          usage: runUsageToMetrics(latestRun.usage),
          errorCode: error instanceof APIError ? error.code : "chat_run_failed",
          errorMessage,
        });
        send({
          type: "error", success: false,
          code: error instanceof APIError ? error.code : "chat_run_failed",
          message: errorMessage,
          content: extractVisibleStreamContent(latestRun.response_text || ""),
          parsedContent: runParsedContent({
            screenContent: extractVisibleStreamContent(latestRun.response_text || ""),
            status: "failed",
            modelId: payload.modelId,
            modelName: payload.modelName,
            promptDirectives: payload.promptDirectives,
            usage: runUsageToMetrics(latestRun.usage),
            errorCode: error instanceof APIError ? error.code : "chat_run_failed",
            errorMessage,
          }),
          run_id: payload.run.id,
          acknowledge: false,
        });
      } finally {
        payload.signal?.removeEventListener("abort", cancelIfRequested);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Chat-Run-ID": payload.run.id,
    },
  });
}

function runUsageToMetrics(usage: ChatRun["usage"]): ResponseUsageMetrics {
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const durationMs = usage?.duration_ms || 0;
  const firstTokenMs = usage?.first_token_ms || 0;
  const generationMs = Math.max(durationMs - firstTokenMs, 0);
  return {
    costMicrousd: usage?.cost_microusd,
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens || inputTokens + outputTokens,
    reasoningTokens: usage?.reasoning_tokens || 0,
    cachedInputTokens: usage?.cache_read_input_tokens || 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens || 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens || 0,
    durationMs,
    firstTokenMs,
    tokensPerSecond: outputTokens > 0 && generationMs > 0
      ? Number((outputTokens / (generationMs / 1000)).toFixed(1))
      : 0,
  };
}

async function processPostResponseAsync({
  characterId,
  message,
  fullResponse,
  screenContent,
	  event,
	  nextPrompts,
	  nodeId,
	  parentNodeId,
  modelId,
  modelName,
  responseUsage,
  promptDirectives,
  generationStatus = "completed",
  generationError,
}: {
  characterId: string;
  message: string;
  fullResponse: string;
  screenContent: string;
  event: string;
  nextPrompts: string[];
	  nodeId: string;
	  parentNodeId: string;
  modelId: string;
  modelName: string;
  responseUsage?: ResponseUsageMetrics;
  promptDirectives?: string[];
  generationStatus?: "completed" | "canceled";
  generationError?: string;
}) {
  try {
    const parsed = runParsedContent({
      screenContent,
      nextPrompts,
      promptDirectives,
      event,
      usage: responseUsage,
      modelId,
      modelName,
      status: generationStatus,
      errorMessage: generationError,
    });
    await LocalCharacterDialogueOperations.upsertNodeToDialogueTree(
      characterId,
      parentNodeId,
      message,
      screenContent,
      fullResponse,
      parsed,
      nodeId,
    );
    const siblings = await LocalCharacterDialogueOperations.getChildNodes(characterId, parentNodeId);
    const alternativeNodeIds = siblings.map((node) => node.node_id);
    return {
      alternativeIndex: Math.max(alternativeNodeIds.indexOf(nodeId) + 1, 1),
      alternativeCount: Math.max(alternativeNodeIds.length, 1),
      alternativeNodeIds: alternativeNodeIds.length > 0 ? alternativeNodeIds : [nodeId],
    };

  } catch (e) {
    console.error("Error in processPostResponseAsync:", e);
    throw e;
  }
}
