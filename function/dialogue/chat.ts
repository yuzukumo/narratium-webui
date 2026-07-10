import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { PromptType } from "@/lib/models/character-prompts-model";
import { ParsedResponse, ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { DialogueWorkflow, DialogueWorkflowParams } from "@/lib/workflow/examples/DialogueWorkflow";
import { ContextNodeTools } from "@/lib/nodeflow/ContextNode/ContextNodeTools";
import { PresetNodeTools } from "@/lib/nodeflow/PresetNode/PresetNodeTools";
import { RegexNodeTools } from "@/lib/nodeflow/RegexNode/RegexNodeTools";
import { WorldBookNodeTools } from "@/lib/nodeflow/WorldBookNode/WorldBookNodeTools";
import { ApiProvider, DEFAULT_RESPONSE_LENGTH, normalizeBaseUrl, ReasoningEffort } from "@/utils/api-config";
import { streamLLM } from "@/utils/llm-api";

export async function handleCharacterChatRequest(payload: {
  username?: string;
  characterId: string;
  message: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  llmType?: ApiProvider;
  reasoningEffort?: ReasoningEffort;
  streaming?: boolean;
  language?: "zh" | "en";
  promptType?: PromptType;
  number?: number;
  nodeId: string;
  fastModel: boolean;
}): Promise<Response> {
  try {
    const {
      username,
      characterId,
      message,
      modelName,
      baseUrl,
      apiKey,
      llmType = "openai",
      reasoningEffort,
      language = "zh",
      promptType = PromptType.EXPLICIT || PromptType.CUSTOM || PromptType.COMPANION,
      number = DEFAULT_RESPONSE_LENGTH,
      nodeId,
      fastModel = false,
    } = payload;

    if (!characterId || !message) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    if (!modelName?.trim() || !apiKey?.trim()) {
      return new Response(JSON.stringify({
        type: "error",
        message: "API configuration is incomplete. Please set the model and API key in Model Settings.",
        success: false,
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    try {
      if (payload.streaming) {
        return await handleCharacterChatStreamingRequest({
          username,
          characterId,
          message,
          modelName: modelName.trim(),
          baseUrl: normalizeBaseUrl(baseUrl),
          apiKey: apiKey.trim(),
          llmType,
          language,
          promptType,
          number,
          nodeId,
          fastModel,
          reasoningEffort,
        });
      }

      const workflow = new DialogueWorkflow();
      const workflowParams: DialogueWorkflowParams = {
        characterId,
        userInput: message,
        language,
        username,
        modelName: modelName.trim(),
        apiKey: apiKey.trim(),
        baseUrl: normalizeBaseUrl(baseUrl),
        llmType,
        temperature: 0.7,
        streaming: false,
        number,
        promptType,
        fastModel,  
        reasoningEffort,
      };
      const workflowResult = await workflow.execute(workflowParams);
      
      if (!workflowResult || !workflowResult.outputData) {
        throw new Error("No response returned from workflow");
      }

      const {
        replacedText,
        screenContent,
        fullResponse,
        nextPrompts,
        event,
        responseUsage,
      } = workflowResult.outputData;

      await processPostResponseAsync({ characterId, message, fullResponse, screenContent, event, nextPrompts, nodeId, responseUsage })
        .catch((e) => console.error("Post-processing error:", e));

      return new Response(JSON.stringify({
        type: "complete",
        success: true,
        content: screenContent,
        parsedContent: { nextPrompts, usage: responseUsage },
        isRegexProcessed: true,
      }), {
        headers: {
          "Content-Type": "application/json",
        },
      });

    } catch (error: any) {
      console.error("Processing error:", error);
      return new Response(JSON.stringify({
        type: "error",
        message: error.message || "Unknown error",
        success: false,
      }), { 
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

  } catch (error: any) {
    console.error("Fatal error:", error);
    return new Response(JSON.stringify({ error: `Failed to process request: ${error.message}`, success: false }), { 
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

async function buildDialoguePromptFramework(input: {
  characterId: string;
  message: string;
  language: "zh" | "en";
  username?: string;
  number: number;
  fastModel: boolean;
}) {
  const presetResult = await PresetNodeTools.buildPromptFramework(
    input.characterId,
    input.language,
    input.username,
    undefined,
    input.number,
    input.fastModel,
  );

  const contextResult = await ContextNodeTools.assembleChatHistory(
    presetResult.userMessage,
    input.characterId,
    10,
  );

  return await WorldBookNodeTools.assemblePromptWithWorldBook(
    input.characterId,
    presetResult.systemMessage,
    contextResult.userMessage,
    input.message,
    input.language,
    5,
    input.username,
    undefined,
  );
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

async function processDialogueResponse(
  llmResponse: string,
  characterId: string,
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

  const processedRegex = await RegexNodeTools.processRegex(mainContent, characterId);

  return {
    fullResponse: normalized,
    screenContent: processedRegex.replacedText,
    nextPrompts,
    event,
  };
}

async function handleCharacterChatStreamingRequest(payload: {
  username?: string;
  characterId: string;
  message: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  llmType: ApiProvider;
  language: "zh" | "en";
  promptType?: PromptType;
  number: number;
  nodeId: string;
  fastModel: boolean;
  reasoningEffort?: ReasoningEffort;
}): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, any>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const promptFramework = await buildDialoguePromptFramework({
          characterId: payload.characterId,
          message: payload.message,
          language: payload.language,
          username: payload.username,
          number: payload.number,
          fastModel: payload.fastModel,
        });

        let fullResponse = "";
        let latestVisibleContent = "";
        let usage: ResponseUsageMetrics | undefined;

        for await (const event of streamLLM({
          provider: payload.llmType,
          baseUrl: payload.baseUrl,
          apiKey: payload.apiKey,
          model: payload.modelName,
          systemMessage: promptFramework.systemMessage,
          userMessage: promptFramework.userMessage,
          maxTokens: payload.number,
          temperature: 0.7,
          reasoningEffort: payload.reasoningEffort,
        })) {
          if (event.type === "delta") {
            fullResponse += event.delta;
            const nextVisibleContent = extractVisibleStreamContent(fullResponse);

            if (nextVisibleContent !== latestVisibleContent) {
              latestVisibleContent = nextVisibleContent;
              send({
                type: "delta",
                content: latestVisibleContent,
              });
            }
            continue;
          }

          if (event.type === "completed") {
            fullResponse = event.text || fullResponse;
            usage = event.usage;
          }
        }

        const processed = await processDialogueResponse(fullResponse, payload.characterId);

        await processPostResponseAsync({
          characterId: payload.characterId,
          message: payload.message,
          fullResponse: processed.fullResponse,
          screenContent: processed.screenContent,
          event: processed.event,
          nextPrompts: processed.nextPrompts,
          nodeId: payload.nodeId,
          responseUsage: usage,
        });

        send({
          type: "complete",
          success: true,
          content: processed.screenContent,
          parsedContent: {
            nextPrompts: processed.nextPrompts,
            usage,
          },
          isRegexProcessed: true,
        });
      } catch (error: any) {
        send({
          type: "error",
          success: false,
          message: error?.message || "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function processPostResponseAsync({
  characterId,
  message,
  fullResponse,
  screenContent,
  event,
  nextPrompts,
  nodeId,
  responseUsage,
}: {
  characterId: string;
  message: string;
  fullResponse: string;
  screenContent: string;
  event: string;
  nextPrompts: string[];
  nodeId: string;
  responseUsage?: ResponseUsageMetrics;
}) {
  try {
    const parsed: ParsedResponse = {
      regexResult: screenContent,
      nextPrompts,
      usage: responseUsage,
    };
    const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
    const parentNodeId = dialogueTree ? dialogueTree.current_node_id : "root";
    await LocalCharacterDialogueOperations.addNodeToDialogueTree(
      characterId,
      parentNodeId,
      message,
      screenContent,
      fullResponse,
      parsed,
      nodeId,
    );

    if (event) {
      const updatedDialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
      if (updatedDialogueTree) {
        await LocalCharacterDialogueOperations.updateNodeInDialogueTree(
          characterId,
          nodeId,
          {
            parsed_content: {
              ...parsed,
              compressedContent: event,
            },
          },
        );
      }
    }
  } catch (e) {
    console.error("Error in processPostResponseAsync:", e);
  }
}
