export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const DEFAULT_ANTHROPIC_MODEL = "claude-fable-5";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_RESPONSE_LENGTH = 4096;
export const MIN_RESPONSE_LENGTH = 100;
const RESPONSE_LENGTH_VERSION_KEY = "responseLengthVersion";
const RESPONSE_LENGTH_VERSION = "2";
export const API_PROVIDER_VALUES = ["openai", "anthropic", "gemini"] as const;
export type ApiProvider = (typeof API_PROVIDER_VALUES)[number];
export const OPENAI_REASONING_EFFORT_VALUES = ["low", "medium", "high", "xhigh"] as const;
export const ANTHROPIC_REASONING_EFFORT_VALUES = ["low", "medium", "high", "max"] as const;
export const GEMINI_THINKING_LEVEL_VALUES = ["minimal", "low", "medium", "high"] as const;
export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORT_VALUES)[number];
export type AnthropicReasoningEffort = (typeof ANTHROPIC_REASONING_EFFORT_VALUES)[number];
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVEL_VALUES)[number];
export type ReasoningEffort = OpenAIReasoningEffort | AnthropicReasoningEffort | GeminiThinkingLevel;
export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAIReasoningEffort = "medium";
export const DEFAULT_ANTHROPIC_REASONING_EFFORT: AnthropicReasoningEffort = "high";
export const DEFAULT_GEMINI_THINKING_LEVEL: GeminiThinkingLevel = "high";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = DEFAULT_OPENAI_REASONING_EFFORT;

export interface ApiConfig {
  id: string;
  name: string;
  type: ApiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffortEnabled: boolean;
  reasoningEffort: ReasoningEffort;
}

const isBrowser = () => typeof window !== "undefined";

export const normalizeBaseUrl = (value?: string): string => {
  const trimmed = (value?.trim() || "").replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/v1(?:beta)?(?:\/.*)?$/i, "");
};

export const getDefaultBaseUrl = (provider: ApiProvider): string => (
  provider === "anthropic"
    ? DEFAULT_ANTHROPIC_BASE_URL
    : provider === "gemini"
      ? DEFAULT_GEMINI_BASE_URL
      : DEFAULT_OPENAI_BASE_URL
);

export const getDefaultModel = (provider: ApiProvider): string => (
  provider === "anthropic"
    ? DEFAULT_ANTHROPIC_MODEL
    : provider === "gemini"
      ? DEFAULT_GEMINI_MODEL
      : DEFAULT_OPENAI_MODEL
);

export const getOpenAIApiBaseUrl = (value?: string): string => `${normalizeBaseUrl(value) || DEFAULT_OPENAI_BASE_URL}/v1`;
export const getOpenAIModelsEndpoint = (value?: string): string => `${getOpenAIApiBaseUrl(value)}/models`;
export const getOpenAIResponsesEndpoint = (value?: string): string => `${getOpenAIApiBaseUrl(value)}/responses`;
export const getAnthropicApiBaseUrl = (value?: string): string => `${normalizeBaseUrl(value) || DEFAULT_ANTHROPIC_BASE_URL}/v1`;
export const getAnthropicModelsEndpoint = (value?: string): string => `${getAnthropicApiBaseUrl(value)}/models`;
export const getAnthropicMessagesEndpoint = (value?: string): string => `${getAnthropicApiBaseUrl(value)}/messages`;
export const getGeminiApiBaseUrl = (value?: string): string => `${normalizeBaseUrl(value) || DEFAULT_GEMINI_BASE_URL}/v1beta`;
export const getGeminiModelsEndpoint = (value?: string): string => `${getGeminiApiBaseUrl(value)}/models`;
export const getGeminiInteractionsEndpoint = (value?: string): string => `${getGeminiApiBaseUrl(value)}/interactions`;
export const getGeminiStreamInteractionsEndpoint = (value?: string): string => `${getGeminiInteractionsEndpoint(value)}?alt=sse`;
export const getModelListEndpoint = (provider: ApiProvider, value?: string): string => (
  provider === "anthropic"
    ? getAnthropicModelsEndpoint(value)
    : provider === "gemini"
      ? getGeminiModelsEndpoint(value)
      : getOpenAIModelsEndpoint(value)
);
export const getApiPathSuffix = (provider: ApiProvider): string => (
  provider === "anthropic"
    ? "/v1/messages"
    : provider === "gemini"
      ? "/v1beta/interactions"
      : "/v1/responses"
);

