"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import openAIIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import {
  ArrowLeft,
  BrainCircuit,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/app/i18n";
import { LANGUAGE_LOCALES } from "@/lib/i18n/languages";
import UserEditorDrawer from "@/components/admin/UserEditorDrawer";
import SelectMenu, { type SelectMenuOption } from "@/components/SelectMenu";
import { useAuth } from "@/contexts/AuthContext";
import { useModels } from "@/contexts/ModelContext";
import {
  apiJSON,
  type AuthUser,
  type AvailableModel,
  type ModelCapabilities,
  type ModelPricing,
} from "@/utils/api-client";
import {
  formatMicrousd,
  microusdToUSDInput,
  multiplyMicrousdByMultiplier,
  parseUSDToMicrousd,
} from "@/utils/money";

interface ProviderConfig {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "gemini";
  api_format: "responses" | "chat_completions" | "messages" | "generate_content";
  prompt_cache_key_enabled: boolean;
  base_url: string;
  models: string[];
  enabled: boolean;
}

interface ProviderDraft {
  id: string;
  name: string;
  provider: ProviderConfig["provider"];
  api_format: ProviderConfig["api_format"];
  prompt_cache_key_enabled: boolean;
  base_url: string;
  models: string[];
  api_key: string;
}

interface ModelDraft {
  id: string;
  externalID: string;
  provider: AvailableModel["provider"];
  contextWindow: string;
  compactionThreshold: string;
  maxOutputTokens: string;
  reasoningEnabled: boolean;
  reasoningEffort: string;
  supportedReasoningEfforts: string[];
  customReasoningEffort: boolean;
	inputPrice: string;
	outputPrice: string;
	cacheReadPrice: string;
	cacheCreationPrice: string;
	priceMultiplier: string;
}

type AdminTab = "providers" | "models" | "users";

const effortValues: Record<AvailableModel["provider"], string[]> = {
  openai: ["low", "medium", "high", "xhigh", "max", "ultra"],
  anthropic: ["low", "medium", "high", "xhigh", "max"],
  gemini: ["minimal", "low", "medium", "high"],
};
const customEffortValue = "__custom__";
const reasoningEffortPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const modelPricingFields = [
  { key: "inputPrice", translation: "admin.models.form.inputPrice" },
  { key: "outputPrice", translation: "admin.models.form.outputPrice" },
  { key: "cacheReadPrice", translation: "admin.models.form.cacheReadPrice" },
  { key: "cacheCreationPrice", translation: "admin.models.form.cacheCreationPrice" },
] as const;

const isNonUnitMultiplier = (value: string): boolean => {
  const normalized = Number(value.trim());
  return Number.isFinite(normalized) && normalized !== 1;
};

const emptyProvider = (): ProviderDraft => ({
  id: "",
  name: "",
  provider: "openai",
  api_format: "responses",
  prompt_cache_key_enabled: true,
  base_url: "https://api.openai.com",
  models: [],
  api_key: "",
});

const providerDefaults: Record<ProviderDraft["provider"], string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

const providerFormatDefaults: Record<ProviderDraft["provider"], ProviderDraft["api_format"]> = {
  openai: "responses",
  anthropic: "messages",
  gemini: "generate_content",
};

const providerEndpointSuffix = (apiFormat: ProviderDraft["api_format"]): string => {
  if (apiFormat === "generate_content") {
    return "/v1beta/models/{model}:streamGenerateContent?alt=sse";
  }
  if (apiFormat === "responses") return "/v1/responses";
  if (apiFormat === "chat_completions") return "/v1/chat/completions";
  return "/v1/messages";
};

const providerTypeTranslationKeys: Record<ProviderConfig["provider"], string> = {
  openai: "admin.channels.types.openai",
  anthropic: "admin.channels.types.anthropic",
  gemini: "admin.channels.types.gemini",
};

const apiFormatTranslationKeys: Record<ProviderConfig["api_format"], string> = {
  responses: "admin.channels.apiFormats.responses",
  chat_completions: "admin.channels.apiFormats.chatCompletions",
  messages: "admin.channels.apiFormats.messages",
  generate_content: "admin.channels.apiFormats.generateContent",
};

const providerIcon = (provider: ProviderConfig["provider"], size = 18) => {
  const source = provider === "anthropic"
    ? claudeIcon
    : provider === "gemini" ? geminiIcon : openAIIcon;
  return (
    <Image
      src={source}
      alt=""
      width={size}
      height={size}
      className={provider === "openai" ? "brightness-0 invert" : ""}
    />
  );
};

const promptCacheKeyDefault = (
  provider: ProviderDraft["provider"],
  apiFormat: ProviderDraft["api_format"],
): boolean => provider === "openai" && apiFormat === "responses";

const errorMessage = (reason: unknown, fallback: string): string => (
  reason instanceof Error ? reason.message : fallback
);

const parseModelIDs = (value: string): string[] => value
  .split(/[,\r\n]+/)
  .map((model) => model.trim())
  .filter(Boolean);

const mergeModelIDs = (current: string[], incoming: string[]): string[] => {
  const seen = new Set(current);
  const merged = [...current];
  incoming.forEach((model) => {
    if (!seen.has(model)) {
      seen.add(model);
      merged.push(model);
    }
  });
  return merged;
};

