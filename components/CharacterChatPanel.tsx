"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import ChatHtmlBubble from "@/components/ChatHtmlBubble";
import { CharacterAvatarBackground } from "@/components/CharacterAvatarBackground";
import UserAvatar from "@/components/UserAvatar";
import type { ParsedResponse, ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { trackButtonClick, trackFormSubmit } from "@/utils/google-analytics";
import { formatMicrousd } from "@/utils/money";

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
  nodeId?: string;
  parentNodeId?: string;
  alternativeIndex?: number;
  alternativeCount?: number;
  alternativeNodeIds?: string[];
}

type ActiveModes = {
  "story-progress": boolean;
  perspective: { active: boolean; mode: "novel" | "protagonist" };
  "scene-setting": boolean;
};

interface Props {
  character: Character;
  messages: Message[];
  userInput: string;
  setUserInput: (value: string) => void;
  isSending: boolean;
  suggestedInputs: string[];
  onSubmit: (event: React.FormEvent) => void;
  onStop: () => void;
  onSuggestedInput: (input: string) => void;
  onSwitchBranch: (nodeId: string) => void;
  onRegenerate: (nodeId: string) => void;
  onEditUserMessage: (nodeId: string, content: string) => void;
  fontClass: string;
  serifFontClass: string;
  t: (key: string) => string;
  activeModes: ActiveModes;
  setActiveModes: React.Dispatch<React.SetStateAction<ActiveModes>>;
  contextUsedTokens: number;
  contextWindow: number;
}

function displayUserMessage(content: string): string {
  return (content.match(/<input_message>([\s\S]*?)<\/input_message>/)?.[1] || content)
    .replace(/^\s*(玩家输入指令|Player Input)[:：]\s*/i, "")
    .trim();
}

function nodeIdFor(message: Message): string {
  return message.nodeId || message.id;
}

interface MessageRowActions {
  beginEdit: (message: Message) => void;
  cancelEdit: () => void;
  submitEdit: (message: Message, content: string) => void;
  switchBranch: (nodeId: string) => void;
  regenerate: (nodeId: string) => void;
}

interface MessageRowProps {
  message: Message;
  isLast: boolean;
  isSending: boolean;
  canRetry: boolean;
  isEditing: boolean;
  editingText: string;
  setEditingText: (value: string) => void;
  character: Character;
  fontClass: string;
  serifFontClass: string;
  numberFormat: Intl.NumberFormat;
  t: (key: string) => string;
  actions: MessageRowActions;
}