export const getDefaultReasoningEffort = (provider: ApiProvider): ReasoningEffort => (
  provider === "anthropic"
    ? DEFAULT_ANTHROPIC_REASONING_EFFORT
    : provider === "gemini"
      ? DEFAULT_GEMINI_THINKING_LEVEL
      : DEFAULT_OPENAI_REASONING_EFFORT
);

export const sanitizeProvider = (value?: string): ApiProvider => {
  return API_PROVIDER_VALUES.includes((value || "") as ApiProvider)
    ? value as ApiProvider
    : "openai";
};

export const sanitizeReasoningEffort = (value: string | undefined, provider: ApiProvider): ReasoningEffort => {
  if (provider === "anthropic") {
    return ANTHROPIC_REASONING_EFFORT_VALUES.includes((value || "") as AnthropicReasoningEffort)
      ? value as AnthropicReasoningEffort
      : DEFAULT_ANTHROPIC_REASONING_EFFORT;
  }

  if (provider === "gemini") {
    return GEMINI_THINKING_LEVEL_VALUES.includes((value || "") as GeminiThinkingLevel)
      ? value as GeminiThinkingLevel
      : DEFAULT_GEMINI_THINKING_LEVEL;
  }

  return OPENAI_REASONING_EFFORT_VALUES.includes((value || "") as OpenAIReasoningEffort)
    ? value as OpenAIReasoningEffort
    : DEFAULT_OPENAI_REASONING_EFFORT;
};

const sanitizeConfig = (config: Partial<ApiConfig>, index: number): ApiConfig => {
  const type = sanitizeProvider(config.type);

  return {
    id: config.id?.trim() || `api_${Date.now()}_${index}`,
    name: config.name?.trim() || config.model?.trim() || getDefaultModel(type) || `API Config ${index + 1}`,
    type,
    baseUrl: normalizeBaseUrl(config.baseUrl) || getDefaultBaseUrl(type),
    model: config.model?.trim() || getDefaultModel(type),
    apiKey: config.apiKey?.trim() || "",
    reasoningEffortEnabled: config.reasoningEffortEnabled === true,
    reasoningEffort: sanitizeReasoningEffort(config.reasoningEffort, type),
  };
};

const migrateLegacyConfig = (storage: Storage): ApiConfig | null => {
  const baseUrl = storage.getItem("openaiBaseUrl") || storage.getItem("modelBaseUrl") || "";
  const model = storage.getItem("openaiModel") || storage.getItem("modelName") || "";
  const apiKey = storage.getItem("openaiApiKey") || storage.getItem("apiKey") || "";

  if (!baseUrl && !model && !apiKey) {
    return null;
  }

  return sanitizeConfig(
    {
      id: "api_legacy",
      name: model || "OpenAI API",
      type: "openai",
      baseUrl,
      model,
      apiKey,
    },
    0,
  );
};

const writeLegacyKeys = (storage: Storage, config: ApiConfig | null) => {
  storage.setItem("llmType", config?.type || "openai");

  if (!config) {
    storage.removeItem("openaiBaseUrl");
    storage.removeItem("openaiModel");
    storage.removeItem("openaiApiKey");
    storage.removeItem("apiKey");
    storage.removeItem("modelBaseUrl");
    storage.removeItem("modelName");
    return;
  }

  if (config.type === "openai") {
    storage.setItem("openaiBaseUrl", normalizeBaseUrl(config.baseUrl) || DEFAULT_OPENAI_BASE_URL);
    storage.setItem("openaiModel", config.model);
    storage.setItem("openaiApiKey", config.apiKey);
  } else {
    storage.removeItem("openaiBaseUrl");
    storage.removeItem("openaiModel");
    storage.removeItem("openaiApiKey");
  }

  storage.setItem("apiKey", config.apiKey);
  storage.setItem("modelBaseUrl", normalizeBaseUrl(config.baseUrl) || getDefaultBaseUrl(config.type));
  storage.setItem("modelName", config.model);
};