export default function AdminPage() {
  const router = useRouter();
  const { user, refresh: refreshAuth } = useAuth();
  const { refresh: refreshUserModels } = useModels();
  const { t, language, fontClass, titleFontClass } = useLanguage();
  const [tab, setTab] = useState<AdminTab>("providers");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [adminModels, setAdminModels] = useState<AvailableModel[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [emailVerificationEnabled, setEmailVerificationEnabled] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft>(emptyProvider());
  const [modelInput, setModelInput] = useState("");
  const [modelError, setModelError] = useState("");
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false);
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingID, setDeletingID] = useState("");
  const [updatingProviderID, setUpdatingProviderID] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [updatingRegistration, setUpdatingRegistration] = useState(false);
  const [error, setError] = useState("");
  const loadErrorText = t("admin.errors.load");
  const endpointSuffix = providerEndpointSuffix(draft.api_format);

  const load = useCallback(async () => {
    if (user?.role !== "admin") {
      return;
    }
    setLoading(true);
    setError("");
    try {
	  const [providerPayload, modelPayload, userPayload, settings] = await Promise.all([
        apiJSON<{ items: ProviderConfig[] }>("/api/v1/admin/providers"),
        apiJSON<{ items: AvailableModel[] }>("/api/v1/admin/models"),
        apiJSON<{ items: AuthUser[]; total: number }>("/api/v1/admin/users?limit=200"),
        apiJSON<{ registration_enabled: boolean; email_verification_enabled: boolean }>("/api/v1/admin/settings"),
      ]);
      setProviders(providerPayload.items);
	  setAdminModels(modelPayload.items);
      setUsers(userPayload.items);
      setRegistrationEnabled(settings.registration_enabled);
      setEmailVerificationEnabled(settings.email_verification_enabled);
    } catch (reason) {
      setError(errorMessage(reason, loadErrorText));
    } finally {
      setLoading(false);
    }
  }, [loadErrorText, user?.role]);

  useEffect(() => {
    if (user?.role !== "admin") {
      router.replace("/");
      return;
    }
    void load();
  }, [load, router, user?.role]);

  useEffect(() => {
    if (!providerDrawerOpen && !modelDrawerOpen) {
      return;
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === "Escape"
        && !document.querySelector("[data-select-menu-open=true]")
      ) {
        setProviderDrawerOpen(false);
        setModelDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modelDrawerOpen, providerDrawerOpen]);

  const refreshAdminModels = useCallback(async () => {
	  const payload = await apiJSON<{ items: AvailableModel[] }>("/api/v1/admin/models");
	  setAdminModels(payload.items);
  }, []);

  const reportActionError = (reason: unknown, fallbackKey: string, toastKey: string) => {
    setError(errorMessage(reason, t(fallbackKey)));
    toast.error(t(toastKey));
  };

  const openNewProvider = () => {
    setDraft(emptyProvider());
    setModelInput("");
    setModelError("");
    setProviderDrawerOpen(true);
  };

  const editProvider = (provider: ProviderConfig) => {
    setDraft({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      api_format: provider.api_format,
      prompt_cache_key_enabled: provider.prompt_cache_key_enabled,
      base_url: provider.base_url,
      models: [...provider.models],
      api_key: "",
    });
    setModelInput("");
    setModelError("");
    setProviderDrawerOpen(true);
  };

  const addPendingModels = (value = modelInput) => {
    const incoming = parseModelIDs(value);
    if (incoming.length === 0) {
      return;
    }
    setDraft((current) => ({
      ...current,
      models: mergeModelIDs(current.models, incoming),
    }));
    setModelInput("");
    setModelError("");
  };

  const handleModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addPendingModels();
    } else if (event.key === "Backspace" && modelInput === "" && draft.models.length > 0) {
      setDraft((current) => ({ ...current, models: current.models.slice(0, -1) }));
    }
  };

  const handleModelPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const value = event.clipboardData.getData("text");
    if (!/[,\r\n]/.test(value)) {
      return;
    }
    event.preventDefault();
    addPendingModels(value);
  };

  const saveProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const models = mergeModelIDs(draft.models, parseModelIDs(modelInput));
    if (models.length === 0) {
      const message = t("admin.channels.form.modelsRequired");
      setModelError(message);
      toast.error(message);
      return;
    }

    const editing = Boolean(draft.id);
    setSaving(true);
    setError("");
    setModelError("");
    try {
      const payload = {
        name: draft.name,
        provider: draft.provider,
        api_format: draft.api_format,
        prompt_cache_key_enabled: draft.prompt_cache_key_enabled,
        base_url: draft.base_url,
        models,
        api_key: draft.api_key || undefined,
      };
      const result = await apiJSON<{ provider: ProviderConfig }>(
        draft.id ? `/api/v1/admin/providers/${draft.id}` : "/api/v1/admin/providers",
        {
          method: draft.id ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setProviders((items) => editing
        ? items.map((item) => item.id === result.provider.id ? result.provider : item)
        : [...items, result.provider]);
      setProviderDrawerOpen(false);
      setDraft(emptyProvider());
      setModelInput("");
      toast.success(t(editing
        ? "admin.toasts.channelUpdateSuccess"
        : "admin.toasts.channelCreateSuccess"));
      await refreshUserModels();
	  await refreshAdminModels();
    } catch (reason) {
      reportActionError(reason, "admin.errors.channelSave", "admin.toasts.channelSaveError");
    } finally {
      setSaving(false);
    }
  };

  const deleteProvider = async (provider: ProviderConfig) => {
    if (!window.confirm(`${t("admin.channels.deleteConfirm")}\n${provider.name}`)) {
      return;
    }
    setDeletingID(provider.id);
    setError("");
    try {
      await apiJSON(`/api/v1/admin/providers/${provider.id}`, { method: "DELETE" });
      setProviders((items) => items.filter((item) => item.id !== provider.id));
      if (draft.id === provider.id) {
        setProviderDrawerOpen(false);
        setDraft(emptyProvider());
      }
      toast.success(t("admin.toasts.channelDeleteSuccess"));
      await refreshUserModels();
	  await refreshAdminModels();
    } catch (reason) {
      reportActionError(reason, "admin.errors.channelDelete", "admin.toasts.channelDeleteError");
    } finally {
      setDeletingID("");
    }
  };

  const updateProviderEnabled = async (provider: ProviderConfig) => {
    const enabled = !provider.enabled;
    setUpdatingProviderID(provider.id);
    setError("");
    try {
      const result = await apiJSON<{ provider: ProviderConfig }>(
        `/api/v1/admin/providers/${provider.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
      setProviders((items) => items.map((item) => (
        item.id === result.provider.id ? result.provider : item
      )));
      toast.success(t(enabled
        ? "admin.toasts.channelEnabledSuccess"
        : "admin.toasts.channelDisabledSuccess"));
      await refreshUserModels();
      await refreshAdminModels();
    } catch (reason) {
      reportActionError(
        reason,
        "admin.errors.channelStatusUpdate",
        "admin.toasts.channelStatusUpdateError",
      );
    } finally {
      setUpdatingProviderID("");
    }
  };

  const editModel = (model: AvailableModel) => {
	  const configuredEffort = model.capabilities.reasoning?.effort || "";
	  const configured = Boolean(model.capabilities.context_window);
	  const supportedReasoningEfforts = model.capabilities.reasoning?.supported_efforts?.length
	    ? model.capabilities.reasoning.supported_efforts
	    : effortValues[model.provider];
	  setModelDraft({
      id: model.id,
      externalID: model.external_id,
      provider: model.provider,
      contextWindow: model.capabilities.context_window ? String(model.capabilities.context_window) : "",
      compactionThreshold: model.capabilities.compaction_threshold ? String(model.capabilities.compaction_threshold) : "",
      maxOutputTokens: model.capabilities.max_output_tokens ? String(model.capabilities.max_output_tokens) : "",
      reasoningEnabled: Boolean(model.capabilities.reasoning?.enabled),
      reasoningEffort: configuredEffort,
      supportedReasoningEfforts,
      customReasoningEffort: Boolean(
        configuredEffort && !supportedReasoningEfforts.includes(configuredEffort),
      ),
      inputPrice: configured ? microusdToUSDInput(model.pricing.input_microusd_per_million) : "",
      outputPrice: configured ? microusdToUSDInput(model.pricing.output_microusd_per_million) : "",
      cacheReadPrice: configured ? microusdToUSDInput(model.pricing.cache_read_microusd_per_million) : "",
		  cacheCreationPrice: configured ? microusdToUSDInput(model.pricing.cache_creation_microusd_per_million) : "",
		  priceMultiplier: model.pricing.price_multiplier || "1",
	  });
	  setModelDrawerOpen(true);
  };

  const saveModel = async (event: FormEvent<HTMLFormElement>) => {
	  event.preventDefault();
	  if (!modelDraft) return;
	  const contextWindow = Number.parseInt(modelDraft.contextWindow, 10);
	  const compactionThreshold = Number.parseInt(modelDraft.compactionThreshold, 10);
	  const maxOutputTokens = Number.parseInt(modelDraft.maxOutputTokens, 10);
	  const reasoningEffort = modelDraft.reasoningEnabled ? modelDraft.reasoningEffort.trim() : "";
	  const inputPrice = parseUSDToMicrousd(modelDraft.inputPrice);
	  const outputPrice = parseUSDToMicrousd(modelDraft.outputPrice);
	  const cacheReadPrice = parseUSDToMicrousd(modelDraft.cacheReadPrice);
	  const cacheCreationPrice = parseUSDToMicrousd(modelDraft.cacheCreationPrice);
	  const priceMultiplier = modelDraft.priceMultiplier.trim();
	  if (
      !Number.isFinite(contextWindow)
		|| !Number.isFinite(compactionThreshold)
		|| !Number.isFinite(maxOutputTokens)
		|| maxOutputTokens < 1
		|| contextWindow < 1024
		|| compactionThreshold < 1
		|| compactionThreshold >= contextWindow
		|| maxOutputTokens > contextWindow
		|| inputPrice === null
		|| outputPrice === null
		|| cacheReadPrice === null
		  || cacheCreationPrice === null
		  || !/^(?:0|[1-9][0-9]*)(?:\.\d+)?$/.test(priceMultiplier)
		  || Number(priceMultiplier) > 1_000_000
		|| (modelDraft.reasoningEnabled && !reasoningEffortPattern.test(reasoningEffort))
	  ) {
      toast.error(t("admin.models.form.invalid"));
      return;
	  }
	  const capabilities: ModelCapabilities = {
      schema_version: 2,
      context_window: contextWindow,
      compaction_threshold: compactionThreshold,
      max_output_tokens: maxOutputTokens,
      reasoning: {
		  enabled: modelDraft.reasoningEnabled,
		  effort: reasoningEffort,
        supported_efforts: modelDraft.reasoningEnabled ? modelDraft.supportedReasoningEfforts : [],
      },
	  };
	  const pricing: ModelPricing = {
      input_microusd_per_million: inputPrice,
      output_microusd_per_million: outputPrice,
      cache_read_microusd_per_million: cacheReadPrice,
	      cache_creation_microusd_per_million: cacheCreationPrice,
	      price_multiplier: priceMultiplier,
	  };
	  setSavingModel(true);
	  setError("");
	  try {
      const result = await apiJSON<{ model: AvailableModel }>(`/api/v1/admin/models/${modelDraft.id}`, {
		  method: "PATCH",
		  body: JSON.stringify({ capabilities, pricing }),
      });
      setAdminModels((items) => items.map((item) => item.id === result.model.id ? result.model : item));
      setModelDrawerOpen(false);
      setModelDraft(null);
      toast.success(t("admin.toasts.modelUpdateSuccess"));
      await refreshUserModels();
	  } catch (reason) {
      reportActionError(reason, "admin.errors.modelSave", "admin.toasts.modelSaveError");
	  } finally {
      setSavingModel(false);
	  }
  };

  const updateRegistration = async (enabled: boolean) => {
    setUpdatingRegistration(true);
    setError("");
    try {
      await apiJSON("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ registration_enabled: enabled }),
      });
      setRegistrationEnabled(enabled);
      toast.success(t(enabled
        ? "admin.toasts.registrationEnabledSuccess"
        : "admin.toasts.registrationDisabledSuccess"));
    } catch (reason) {
      reportActionError(
        reason,
        "admin.errors.registrationUpdate",
        "admin.toasts.registrationUpdateError",
      );
    } finally {
      setUpdatingRegistration(false);
    }
  };

  const updateEmailVerification = async (enabled: boolean) => {
    setUpdatingRegistration(true);
    setError("");
    try {
      await apiJSON("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ email_verification_enabled: enabled }),
      });
      setEmailVerificationEnabled(enabled);
      toast.success(t(enabled
        ? "admin.toasts.emailVerificationEnabledSuccess"
        : "admin.toasts.emailVerificationDisabledSuccess"));
    } catch (reason) {
      reportActionError(
        reason,
        "admin.errors.registrationUpdate",
        "admin.toasts.registrationUpdateError",
      );
    } finally {
      setUpdatingRegistration(false);
    }
  };

  if (user?.role !== "admin") {
    return null;
  }

  const providerOptions: readonly SelectMenuOption<ProviderConfig["provider"]>[] = [
    { value: "openai", label: t("admin.channels.types.openai"), icon: providerIcon("openai") },
    { value: "anthropic", label: t("admin.channels.types.anthropic"), icon: providerIcon("anthropic") },
    { value: "gemini", label: t("admin.channels.types.gemini"), icon: providerIcon("gemini") },
  ];
  const openAIFormatOptions: readonly SelectMenuOption<ProviderConfig["api_format"]>[] = [
    { value: "responses", label: t("admin.channels.apiFormats.responses") },
    { value: "chat_completions", label: t("admin.channels.apiFormats.chatCompletions") },
  ];
  const activeAdminCount = users.filter((item) => (
    item.role === "admin" && item.status === "active"
  )).length;
  const tabs = [
    { id: "providers" as const, label: t("admin.tabs.channels"), Icon: KeyRound },
    { id: "models" as const, label: t("admin.tabs.models"), Icon: BrainCircuit },
    { id: "users" as const, label: t("admin.tabs.users"), Icon: Users },
  ];
  const switchClass = (enabled: boolean) => `relative h-7 w-12 shrink-0 rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-500/30 ${enabled ? "border-amber-500/50 bg-[#8b642f]" : "border-[#625343] bg-[#27231f]"}`;

  return (
    <div className={`relative min-h-full min-w-0 overflow-x-hidden bg-[#1a1816] text-[#eae6db] ${fontClass}`}>
      <header className="border-b border-[#534741] bg-[#252220] px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            title={t("admin.actions.back")}
            aria-label={t("admin.actions.back")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#534741] bg-[#1a1816] text-[#a18d6f] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#534741] bg-[#1a1816] text-[#f9c86d]">
            <ShieldCheck size={20} />
          </span>
          <h1 className={`${titleFontClass} min-w-0 truncate text-lg font-semibold text-[#f4cf7a]`}>
            {t("admin.title")}
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl min-w-0 px-4 py-5 md:px-8 md:py-7">
        <nav
          className="mb-5 flex max-w-full overflow-x-auto rounded-md border border-[#534741]/70 bg-[#252220]/70 p-1"
          aria-label={t("admin.tabs.label")}
        >
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex h-10 min-w-fit flex-1 items-center justify-center gap-2 rounded border px-4 text-sm transition-colors ${tab === id ? "border-amber-500/40 bg-[#3a3026] text-[#f9c86d]" : "border-transparent text-[#a18d6f] hover:bg-[#302b27] hover:text-[#eae6db]"}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        {error && (
          <p role="alert" className="mb-4 break-words rounded-md border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex h-48 flex-col items-center justify-center text-[#c0a480]">
            <LoaderCircle size={28} className="animate-spin" />
            <span className="mt-3 text-xs">{t("admin.loading")}</span>
          </div>
        ) : tab === "providers" ? (
          <section aria-labelledby="channels-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h2 id="channels-heading" className={`${titleFontClass} text-sm font-semibold text-[#f4e8c1]`}>
                  {t("admin.channels.title")}
                </h2>
                <span
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-amber-500/25 bg-amber-950/20 px-1.5 text-xs tabular-nums text-[#d9b16b]"
                  aria-label={`${t("admin.channels.countLabel")}: ${providers.length}`}
                >
                  {providers.length}
                </span>
              </div>
              <button
                type="button"
                onClick={openNewProvider}
                className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-[#5a4228] px-3 text-sm font-medium text-[#f9c86d] transition-colors hover:border-amber-400/60 hover:bg-[#674b2c] hover:text-[#fff0c7]"
              >
                <Plus size={15} />
                <span>{t("admin.channels.new")}</span>
              </button>
            </div>

            <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#534741]/70 bg-[#211e1c] shadow-lg shadow-black/20">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-[#534741]/60 bg-[#2b2724] text-xs text-[#a18d6f]">
                  <tr>
                    <th className="px-3 py-3 font-medium">{t("admin.channels.columns.name")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.channels.columns.type")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.channels.columns.models")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.channels.columns.status")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("admin.channels.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#534741]/40">
                  {providers.map((provider) => (
                    <tr key={provider.id} className="bg-[#1d1a18] transition-colors hover:bg-[#28231f]">
                      <td className="max-w-64 px-3 py-3">
                        <span className="block truncate text-[#eae6db]">{provider.name}</span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-[#817361]" title={provider.base_url}>
                          {provider.base_url}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#534741]/70 bg-[#25211e] text-[#e9e4d9]">
                            {providerIcon(provider.provider, 19)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[#d8c9b3]">{t(providerTypeTranslationKeys[provider.provider])}</span>
                            <span className="mt-0.5 block text-[11px] text-[#817361]">{t(apiFormatTranslationKeys[provider.api_format])}</span>
                          </span>
                        </div>
                      </td>
                      <td className="max-w-[25rem] px-3 py-3">
                        <div className="flex flex-wrap gap-1" title={provider.models.join(", ")}>
                          {provider.models.slice(0, 3).map((model) => (
                            <span key={model} className="max-w-44 truncate rounded border border-[#5f5145] bg-[#25211e] px-1.5 py-0.5 font-mono text-[11px] text-[#c8b99f]">
                              {model}
                            </span>
                          ))}
                          {provider.models.length > 3 && (
                            <span className="rounded border border-amber-500/25 bg-amber-950/20 px-1.5 py-0.5 text-[11px] text-[#d9b16b]">
                              +{provider.models.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={provider.enabled}
                            aria-busy={updatingProviderID === provider.id}
                            aria-label={`${t(provider.enabled
                              ? "admin.channels.actions.disable"
                              : "admin.channels.actions.enable")}: ${provider.name}`}
                            title={t(provider.enabled
                              ? "admin.channels.actions.disable"
                              : "admin.channels.actions.enable")}
                            disabled={updatingProviderID === provider.id}
                            onClick={() => void updateProviderEnabled(provider)}
                            className={`${switchClass(provider.enabled)} disabled:cursor-wait disabled:opacity-50`}
                          >
                            <span className={`absolute left-0 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-[#f5e4c0] shadow-sm transition-transform ${provider.enabled ? "translate-x-6" : "translate-x-1"}`} />
                          </button>
                          <span className={`text-xs ${provider.enabled ? "text-emerald-300" : "text-[#817361]"}`}>
                            {t(provider.enabled ? "admin.status.enabled" : "admin.status.disabled")}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => editProvider(provider)}
                            title={t("admin.channels.actions.edit")}
                            aria-label={`${t("admin.channels.actions.edit")}: ${provider.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#534741] bg-[#211e1c] text-[#b7a385] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteProvider(provider)}
                            disabled={deletingID === provider.id}
                            title={t("admin.channels.actions.delete")}
                            aria-label={`${t("admin.channels.actions.delete")}: ${provider.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#534741] bg-[#211e1c] text-[#a88b7e] transition-colors hover:border-red-500/45 hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
                          >
                            {deletingID === provider.id
                              ? <LoaderCircle size={14} className="animate-spin" />
                              : <Trash2 size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {providers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="bg-[#1d1a18] px-4 py-12 text-center text-sm text-[#817361]">
                        {t("admin.channels.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : tab === "models" ? (
		  <section aria-labelledby="models-heading">
            <div className="mb-3 flex items-center gap-2">
			  <h2 id="models-heading" className={`${titleFontClass} text-sm font-semibold text-[#f4e8c1]`}>
                {t("admin.models.title")}
			  </h2>
			  <span
                className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-amber-500/25 bg-amber-950/20 px-1.5 text-xs tabular-nums text-[#d9b16b]"
                aria-label={`${t("admin.models.countLabel")}: ${adminModels.length}`}
			  >
                {adminModels.length}
			  </span>
            </div>
            <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#534741]/70 bg-[#211e1c] shadow-lg shadow-black/20">
			  <table className="w-full min-w-[1020px] text-left text-sm">
                <thead className="border-b border-[#534741]/60 bg-[#2b2724] text-xs text-[#a18d6f]">
				  <tr>
                    <th className="px-3 py-3 font-medium">{t("admin.models.columns.model")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.models.columns.channel")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.models.columns.context")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.models.columns.output")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.models.columns.pricing")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.models.columns.reasoning")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("admin.models.columns.actions")}</th>
				  </tr>
                </thead>
                <tbody className="divide-y divide-[#534741]/40">
				  {adminModels.map((model) => (
                    <tr key={model.id} className="bg-[#1d1a18] transition-colors hover:bg-[#28231f]">
					  <td className="max-w-72 px-3 py-3">
	                        <span className="block truncate font-mono text-xs text-[#eae6db]" title={model.external_id}>{model.external_id}</span>
					  </td>
					  <td className="px-3 py-3">
	                        <div className="flex items-center gap-2">
						  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#534741]/70 bg-[#25211e]">
                            {providerIcon(model.provider, 17)}
						  </span>
						  <span className="max-w-40 truncate text-xs text-[#c8b99f]">{model.provider_name}</span>
                        </div>
					  </td>
					  <td className="px-3 py-3 tabular-nums text-[#d8c9b3]">
                        <span className="block">{model.capabilities.context_window ? new Intl.NumberFormat().format(model.capabilities.context_window) : "—"}</span>
                        <span className="mt-0.5 block text-[11px] text-[#817361]">
                          {t("admin.models.compactionShort")} {model.capabilities.compaction_threshold ? new Intl.NumberFormat().format(model.capabilities.compaction_threshold) : "—"}
                        </span>
	                      </td>
					  <td className="px-3 py-3 tabular-nums text-[#d8c9b3]">{model.capabilities.max_output_tokens ? new Intl.NumberFormat().format(model.capabilities.max_output_tokens) : "—"}</td>
					  <td className="px-3 py-3 font-mono text-[11px] text-[#a99a83]">
	                        <span className="block">{t("admin.models.pricingShort.input")} {model.capabilities.context_window ? `$${microusdToUSDInput(model.pricing.input_microusd_per_million)}` : "—"}</span>
	                        <span className="mt-0.5 block">{t("admin.models.pricingShort.output")} {model.capabilities.context_window ? `$${microusdToUSDInput(model.pricing.output_microusd_per_million)}` : "—"}</span>
					  </td>
					  <td className="px-3 py-3">
                        {model.capabilities.reasoning?.enabled ? (
						  <span className="font-mono text-xs text-[#d8c9b3]">{model.capabilities.reasoning.effort}</span>
                        ) : <span className="text-xs text-[#817361]">{t("admin.models.reasoningDisabled")}</span>}
					  </td>
					  <td className="px-3 py-3 text-right">
                        <button
						  type="button"
						  onClick={() => editModel(model)}
						  title={t("admin.models.actions.edit")}
						  aria-label={`${t("admin.models.actions.edit")}: ${model.external_id}`}
						  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#534741] bg-[#211e1c] text-[#b7a385] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
                        >
						  <Pencil size={14} />
                        </button>
					  </td>
                    </tr>
				  ))}
				  {adminModels.length === 0 && (
                    <tr><td colSpan={7} className="bg-[#1d1a18] px-4 py-12 text-center text-sm text-[#817361]">{t("admin.models.empty")}</td></tr>
				  )}
                </tbody>
			  </table>
            </div>
		  </section>
        ) : (
          <section className="space-y-5" aria-labelledby="users-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <h2 id="users-heading" className={`${titleFontClass} text-sm font-semibold text-[#f4e8c1]`}>
                  {t("admin.users.title")}
                </h2>
                <span
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-amber-500/25 bg-amber-950/20 px-1.5 text-xs tabular-nums text-[#d9b16b]"
                  aria-label={`${t("admin.users.countLabel")}: ${users.length}`}
                >
                  {users.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 border-y border-[#534741]/70 px-1 py-2.5 text-sm text-[#eae6db] sm:flex-row sm:items-center sm:gap-6 sm:border-y-0">
                <div className="flex items-center justify-between gap-6">
                  <span>{t("admin.users.registrationEnabled")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={registrationEnabled}
                    aria-label={t("admin.users.registrationEnabled")}
                    disabled={updatingRegistration}
                    onClick={() => void updateRegistration(!registrationEnabled)}
                    className={`${switchClass(registrationEnabled)} disabled:cursor-wait disabled:opacity-50`}
                  >
                    <span className={`absolute left-0 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-[#f5e4c0] shadow-sm transition-transform ${registrationEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <span>{t("admin.users.emailVerificationEnabled")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={emailVerificationEnabled}
                    aria-label={t("admin.users.emailVerificationEnabled")}
                    disabled={updatingRegistration}
                    onClick={() => void updateEmailVerification(!emailVerificationEnabled)}
                    className={`${switchClass(emailVerificationEnabled)} disabled:cursor-wait disabled:opacity-50`}
                  >
                    <span className={`absolute left-0 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-[#f5e4c0] shadow-sm transition-transform ${emailVerificationEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              </div>
            </div>
            <div className="w-full max-w-full overflow-x-auto rounded-md border border-[#534741]/70 bg-[#211e1c] shadow-lg shadow-black/20">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-[#534741]/60 bg-[#2b2724] text-xs text-[#a18d6f]">
                  <tr>
                    <th className="px-3 py-3 font-medium">{t("admin.users.columns.name")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.users.columns.role")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.users.columns.status")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.users.columns.balance")}</th>
                    <th className="px-3 py-3 font-medium">{t("admin.users.columns.createdAt")}</th>
                    <th className="px-3 py-3 text-right font-medium">{t("admin.users.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#534741]/40">
                  {users.map((target) => (
                    <tr key={target.id} className="bg-[#1d1a18] transition-colors hover:bg-[#28231f]">
                      <td className="max-w-64 px-3 py-3 text-[#eae6db]">
                        <span className="block truncate">{target.name}</span>
                        {target.email && <span className="mt-0.5 block truncate text-xs text-[#817361]">{target.email}</span>}
                        {target.id === user.id && (
                          <span className="ml-2 rounded border border-amber-500/25 bg-amber-950/20 px-1.5 py-0.5 text-[11px] text-[#d9b16b]">
                            {t("admin.users.currentAccount")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded border border-[#665442] bg-[#27231f] px-2 py-1 text-xs text-[#d8c9b3]">
                          {t(`admin.users.roles.${target.role}`)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded border px-2 py-1 text-xs ${target.status === "active"
                          ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-300"
                          : "border-[#534741] bg-[#27231f] text-[#817361]"}`}>
                          {t(`admin.users.statuses.${target.status}`)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="block font-mono text-xs text-[#e6d3ae]">{formatMicrousd(target.available_balance_microusd)}</span>
                        {target.reserved_microusd !== "0" && (
                          <span className="mt-0.5 block text-[11px] text-[#817361]">
                            {t("admin.users.balance.reserved")} {formatMicrousd(target.reserved_microusd)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-[#a18d6f]">
                        {new Date(target.created_at).toLocaleString(LANGUAGE_LOCALES[language])}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedUser(target)}
                          title={t("admin.users.actions.edit")}
                          aria-label={`${t("admin.users.actions.edit")}: ${target.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#534741] bg-[#211e1c] text-[#b7a385] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="bg-[#1d1a18] px-4 py-12 text-center text-sm text-[#817361]">
                        {t("admin.users.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {providerDrawerOpen && (
        <div className="fixed inset-0 z-[80]">
          <button
            type="button"
            onClick={() => setProviderDrawerOpen(false)}
            aria-label={t("admin.channels.drawer.close")}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[1px]"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-drawer-title"
            className="absolute inset-y-0 right-0 w-full border-l border-[#66564b] bg-[#1d1a18] shadow-[-18px_0_50px_rgba(0,0,0,0.45)] sm:w-[30rem] sm:max-w-[calc(100vw-2rem)]"
          >
            <form onSubmit={saveProvider} className="flex h-full min-h-0 flex-col">
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#534741]/70 bg-[#252220] px-4 py-4">
                <div className="min-w-0">
                  <h2 id="provider-drawer-title" className={`${titleFontClass} truncate text-base font-semibold text-[#f4e8c1]`}>
                    {draft.id
                      ? t("admin.channels.drawer.editTitle")
                      : t("admin.channels.drawer.createTitle")}
                  </h2>
                  <p className="mt-1 truncate text-xs text-[#817361]">
                    {draft.id ? draft.name : t("admin.channels.drawer.newSubtitle")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProviderDrawerOpen(false)}
                  title={t("admin.channels.drawer.close")}
                  aria-label={t("admin.channels.drawer.close")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#534741] bg-[#1a1816] text-[#a18d6f] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
                >
                  <X size={17} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
                <div className="space-y-4">
                  <label htmlFor="provider-name" className="block text-xs text-[#a18d6f]">
                    {t("admin.channels.form.name")}
                    <input
                      id="provider-name"
                      required
                      autoFocus
                      maxLength={100}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      placeholder={t("admin.channels.form.namePlaceholder")}
                      className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm text-[#eae6db] outline-none placeholder:text-[#756958] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                    />
                  </label>

                  <div className="block text-xs text-[#a18d6f]">
                    <span>{t("admin.channels.form.type")}</span>
                    <SelectMenu
                      value={draft.provider}
                      options={providerOptions}
                      onChange={(provider) => {
                        setDraft((current) => {
                          const apiFormat = providerFormatDefaults[provider];
                          const baseURL = current.base_url === providerDefaults[current.provider]
                            ? providerDefaults[provider]
                            : current.base_url;
                          return {
                            ...current,
                            provider,
                            api_format: apiFormat,
                            prompt_cache_key_enabled: promptCacheKeyDefault(provider, apiFormat),
                            base_url: baseURL,
                          };
                        });
                      }}
                      ariaLabel={t("admin.channels.form.type")}
                      className="mt-1.5 w-full"
                    />
                  </div>

                  {draft.provider === "openai" && (
                    <div className="block text-xs text-[#a18d6f]">
                      <span>{t("admin.channels.form.apiFormat")}</span>
                      <SelectMenu
                        value={draft.api_format}
                        options={openAIFormatOptions}
                        onChange={(apiFormat) => setDraft((current) => ({
                          ...current,
                          api_format: apiFormat,
                          prompt_cache_key_enabled: promptCacheKeyDefault(current.provider, apiFormat),
                        }))}
                        ariaLabel={t("admin.channels.form.apiFormat")}
                        className="mt-1.5 w-full"
                      />
                    </div>
                  )}

                  {draft.provider === "openai" && (
                    <div className="flex items-center justify-between gap-4 rounded-md border border-[#534741]/50 bg-[#211e1c] px-3 py-3 text-sm text-[#c0b4a4]">
                      <span>{t("admin.channels.form.promptCacheKey")}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draft.prompt_cache_key_enabled}
                        aria-label={t("admin.channels.form.promptCacheKey")}
                        onClick={() => setDraft((current) => ({
                          ...current,
                          prompt_cache_key_enabled: !current.prompt_cache_key_enabled,
                        }))}
                        className={switchClass(draft.prompt_cache_key_enabled)}
                      >
                        <span className={`absolute left-0 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-[#f5e4c0] shadow-sm transition-transform ${draft.prompt_cache_key_enabled ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </div>
                  )}

                  <label htmlFor="provider-base-url" className="block text-xs text-[#a18d6f]">
                    {t("admin.channels.form.baseUrl")}
                    <span className="mt-1.5 flex min-h-10 w-full min-w-0 flex-col overflow-hidden rounded-md border border-[#534741]/70 bg-[#1a1816] transition-colors focus-within:border-amber-500/60 focus-within:ring-2 focus-within:ring-amber-500/10 sm:flex-row">
                      <input
                        id="provider-base-url"
                        required
                        type="url"
                        value={draft.base_url}
                        onChange={(event) => setDraft({ ...draft, base_url: event.target.value })}
                        placeholder={t("admin.channels.form.baseUrlPlaceholder")}
                        aria-describedby={endpointSuffix ? "provider-endpoint-suffix" : undefined}
                        className="h-10 w-full min-w-0 bg-transparent px-3 text-sm text-[#eae6db] outline-none placeholder:text-[#756958] sm:w-auto sm:min-w-[9rem] sm:flex-1"
                      />
                      {endpointSuffix && (
                        <span
                          id="provider-endpoint-suffix"
                          className="flex min-h-8 w-full min-w-0 items-center justify-end break-all border-t border-[#534741]/60 bg-[#211e1c] px-2.5 text-right font-mono text-[11px] leading-4 text-[#8f806d] sm:min-h-10 sm:w-auto sm:max-w-[58%] sm:shrink sm:border-l sm:border-t-0"
                        >
                          {endpointSuffix}
                        </span>
                      )}
                    </span>
                  </label>

                  <label htmlFor="provider-api-key" className="block text-xs text-[#a18d6f]">
                    {t("admin.channels.form.apiKey")}
                    <input
                      id="provider-api-key"
                      type="password"
                      required={!draft.id}
                      value={draft.api_key}
                      onChange={(event) => setDraft({ ...draft, api_key: event.target.value })}
                      placeholder={draft.id
                        ? t("admin.channels.form.apiKeyKeepPlaceholder")
                        : t("admin.channels.form.apiKeyPlaceholder")}
                      className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm text-[#eae6db] outline-none placeholder:text-[#756958] focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                    />
                  </label>

                  <div className="block text-xs text-[#a18d6f]">
                    <div className="flex items-center justify-between gap-3">
                      <span>{t("admin.channels.form.models")}</span>
                      <span className="tabular-nums text-[#817361]">{draft.models.length}</span>
                    </div>
                    <div className={`mt-1.5 rounded-md border bg-[#1a1816] p-2 transition-colors focus-within:ring-2 ${modelError ? "border-red-500/50 focus-within:ring-red-500/10" : "border-[#534741]/70 focus-within:border-amber-500/60 focus-within:ring-amber-500/10"}`}>
                      {draft.models.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {draft.models.map((model) => (
                            <span key={model} className="flex min-w-0 max-w-full items-center gap-1 rounded border border-[#665442] bg-[#2a2521] py-1 pl-2 pr-1 font-mono text-xs text-[#d8c9b3]">
                              <span className="min-w-0 break-all">{model}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setDraft((current) => ({
                                    ...current,
                                    models: current.models.filter((item) => item !== model),
                                  }));
                                  setModelError("");
                                }}
                                title={t("admin.channels.form.removeModel")}
                                aria-label={`${t("admin.channels.form.removeModel")}: ${model}`}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#8f806d] hover:bg-[#3a3026] hover:text-[#f2c976]"
                              >
                                <X size={13} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <input
                          id="provider-models"
                          value={modelInput}
                          onChange={(event) => {
                            setModelInput(event.target.value);
                            setModelError("");
                          }}
                          onKeyDown={handleModelKeyDown}
                          onPaste={handleModelPaste}
                          onBlur={() => addPendingModels()}
                          placeholder={t("admin.channels.form.modelPlaceholder")}
                          aria-invalid={Boolean(modelError)}
                          aria-describedby={modelError ? "provider-model-error" : undefined}
                          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1.5 py-0 font-mono text-sm leading-none text-[#eae6db] shadow-none outline-none placeholder:font-sans placeholder:text-[#756958] focus:border-0 focus:shadow-none"
                        />
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addPendingModels()}
                          disabled={!modelInput.trim()}
                          title={t("admin.channels.form.addModel")}
                          aria-label={t("admin.channels.form.addModel")}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#534741] text-[#a18d6f] hover:border-amber-500/50 hover:text-[#f9c86d] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    {modelError && (
                      <p id="provider-model-error" role="alert" className="mt-1.5 text-xs text-red-300">
                        {modelError}
                      </p>
                    )}
                  </div>

                </div>
              </div>

              <footer className="flex shrink-0 gap-2 border-t border-[#534741]/70 bg-[#252220] px-4 py-4 sm:px-5">
                <button
                  type="button"
                  onClick={() => setProviderDrawerOpen(false)}
                  className="h-10 flex-1 rounded-md border border-[#534741] bg-[#1a1816] px-3 text-sm text-[#c0a480] transition-colors hover:border-[#756655] hover:text-[#eae6db]"
                >
                  {t("admin.actions.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-[#5a4228] px-3 text-sm font-medium text-[#f9c86d] transition-colors hover:border-amber-400/60 hover:bg-[#674b2c] hover:text-[#fff0c7] disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? t("admin.actions.saving") : t("admin.actions.save")}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}

	  {modelDrawerOpen && modelDraft && (
        <div className="fixed inset-0 z-[80]">
		  <button
            type="button"
            onClick={() => setModelDrawerOpen(false)}
            aria-label={t("admin.models.drawer.close")}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[1px]"
		  />
		  <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-drawer-title"
            className="absolute inset-y-0 right-0 w-full border-l border-[#66564b] bg-[#1d1a18] shadow-[-18px_0_50px_rgba(0,0,0,0.45)] sm:w-[30rem] sm:max-w-[calc(100vw-2rem)]"
		  >
            <form onSubmit={saveModel} className="flex h-full min-h-0 flex-col">
			  <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#534741]/70 bg-[#252220] px-4 py-4">
                <div className="min-w-0">
				  <h2 id="model-drawer-title" className={`${titleFontClass} truncate text-base font-semibold text-[#f4e8c1]`}>
                    {t("admin.models.drawer.title")}
				  </h2>
				  <p className="mt-1 truncate font-mono text-xs text-[#817361]">{modelDraft.externalID}</p>
                </div>
                <button
				  type="button"
				  onClick={() => setModelDrawerOpen(false)}
				  title={t("admin.models.drawer.close")}
				  aria-label={t("admin.models.drawer.close")}
				  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#534741] bg-[#1a1816] text-[#a18d6f] transition-colors hover:border-amber-500/50 hover:text-[#f9c86d]"
                >
				  <X size={17} />
                </button>
			  </header>

			  <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
	                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				  <label htmlFor="model-context-window" className="block text-xs text-[#a18d6f]">
                    {t("admin.models.form.contextWindow")}
                    <input
					  id="model-context-window"
					  required
					  autoFocus
					  type="text"
					  inputMode="numeric"
					  pattern="[0-9]*"
					  value={modelDraft.contextWindow}
					  onChange={(event) => {
                        if (/^\d*$/.test(event.target.value)) {
                          setModelDraft({ ...modelDraft, contextWindow: event.target.value });
                        }
                      }}
					  className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm tabular-nums text-[#eae6db] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                    />
				  </label>
				  <label htmlFor="model-compaction-threshold" className="block text-xs text-[#a18d6f]">
                    {t("admin.models.form.compactionThreshold")}
                    <input
					  id="model-compaction-threshold"
					  required
					  type="text"
					  inputMode="numeric"
					  pattern="[0-9]*"
					  value={modelDraft.compactionThreshold}
					  onChange={(event) => {
                        if (/^\d*$/.test(event.target.value)) {
                          setModelDraft({ ...modelDraft, compactionThreshold: event.target.value });
                        }
                      }}
					  className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm tabular-nums text-[#eae6db] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                    />
				  </label>
				  <label htmlFor="model-max-output" className="block text-xs text-[#a18d6f]">
                    {t("admin.models.form.maxOutputTokens")}
                    <input
					  id="model-max-output"
					  required
					  type="text"
					  inputMode="numeric"
					  pattern="[0-9]*"
					  value={modelDraft.maxOutputTokens}
					  onChange={(event) => {
                        if (/^\d*$/.test(event.target.value)) {
                          setModelDraft({ ...modelDraft, maxOutputTokens: event.target.value });
                        }
                      }}
					  className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm tabular-nums text-[#eae6db] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                    />
					  </label>
                </div>

                <div className="space-y-3 border-t border-[#534741]/60 pt-5">
                  <h3 className={`${titleFontClass} text-sm font-semibold text-[#e9d8b7]`}>
                    {t("admin.models.form.pricing")}
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {modelPricingFields.map((field) => (
                      <label key={field.key} className="block text-xs text-[#a18d6f]">
                        {t(field.translation)}
                        <div className="mt-1.5 flex h-10 w-full overflow-hidden rounded-md border border-[#534741]/70 bg-[#1a1816] transition-colors focus-within:border-amber-500/60 focus-within:ring-2 focus-within:ring-amber-500/10">
                          <span aria-hidden="true" className="flex h-full shrink-0 items-center pl-3 pr-2 text-sm text-[#817361]">$</span>
                          <input
                            required
                            type="text"
                            inputMode="decimal"
                            value={modelDraft[field.key]}
                            onChange={(event) => {
                              if (/^\d*(?:\.\d{0,6})?$/.test(event.target.value)) {
                                setModelDraft({ ...modelDraft, [field.key]: event.target.value });
                              }
                            }}
                            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 pr-3 text-sm tabular-nums text-[#eae6db] outline-none"
                          />
                          <span aria-hidden="true" className="flex shrink-0 items-center pr-3 text-xs text-[#817361]">{t("admin.models.form.pricePerMillion")}</span>
                        </div>
                        {isNonUnitMultiplier(modelDraft.priceMultiplier) && modelDraft[field.key] && (
                          <span className="mt-2 block pl-1 tabular-nums">
                            <span className="block text-base font-medium text-[#e6d3ae]">
                              ${microusdToUSDInput(multiplyMicrousdByMultiplier(
                                parseUSDToMicrousd(modelDraft[field.key]) || "0",
                                modelDraft.priceMultiplier,
                              ))}
                            </span>
                          </span>
                        )}
                      </label>
                    ))}
	                  </div>
	                  <label htmlFor="model-price-multiplier" className="block max-w-[calc(50%-0.5rem)] text-xs text-[#a18d6f]">
	                    {t("admin.models.form.multiplier")}
	                    <input
	                      id="model-price-multiplier"
	                      required
	                      type="text"
	                      inputMode="decimal"
	                      value={modelDraft.priceMultiplier}
	                      onChange={(event) => {
	                        if (/^(?:\d*(?:\.\d*)?)?$/.test(event.target.value)) {
	                          setModelDraft({ ...modelDraft, priceMultiplier: event.target.value });
	                        }
	                      }}
	                      className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm tabular-nums text-[#eae6db] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
	                    />
	                  </label>
                </div>

                <div className="flex items-center justify-between gap-4 border-y border-[#534741]/60 py-3 text-sm text-[#d8c9b3]">
				  <span>{t("admin.models.form.reasoning")}</span>
				  <button
                    type="button"
                    role="switch"
                    aria-checked={modelDraft.reasoningEnabled}
                    onClick={() => {
                      const enabled = !modelDraft.reasoningEnabled;
                      setModelDraft({
                        ...modelDraft,
                        reasoningEnabled: enabled,
                        reasoningEffort: enabled && !modelDraft.reasoningEffort
                          ? modelDraft.supportedReasoningEfforts[0] || effortValues[modelDraft.provider][0]
                          : modelDraft.reasoningEffort,
                      });
                    }}
                    className={switchClass(modelDraft.reasoningEnabled)}
				  >
                    <span className={`absolute left-0 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-[#f5e4c0] shadow-sm transition-transform ${modelDraft.reasoningEnabled ? "translate-x-6" : "translate-x-1"}`} />
				  </button>
                </div>

                {modelDraft.reasoningEnabled && (
				  <div className="space-y-3">
                    <div className="block text-xs text-[#a18d6f]">
					  <span>{t("admin.models.form.effort")}</span>
					  <SelectMenu
                        value={modelDraft.customReasoningEffort ? customEffortValue : modelDraft.reasoningEffort}
                        options={[
                          ...modelDraft.supportedReasoningEfforts.map((effort) => ({ value: effort, label: effort })),
                          { value: customEffortValue, label: t("admin.models.form.customEffort") },
                        ]}
                        onChange={(choice) => setModelDraft({
                          ...modelDraft,
                          customReasoningEffort: choice === customEffortValue,
                          reasoningEffort: choice === customEffortValue
                            ? (modelDraft.customReasoningEffort ? modelDraft.reasoningEffort : "")
                            : choice,
                        })}
                        ariaLabel={t("admin.models.form.effort")}
                        className="mt-1.5 w-full"
					  />
                    </div>
                    {modelDraft.customReasoningEffort && (
                      <label htmlFor="model-custom-effort" className="block text-xs text-[#a18d6f]">
                        {t("admin.models.form.customEffort")}
                        <input
                          id="model-custom-effort"
                          type="text"
                          maxLength={64}
                          value={modelDraft.reasoningEffort}
                          placeholder={t("admin.models.form.customEffortPlaceholder")}
                          onChange={(event) => setModelDraft({ ...modelDraft, reasoningEffort: event.target.value })}
                          className="mt-1.5 h-10 w-full rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 font-mono text-sm text-[#eae6db] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/10"
                        />
                      </label>
                    )}
				  </div>
                )}
			  </div>

			  <footer className="flex shrink-0 gap-2 border-t border-[#534741]/70 bg-[#252220] px-4 py-4 sm:px-5">
                <button type="button" onClick={() => setModelDrawerOpen(false)} className="h-10 flex-1 rounded-md border border-[#534741] bg-[#1a1816] px-3 text-sm text-[#c0a480] transition-colors hover:border-[#756655] hover:text-[#eae6db]">
				  {t("admin.actions.cancel")}
                </button>
                <button type="submit" disabled={savingModel} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-[#5a4228] px-3 text-sm font-medium text-[#f9c86d] transition-colors hover:border-amber-400/60 hover:bg-[#674b2c] disabled:cursor-wait disabled:opacity-50">
				  {savingModel ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
				  {savingModel ? t("admin.actions.saving") : t("admin.actions.save")}
                </button>
			  </footer>
            </form>
		  </aside>
        </div>
	  )}

      {selectedUser && (
        <UserEditorDrawer
          target={selectedUser}
          currentUserID={user.id}
          activeAdminCount={activeAdminCount}
          onClose={() => setSelectedUser(null)}
          onUserUpdated={(updated) => {
            setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
            setSelectedUser(updated);
          }}
          refreshAuth={refreshAuth}
        />
      )}
    </div>
  );
}