function responseMeta(
  usage: ResponseUsageMetrics,
  numberFormat: Intl.NumberFormat,
  t: (key: string) => string,
): string {
  const durationSeconds = usage.durationMs / 1000;
  const firstTokenSeconds = usage.firstTokenMs / 1000;
  const duration = durationSeconds >= 10 ? durationSeconds.toFixed(1) : durationSeconds.toFixed(2);
  const firstToken = firstTokenSeconds >= 10 ? firstTokenSeconds.toFixed(1) : firstTokenSeconds.toFixed(2);
  const speed = usage.tokensPerSecond >= 100
    ? usage.tokensPerSecond.toFixed(0)
    : usage.tokensPerSecond.toFixed(1);
  return [
    usage.costMicrousd !== undefined
      ? `${t("characterChat.metrics.cost")} ${formatMicrousd(usage.costMicrousd, 6)}`
      : "",
    `${t("characterChat.metrics.input")} ${numberFormat.format(usage.inputTokens)}`,
    `${t("characterChat.metrics.cacheCreation")} ${numberFormat.format(usage.cacheCreationInputTokens)}`,
    `${t("characterChat.metrics.cacheRead")} ${numberFormat.format(usage.cacheReadInputTokens)}`,
    `${t("characterChat.metrics.output")} ${numberFormat.format(usage.outputTokens)}`,
    `${t("characterChat.metrics.firstToken")} ${firstToken}s`,
    `${t("characterChat.metrics.totalTime")} ${duration}s`,
    `${t("characterChat.metrics.speed")} ${speed} tok/s`,
  ].filter(Boolean).join(" · ");
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  isLast,
  isSending,
  canRetry,
  isEditing,
  editingText,
  setEditingText,
  character,
  fontClass,
  serifFontClass,
  numberFormat,
  t,
  actions,
}: MessageRowProps) {
  const nodeId = nodeIdFor(message);
  const isError = message.role === "error";

  const branchPicker = (() => {
    const ids = message.alternativeNodeIds || [];
    const count = message.alternativeCount || ids.length;
    const alternativeIndex = message.alternativeIndex || 1;
    if (count <= 1 || ids.length <= 1) return null;
    const previous = ids[alternativeIndex - 2];
    const next = ids[alternativeIndex];
    return (
      <div className="ml-1 inline-flex h-6 items-center gap-0.5 rounded-md border border-[#4b4035] bg-[#211e1b] px-0.5 text-[11px] text-[#c7b28d]" aria-label={t("characterChat.alternativeReply")}>
        <button
          type="button"
          disabled={!previous || isSending}
          onClick={() => previous && actions.switchBranch(previous)}
          title={t("characterChat.previousReply")}
          aria-label={t("characterChat.previousReply")}
          className="flex h-5 w-5 items-center justify-center rounded text-[#c0a480] transition-colors hover:bg-[#382e25] hover:text-[#f9c86d] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronLeft size={13} />
        </button>
        <span className="min-w-[2.5rem] text-center tabular-nums">{alternativeIndex}/{count}</span>
        <button
          type="button"
          disabled={!next || isSending}
          onClick={() => next && actions.switchBranch(next)}
          title={t("characterChat.nextReply")}
          aria-label={t("characterChat.nextReply")}
          className="flex h-5 w-5 items-center justify-center rounded text-[#c0a480] transition-colors hover:bg-[#382e25] hover:text-[#f9c86d] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    );
  })();

  if (message.role === "user") {
    return (
      <div className="chat-message-row group mb-4 flex justify-end gap-2">
        <div className="min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-[90%]">
          {isEditing ? (
            <div className="flex min-w-[min(34rem,90vw)] flex-col gap-2 rounded-lg border border-[#776044] bg-[#29231e] p-2 shadow-lg">
              <textarea
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                rows={3}
                autoFocus
                className={`w-full resize-y rounded border border-[#534741] bg-[#1c1917] px-3 py-2 text-sm leading-6 text-[#f4e8c1] outline-none focus:border-[#c49752] ${fontClass}`}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={actions.cancelEdit} className="flex h-7 items-center gap-1 rounded border border-[#534741] px-2 text-xs text-[#b5a18a] hover:border-[#806d58] hover:text-[#f4e8c1]">
                  <X size={13} /> {t("common.cancel") || "Cancel"}
                </button>
                <button type="button" disabled={!editingText.trim() || isSending} onClick={() => actions.submitEdit(message, editingText)} className="flex h-7 items-center gap-1 rounded border border-[#9c7540] bg-[#6d512e] px-2 text-xs text-[#fff1c7] hover:bg-[#82623a] disabled:opacity-40">
                  <Check size={13} /> {t("common.save") || "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className={`story-text whitespace-pre-wrap break-words leading-relaxed text-[#f4e8c1] magical-text ${serifFontClass}`}>
                {displayUserMessage(message.content)}
              </div>
              {!isSending && (
                <button
                  type="button"
                  onClick={() => actions.beginEdit(message)}
                  title={t("characterChat.editMessage")}
                  aria-label={t("characterChat.editMessage")}
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-[#8f7b63] opacity-0 transition-all hover:border-[#534741] hover:bg-[#29231e] hover:text-[#f4d28a] group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[#665442] bg-[#211e1b] text-[#9f896a]">
          <UserAvatar className="text-[#9f896a]" iconSize={16} />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-message-row mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-y-1">
        <div className="mr-2 h-8 w-8 overflow-hidden rounded-full">
          {isError ? (
            <div className="flex h-full w-full items-center justify-center bg-[#3a1f1f] text-[#f1b4b4]">!</div>
          ) : character.avatar_path ? (
            <CharacterAvatarBackground avatarPath={character.avatar_path} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#1a1816] text-[#8f7b63]">{character.name.slice(0, 1)}</div>
          )}
        </div>
        <span className={`text-sm font-medium text-[#f4e8c1] ${serifFontClass}`}>
          {isError ? (t("characterChat.requestFailed") || "Request Failed") : character.name}
        </span>
        {!isError && branchPicker}
        {canRetry && (
          <button
            type="button"
            onClick={() => actions.regenerate(nodeId)}
            title={t("characterChat.regenerateMessage")}
            aria-label={t("characterChat.regenerateMessage")}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded border border-[#333] bg-[#1c1c1c] text-[#a18d6f] transition-colors hover:border-[#806d58] hover:text-[#f4b85e]"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      {!isError && (message.parsedContent?.usage || message.parsedContent?.modelName) && (
        <div className={`mb-3 flex flex-wrap items-center gap-x-1.5 pl-10 text-[11px] leading-5 text-[#8a8177] ${fontClass}`}>
          {message.parsedContent?.modelName && <span className="font-mono text-[#b79b72]">{message.parsedContent.modelName}</span>}
          {message.parsedContent?.modelName && message.parsedContent?.usage && <span aria-hidden="true">·</span>}
          {message.parsedContent?.usage && <span>{responseMeta(message.parsedContent.usage, numberFormat, t)}</span>}
        </div>
      )}
      {isError ? (
        <div className="pl-10">
          <div className="rounded-lg border border-[#8c4747] bg-[rgba(58,31,31,0.72)] px-4 py-3 text-sm leading-6 text-[#f4d7d7]">
            {message.content}
            <div className="mt-2 text-[11px] text-[#c9a7a7]">{t("characterChat.errorRetryHint") || "Use retry to try this request again."}</div>
          </div>
        </div>
      ) : (
        <>
          <ChatHtmlBubble
            html={message.content}
            isLoading={isSending && message.content.trim() === ""}
            isStreaming={isSending && isLast && message.content.trim() !== ""}
            enableStreaming={false}
          />
          {message.parsedContent?.errorMessage && (
            <div className="mt-2 pl-10 text-xs text-[#d9a6a6]">
              {message.parsedContent.errorMessage}
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default function CharacterChatPanel({
  character,
  messages,
  userInput,
  setUserInput,
  isSending,
  suggestedInputs,
  onSubmit,
  onStop,
  onSuggestedInput,
  onSwitchBranch,
  onRegenerate,
  onEditUserMessage,
  fontClass,
  serifFontClass,
  t,
  activeModes,
  setActiveModes,
  contextUsedTokens,
  contextWindow,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const keepAtBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const showScrollToBottomRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const numberFormat = useMemo(() => new Intl.NumberFormat(), []);
  const rowActionTargetsRef = useRef({
    isSending,
    onSwitchBranch,
    onRegenerate,
    onEditUserMessage,
  });
  rowActionTargetsRef.current = {
    isSending,
    onSwitchBranch,
    onRegenerate,
    onEditUserMessage,
  };
  const rowActions = useMemo<MessageRowActions>(() => ({
    beginEdit: (message) => {
      setEditingMessageId(nodeIdFor(message));
      setEditingText(displayUserMessage(message.content));
    },
    cancelEdit: () => {
      setEditingMessageId(null);
      setEditingText("");
    },
    submitEdit: (message, content) => {
      const value = content.trim();
      const targets = rowActionTargetsRef.current;
      if (!value || targets.isSending) return;
      trackButtonClick("page", "提交编辑后的用户消息");
      setEditingMessageId(null);
      setEditingText("");
      targets.onEditUserMessage(nodeIdFor(message), value);
    },
    switchBranch: (nodeId) => rowActionTargetsRef.current.onSwitchBranch(nodeId),
    regenerate: (nodeId) => {
      trackButtonClick("page", "重新生成消息");
      rowActionTargetsRef.current.onRegenerate(nodeId);
    },
  }), []);
  const userMessageNodeIds = useMemo(() => new Set(
    messages
      .filter((message) => message.role === "user")
      .map((message) => nodeIdFor(message)),
  ), [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    keepAtBottomRef.current = true;
    showScrollToBottomRef.current = false;
    setShowScrollToBottom(false);
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const maybeScrollToBottom = useCallback(() => {
    if (keepAtBottomRef.current) scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(maybeScrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [messages, maybeScrollToBottom]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (!element) return;
      const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
      keepAtBottomRef.current = nearBottom;
      const shouldShow = !nearBottom;
      if (showScrollToBottomRef.current !== shouldShow) {
        showScrollToBottomRef.current = shouldShow;
        setShowScrollToBottom(shouldShow);
      }
    });
  }, []);

  const normalizedContextWindow = Math.max(contextWindow || 0, 0);
  const normalizedContextUsage = Math.max(contextUsedTokens || 0, 0);
  const contextPercentage = normalizedContextWindow > 0
    ? Math.min((normalizedContextUsage / normalizedContextWindow) * 100, 100)
    : 0;
  const contextLabel = `${t("characterChat.contextUsage")}: ${numberFormat.format(normalizedContextUsage)} / ${numberFormat.format(normalizedContextWindow)} (${contextPercentage.toFixed(1)}%)`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="fantasy-scrollbar h-full overscroll-contain overflow-y-auto overflow-x-hidden p-3 sm:p-6"
          onScroll={handleScroll}
        >
          <div className="mx-auto max-w-4xl">
            {messages.length === 0 ? (
              <div className="py-12 text-center">
                <div className="mx-auto mb-4 h-16 w-16 opacity-60">
                  <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#f9c86d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className={`text-[#c0a480] ${serifFontClass}`}>{t("characterChat.startConversation")}</p>
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((message, index) => {
                  if (message.role === "sample") return null;
                  const nodeId = nodeIdFor(message);
                  const isError = message.role === "error";
                  const isEditing = message.role === "user" && editingMessageId === nodeId;
                  const hasUserMessage = userMessageNodeIds.has(nodeId);
                  const canRetry = (message.role === "assistant" || isError)
                    && hasUserMessage
                    && !isSending
                    && message.content.trim() !== "";

                  return (
                    <ChatMessageRow
                      key={`${nodeId}-${message.role}-${index}`}
                      message={message}
                      isLast={index === messages.length - 1}
                      isSending={isSending}
                      canRetry={canRetry}
                      isEditing={isEditing}
                      editingText={isEditing ? editingText : ""}
                      setEditingText={setEditingText}
                      character={character}
                      fontClass={fontClass}
                      serifFontClass={serifFontClass}
                      numberFormat={numberFormat}
                      t={t}
                      actions={rowActions}
                    />
                  );
                })}
                {isSending && (
                  <div className="mb-8 flex min-h-[40px] items-center gap-2 pb-4 pt-2 text-[#c0a480]">
                    <div className="relative h-6 w-6">
                      <span className="absolute inset-0 animate-spin rounded-full border-2 border-b-[#a18d6f] border-l-transparent border-r-[#c0a480] border-t-[#f9c86d]" />
                    </div>
                    <span className={`text-sm ${serifFontClass}`}>{character.name} {t("characterChat.isTyping") || "is typing..."}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            title={t("characterChat.scrollToBottom")}
            aria-label={t("characterChat.scrollToBottom")}
            className="absolute bottom-4 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[#6a5948] bg-[#24201d]/95 text-[#d8b979] shadow-lg transition-colors hover:border-[#c49752] hover:bg-[#302a24]"
          >
            <ArrowDown size={17} />
          </button>
        )}
      </div>

      <div className="z-5 shrink-0 border-t border-[#534741] bg-[#1a1816] px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.2)] sm:px-5 sm:pb-6 sm:pt-6">
        {suggestedInputs.length > 0 && !isSending && (
          <div className="relative mx-auto max-w-4xl">
            <button
              type="button"
              onClick={() => setSuggestionsCollapsed((collapsed) => !collapsed)}
              className="absolute -top-10 right-0 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[#534741] bg-[#2a261f] text-[#c0a480] hover:border-[#a18d6f] hover:text-[#f4e8c1]"
              aria-label={t(suggestionsCollapsed ? "characterChat.expandSuggestions" : "characterChat.collapseSuggestions")}
            >
              {suggestionsCollapsed ? <ChevronRight className="rotate-90" size={15} /> : <ChevronLeft className="-rotate-90" size={15} />}
            </button>
            {!suggestionsCollapsed && (
              <div className="mb-6 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                {suggestedInputs.map((input, index) => (
                  <button
                    type="button"
                    key={`${input}-${index}`}
                    onClick={() => { trackButtonClick("page", "建议输入"); onSuggestedInput(input); }}
                    disabled={isSending}
                    className={`rounded-md border border-[#534741] bg-[#2a261f] px-4 py-1.5 text-xs text-[#c0a480] transition-colors hover:border-[#a18d6f] hover:bg-[#342f25] hover:text-[#f4e8c1] disabled:opacity-50 ${fontClass}`}
                  >
                    {input}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <form onSubmit={(event) => { trackFormSubmit("page", "提交表单"); onSubmit(event); }} className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-grow">
              <textarea
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={t("characterChat.typeMessage") || "Type a message..."}
                rows={1}
                disabled={isSending}
                className="max-h-40 min-h-[2.75rem] w-full resize-y rounded-lg border border-[#534741] bg-[#2a261f] px-4 py-3 text-base leading-6 text-[#f4e8c1] shadow-inner outline-none transition-colors focus:border-[#c0a480] sm:text-sm"
              />
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-auto">
              <div role="img" title={contextLabel} aria-label={contextLabel} className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#534741] bg-[#211e1b] shadow-inner">
                <span className="absolute inset-[5px] rounded-full" style={{ background: `conic-gradient(#d2a75d ${contextPercentage}%, #4d443a ${contextPercentage}% 100%)` }} />
                <span className="absolute inset-[8px] rounded-full bg-[#211e1b]" />
                <span className="relative text-[8px] font-medium tabular-nums text-[#d8c39d]">{Math.round(contextPercentage)}</span>
              </div>
              {isSending ? (
                <button type="button" onClick={onStop} title={t("characterChat.stopGeneration")} aria-label={t("characterChat.stopGeneration")} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-[#6a5948] bg-[#2a261f] text-[#f0c979] hover:border-[#c49752] hover:bg-[#342f25]">
                  <span className="absolute inset-1 animate-spin rounded-full border-2 border-b-[#a18d6f] border-l-transparent border-r-[#c0a480] border-t-[#f9c86d]" />
                  <Square size={12} className="relative fill-current" />
                </button>
              ) : (
                <button type="submit" disabled={!userInput.trim()} title={t("characterChat.send")} aria-label={t("characterChat.send")} className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#534741] bg-[#2a261f] text-[#c0a480] hover:border-[#a18d6f] hover:text-[#f4e8c1] disabled:cursor-not-allowed disabled:opacity-40">
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex max-w-4xl flex-wrap justify-start gap-2 sm:gap-3">
            <button type="button" onClick={() => { trackButtonClick("page", "切换故事进度"); setActiveModes((prev) => ({ ...prev, "story-progress": !prev["story-progress"] })); }} className={`rounded-full border px-3 py-1.5 text-xs transition-colors sm:px-4 ${activeModes["story-progress"] ? "border-[#d1a35c] bg-[#d1a35c] text-[#2a261f]" : "border-[#534741] bg-[#2a261f] text-[#d1a35c] hover:border-[#d1a35c]"}`}>
              {t("characterChat.storyProgress") || "剧情推进"}
            </button>
            <button type="button" onClick={() => setActiveModes((prev) => {
              if (!prev.perspective.active) return { ...prev, perspective: { active: true, mode: "novel" } };
              if (prev.perspective.mode === "novel") return { ...prev, perspective: { active: true, mode: "protagonist" } };
              return { ...prev, perspective: { active: false, mode: "novel" } };
            })} className={`rounded-full border px-3 py-1.5 text-xs transition-colors sm:px-4 ${!activeModes.perspective.active ? "border-[#534741] bg-[#2a261f] text-[#56b3b4] hover:border-[#56b3b4]" : "border-[#56b3b4] bg-[#56b3b4] text-[#2a261f]"}`}>
              {!activeModes.perspective.active ? t("characterChat.perspective") : activeModes.perspective.mode === "novel" ? t("characterChat.novelPerspective") : t("characterChat.protagonistPerspective")}
            </button>
            <button type="button" onClick={() => { trackButtonClick("page", "切换场景设置"); setActiveModes((prev) => ({ ...prev, "scene-setting": !prev["scene-setting"] })); }} className={`rounded-full border px-3 py-1.5 text-xs transition-colors sm:px-4 ${activeModes["scene-setting"] ? "border-[#c093ff] bg-[#c093ff] text-[#2a261f]" : "border-[#534741] bg-[#2a261f] text-[#c093ff] hover:border-[#c093ff]"}`}>
              {t("characterChat.sceneTransition")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
