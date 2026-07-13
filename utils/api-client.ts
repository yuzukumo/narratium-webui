export interface AuthUser {
  id: string;
  name: string;
	email: string;
  role: "admin" | "user";
  status: "active" | "disabled";
	balance_microusd: string;
	reserved_microusd: string;
	available_balance_microusd: string;
  created_at: string;
  updated_at: string;
}

export interface ModelReasoningCapabilities {
  enabled: boolean;
  effort: string;
  supported_efforts?: string[];
}

export interface ModelCapabilities {
  schema_version?: 2;
  context_window?: number;
  compaction_threshold?: number;
  max_output_tokens?: number;
  reasoning?: ModelReasoningCapabilities;
}

export interface ModelPricing {
	input_microusd_per_million: string;
	output_microusd_per_million: string;
	cache_read_microusd_per_million: string;
	cache_creation_microusd_per_million: string;
	price_multiplier: string;
}

export interface AvailableModel {
  id: string;
  provider_config_id: string;
  provider: "openai" | "anthropic" | "gemini";
  provider_name: string;
  external_id: string;
  capabilities: ModelCapabilities;
	pricing: ModelPricing;
  pricing_configured?: boolean;
}

interface APIErrorBody {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  } | string;
  code?: string;
  message?: string;
  request_id?: string;
}

export class APIError extends Error {
  status: number;
  code: string;
  requestId: string;

  constructor(status: number, code: string, message: string, requestId = "") {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const apiBaseURL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");

export const ACCOUNT_BINDING_HEADER = "X-Narratium-User-ID";
export const AUTH_REQUIRED_EVENT = "narratium:auth-required";
export const ACCOUNT_CHANGED_EVENT = "narratium:account-changed";

const UNBOUND_API_PATHS = new Set([
  "/api/v1/health",
  "/api/v1/auth/bootstrap",
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/send-verification-code",
  "/api/v1/auth/me",
]);
const ACCOUNT_BINDING_EXEMPT_PATHS = new Set([
  "/api/v1/health",
  "/api/v1/auth/bootstrap",
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/send-verification-code",
]);

let boundUserID: string | null = null;
let accountBindingReady = false;

export function setAPIUserBinding(userID: string | null): void {
  const normalized = userID?.trim() || null;
  boundUserID = normalized;
  accountBindingReady = true;
}

export function suspendAPIUserBinding(): void {
  boundUserID = null;
  accountBindingReady = false;
}

function normalizedAPIPath(path: string): string {
  return path.split(/[?#]/, 1)[0];
}

async function responseErrorCode(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as APIErrorBody;
    return (typeof payload.error === "object" ? payload.error.code : payload.code) || "";
  } catch {
    return "";
  }
}

export const apiURL = (path: string): string => `${apiBaseURL}${path}`;

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const normalizedPath = normalizedAPIPath(path);
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (typeof window !== "undefined") {
    if (ACCOUNT_BINDING_EXEMPT_PATHS.has(normalizedPath)) {
      headers.delete(ACCOUNT_BINDING_HEADER);
    } else if (accountBindingReady && boundUserID) {
      headers.set(ACCOUNT_BINDING_HEADER, boundUserID);
    } else if (!UNBOUND_API_PATHS.has(normalizedPath)) {
      throw new APIError(
        409,
        "account_binding_required",
        "The active account is being verified. Retry after authentication refreshes.",
      );
    }
  }
  const response = await fetch(apiURL(path), {
    ...init,
    cache: "no-store",
    headers,
    credentials: "include",
  });
  if (
    response.status === 401
    && !normalizedPath.startsWith("/api/v1/auth/")
    && typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  } else if (
    response.status === 409
    && typeof window !== "undefined"
    && await responseErrorCode(response) === "account_changed"
  ) {
    window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
  }
  return response;
}

export async function parseAPIError(response: Response): Promise<APIError> {
  let payload: APIErrorBody = {};
  try {
    payload = await response.clone().json() as APIErrorBody;
  } catch {
    // Non-JSON upstream failures are normalized to the HTTP status below.
  }
  const nestedError = typeof payload.error === "object" ? payload.error : undefined;
  const stringError = typeof payload.error === "string" ? payload.error : "";
  return new APIError(
    response.status,
    nestedError?.code || payload.code || "request_failed",
    nestedError?.message || payload.message || stringError || `Request failed with status ${response.status}.`,
    nestedError?.request_id || payload.request_id || response.headers.get("X-Request-ID") || "",
  );
}

export async function apiJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw await parseAPIError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return await response.json() as T;
}
