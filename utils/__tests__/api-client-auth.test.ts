import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_BINDING_HEADER,
  ACCOUNT_CHANGED_EVENT,
  apiFetch,
  AUTH_REQUIRED_EVENT,
  parseAPIError,
  setAPIUserBinding,
  suspendAPIUserBinding,
} from "@/utils/api-client";

afterEach(() => {
  suspendAPIUserBinding();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("API error parsing", () => {
  it("preserves the standard backend error code and message", async () => {
    const error = await parseAPIError(new Response(JSON.stringify({
      error: {
        code: "insufficient_user_quota",
        message: "Insufficient quota.",
        request_id: "request-1",
      },
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }));

    expect(error).toMatchObject({
      status: 403,
      code: "insufficient_user_quota",
      message: "Insufficient quota.",
      requestId: "request-1",
    });
  });

  it("also preserves errors produced by the client-side chat pipeline", async () => {
    const error = await parseAPIError(new Response(JSON.stringify({
      code: "chat_request_failed",
      message: "Unable to build the request.",
      request_id: "request-2",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));

    expect(error).toMatchObject({
      status: 500,
      code: "chat_request_failed",
      message: "Unable to build the request.",
      requestId: "request-2",
    });
  });
});

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0): Headers {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

describe("authenticated account binding", () => {
  it("adds the displayed user ID to protected requests and overrides caller input", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);
    setAPIUserBinding("user-123");

    await apiFetch("/api/v1/data/preferences?revision=2", {
      headers: { [ACCOUNT_BINDING_HEADER]: "spoofed-user" },
    });

    expect(requestHeaders(fetchMock).get(ACCOUNT_BINDING_HEADER)).toBe("user-123");
  });

  it("keeps login and registration exempt from account binding", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);
    setAPIUserBinding("old-user");

    await apiFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { [ACCOUNT_BINDING_HEADER]: "spoofed-user" },
      body: "{}",
    });
    await apiFetch("/api/v1/auth/register", {
      method: "POST",
      headers: {
        [ACCOUNT_BINDING_HEADER]: "spoofed-user",
        "X-Narratium-Bootstrap-Secret": "bootstrap-secret",
      },
      body: "{}",
    });

    expect(requestHeaders(fetchMock, 0).has(ACCOUNT_BINDING_HEADER)).toBe(false);
    expect(requestHeaders(fetchMock, 1).has(ACCOUNT_BINDING_HEADER)).toBe(false);
    expect(requestHeaders(fetchMock, 1).get("X-Narratium-Bootstrap-Secret")).toBe("bootstrap-secret");
  });

  it("allows auth/me to bootstrap identity before a binding exists", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/auth/me");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestHeaders(fetchMock).has(ACCOUNT_BINDING_HEADER)).toBe(false);
  });

  it("binds later auth/me refreshes once identity is known", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);
    setAPIUserBinding("user-123");

    await apiFetch("/api/v1/auth/me");

    expect(requestHeaders(fetchMock).get(ACCOUNT_BINDING_HEADER)).toBe("user-123");
  });

  it("blocks protected requests while the displayed account is unknown", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/v1/models")).rejects.toMatchObject({
      status: 409,
      code: "account_binding_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("authentication transition events", () => {
  it("does not treat rejected login credentials as an expired authenticated session", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    setAPIUserBinding("old-user");

    await apiFetch("/api/v1/auth/login", { method: "POST", body: "{}" });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("notifies the auth bridge when a protected data request expires", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    setAPIUserBinding("user-123");

    await apiFetch("/api/v1/data/preferences");

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: AUTH_REQUIRED_EVENT });
  });

  it("asks the auth bridge to refresh when the server detects an account change", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "account_changed", message: "Account changed." },
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })));
    setAPIUserBinding("stale-user");

    await apiFetch("/api/v1/models");

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: ACCOUNT_CHANGED_EVENT });
  });
});
