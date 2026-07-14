/**
 * Character Page Component
 * 
 * This is the main character interaction page that provides:
 * - Real-time chat interface with character
 * - World book editing capabilities
 * - Regex script management
 * - Preset management
 * - Message history and regeneration
 * - Branch switching in conversations
 * 
 * The page handles all character interactions and provides a rich
 * set of features for managing character dialogues and settings.
 * 
 * Dependencies:
 * - CharacterSidebar: For character navigation
 * - CharacterChatPanel: For chat interface
 * - WorldBookEditor: For world book management
 * - RegexScriptEditor: For regex script editing
 * - PresetEditor: For preset management
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useLanguage } from "@/app/i18n";
import { defaultProtagonistName } from "@/lib/i18n/languages";
import { toast } from "react-hot-toast";
import CharacterSidebar from "@/components/CharacterSidebar";
import { PromptType } from "@/lib/models/character-prompts-model";
import { ParsedResponse } from "@/lib/models/parsed-response";
import { v4 as uuidv4 } from "uuid";
import { initCharacterDialogue } from "@/function/dialogue/init";
import { getCharacterDialogue } from "@/function/dialogue/info";
import { MOBILE_VIEWPORT_QUERY, useMediaQuery } from "@/lib/browser/use-media-query";
import { handleCharacterChatRequest, resumeCharacterChatRun } from "@/function/dialogue/chat";
import { switchDialogueBranch } from "@/function/dialogue/truncate";
import CharacterChatPanel from "@/components/CharacterChatPanel";
import CharacterChatHeader from "@/components/CharacterChatHeader";
import { getStoredResponseLength } from "@/utils/api-config";
import { useModels } from "@/contexts/ModelContext";
import { APIError, parseAPIError } from "@/utils/api-client";
import { acknowledgeChatRun, cancelChatRun, getPendingChatRuns } from "@/utils/chat-runs";
import { LLMStreamError } from "@/utils/llm-api";
import { NARRATIVE_MODE_DIRECTIVES } from "@/lib/prompts/preset-prompts";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";

const editorLoading = () => (
  <div className="flex h-full min-h-0 items-center justify-center" aria-busy="true">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#665442] border-t-[#e0b766]" />
  </div>
);

const WorldBookEditor = dynamic(() => import("@/components/WorldBookEditor"), { loading: editorLoading });
const RegexScriptEditor = dynamic(() => import("@/components/RegexScriptEditor"), { loading: editorLoading });
const PresetEditor = dynamic(() => import("@/components/PresetEditor"), { loading: editorLoading });

/**
 * Interface definitions for the component's data structures
 */
interface Character {
  id: string;
  name: string;
  personality?: string;
  avatar_path?: string;
  protagonistName?: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp?: string;
  parsedContent?: ParsedResponse | null;
  nodeId?: string;
  parentNodeId?: string;
  alternativeIndex?: number;
  alternativeCount?: number;
  alternativeNodeIds?: string[];
}

type ActiveModes = {
  "story-progress": boolean;
  perspective: {
    active: boolean;
    mode: "novel" | "protagonist";
  };
  "scene-setting": boolean;
};

function formatDialogueMessages(dialogue: any): Message[] {
  return (dialogue?.messages || []).map((msg: any) => ({
    id: String(msg.id),
    role: msg.role === "system" ? "assistant" : msg.role,
    content: msg.content || "",
    timestamp: msg.timestamp || new Date(dialogue.created_at).toISOString(),
    parsedContent: msg.parsedContent || null,
    nodeId: msg.nodeId || msg.node_id || String(msg.id),
    parentNodeId: msg.parentNodeId || msg.parent_node_id,
    alternativeIndex: msg.alternativeIndex,
    alternativeCount: msg.alternativeCount,
    alternativeNodeIds: msg.alternativeNodeIds,
  }));
}

function visibleStoredUserMessage(content: string): string {
  const wrapped = content.match(/<input_message>([\s\S]*?)<\/input_message>/)?.[1];
  return (wrapped || content)
    .replace(/^\s*(?:玩家输入指令|Player Input)[:：]\s*/i, "")
    .trim();
}

