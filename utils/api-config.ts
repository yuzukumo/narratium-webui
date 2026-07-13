export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const DEFAULT_ANTHROPIC_MODEL = "claude-fable-5";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_RESPONSE_LENGTH = 4096;
export const MIN_RESPONSE_LENGTH = 100;
const RESPONSE_LENGTH_VERSION_KEY = "responseLengthVersion";
const RESPONSE_LENGTH_VERSION = "3";

export const API_PROVIDER_VALUES = ["openai", "anthropic", "gemini"] as const;
export type ApiProvider = (typeof API_PROVIDER_VALUES)[number];

export interface ApiConfig {
  id: string;
  name: string;
  type: ApiProvider;
  model: string;
  externalModel: string;
  contextWindow: number;
  compactionThreshold: number;
  maxOutputTokens: number;
}

let runtimeApiConfig: ApiConfig | null = null;

export const setRuntimeApiConfig = (config: ApiConfig | null): void => {
  runtimeApiConfig = config;
};

export const getActiveApiConfig = (): ApiConfig | null => runtimeApiConfig;

export const getDefaultModel = (provider: ApiProvider): string => (
  provider === "anthropic"
    ? DEFAULT_ANTHROPIC_MODEL
    : provider === "gemini"
      ? DEFAULT_GEMINI_MODEL
      : DEFAULT_OPENAI_MODEL
);

export const sanitizeResponseLength = (value: string | number | null | undefined): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.max(MIN_RESPONSE_LENGTH, Math.round(parsed)) : DEFAULT_RESPONSE_LENGTH;
};

export const getStoredResponseLength = (): number => {
  if (typeof window === "undefined") {
    return DEFAULT_RESPONSE_LENGTH;
  }
  if (window.localStorage.getItem(RESPONSE_LENGTH_VERSION_KEY) !== RESPONSE_LENGTH_VERSION) {
    window.localStorage.setItem("responseLength", String(DEFAULT_RESPONSE_LENGTH));
    window.localStorage.setItem(RESPONSE_LENGTH_VERSION_KEY, RESPONSE_LENGTH_VERSION);
  }
  return sanitizeResponseLength(window.localStorage.getItem("responseLength"));
};

export const persistResponseLength = (value: string | number): number => {
  const normalized = sanitizeResponseLength(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("responseLength", String(normalized));
    window.localStorage.setItem(RESPONSE_LENGTH_VERSION_KEY, RESPONSE_LENGTH_VERSION);
  }
  return normalized;
};

/**
 * Reserve only the output space implied by the administrator's compaction
 * threshold. The user's response-length preference is intentionally absent:
 * it is prompt guidance, not an API token ceiling.
 */
export const calculateContextOutputReserve = (
  contextWindow: number,
  compactionThreshold: number,
  modelMaxOutputTokens: number,
): number => {
  const normalizedContextWindow = Math.max(Math.floor(contextWindow), 2);
  const normalizedThreshold = Math.min(
    Math.max(Math.floor(compactionThreshold), 1),
    normalizedContextWindow - 1,
  );
  const normalizedModelLimit = Math.max(Math.floor(modelMaxOutputTokens), 1);
  return Math.max(
    1,
    Math.min(normalizedModelLimit, normalizedContextWindow - normalizedThreshold),
  );
};

/**
 * Providers such as Anthropic require a numeric output ceiling. Use only the
 * model's physical limit and the actual context space left by this request.
 */
export const calculateRequestMaxOutputTokens = (
  contextWindow: number,
  estimatedInputTokens: number,
  modelMaxOutputTokens: number,
): number => {
  const normalizedContextWindow = Math.max(Math.floor(contextWindow), 2);
  const normalizedInputTokens = Math.max(Math.floor(estimatedInputTokens), 0);
  const normalizedModelLimit = Math.max(Math.floor(modelMaxOutputTokens), 1);
  return Math.max(
    1,
    Math.min(normalizedModelLimit, normalizedContextWindow - normalizedInputTokens),
  );
};
