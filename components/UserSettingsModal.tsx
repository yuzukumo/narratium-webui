"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ClipboardList,
  Languages,
  LoaderCircle,
  Pencil,
  SlidersHorizontal,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  getTranslation,
  LANGUAGE_NATIVE_NAMES,
  LANGUAGES,
  type Language,
  useLanguage,
} from "@/app/i18n";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";
import UserAvatar, { USER_AVATAR_CHANGED_EVENT, USER_AVATAR_KEY } from "@/components/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { setBlob } from "@/lib/data/local-storage";
import { createImageThumbnail } from "@/lib/media/image-thumbnail";
import { formatMicrousd } from "@/utils/money";
import { apiJSON, type AuthUser } from "@/utils/api-client";

const UsageLogPanel = dynamic(() => import("@/components/UsageLogPanel"), {
  loading: () => (
    <div className="flex min-h-48 items-center justify-center" aria-busy="true">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#665442] border-t-[#e0b766]" />
    </div>
  ),
});

export interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function UserSettingsModal({ isOpen, onClose }: UserSettingsModalProps) {
  const {
    language,
    languagePreference,
    setLanguagePreference,
    t,
    fontClass,
    serifFontClass,
  } = useLanguage();
  const { user, refresh } = useAuth();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "usage">("general");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setNameDraft(user?.name || "");
  }, [user?.name]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[data-select-menu-open=true]")) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElementRef.current?.focus();
      previousActiveElementRef.current = null;
    };
  }, [isOpen]);

  if (!mounted || !isOpen) {
    return null;
  }

  const languageOptions: readonly SelectMenuOption<Language>[] = LANGUAGES.map((value) => ({
    value,
    label: LANGUAGE_NATIVE_NAMES[value],
  }));

  const handleLanguageChange = (choice: Language) => {
    setLanguagePreference(choice);
    toast.success(getTranslation(choice, "notifications.languageSaved"));
  };

  const handleAvatarUpload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 4 * 1024 * 1024) {
      toast.error(t("settings.general.avatarInvalid"));
      return;
    }
    setUploadingAvatar(true);
    try {
      const avatar = await createImageThumbnail(file, 384, 0.86);
      await setBlob(USER_AVATAR_KEY, avatar);
      window.dispatchEvent(new Event(USER_AVATAR_CHANGED_EVENT));
      toast.success(t("settings.general.avatarSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.general.avatarError"));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setSavingName(true);
    try {
      await apiJSON<{ user: AuthUser }>("/api/v1/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await refresh();
      setEditingName(false);
      toast.success(t("settings.general.nameSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.general.nameError"));
    } finally {
      setSavingName(false);
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-0 backdrop-blur-[2px] sm:p-4 ${fontClass}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-[100dvh] w-full flex-col overflow-hidden border-[#665442] bg-[#1b1816] text-[#eae0ce] shadow-[0_28px_80px_rgba(0,0,0,0.62)] outline-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-5xl sm:rounded-lg sm:border"
      >
        <header className="relative flex h-16 shrink-0 items-center justify-between overflow-hidden border-b border-[#534741] px-4 sm:px-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-amber-700/10 via-transparent to-[#7b4e2e]/5" />
          <div className="relative flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#665442] bg-[#24201c] text-[#e0b766]">
              <SlidersHorizontal size={18} />
            </span>
            <h2 id={titleId} className={`truncate text-lg font-semibold text-[#f3dfb7] ${serifFontClass}`}>
              {t("settings.title")}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseRef.current()}
            title={t("settings.close")}
            aria-label={t("settings.close")}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-[#9e8b72] outline-none transition-colors hover:border-[#665442] hover:bg-[#2b2621] hover:text-[#f1cc83] focus-visible:border-[#d0a45f] focus-visible:ring-2 focus-visible:ring-amber-500/25"
          >
            <X size={19} />
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-[#534741] px-4 pt-3 sm:px-6" aria-label={t("settings.tabs.label")}>
          {([
            ["general", t("settings.tabs.general"), Languages],
            ["usage", t("settings.tabs.usage"), ClipboardList],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${activeTab === value ? "border-amber-400 text-[#f1cc83]" : "border-transparent text-[#8f806d] hover:text-[#e9d8b7]"}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        <section className="fantasy-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === "usage" ? <UsageLogPanel /> : (
            <>
              <h3 className={`text-base font-semibold text-[#f0dfbe] ${serifFontClass}`}>
                {t("settings.tabs.general")}
              </h3>
              <div className="mt-4 divide-y divide-[#534741]/55 border-y border-[#534741]/55">
                <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#665442] bg-[#151311] text-[#e1b765]">
                      <UserAvatar iconSize={20} />
                    </span>
                    {editingName ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-2"
                        onSubmit={(event) => { event.preventDefault(); void saveName(); }}
                      >
                        <input
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          minLength={1}
                          maxLength={64}
                          required
                          autoFocus
                          aria-label={t("settings.general.name")}
                          className="h-9 min-w-0 flex-1 rounded-md border border-[#665442] bg-[#151311] px-3 text-sm text-[#eae0ce] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <button
                          type="submit"
                          disabled={savingName}
                          title={t("settings.general.saveName")}
                          aria-label={t("settings.general.saveName")}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#665442] text-[#d8c9b3] hover:border-amber-500/50 hover:text-[#f1cc83] disabled:cursor-wait disabled:opacity-55"
                        >
                          {savingName ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
                        </button>
                        <button
                          type="button"
                          disabled={savingName}
                          onClick={() => { setEditingName(false); setNameDraft(user?.name || ""); }}
                          title={t("common.cancel")}
                          aria-label={t("common.cancel")}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#534741] text-[#8f806d] hover:text-[#eae0ce] disabled:opacity-55"
                        >
                          <X size={15} />
                        </button>
                      </form>
                    ) : (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[#eae0ce]">{user?.name}</span>
                        <span className="block truncate text-xs text-[#8f806d]">{user?.email}</span>
                      </span>
                    )}
                  </div>
                  {!editingName && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingName(true)}
                        title={t("settings.general.editName")}
                        aria-label={t("settings.general.editName")}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-[#534741] text-[#a18d6f] transition-colors hover:border-amber-500/50 hover:text-[#f1cc83]"
                      >
                        <Pencil size={15} />
                      </button>
                      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-[#534741] px-3 text-sm text-[#d8c9b3] transition-colors hover:border-amber-500/50 hover:text-[#f1cc83]">
                        <Upload size={15} />
                        {t(uploadingAvatar ? "settings.general.avatarUploading" : "settings.general.avatarUpload")}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          disabled={uploadingAvatar}
                          className="sr-only"
                          onChange={(event) => {
                            void handleAvatarUpload(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <WalletCards size={18} className="shrink-0 text-[#c89b55]" />
                    <span className="text-sm text-[#eae0ce]">{t("settings.general.availableBalance")}</span>
                  </div>
                  <button type="button" onClick={() => void refresh()} className="font-mono text-sm tabular-nums text-[#f1cc83]" title={t("settings.general.refreshBalance") }>
                    {formatMicrousd(user?.available_balance_microusd || "0")}
                  </button>
                </div>
                <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Languages size={18} className="shrink-0 text-[#c89b55]" />
                    <span className="min-w-0 truncate text-sm text-[#eae0ce]">
                      {t("settings.general.language")}
                    </span>
                  </div>
                  <SelectMenu
                    value={languagePreference ?? language}
                    options={languageOptions}
                    onChange={handleLanguageChange}
                    ariaLabel={t("settings.general.language")}
                    className="w-full sm:w-60"
                  />
                </div>

              </div>
            </>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