export const createEmptyApiConfig = (type: ApiProvider = "openai"): ApiConfig => ({
  id: `api_${Date.now()}`,
  name: "",
  type,
  baseUrl: getDefaultBaseUrl(type),
  model: getDefaultModel(type),
  apiKey: "",
  reasoningEffortEnabled: false,
  reasoningEffort: getDefaultReasoningEffort(type),
});

export const getStoredApiConfigs = (): ApiConfig[] => {
  if (!isBrowser()) {
    return [];
  }

  const storage = window.localStorage;
  let configs: ApiConfig[] = [];

  const rawConfigs = storage.getItem("apiConfigs");
  if (rawConfigs) {
    try {
      const parsed = JSON.parse(rawConfigs) as Partial<ApiConfig>[];
      if (Array.isArray(parsed)) {
        configs = parsed.map((config, index) => sanitizeConfig(config, index));
      }
    } catch (error) {
      console.error("Failed to parse stored API configs:", error);
    }
  }

  if (configs.length === 0) {
    const migrated = migrateLegacyConfig(storage);
    if (migrated) {
      configs = [migrated];
    }
  }

  const activeConfigId = storage.getItem("activeConfigId");
  const hasStoredActiveConfig = activeConfigId !== null;
  const activeConfig = hasStoredActiveConfig
    ? (activeConfigId ? configs.find((config) => config.id === activeConfigId) || null : null)
    : (configs[0] || null);

  storage.setItem("apiConfigs", JSON.stringify(configs));
  storage.setItem("activeConfigId", activeConfig?.id || "");
  writeLegacyKeys(storage, activeConfig);

  return configs;
};

export const getActiveApiConfig = (configs?: ApiConfig[]): ApiConfig | null => {
  if (!isBrowser()) {
    return null;
  }

  const resolvedConfigs = configs ?? getStoredApiConfigs();
  const activeConfigId = window.localStorage.getItem("activeConfigId");
  if (activeConfigId === "") {
    return null;
  }
  return resolvedConfigs.find((config) => config.id === activeConfigId) || resolvedConfigs[0] || null;
};

export const persistApiConfigState = (configs: ApiConfig[], activeConfigId: string) => {
  if (!isBrowser()) {
    return;
  }

  const sanitizedConfigs = configs.map((config, index) => sanitizeConfig(config, index));
  const activeConfig = activeConfigId
    ? sanitizedConfigs.find((config) => config.id === activeConfigId) || null
    : null;

  window.localStorage.setItem("apiConfigs", JSON.stringify(sanitizedConfigs));
  window.localStorage.setItem("activeConfigId", activeConfig?.id || "");
  writeLegacyKeys(window.localStorage, activeConfig);
};

export const sanitizeResponseLength = (value?: string | number | null): number => {
  const parsed = typeof value === "number" ? value : parseInt(value || "", 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_RESPONSE_LENGTH;
  }

  return Math.max(MIN_RESPONSE_LENGTH, parsed);
};

export const getStoredResponseLength = (): number => {
  if (!isBrowser()) {
    return DEFAULT_RESPONSE_LENGTH;
  }

  if (window.localStorage.getItem(RESPONSE_LENGTH_VERSION_KEY) !== RESPONSE_LENGTH_VERSION) {
    window.localStorage.setItem("responseLength", DEFAULT_RESPONSE_LENGTH.toString());
    window.localStorage.setItem(RESPONSE_LENGTH_VERSION_KEY, RESPONSE_LENGTH_VERSION);
    return DEFAULT_RESPONSE_LENGTH;
  }

  const normalized = sanitizeResponseLength(window.localStorage.getItem("responseLength"));
  window.localStorage.setItem("responseLength", normalized.toString());
  return normalized;
};

export const persistResponseLength = (value: string | number) => {
  if (!isBrowser()) {
    return DEFAULT_RESPONSE_LENGTH;
  }

  const normalized = sanitizeResponseLength(value);
  window.localStorage.setItem("responseLength", normalized.toString());
  window.localStorage.setItem(RESPONSE_LENGTH_VERSION_KEY, RESPONSE_LENGTH_VERSION);
  return normalized;
};