/**
 * Main character interaction page component
 * 
 * Manages all character interactions and provides a comprehensive interface for:
 * - Chat functionality with message history
 * - World book editing
 * - Regex script management
 * - Preset configuration
 * - Message regeneration and branch switching
 * 
 * @returns {JSX.Element} The complete character interaction interface
 */
export default function CharacterPage() {
  const searchParams = useSearchParams();
  const characterId = searchParams.get("id");
  const { t, language, fontClass, serifFontClass } = useLanguage();
  const {
    models,
    activeModel,
    loading: modelsLoading,
    activateCharacter,
    selectModel,
  } = useModels();

  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pageError, setPageError] = useState("");
  const [userInput, setUserInput] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);
  const [viewportReady, setViewportReady] = useState(false);
  const [suggestedInputs, setSuggestedInputs] = useState<string[]>([]);
  const initializationRef = useRef(false);
  const generationControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const lastIsMobileRef = useRef<boolean | null>(null);
  const [activeView, setActiveView] = useState<"chat" | "worldbook" | "regex" | "preset">("chat");
  const [activeModes, setActiveModes] = useState<ActiveModes>({
    "story-progress": false,
    "perspective": {
      active: false,
      mode: "novel",
    },
    "scene-setting": false,
  });

  const switchToView = (targetView: "chat" | "worldbook" | "regex" | "preset") => {
    setActiveView(targetView);
  };

  const toggleView = () => {
    setActiveView(prev => prev === "chat" ? "worldbook" : "chat");
  };

  const toggleRegexEditor = () => {
    setActiveView(prev => prev === "regex" ? "chat" : "regex");
  };

  useEffect(() => {
    if (isMobile === null || lastIsMobileRef.current === isMobile) return;

    setSidebarCollapsed(isMobile);
    lastIsMobileRef.current = isMobile;
    setViewportReady(true);
  }, [isMobile]);

  useEffect(() => {
    if (characterId) {
      activateCharacter(characterId);
    }
  }, [activateCharacter, characterId]);

  const handleSwitchBranch = async (nodeId: string) => {
    if (!characterId) return;
    
    try {
      const knownAlternative = messages.some((msg) => msg.alternativeNodeIds?.includes(nodeId));
      const visibleNode = messages.some((msg) => (msg.nodeId || msg.id) === nodeId);
      if (!knownAlternative && !visibleNode) {
        console.warn(`Dialogue branch not found: ${nodeId}`);
        return;
      }
  
      const response = await switchDialogueBranch({
        characterId,
        nodeId,
      });
      
      if (!response.success) {
        console.error("Failed to switch dialogue branch", response);
        return;
      }
      
      const dialogue = response.dialogue;
      
      if (dialogue) {
        const formattedMessages = formatDialogueMessages(dialogue);
        setMessages(formattedMessages);
        const lastAssistant = [...formattedMessages].reverse().find((msg) => msg.role === "assistant");
        setSuggestedInputs(lastAssistant?.parsedContent?.nextPrompts || []);
      }
    } catch (error) {
      console.error("Error switching dialogue branch:", error);
    }
  };

  const handleRegenerate = async (nodeId: string) => {
    const messageIndex = messages.findIndex((msg) => (
      (msg.role === "assistant" || msg.role === "error")
      && (msg.nodeId || msg.id) === nodeId
    ));
    const target = messages[messageIndex];
    if (!target || (target.role !== "assistant" && target.role !== "error")) return;

    const userMessage = messages.find((msg) => msg.role === "user" && (msg.nodeId || msg.id) === nodeId)
      || [...messages.slice(0, messageIndex)].reverse().find((msg) => msg.role === "user");
    if (!userMessage) return;

    const targetNodeId = target.nodeId || target.id;
    const parentNodeId = target.parentNodeId || "root";
    const userIndex = messages.findIndex((msg) => msg.role === "user" && (msg.nodeId || msg.id) === targetNodeId);
    const prefix = messages.slice(0, userIndex >= 0 ? userIndex : messageIndex);
    await handleSendMessage(visibleStoredUserMessage(userMessage.content), {
      parentNodeId,
      promptDirectives: target.parsedContent?.promptDirectives || userMessage.parsedContent?.promptDirectives || [],
      displayPrefix: prefix,
    });
  };

  const handleEditUserMessage = async (nodeId: string, editedContent: string) => {
    const target = messages.find((msg) => msg.role === "user" && (msg.nodeId || msg.id) === nodeId);
    if (!target || !editedContent.trim()) return;
    const index = messages.indexOf(target);
    const prefix = messages.slice(0, index);
    const assistantForTurn = messages.find((msg) => (
      msg.role === "assistant" && (msg.nodeId || msg.id) === nodeId
    ));
    await handleSendMessage(editedContent.trim(), {
      parentNodeId: target.parentNodeId || "root",
      promptDirectives: assistantForTurn?.parsedContent?.promptDirectives || [],
      displayPrefix: prefix,
    });
  };

  const fetchLatestDialogue = async () => {
    if (!characterId) return;

    try {
      const response = await getCharacterDialogue(characterId, language);
      if (!response.success) {
        throw new Error(`Failed to load dialogue: ${response}`);
      }
      
      const dialogue = response.dialogue;

      if (dialogue && dialogue.messages) {
        const formattedMessages = formatDialogueMessages(dialogue);
        setMessages(formattedMessages);
        const lastAssistant = [...formattedMessages].reverse().find((msg) => msg.role === "assistant");
        setSuggestedInputs(lastAssistant?.parsedContent?.nextPrompts || []);
      }
    } catch (err) {
      console.error("Error refreshing dialogue:", err);
    }
  };

  const createPendingAssistantMessage = (id: string, metadata: Partial<Message> = {}): Message => ({
    id,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parsedContent: null,
    nodeId: id,
    ...metadata,
  });

  const createInlineErrorMessage = (message: string, id = `error-${Date.now()}`): Message => ({
    id,
    role: "error",
    content: message,
    timestamp: new Date().toISOString(),
  });

  const upsertInlineErrorMessage = (message: string, replaceMessageId?: string) => {
    const errorMessage = createInlineErrorMessage(message, replaceMessageId || `error-${Date.now()}`);

    setMessages((prev) => {
      if (replaceMessageId && prev.some((item) => item.id === replaceMessageId)) {
        return prev.map((item) => {
          if (item.id !== replaceMessageId) return item;
          const hasPartialResponse = item.role === "assistant" && item.content.trim() !== "";
          return {
            ...item,
            role: hasPartialResponse ? "assistant" : "error",
            content: hasPartialResponse ? item.content : message,
            parsedContent: {
              ...(item.parsedContent || {}),
              generationStatus: "failed",
              errorMessage: message,
            },
            nodeId: item.nodeId || item.id,
          };
        });
      }

      return [...prev, errorMessage];
    });
  };

  const markInlineGenerationStopped = (messageId: string) => {
    const stoppedMessage = t("characterChat.generationStopped") || "Generation stopped.";
    setMessages((prev) => prev.map((item) => {
      if (item.id !== messageId) return item;
      const hasPartialResponse = item.content.trim() !== "";
      return {
        ...item,
        role: hasPartialResponse ? "assistant" : "error",
        content: hasPartialResponse ? item.content : stoppedMessage,
        parsedContent: {
          ...(item.parsedContent || {}),
          generationStatus: "canceled",
          errorMessage: stoppedMessage,
        },
        nodeId: item.nodeId || item.id,
      };
    }));
  };

  const generationErrorMessage = (reason: unknown): string => {
    const code = reason instanceof APIError || reason instanceof LLMStreamError
      ? reason.code
      : "";
    if (code === "insufficient_user_quota" || code === "insufficient_balance") {
      return t("game.insufficientQuota");
    }
    return reason instanceof Error ? reason.message : t("game.actionFailed");
  };

  useEffect(() => {
    const loadCharacterAndDialogue = async () => {
      if (!characterId) return;
      
      setIsLoading(true);
      setPageError("");
      
      try {
        const response = await getCharacterDialogue(characterId, language);
        if (!response.success) {
          throw new Error(`Failed to load character: ${response}`);
        }
        
        const dialogue = response.dialogue;
        const character = response.character;
        void LocalCharacterRecordOperations.touchCharacter(characterId).catch((error) => {
          console.error("Failed to update character last-used time:", error);
        });

        const characterInfo = {
          id: character.id,
          name: character.data.name,
          personality: character.data.personality,
          avatar_path: character.thumbnailPath || character.imagePath,
          protagonistName: character.protagonistName,
        };
        setCharacter(characterInfo);

        if (dialogue && dialogue.messages) {
          const formattedMessages = formatDialogueMessages(dialogue);
          setMessages(formattedMessages);
          const lastAssistant = [...formattedMessages].reverse().find((msg) => msg.role === "assistant");
          setSuggestedInputs(lastAssistant?.parsedContent?.nextPrompts || []);
        }
        else if (!initializationRef.current) {
          initializationRef.current = true;
          await initializeNewDialogue(characterId);
        }
      } catch (err) {
        console.error("Error loading character or dialogue:", err);
        setPageError(typeof err === "object" && err !== null && "message" in err ? (err as Error).message : "Failed to load character");
      } finally {
        setIsLoading(false);
      }
    };

    loadCharacterAndDialogue();
  }, [characterId]);

  const initializeNewDialogue = async (charId: string) => {
    try {
      setIsInitializing(true);
      const initData = await initCharacterDialogue({
        characterId: charId,
        language,
      });

      if (!initData.success) {
        throw new Error(`Failed to initialize dialogue: ${initData}`);
      }
      if (initData.firstMessage) {
        setMessages([{
          id: initData.nodeId,
          nodeId: initData.nodeId,
          parentNodeId: "root",
          alternativeIndex: 1,
          alternativeCount: initData.alternativeNodeIds.length,
          alternativeNodeIds: initData.alternativeNodeIds,
          role: "assistant",
          content: initData.firstMessage,
          timestamp: new Date().toISOString(),
        },
        ]);
      }
    } catch (error) {
      console.error("Error initializing dialogue:", error);
      throw error;
    } finally {
      setIsInitializing(false);
    }
  };

  const consumeChatResponse = async (
    response: Response,
    assistantMessageId: string,
    responseNodeId: string,
  ): Promise<boolean> => {
    if (!response.ok) {
      throw await parseAPIError(response);
    }
    if (!(response.headers.get("Content-Type") || "").includes("text/event-stream") || !response.body) {
      throw new Error(t("game.cannotReadResponseStream") || "The server did not return a response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: any = null;
    let updateFrame: number | null = null;
    let pendingUpdate: {
      content: string;
      parsedContent?: ParsedResponse | null;
      nextMessageId?: string;
    } | null = null;
    const applyAssistantMessageUpdate = () => {
      if (updateFrame !== null) {
        window.cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }
      const update = pendingUpdate;
      pendingUpdate = null;
      if (!update) return;
      const { content, parsedContent, nextMessageId } = update;
      const resolvedContent = content.trim()
        ? content
        : parsedContent?.generationStatus && parsedContent.generationStatus !== "completed"
          ? parsedContent.errorMessage || content
          : content;
      setMessages((prev) => prev.map((item) => (
        item.id === assistantMessageId
          ? {
            ...item,
            id: nextMessageId || item.id,
            role: parsedContent?.generationStatus && parsedContent.generationStatus !== "completed" && !content.trim()
              ? "error"
              : "assistant",
            content: resolvedContent,
            parsedContent: parsedContent ?? item.parsedContent ?? null,
            alternativeIndex: parsedContent?.alternativeIndex ?? item.alternativeIndex,
            alternativeCount: parsedContent?.alternativeCount ?? item.alternativeCount,
            alternativeNodeIds: parsedContent?.alternativeNodeIds ?? item.alternativeNodeIds,
          }
          : item
      )));
    };
    const updateAssistantMessage = (
      content: string,
      parsedContent?: ParsedResponse | null,
      nextMessageId?: string,
      immediate = false,
    ) => {
      pendingUpdate = { content, parsedContent, nextMessageId };
      if (immediate) {
        applyAssistantMessageUpdate();
      } else if (updateFrame === null) {
        updateFrame = window.requestAnimationFrame(applyAssistantMessageUpdate);
      }
    };
    const handleFrame = async (frame: string) => {
      const data = frame
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .join("\n");
      if (!data || data === "[DONE]") return;
      const event = JSON.parse(data) as {
        type?: string;
        content?: string;
        parsedContent?: ParsedResponse | null;
        success?: boolean;
        message?: string;
        code?: string;
        request_id?: string;
        run_id?: string;
        acknowledge?: boolean;
      };
      if (event.type === "delta") {
        updateAssistantMessage(event.content || "");
      } else if (event.type === "complete") {
        finalResult = event;
        updateAssistantMessage(event.content || "", event.parsedContent || null, responseNodeId, true);
      } else if (event.type === "stopped") {
        finalResult = event;
        updateAssistantMessage(event.content || "", event.parsedContent || null, responseNodeId, true);
      } else if (event.type === "error") {
        if (event.content !== undefined || event.parsedContent) {
          updateAssistantMessage(event.content || "", event.parsedContent || null, undefined, true);
        }
        // Provider failures are acknowledged only after an active tab receives
        // them. Local post-processing failures stay pending for the next tab.
        if (event.run_id && event.acknowledge) {
          await acknowledgeChatRun(event.run_id).catch(() => undefined);
        }
        throw new LLMStreamError(
          event.message || "Failed to get response",
          event.code || "chat_run_failed",
          event.request_id || "",
        );
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) await handleFrame(frame);
        if (done) break;
      }
      if (buffer.trim()) await handleFrame(buffer);
    } finally {
      applyAssistantMessageUpdate();
    }
    if (!finalResult?.success) {
      throw new Error(finalResult?.message || "Failed to get response");
    }
    if (finalResult.parsedContent?.nextPrompts) {
      setSuggestedInputs(finalResult.parsedContent.nextPrompts);
    }
    return true;
  };

  const buildPromptMessage = (rawMessage: string, directives: string[]): string => {
    if (directives.length === 0) {
      return `<input_message>\n${rawMessage}\n</input_message>`;
    }
    return [
      "<input_message>",
      rawMessage,
      "</input_message>",
      "<response_instructions>",
      directives.join(" "),
      "</response_instructions>",
    ].join("\n");
  };

  const handleSendMessage = async (
    message: string,
    options?: {
      parentNodeId?: string;
      promptDirectives?: string[];
      displayPrefix?: Message[];
      onStarted?: () => void;
      onFailed?: () => void;
    },
  ): Promise<boolean> => {
    if (!character || isSending || !message.trim()) return false;

    const responseNodeId = uuidv4();
    const userMessageId = `pending-user:${responseNodeId}`;
    const assistantMessageId = `pending-assistant:${responseNodeId}`;
    const promptDirectives = options?.promptDirectives || [];
    const inferredParentNodeId = options?.parentNodeId || [...messages]
      .reverse()
      .find((item) => item.role === "assistant" && item.nodeId)?.nodeId;
    const parentNodeId = inferredParentNodeId || "root";
    let requestController: AbortController | null = null;

    const userMessage: Message = {
      id: userMessageId,
      nodeId: responseNodeId,
      parentNodeId,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    const pending = createPendingAssistantMessage(assistantMessageId, {
      nodeId: responseNodeId,
      parentNodeId,
      parsedContent: promptDirectives.length > 0 ? { promptDirectives } : null,
    });

    // Keep the submitted message visible even when validation or the provider
    // fails before a persisted dialogue node can be created.
    setMessages((prev) => [
      ...(options?.displayPrefix || prev),
      userMessage,
      pending,
    ]);

    try {
      const requestModel = activeModel;
      if (!requestModel) {
        throw new Error(
          t("modelSettings.apiConfigRequired")
          || "请先选择管理员已启用的模型。",
        );
      }
      const modelMaxOutputTokens = requestModel.capabilities.max_output_tokens;
      if (
        typeof modelMaxOutputTokens !== "number"
        || !Number.isSafeInteger(modelMaxOutputTokens)
        || modelMaxOutputTokens < 1
      ) {
        throw new Error("The selected model has an invalid maximum output capability.");
      }

      setIsSending(true);
      requestController = new AbortController();
      generationControllerRef.current = requestController;
      options?.onStarted?.();
      
      setSuggestedInputs([]);

      const promptType = localStorage.getItem("promptType");
      const responseLength = getStoredResponseLength();
      const response = await handleCharacterChatRequest({
        characterId: character.id,
        characterName: character.name,
        message: buildPromptMessage(message, promptDirectives),
        storedUserMessage: message,
        promptDirectives,
        modelId: requestModel.id,
        modelName: requestModel.external_id,
        contextWindow: requestModel.capabilities.context_window || undefined,
        compactionThreshold: requestModel.capabilities.compaction_threshold || undefined,
        modelMaxOutputTokens,
        language,
        promptType: promptType as PromptType,
        number: responseLength,
        nodeId: responseNodeId,
        parentNodeId,
        signal: requestController.signal,
      });
      activeRunIdRef.current = response.headers.get("X-Chat-Run-ID");

	  return await consumeChatResponse(response, assistantMessageId, responseNodeId);
    } catch (err) {
      if (requestController?.signal.aborted) {
        markInlineGenerationStopped(assistantMessageId);
        return true;
      }
      console.error("Error sending message:", err);
      upsertInlineErrorMessage(generationErrorMessage(err), assistantMessageId);
      options?.onFailed?.();

      return false;
    } finally {
      if (generationControllerRef.current === requestController) {
        generationControllerRef.current = null;
      }
      activeRunIdRef.current = null;
      setIsSending(false);
    }
  };

  const resumedCharacterRef = useRef<string | null>(null);
  useEffect(() => {
    if (!character || !characterId || resumedCharacterRef.current === character.id) return;
    resumedCharacterRef.current = character.id;
    let disposed = false;
    void (async () => {
      try {
        const pendingRuns = await getPendingChatRuns(character.id);
        if (pendingRuns.length === 0 || disposed) return;
        setIsSending(true);
        for (const run of pendingRuns) {
          if (disposed) return;
          const responseNodeId = run.node_id;
          const pendingUserMessageId = `pending-user:${run.node_id}`;
          const pendingAssistantMessageId = `pending-assistant:${run.id}`;
          setMessages((previous) => {
            const hasAssistantMessage = previous.some((item) => (
              (item.role === "assistant" || item.role === "error")
              && (item.nodeId || item.id) === responseNodeId
            ));
            if (hasAssistantMessage) {
              return previous;
            }
            const userIndex = previous.findIndex((item) => (
              item.role === "user" && (item.nodeId || item.id) === responseNodeId
            ));
            if (userIndex >= 0) {
              return [
                ...previous.slice(0, userIndex + 1),
                createPendingAssistantMessage(pendingAssistantMessageId, {
                  nodeId: responseNodeId,
                  parentNodeId: run.parent_node_id,
                }),
                ...previous.slice(userIndex + 1),
              ];
            }
            const parentIndex = run.parent_node_id === "root"
              ? -1
              : previous.findIndex((item) => (item.nodeId || item.id) === run.parent_node_id);
            const prefix = parentIndex >= 0 ? previous.slice(0, parentIndex + 1) : [];
            return [
              ...prefix,
              {
                id: pendingUserMessageId,
                nodeId: responseNodeId,
                parentNodeId: run.parent_node_id,
                role: "user",
                content: run.user_message,
                timestamp: run.created_at,
              },
              createPendingAssistantMessage(pendingAssistantMessageId, {
                nodeId: responseNodeId,
                parentNodeId: run.parent_node_id,
              }),
            ];
          });
          const controller = new AbortController();
          generationControllerRef.current = controller;
          try {
            const response = await resumeCharacterChatRun({
              run,
              characterId: character.id,
              protagonistName: character.protagonistName || defaultProtagonistName(language),
              characterName: character.name,
              signal: controller.signal,
            });
            activeRunIdRef.current = response.headers.get("X-Chat-Run-ID") || run.id;
            await consumeChatResponse(response, pendingAssistantMessageId, run.node_id);
          } catch (error) {
            if (controller.signal.aborted) {
              markInlineGenerationStopped(pendingAssistantMessageId);
            } else {
              upsertInlineErrorMessage(generationErrorMessage(error), pendingAssistantMessageId);
            }
          } finally {
            if (generationControllerRef.current === controller) generationControllerRef.current = null;
            activeRunIdRef.current = null;
          }
        }
      } catch (error) {
        console.error("Failed to resume chat runs:", error);
      } finally {
        if (!disposed) setIsSending(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [character, characterId, language]);

  useEffect(() => {
    const handleSwitchToPresetView = (event: any) => {
      setActiveView("preset");

      const detail = event.detail;
      if (detail) {
        if (detail.presetId) {
          sessionStorage.setItem("activate_preset_id", detail.presetId);
        } else if (detail.presetName) {
          sessionStorage.setItem("activate_preset_name", detail.presetName);
        }
      }
    };
    
    window.addEventListener("switchToPresetView", handleSwitchToPresetView);
    
    return () => {
      window.removeEventListener("switchToPresetView", handleSwitchToPresetView);
    };
  }, []);

  if (isLoading && !character) {
    return (
      <div className="flex justify-center items-center h-full fantasy-bg">
        <div className="relative w-12 h-12 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
          <div className="absolute inset-2 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
        </div>
      </div>
    );
  }
  
  if (isInitializing) {
    return (
      <div className="flex flex-col justify-center items-center h-full fantasy-bg">
        <div className="relative w-12 h-12 flex items-center justify-center mb-4">
          <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
          <div className="absolute inset-2 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
        </div>
        <p className={`text-[#f4e8c1] ${serifFontClass}`}>{t("characterChat.initializing")}</p>
        <p className={`text-[#a18d6f] text-sm mt-2 ${fontClass}`}>{t("characterChat.extractingTemplate") || "提取状态模板中，请稍候..."}</p>
        <p className={`text-[#a18d6f] text-xs mt-4 max-w-xs text-center ${fontClass}`}>{t("characterChat.loadingTimeHint") || "通常加载时间在 5-20 秒之间，如果超过 30 秒请检查 API 配置是否正确"}</p>
      </div>
    );
  }

  if (pageError || !character) {
    return (
      <div className="flex flex-col items-center justify-center h-full fantasy-bg">
        <h1 className="text-2xl text-[#f4e8c1] mb-4">{t("characterChat.error") || "Error"}</h1>
        <p className="text-[#c0a480] mb-6">{pageError || t("characterChat.characterNotFound") || "Character not found"}</p>
        <a
          href="/character-cards"
          className="bg-[#252220] hover:bg-[#342f25] text-[#f4e8c1] font-medium py-2 px-4 rounded border border-[#534741]"
        >
          {t("characterChat.backToCharacters") || "Back to Characters"}
        </a>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isSending) return;
  
    const rawMessage = userInput.trim();
    const hints: string[] = [];
  
    if (activeModes["story-progress"]) {
      hints.push(NARRATIVE_MODE_DIRECTIVES.storyProgress);
    }
  
    if (activeModes["perspective"].active) {
      if (activeModes["perspective"].mode === "novel") {
        hints.push(NARRATIVE_MODE_DIRECTIVES.novelPerspective);
      } else if (activeModes["perspective"].mode === "protagonist") {
        hints.push(NARRATIVE_MODE_DIRECTIVES.protagonistPerspective);
      }
    }
  
    if (activeModes["scene-setting"]) {
      hints.push(NARRATIVE_MODE_DIRECTIVES.sceneTransition);
    }
  
    await handleSendMessage(rawMessage, {
      promptDirectives: hints,
      onStarted: () => setUserInput(""),
      onFailed: () => setUserInput(rawMessage),
    });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleSuggestedInput = (input: string) => {
    setUserInput(input);
  };

  const handleStopGeneration = () => {
    const runId = activeRunIdRef.current;
    if (!runId) {
      generationControllerRef.current?.abort();
      return;
    }
    void cancelChatRun(runId).catch((error) => {
      console.error("Failed to stop generation:", error);
      toast.error(generationErrorMessage(error));
    });
  };

  const handleModelChange = (modelId: string) => {
    if (activeModel?.id === modelId) {
      return;
    }
    selectModel(modelId);
    toast.success(t("notifications.modelSelectedNextRequest"));
  };

  const latestUsage = [...messages]
    .reverse()
    .find((message) => message.parsedContent?.usage)
    ?.parsedContent?.usage;
  const contextUsedTokens = latestUsage
    ? latestUsage.inputTokens
      + latestUsage.cacheCreationInputTokens
      + latestUsage.cacheReadInputTokens
    : 0;

  if (!viewportReady) {
    return null;
  }

  return (
    <div className="flex h-full w-full min-w-0 relative fantasy-bg overflow-hidden">
      {isMobile && !sidebarCollapsed && (
        <button
          type="button"
          aria-label="Close character sidebar"
          onClick={toggleSidebar}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[1px] md:hidden"
        />
      )}

      <CharacterSidebar
        character={character}
        isCollapsed={sidebarCollapsed}
        toggleSidebar={toggleSidebar}
        onDialogueEdit={() => fetchLatestDialogue()}
        onViewSwitch={() => {
          switchToView("worldbook");
          setTimeout(() => {
            switchToView("chat");
          }, 1000);
        }}
      />

      <div className="fantasy-bg flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden transition-all duration-300 ease-in-out">
        {activeView === "chat" && (
          <CharacterChatHeader
            character={character}
            serifFontClass={serifFontClass}
            sidebarCollapsed={sidebarCollapsed}
            activeView={activeView}
            models={models}
            activeModel={activeModel}
            modelsLoading={modelsLoading}
            toggleSidebar={toggleSidebar}
            onModelChange={handleModelChange}
            onSwitchToView={switchToView}
            onToggleView={toggleView}
            onToggleRegexEditor={toggleRegexEditor}
          />
        )}

        {activeView === "chat" ? (
          <CharacterChatPanel
            character={character}
            messages={messages}
            userInput={userInput}
            setUserInput={setUserInput}
            isSending={isSending}
            suggestedInputs={suggestedInputs}
            onSubmit={handleSubmit}
            onStop={handleStopGeneration}
            onSuggestedInput={handleSuggestedInput}
            onSwitchBranch={handleSwitchBranch}
            onRegenerate={handleRegenerate}
            onEditUserMessage={handleEditUserMessage}
            fontClass={fontClass}
            serifFontClass={serifFontClass}
            t={t}
            activeModes={activeModes}
            setActiveModes={setActiveModes}
            contextUsedTokens={contextUsedTokens}
            contextWindow={activeModel?.capabilities.context_window || 0}
          />
        ) : activeView === "worldbook" ? (
          <WorldBookEditor
            onClose={() => setActiveView("chat")}
            characterName={character?.name || ""}
            characterId={characterId || ""}
          />
        ) : activeView === "preset" ? (
          <PresetEditor
            onClose={() => setActiveView("chat")}
            characterName={character?.name || ""}
            characterId={characterId || ""}
          />
        ) : (
          <RegexScriptEditor
            onClose={() => setActiveView("chat")}
            characterName={character?.name || ""}
            characterId={characterId || ""}
          />
        )}
      </div>
    </div>
  );
}
