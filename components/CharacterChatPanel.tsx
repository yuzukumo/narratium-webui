/**
 * Character Chat Panel Component
 * 
 * This component implements the main chat interface for character interactions, featuring:
 * - Real-time message display with HTML formatting
 * - Character avatar and name display
 * - Message regeneration and truncation capabilities
 * - Suggested input system
 * - Auto-scrolling chat history
 * - Fantasy-themed UI elements
 * 
 * The component handles both user and character messages, with special formatting
 * and interactive features for each message type.
 * 
 * Dependencies:
 * - ChatHtmlBubble: For rendering formatted chat messages
 * - CharacterAvatarBackground: For character avatar display
 * - Google Analytics: For tracking user interactions
 */

"use client";

import { useEffect, useRef, useState } from "react";
import ChatHtmlBubble from "@/components/ChatHtmlBubble";
import { CharacterAvatarBackground } from "@/components/CharacterAvatarBackground";
import { ParsedResponse, ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { trackButtonClick, trackFormSubmit } from "@/utils/google-analytics";

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
  isUser?: boolean;
  parsedContent?: ParsedResponse | null;
}

interface Props {
  character: Character;
  messages: Message[];
  userInput: string;
  setUserInput: (val: string) => void;
  isSending: boolean;
  suggestedInputs: string[];
  onSubmit: (e: React.FormEvent) => void;
  onSuggestedInput: (input: string) => void;
  onTruncate: (id: string) => void;
  onRegenerate: (id: string) => void;
  fontClass: string;
  serifFontClass: string;
  t: (key: string) => string;
  activeModes: Record<string, any>;
  setActiveModes: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

/**
 * Main chat panel component that handles character interactions
 * 
 * @param {Props} props - Component properties including character data, messages, and callbacks
 * @returns {JSX.Element} The complete chat interface with message history and input controls
 */
export default function CharacterChatPanel({
  character,
  messages,
  userInput,
  setUserInput,
  isSending,
  suggestedInputs,
  onSubmit,
  onSuggestedInput,
  onTruncate,
  onRegenerate,
  fontClass,
  serifFontClass,
  t,
  activeModes,
  setActiveModes,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedStreaming = localStorage.getItem("streamingEnabled");
    const isStreamingEnabled = savedStreaming === null ? true : savedStreaming === "true";

    if (savedStreaming === null) {
      localStorage.setItem("streamingEnabled", "true");
    }

    setActiveModes(prev => ({
      ...prev,
      streaming: isStreamingEnabled,
    }));
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };  

  const maybeScrollToBottom = (threshold = 120) => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < threshold) {
      scrollToBottom();
    }
  };

  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);

  const formatResponseMeta = (usage?: ResponseUsageMetrics | null) => {
    if (!usage) {
      return "";
    }

    const durationSeconds = usage.durationMs / 1000;
    const formattedInputTokens = new Intl.NumberFormat("en-US").format(usage.inputTokens);
    const formattedOutputTokens = new Intl.NumberFormat("en-US").format(usage.outputTokens);
    const formattedCachedTokens = new Intl.NumberFormat("en-US").format(usage.cachedInputTokens);
    const formattedCacheCreationTokens = new Intl.NumberFormat("en-US").format(usage.cacheCreationInputTokens);
    const formattedDuration = durationSeconds >= 10 ? durationSeconds.toFixed(1) : durationSeconds.toFixed(2);
    const formattedSpeed = usage.tokensPerSecond >= 100
      ? usage.tokensPerSecond.toFixed(0)
      : usage.tokensPerSecond.toFixed(1);
    const cacheParts = [
      usage.cachedInputTokens > 0 ? `Cache hit ${formattedCachedTokens}` : "",
      usage.cacheCreationInputTokens > 0 ? `Cache write ${formattedCacheCreationTokens}` : "",
    ].filter(Boolean);
    const cacheText = cacheParts.length > 0 ? ` | ${cacheParts.join(" | ")}` : "";

    return `Input ${formattedInputTokens} | Completion ${formattedOutputTokens}${cacheText} | Time ${formattedDuration}s | Speed ${formattedSpeed} token/s`;
  };

  const shouldShowRegenerateButton = (message: Message, index: number) => {
    if (isSending) return false;
    if (message.role !== "assistant" && message.role !== "error") return false;
    if (index !== messages.length - 1) return false;
    
    return true;
  };

  useEffect(() => {
    const id = setTimeout(() => scrollToBottom(), 300);
    return () => clearTimeout(id);
  }, [messages]);

  useEffect(() => {
    // On mount, restore fastModel state from localStorage
    const fastModelEnabled = localStorage.getItem("fastModelEnabled");
    if (fastModelEnabled !== null) {
      setActiveModes(prev => ({ ...prev, fastModel: fastModelEnabled === "true" }));
    }
  }, []);
  
  return (
    <div className="flex h-full max-h-screen min-w-0 flex-col overflow-x-hidden">
      <div className="flex-grow overflow-y-auto overflow-x-hidden p-3 sm:p-6 fantasy-scrollbar" ref={scrollRef}>
        <div className="max-w-4xl mx-auto">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 opacity-60">
                <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                    stroke="#f9c86d"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className={`text-[#c0a480] ${serifFontClass}`}>
                {t("characterChat.startConversation")}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((message, index) => {
                if (message.role === "sample") return null;

                const isInlineError = message.role === "error";

                return message.role === "user" ? (
                  <div key={index} className="flex justify-end mb-4">
                    <div className="whitespace-pre-line text-[#f4e8c1] story-text leading-relaxed magical-text">
                      <p
                        className={`${serifFontClass}`}
                        dangerouslySetInnerHTML={{
                          __html: (
                            message.content.match(/<input_message>([\s\S]*?)<\/input_message>/)?.[1] || ""
                          ).replace(
                            /^[\s\n\r]*((<[^>]+>\s*)*)?(玩家输入指令|Player Input)[:：]\s*/i,
                            "",
                          ),
                        }}
                      ></p>
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="mb-6">
                    <div className="flex flex-wrap items-center gap-y-1 mb-2">
                      <div className="w-8 h-8 rounded-full overflow-hidden mr-2">
                        {isInlineError ? (
                          <div className="w-full h-full flex items-center justify-center bg-[#3a1f1f] text-[#f1b4b4]">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={1.8}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 9v4m0 4h.01M10.29 3.86l-7.5 13A1 1 0 003.66 18h16.68a1 1 0 00.87-1.5l-7.5-13a1 1 0 00-1.74 0z"
                              />
                            </svg>
                          </div>
                        ) : character.avatar_path ? (
                          <CharacterAvatarBackground avatarPath={character.avatar_path} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[#1a1816]">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 w-4 text-[#534741]"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center">
                        <span className={`text-sm font-medium text-[#f4e8c1] ${serifFontClass}`}>
                          {isInlineError
                            ? (t("characterChat.requestFailed") || "Request Failed")
                            : character.name}
                        </span>
                        {message.role === "assistant" && shouldShowRegenerateButton(message, index) && (
                          <>
                            <button
                              onClick={() => {
                                setActiveModes(prev => {
                                  const newStreaming = !prev.streaming;
                                  return { ...prev, streaming: newStreaming };
                                });
                                localStorage.setItem("streamingEnabled", String(!activeModes.streaming));
                                trackButtonClick("toggle_streaming", "流式输出切换");
                              }}
                              className={`mx-1 p-1 rounded-md transition-all duration-300 group relative ${
                                activeModes.streaming
                                  ? "text-amber-400 hover:text-amber-300"
                                  : "text-[#8a8a8a] hover:text-[#a8a8a8]"
                              }`}
                              data-tooltip={activeModes.streaming ? t("characterChat.disableStreaming") : t("characterChat.enableStreaming")}
                            >
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-[#2a261f] text-[#f4e8c1] text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap border border-[#534741]">
                                {activeModes.streaming ? t("characterChat.disableStreaming") : t("characterChat.enableStreaming")}
                              </div>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  d="M13 2L3 14h7v8l8-12h-7z"
                                  fill={activeModes.streaming ? "#FFC107" : "none"}
                                  stroke={activeModes.streaming ? "#FFC107" : "#8a8a8a"}
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                setActiveModes(prev => {
                                  const newFastModel = !prev.fastModel;
                                  // Store fastModel state in localStorage
                                  localStorage.setItem("fastModelEnabled", String(newFastModel));
                                  return { ...prev, fastModel: newFastModel };
                                });
                                trackButtonClick("toggle_fastmodel", "快速模式切换");
                              }}
                              className={`mx-1 p-1 rounded-md transition-all duration-300 group relative ${
                                activeModes.fastModel
                                  ? "text-blue-500 hover:text-blue-400"
                                  : "text-[#8a8a8a] hover:text-[#a8a8a8]"
                              }`}
                              data-tooltip={activeModes.fastModel ? t("characterChat.disableFastModel") : t("characterChat.enableFastModel")}
                            >
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-[#2a261f] text-[#f4e8c1] text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap border border-[#534741]">
                                {activeModes.fastModel ? t("characterChat.disableFastModel") : t("characterChat.enableFastModel")}
                              </div>
                              {/* Lightning bolt SVG for fastmodel, blue when active */}
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  d="M7 2L17 14h-7v8l-8-12h7z"
                                  fill={activeModes.fastModel ? "#3B82F6" : "none"}
                                  stroke={activeModes.fastModel ? "#3B82F6" : "#8a8a8a"}
                                />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                      <div className="flex items-center">
                        {!isInlineError && message.content.trim() !== "" && (
                          <button
                            onClick={() => {
                              trackButtonClick("page", "跳转到此消息");
                              onTruncate(message.id);
                            }}
                            className="ml-1 w-6 h-6 flex items-center justify-center text-[#a18d6f] hover:text-green-400 bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 hover:border-[#444444] hover:shadow-[0_0_8px_rgba(34,197,94,0.4)] group relative"
                            data-tooltip={t("characterChat.jumpToMessage")}
                          >
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-[#2a261f] text-[#f4e8c1] text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap border border-[#534741]">
                              {t("characterChat.jumpToMessage")}
                            </div>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="12"
                              height="12"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 19V5"></path>
                              <polyline points="5 12 12 5 19 12"></polyline>
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            trackButtonClick("page", "重新生成消息");
                            onRegenerate(message.id);
                          }}
                          className={`ml-1 w-6 h-6 flex items-center justify-center text-[#a18d6f] hover:text-orange-400 bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 hover:border-[#444444] hover:shadow-[0_0_8px_rgba(249,115,22,0.4)] group relative ${
                            shouldShowRegenerateButton(message, index) ? "" : "hidden"
                          }`}
                          data-tooltip={t("characterChat.regenerateMessage")}
                        >
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-[#2a261f] text-[#f4e8c1] text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap border border-[#534741]">
                            {t("characterChat.regenerateMessage")}
                          </div>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="17 1 21 5 17 9"></polyline>
                            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                            <polyline points="7 23 3 19 7 15"></polyline>
                            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {!isInlineError && message.parsedContent?.usage && (
                      <div className="pl-10 mb-3 text-[11px] leading-5 text-[#8a8177]">
                        {formatResponseMeta(message.parsedContent.usage)}
                      </div>
                    )}
                    {isInlineError ? (
                      <div className="pl-10">
                        <div className="rounded-xl border border-[#8c4747] bg-[rgba(58,31,31,0.72)] px-4 py-3 shadow-[0_0_16px_rgba(140,71,71,0.12)]">
                          <div className={`text-sm leading-6 text-[#f4d7d7] ${fontClass}`}>
                            {message.content}
                          </div>
                          <div className={`mt-2 text-[11px] leading-5 text-[#c9a7a7] ${fontClass}`}>
                            {t("characterChat.errorRetryHint") || "Use the regenerate button on this message to try again."}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <ChatHtmlBubble
                        key={message.id}
                        html={message.content}
                        isLoading={
                          isSending && index === messages.length - 1 && message.content.trim() === ""
                        }
                        enableStreaming={false}
                        onContentChange={
                          index === messages.length - 1 ? () => maybeScrollToBottom() : undefined
                        }
                      />
                    )}
                  </div>
                );
              })}

              {isSending && (
                <div className="flex items-center space-x-2 text-[#c0a480] mb-8 pb-4 pt-2 min-h-[40px]">
                  <div className="relative w-6 h-6 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
                    <div className="absolute inset-1 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
                  </div>
                  <span className={`text-sm ${serifFontClass}`}>
                    {character.name} {t("characterChat.isTyping") || "is typing..."}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 bg-[#1a1816] border-t border-[#534741] pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] px-3 sm:pt-6 sm:pb-6 sm:px-5 z-5 mt-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.2)]">
        {suggestedInputs.length > 0 && !isSending && (
          <div className="relative max-w-4xl mx-auto">
            <button
              onClick={() => setSuggestionsCollapsed(!suggestionsCollapsed)}
              className="absolute -top-10 right-0 bg-[#2a261f] hover:bg-[#342f25] text-[#c0a480] hover:text-[#f4e8c1] p-1.5 rounded-md border border-[#534741] hover:border-[#a18d6f] transition-all duration-300 shadow-sm hover:shadow z-10"
              aria-label={suggestionsCollapsed ? "展开建议" : "收起建议"}
            >
              {suggestionsCollapsed ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            
            <div  
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                suggestionsCollapsed 
                  ? "max-h-0 opacity-0 mb-0" 
                  : "max-h-40 opacity-100 mb-6"
              }`}
            >
              <div className="flex flex-wrap gap-2">
                {suggestedInputs.map((input, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      trackButtonClick("page", "建议输入");
                      onSuggestedInput(input);
                    }}
                    disabled={isSending}
                    className={`bg-[#2a261f] hover:bg-[#342f25] text-[#c0a480] hover:text-[#f4e8c1] py-1.5 px-4 rounded-md text-xs border border-[#534741] hover:border-[#a18d6f] transition-all duration-300 shadow-sm hover:shadow menu-item ${
                      isSending ? "opacity-50 cursor-not-allowed" : ""
                    } ${fontClass}`}
                  >
                    {input}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <form
          onSubmit={(event) => {
            trackFormSubmit("page", "提交表单");
            onSubmit(event);
          }}
          className="max-w-4xl mx-auto"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-grow magical-input relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-400/20 via-amber-500/5 to-amber-400/10 rounded-lg blur opacity-0 group-hover:opacity-100 transition duration-300"></div>
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder={t("characterChat.typeMessage") || "Type a message..."}
                data-tour="chat-input"
                className="w-full bg-[#2a261f] border border-[#534741] rounded-lg py-3 sm:py-2.5 px-4 text-[#f4e8c1] text-base sm:text-sm leading-tight focus:outline-none focus:border-[#c0a480] shadow-inner relative z-1 transition-all duration-300 group-hover:border-[#a18d6f]"
                disabled={isSending}
              />
            </div>
            {isSending ? (
              <div className="relative w-8 h-8 flex items-center justify-center self-end sm:self-auto">
                <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
                <div className="absolute inset-1 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
              </div>
            ) : (
              <button
                type="submit"
                disabled={!userInput.trim()}
                className={`portal-button relative overflow-hidden w-full sm:w-auto bg-[#2a261f] hover:bg-[#342f25] text-[#c0a480] hover:text-[#f4e8c1] py-3 sm:py-2 px-4 rounded-lg text-sm border border-[#534741] hover:border-[#a18d6f] shadow-md transition-all duration-300 ${
                  !userInput.trim() ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {t("characterChat.send") || "Send"}
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap justify-start gap-2 sm:gap-3 max-w-4xl mx-auto">
            <button
              type="button"
              onClick={() => {
                trackButtonClick("page", "切换故事进度");
                setActiveModes((prev) => ({
                  ...prev,
                  "story-progress": !prev["story-progress"],
                }));
              }}
              className={`px-3 sm:px-4 py-1.5 text-xs rounded-full border transition-all duration-300 ${
                activeModes["story-progress"]
                  ? "bg-[#d1a35c] text-[#2a261f] border-[#d1a35c] shadow-[0_0_8px_rgba(209,163,92,0.5)]"
                  : "bg-[#2a261f] text-[#d1a35c] border-[#534741] hover:border-[#d1a35c] shadow-sm hover:shadow-md"
              }`}
            >
              <span className="flex items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-1"
                >
                  <path d="M5 12h14"></path>
                  <path d="m12 5 7 7-7 7"></path>
                </svg>
                {t("characterChat.storyProgress") || "剧情推进"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                trackButtonClick("page", "切换视角");
                setActiveModes((prev) => {
                  const perspective = prev["perspective"];

                  if (!perspective.active) {
                    return {
                      ...prev,
                      perspective: {
                        active: true,
                        mode: "novel",
                      },
                    };
                  }

                  if (perspective.mode === "novel") {
                    return {
                      ...prev,
                      perspective: {
                        active: true,
                        mode: "protagonist",
                      },
                    };
                  }

                  return {
                    ...prev,
                    perspective: {
                      active: false,
                      mode: "novel",
                    },
                  };
                });
              }}
              className={`px-4 py-1.5 text-xs rounded-full border transition-all duration-300 ${
                !activeModes["perspective"].active
                  ? "bg-[#2a261f] text-[#56b3b4] border-[#534741] hover:border-[#56b3b4] shadow-sm hover:shadow-md"
                  : activeModes["perspective"].mode === "novel"
                    ? "bg-[#56b3b4] text-[#2a261f] border-[#56b3b4] shadow-[0_0_8px_rgba(86,179,180,0.5)]"
                    : "bg-[#378384] text-[#2a261f] border-[#378384] shadow-[0_0_8px_rgba(55,131,132,0.5)]"
              }`}
            >
              <span className="flex items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-1"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                {!activeModes["perspective"].active
                  ? t("characterChat.perspective") || "视角设计"
                  : activeModes["perspective"].mode === "novel"
                    ? t("characterChat.novelPerspective") || "小说视角"
                    : t("characterChat.protagonistPerspective") || "主角视角"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                trackButtonClick("page", "切换场景设置");
                setActiveModes((prev) => ({
                  ...prev,
                  "scene-setting": !prev["scene-setting"],
                }));
              }}
              className={`px-4 py-1.5 text-xs rounded-full border transition-all duration-300 ${
                activeModes["scene-setting"]
                  ? "bg-[#c093ff] text-[#2a261f] border-[#c093ff] shadow-[0_0_8px_rgba(192,147,255,0.5)]"
                  : "bg-[#2a261f] text-[#c093ff] border-[#534741] hover:border-[#c093ff] shadow-sm hover:shadow-md"
              }`}
            >
              <span className="flex items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-1"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="3" y1="15" x2="21" y2="15"></line>
                  <line x1="9" y1="3" x2="9" y2="21"></line>
                  <line x1="15" y1="3" x2="15" y2="21"></line>
                </svg>
                {t("characterChat.sceneTransition")}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
