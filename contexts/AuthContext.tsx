"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACCOUNT_CHANGED_EVENT,
  apiFetch,
  apiJSON,
  AuthUser,
  AUTH_REQUIRED_EVENT,
  parseAPIError,
  setAPIUserBinding,
  suspendAPIUserBinding,
} from "@/utils/api-client";
import { clearDataRevisionCache } from "@/lib/data/local-storage";
import { clearBlobUrlCache } from "@/lib/data/blob-url-cache";
import { PREFERENCES_CHANGED_EVENT } from "@/app/i18n";
import {
  clearLocalPreferenceCache,
  discardActivePreferences,
  pausePreferencesForAccountChange,
} from "@/lib/data/preferences-sync";

interface BootstrapState {
  initialized: boolean;
  registration_enabled: boolean;
  email_verification_enabled: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  bootstrap: BootstrapState | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, verificationCode: string) => Promise<void>;
  sendVerificationCode: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_SYNC_CHANNEL = "narratium-auth";
const AUTH_SYNC_STORAGE_KEY = "narratium:auth-sync";

interface AuthSyncMessage {
  type: "session-changed";
  id: string;
  source: string;
  user_id: string | null;
}

function createSyncID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isAuthSyncMessage(value: unknown): value is AuthSyncMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AuthSyncMessage>;
  return candidate.type === "session-changed"
    && typeof candidate.id === "string"
    && typeof candidate.source === "string"
    && (candidate.user_id === null || typeof candidate.user_id === "string");
}

