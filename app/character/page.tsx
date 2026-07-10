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
 * - User tour functionality
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
 * - UserTour: For user onboarding
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/app/i18n";
import CharacterSidebar from "@/components/CharacterSidebar";
import { PromptType } from "@/lib/models/character-prompts-model";
import { ParsedResponse } from "@/lib/models/parsed-response";
import { v4 as uuidv4 } from "uuid";
import { initCharacterDialogue } from "@/function/dialogue/init";
import { getCharacterDialogue } from "@/function/dialogue/info";
import { handleCharacterChatRequest } from "@/function/dialogue/chat";
import { switchDialogueBranch } from "@/function/dialogue/truncate";
import { deleteDialogueNode } from "@/function/dialogue/delete";
import CharacterChatPanel from "@/components/CharacterChatPanel";
import WorldBookEditor from "@/components/WorldBookEditor";
import RegexScriptEditor from "@/components/RegexScriptEditor";
import PresetEditor from "@/components/PresetEditor";
import CharacterChatHeader from "@/components/CharacterChatHeader";
import UserTour from "@/components/UserTour";
import { useTour } from "@/hooks/useTour";
import { getActiveApiConfig, getStoredResponseLength } from "@/utils/api-config";

/**
 * Interface definitions for the component's data structures
 */
interface Character {
  id: string;
  name: string;
  personality?: string;
  avatar_path?: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp?: string;
  parsedContent?: ParsedResponse | null;
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
 * - User tour and onboarding
 * 
 * @returns {JSX.Element} The complete character interaction interface
 */
export default function CharacterPage() {
  const searchParams = useSearchParams();
  const characterId = searchParams.get("id");
  const { t, fontClass, serifFontClass } = useLanguage();
  const { isTourVisible, currentTourSteps, startCharacterTour, completeTour, skipTour } = useTour();

  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pageError, setPageError] = useState("");
  const [userInput, setUserInput] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportReady, setViewportReady] = useState(false);
  const [suggestedInputs, setSuggestedInputs] = useState<string[]>([]);
  const initializationRef = useRef(false);
  const lastIsMobileRef = useRef<boolean | null>(null);
  const [activeView, setActiveView] = useState<"chat" | "worldbook" | "regex" | "preset">("chat");
  const [activeModes, setActiveModes] = useState<Record<string, any>>({
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
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      const mobile = window.innerWidth < 768;
      const previousMobile = lastIsMobileRef.current;

      setIsMobile(mobile);

      if (previousMobile === null || previousMobile !== mobile) {
        setSidebarCollapsed(mobile);
      }

      lastIsMobileRef.current = mobile;
    };

    syncViewport();
    setViewportReady(true);
    window.addEventListener("resize", syncViewport);

    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("narratium:character-view-change", {
        detail: { hideSettings: activeView !== "chat" },
      }),
    );
  }, [activeView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    return () => {
      window.dispatchEvent(
        new CustomEvent("narratium:character-view-change", {
          detail: { hideSettings: false },
        }),
      );
    };
  }, []);

  const truncateMessagesAfter = async (nodeId: string) => {
    if (!characterId) return;
    
    try {
      const messageIndex = messages.findIndex(msg => msg.id == nodeId);
      if (messageIndex === -1) {
        console.warn(`Dialogue branch not found: ${nodeId}`);
        return;
      }
  
      const response = await switchDialogueBranch({
        characterId,
        nodeId,
      });
      
      if (!response.success) {
        console.error("Failed to truncate messages", response);
        return;
      }
      
      const dialogue = response.dialogue;
      
      if (dialogue) {
        setTimeout(() => {
          const formattedMessages = dialogue.messages.map((msg: any) => ({
            id: msg.id,
            role: msg.role == "system" ? "assistant" : msg.role,
            content: msg.content,
            timestamp: msg.timestamp || new Date(dialogue.created_at).toISOString(),
            parsedContent: msg.parsedContent || null,
          }));

          setMessages(formattedMessages);
          
          const lastMessage = dialogue.messages[dialogue.messages.length - 1];
          if (lastMessage && lastMessage.parsedContent?.nextPrompts) {
            setSuggestedInputs(lastMessage.parsedContent.nextPrompts);
          } else {
            setSuggestedInputs([]);
          }
        }, 100);
      } else {
      }
    } catch (error) {
      console.error("Error truncating messages:", error);
    }
  };

  const handleRegenerate = async (nodeId: string) => {
    if (!characterId) return;
    
    try {
      const messageIndex = messages.findIndex(msg => msg.id === nodeId);
      if (messageIndex === -1) {
        console.warn(`Message not found: ${nodeId}`);
        return;
      }
      const messageToRegenerate = messages[messageIndex];

      if (messageToRegenerate.role === "error") {
        let previousUserMessage = null;
        for (let i = messageIndex - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            previousUserMessage = messages[i];
            break;
          }
        }

        if (!previousUserMessage) {
          console.warn("No previous user message found for retry");
          return;
        }

        await handleSendMessage(previousUserMessage.content, {
          appendUserMessage: false,
          assistantMessageId: nodeId,
        });
        return;
      }

      if (messageToRegenerate.role !== "assistant") {
        console.warn("Can only regenerate assistant messages");
        return;
      }

      let userMessage = null;
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMessage = messages[i];
          break;
        }
      }

      if (!userMessage) {
        console.warn("No previous user message found for regeneration");
        return;
      }

      const response = await deleteDialogueNode({
        characterId,
        nodeId,
      });
      if (!response.success) {
        console.error("Failed to delete message", response);
        return;
      }
      
      const dialogue = response.dialogue;
      
      if (dialogue) {
        setTimeout(() => {
          const formattedMessages = dialogue.messages.map((msg: any) => ({
            id: msg.id,
            role: msg.role == "system" ? "assistant" : msg.role,
            content: msg.content,
            timestamp: msg.timestamp || new Date(dialogue.created_at).toISOString(),
            parsedContent: msg.parsedContent || null,
          }));

          setMessages(formattedMessages);
          
          const lastMessage = dialogue.messages[dialogue.messages.length - 1];
          if (lastMessage && lastMessage.parsedContent?.nextPrompts) {
            setSuggestedInputs(lastMessage.parsedContent.nextPrompts);
          } else {
            setSuggestedInputs([]);
          }
        }, 100);
      }

      setTimeout(async () => {
        await handleSendMessage(userMessage.content);
      }, 300);

    } catch (error) {
      console.error("Error regenerating message:", error);
    }
  };

  const fetchLatestDialogue = async () => {
    if (!characterId) return;

    try {
      const username = localStorage.getItem("username") || undefined;
      const currentLanguage = localStorage.getItem("language") as "en" | "zh";
      const response = await getCharacterDialogue(characterId, currentLanguage, username);
      if (!response.success) {
        throw new Error(`Failed to load dialogue: ${response}`);
      }
      
      const dialogue = response.dialogue;

      if (dialogue && dialogue.messages) {
        const formattedMessages = dialogue.messages.map((msg: any) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp || new Date(dialogue.created_at).toISOString(),
          parsedContent: msg.parsedContent || null,
        }));
        setMessages(formattedMessages);
        setSuggestedInputs(dialogue.messages[dialogue.messages.length - 1].parsedContent?.nextPrompts || []);
      } else {
      }
    } catch (err) {
      console.error("Error refreshing dialogue:", err);
    }
  };

  const createPendingAssistantMessage = (id: string): Message => ({
    id,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parsedContent: null,
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
        return prev.map((item) => (item.id === replaceMessageId ? errorMessage : item));
      }

      return [...prev, errorMessage];
    });
  };

  const getResponseErrorMessage = async (response: Response) => {
    const fallback = `Failed to send message: ${response.status}`;
    const contentType = response.headers.get("Content-Type") || "";

    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => null) as {
        message?: string;
        error?: string | { message?: string };
      } | null;

      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message.trim();
      }

      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error.trim();
      }

      if (typeof payload?.error === "object" && typeof payload.error?.message === "string" && payload.error.message.trim()) {
        return payload.error.message.trim();
      }
    }

    const text = await response.text().catch(() => "");
    return text.trim() || fallback;
  };
  
  useEffect(() => {
    const loadCharacterAndDialogue = async () => {
      if (!characterId) return;
      
      setIsLoading(true);
      setPageError("");
      
      try {
        const username = localStorage.getItem("username") || undefined;
        const currentLanguage = localStorage.getItem("language") as "en" | "zh";
        const response = await getCharacterDialogue(characterId, currentLanguage, username);
        if (!response.success) {
          throw new Error(`Failed to load character: ${response}`);
        }
        
        const dialogue = response.dialogue;
        const character = response.character;

        const characterInfo = {
          id: character.id,
          name: character.data.name,
          personality: character.data.personality,
          avatar_path: character.imagePath,
        };
        setCharacter(characterInfo);

        if (dialogue && dialogue.messages) {
          const formattedMessages = dialogue.messages.map((msg: any) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(dialogue.created_at).toISOString(),
            parsedContent: msg.parsedContent || null,
          }));
          setMessages(formattedMessages);
          setSuggestedInputs(dialogue.messages[dialogue.messages.length - 1].parsedContent?.nextPrompts || []);
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
      const username = localStorage.getItem("username") || "";
      const language = localStorage.getItem("language") || "zh";
      const activeConfig = getActiveApiConfig();
      const initData = await initCharacterDialogue({
        username,
        characterId: charId,
        modelName: activeConfig?.model || "",
        baseUrl: activeConfig?.baseUrl || "",
        apiKey: activeConfig?.apiKey || "",
        llmType: activeConfig?.type || "openai",
        language: language as "zh" | "en",
      });

      if (!initData.success) {
        throw new Error(`Failed to initialize dialogue: ${initData}`);
      }
      if (initData.firstMessage) {
        setMessages([{
          id: initData.nodeId,
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

  const handleSendMessage = async (
    message: string,
    options?: {
      appendUserMessage?: boolean;
      assistantMessageId?: string;
    },
  ): Promise<boolean> => {
    if (!character || isSending) return false;

    const appendUserMessage = options?.appendUserMessage !== false;
    const responseNodeId = uuidv4();
    const assistantMessageId = options?.assistantMessageId || responseNodeId;
    let shouldStream = false;

    try {
      const activeConfig = getActiveApiConfig();
      if (!activeConfig?.model || !activeConfig?.apiKey) {
        throw new Error(
          t("modelSettings.apiConfigRequired")
          || "请先在模型设置中填写并启用 Endpoint、模型和 API Key。",
        );
      }

      setIsSending(true);
      
      setSuggestedInputs([]);

      if (appendUserMessage) {
        const userMessage = {
          id: new Date().toISOString() + "-user",
          role: "user",
          content: message,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage, createPendingAssistantMessage(assistantMessageId)]);
      } else {
        setMessages((prev) => {
          if (prev.some((item) => item.id === assistantMessageId)) {
            return prev.map((item) => (
              item.id === assistantMessageId
                ? createPendingAssistantMessage(assistantMessageId)
                : item
            ));
          }

          return [...prev, createPendingAssistantMessage(assistantMessageId)];
        });
      }

      const language = localStorage.getItem("language") || "zh";
      const promptType = localStorage.getItem("promptType");
      const username = localStorage.getItem("username") || "";
      const responseLength = getStoredResponseLength();
      const fastModel = localStorage.getItem("fastModelEnabled") === "true";
      shouldStream = activeModes.streaming === true;

      const response = await handleCharacterChatRequest({
        username,
        characterId: character.id,
        message,
        modelName: activeConfig.model,
        baseUrl: activeConfig.baseUrl,
        apiKey: activeConfig.apiKey,
        llmType: activeConfig.type,
        reasoningEffort: activeConfig.reasoningEffortEnabled ? activeConfig.reasoningEffort : undefined,
        language: language as "zh" | "en",
        streaming: shouldStream,
        promptType: promptType as PromptType,
        number: responseLength,
        nodeId: responseNodeId,
        fastModel: fastModel,
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response));
      }

      const contentType = response.headers.get("Content-Type") || "";

      if (shouldStream && contentType.includes("text/event-stream")) {
        if (!response.body) {
          throw new Error(t("game.cannotReadResponseStream") || "Cannot read response stream");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalResult: any = null;

        const updateAssistantMessage = (
          content: string,
          parsedContent?: ParsedResponse | null,
          nextMessageId?: string,
        ) => {
          setMessages((prev) => prev.map((item) => (
            item.id === assistantMessageId
              ? {
                ...item,
                id: nextMessageId || item.id,
                role: "assistant",
                content,
                parsedContent: parsedContent ?? item.parsedContent ?? null,
              }
              : item
          )));
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
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

            const event = JSON.parse(dataLines.join("\n"));

            if (event.type === "delta") {
              updateAssistantMessage(event.content || "");
              continue;
            }

            if (event.type === "complete") {
              finalResult = event;
              updateAssistantMessage(event.content || "", event.parsedContent || null, responseNodeId);
              continue;
            }

            if (event.type === "error") {
              throw new Error(event.message || "Failed to get response");
            }
          }
        }

        if (!finalResult?.success) {
          throw new Error(finalResult?.message || "Failed to get response");
        }

        if (finalResult.parsedContent?.nextPrompts) {
          setSuggestedInputs(finalResult.parsedContent.nextPrompts);
        }

        return true;
      }

      const result = await response.json();
      
      if (result.success) {
        setMessages((prev) => prev.map((item) => (
          item.id === assistantMessageId
            ? {
              ...item,
              id: responseNodeId,
              role: "assistant",
              content: result.content || "",
              timestamp: new Date().toISOString(),
              parsedContent: result.parsedContent || null,
            }
            : item
        )));
        
        if (result.parsedContent?.nextPrompts) {
          setSuggestedInputs(result.parsedContent.nextPrompts);
        }

        return true;
      } else {
        throw new Error(result.message || "Failed to get response");
      }
    } catch (err) {
      console.error("Error sending message:", err);
      const errorMessage = err instanceof Error ? err.message : "An error occurred";
      upsertInlineErrorMessage(errorMessage, assistantMessageId);

      return false;
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (character && !isLoading && !isInitializing && !pageError) {
      const hasSeenCharacterTour = localStorage.getItem("narratium_character_tour_completed");
      if (!hasSeenCharacterTour) {
        setTimeout(() => {
          startCharacterTour();
        }, 2000);
      }
    }
  }, [character, isLoading, isInitializing, pageError, startCharacterTour]);

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
  
    let message = userInput;
    let hints: string[] = [];
  
    if (activeModes["story-progress"]) {
      const progressHint = t("characterChat.storyProgressHint");
      hints.push(progressHint);
    }
  
    if (activeModes["perspective"].active) {
      if (activeModes["perspective"].mode === "novel") {
        const novelHint = t("characterChat.novelPerspectiveHint");
        hints.push(novelHint);
      } else if (activeModes["perspective"].mode === "protagonist") {
        const protagonistHint = t("characterChat.protagonistPerspectiveHint");
        hints.push(protagonistHint);
      }
    }
  
    if (activeModes["scene-setting"]) {
      const sceneSettingHint = t("characterChat.sceneTransitionHint");
      hints.push(sceneSettingHint);
    }
  
    if (hints.length > 0) {
      message = `
      <input_message>
      ${t("characterChat.playerInput")}：${userInput}
      </input_message>
      <response_instructions>
      ${t("characterChat.responseInstructions")}：${hints.join(" ")}
      </response_instructions>
          `.trim();
    } else {
      message = `
      <input_message>
      ${t("characterChat.playerInput")}：${userInput}
      </input_message>
          `.trim();
    }
  
    setUserInput("");
    await handleSendMessage(message);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleSuggestedInput = (input: string) => {
    setUserInput(input);
  };

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

      <div className="flex-1 w-full min-w-0 fantasy-bg h-full transition-all duration-300 ease-in-out flex flex-col overflow-x-hidden">
        {activeView === "chat" && (
          <CharacterChatHeader
            character={character}
            serifFontClass={serifFontClass}
            sidebarCollapsed={sidebarCollapsed}
            activeView={activeView}
            toggleSidebar={toggleSidebar}
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
            onSuggestedInput={handleSuggestedInput}
            onTruncate={truncateMessagesAfter}
            onRegenerate={handleRegenerate}
            fontClass={fontClass}
            serifFontClass={serifFontClass}
            t={t}
            activeModes={activeModes}
            setActiveModes={setActiveModes}
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
      <UserTour
        steps={currentTourSteps}
        isVisible={isTourVisible}
        onComplete={() => {
          completeTour();
          localStorage.setItem("narratium_character_tour_completed", "true");
        }}
        onSkip={() => {
          skipTour();
          localStorage.setItem("narratium_character_tour_completed", "true");
        }}
      />
    </div>
  );
}