function clearAccountClientCaches(clearPreferences: boolean): void {
  clearDataRevisionCache();
  if (typeof window === "undefined") {
    return;
  }
  if (clearPreferences) {
    clearBlobUrlCache();
  }
  if (clearPreferences) {
    clearLocalPreferenceCache(window.localStorage);
    window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
  }
  window.sessionStorage.removeItem("activate_preset_id");
  window.sessionStorage.removeItem("activate_preset_name");
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  const authTransitionRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const seenSyncMessagesRef = useRef(new Set<string>());
  const tabIDRef = useRef(createSyncID());

  const rememberSyncMessage = useCallback((id: string) => {
    const seen = seenSyncMessagesRef.current;
    if (seen.size >= 64) {
      seen.clear();
    }
    seen.add(id);
  }, []);

  const publishAuthTransition = useCallback((userID: string | null) => {
    if (typeof window === "undefined") {
      return;
    }
    const message: AuthSyncMessage = {
      type: "session-changed",
      id: createSyncID(),
      source: tabIDRef.current,
      user_id: userID,
    };
    rememberSyncMessage(message.id);
    try {
      channelRef.current?.postMessage(message);
    } catch (error) {
      console.warn("Failed to broadcast the authentication transition:", error);
    }
    try {
      window.localStorage.setItem(AUTH_SYNC_STORAGE_KEY, JSON.stringify(message));
      window.localStorage.removeItem(AUTH_SYNC_STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to publish the authentication storage event:", error);
    }
  }, [rememberSyncMessage]);

  const transitionToLoggedOut = useCallback((broadcast = false) => {
    authTransitionRef.current += 1;
    const hadAuthenticatedUser = userRef.current !== null;
    discardActivePreferences();
    clearAccountClientCaches(hadAuthenticatedUser);
    userRef.current = null;
    setAPIUserBinding(null);
    setUser(null);
    setLoading(false);
    if (broadcast) {
      publishAuthTransition(null);
    }
  }, [publishAuthTransition]);

  const refresh = useCallback(async () => {
    const transition = ++authTransitionRef.current;
    const previousUser = userRef.current;
    let resumePreferences: () => void = () => undefined;
    setLoading(true);
    try {
      resumePreferences = await pausePreferencesForAccountChange();
      if (authTransitionRef.current !== transition) {
        resumePreferences();
        return;
      }
      suspendAPIUserBinding();
      const state = await apiJSON<BootstrapState>("/api/v1/auth/bootstrap");
      if (authTransitionRef.current !== transition) {
        return;
      }
      setBootstrap(state);
      const response = await apiFetch("/api/v1/auth/me");
      let nextUser: AuthUser | null = null;
      if (response.ok) {
        const payload = await response.json() as { user: AuthUser };
        nextUser = payload.user;
      } else if (response.status !== 401) {
        throw await parseAPIError(response);
      }
      if (authTransitionRef.current !== transition) {
        return;
      }
      const accountChanged = previousUser !== null && previousUser.id !== nextUser?.id;
      const sameAccount = previousUser !== null && previousUser.id === nextUser?.id;
      if (sameAccount) {
        resumePreferences();
      } else {
        discardActivePreferences();
      }
      clearAccountClientCaches(accountChanged);
      userRef.current = nextUser;
      setAPIUserBinding(nextUser?.id || null);
      setUser(nextUser);
    } catch (error) {
      if (authTransitionRef.current === transition) {
        setAPIUserBinding(previousUser?.id || null);
        resumePreferences();
      }
      throw error;
    } finally {
      if (authTransitionRef.current === transition) {
        setLoading(false);
      }
    }
  }, []);

  const refreshAfterExternalTransition = useCallback(() => {
    authTransitionRef.current += 1;
    suspendAPIUserBinding();
    const hadAuthenticatedUser = userRef.current !== null;
    discardActivePreferences();
    clearAccountClientCaches(hadAuthenticatedUser);
    userRef.current = null;
    setUser(null);
    setLoading(true);
    void refresh().catch((error) => {
      console.error("Failed to refresh authentication after an account transition:", error);
    });
  }, [refresh]);

  useEffect(() => {
    const handleSyncMessage = (value: unknown) => {
      if (
        !isAuthSyncMessage(value)
        || value.source === tabIDRef.current
        || seenSyncMessagesRef.current.has(value.id)
      ) {
        return;
      }
      rememberSyncMessage(value.id);
      refreshAfterExternalTransition();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_SYNC_STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        handleSyncMessage(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed events from unrelated code sharing this origin.
      }
    };

    const handleAccountChanged = () => refreshAfterExternalTransition();
    const handleAuthenticationRequired = () => transitionToLoggedOut(true);

    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
      channelRef.current = channel;
      channel.addEventListener("message", (event) => handleSyncMessage(event.data));
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged);
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);

    return () => {
      channelRef.current?.close();
      channelRef.current = null;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged);
      window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
    };
  }, [refreshAfterExternalTransition, rememberSyncMessage, transitionToLoggedOut]);

  useEffect(() => {
    void refresh().catch((error) => {
      console.error("Failed to refresh authentication:", error);
    });
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const transition = ++authTransitionRef.current;
    const previousUser = userRef.current;
    const resumePreferences = await pausePreferencesForAccountChange();
    suspendAPIUserBinding();
    try {
      const response = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        throw await parseAPIError(response);
      }
      const payload = await response.json() as { user: AuthUser };
      if (authTransitionRef.current !== transition) {
        publishAuthTransition(payload.user.id);
        return;
      }
      discardActivePreferences();
      clearAccountClientCaches(previousUser !== null && previousUser.id !== payload.user.id);
      userRef.current = payload.user;
      setAPIUserBinding(payload.user.id);
      setUser(payload.user);
      publishAuthTransition(payload.user.id);
    } catch (error) {
      if (authTransitionRef.current === transition) {
        setAPIUserBinding(previousUser?.id || null);
        resumePreferences();
      }
      throw error;
    }
  }, [publishAuthTransition]);

  const register = useCallback(async (
    name: string,
    email: string,
    password: string,
    verificationCode: string,
  ) => {
    const transition = ++authTransitionRef.current;
    const previousUser = userRef.current;
    const resumePreferences = await pausePreferencesForAccountChange();
    suspendAPIUserBinding();
    try {
      const response = await apiFetch("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, verification_code: verificationCode }),
      });
      if (!response.ok) {
        throw await parseAPIError(response);
      }
      const payload = await response.json() as { user: AuthUser };
      if (authTransitionRef.current !== transition) {
        publishAuthTransition(payload.user.id);
        return;
      }
      discardActivePreferences();
      clearAccountClientCaches(previousUser !== null && previousUser.id !== payload.user.id);
      userRef.current = payload.user;
      setAPIUserBinding(payload.user.id);
      setUser(payload.user);
      setBootstrap((current) => ({
        initialized: true,
        registration_enabled: current?.registration_enabled ?? true,
        email_verification_enabled: current?.email_verification_enabled ?? false,
      }));
      publishAuthTransition(payload.user.id);
    } catch (error) {
      if (authTransitionRef.current === transition) {
        setAPIUserBinding(previousUser?.id || null);
        resumePreferences();
      }
      throw error;
    }
  }, [publishAuthTransition]);

  const sendVerificationCode = useCallback(async (email: string) => {
    const response = await apiFetch("/api/v1/auth/send-verification-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      throw await parseAPIError(response);
    }
  }, []);

  const logout = useCallback(async () => {
    const resumePreferences = await pausePreferencesForAccountChange();
    try {
      const response = await apiFetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) {
        throw await parseAPIError(response);
      }
      transitionToLoggedOut(true);
    } catch (error) {
      resumePreferences();
      throw error;
    }
  }, [transitionToLoggedOut]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    bootstrap,
    loading,
    login,
    register,
    sendVerificationCode,
    logout,
    refresh,
  }), [bootstrap, loading, login, logout, refresh, register, sendVerificationCode, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
