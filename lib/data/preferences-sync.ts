import { APIError } from "@/utils/api-client";

export interface PreferencesDocument {
  namespace: "preferences";
  value: Record<string, string>;
  revision: number;
}

export interface PreferencesTransport {
  load: () => Promise<PreferencesDocument>;
  save: (value: Record<string, string>, expectedRevision: number) => Promise<PreferencesDocument>;
}

export interface PreferenceStorage {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const PREFERENCES_OWNER_KEY = "narratium:preferences-owner";

const sensitiveLegacyKeys = [
  "apiConfigs",
  "activeConfigId",
  "openaiApiKey",
  "apiKey",
  "openaiBaseUrl",
  "modelBaseUrl",
  "openaiModel",
  "modelName",
  "llmType",
  "isLoggedIn",
  "userId",
  "username",
];

const fixedPreferenceKeys = new Set([
  "language",
  "characterCardsViewMode",
  "sidebarState",
  "responseLength",
  "responseLengthVersion",
  "symbol-colors",
  "promptType",
  "llmSettings",
  "activeModelId",
  "reasoningEffortEnabled",
  "reasoningEffort",
]);

export const isPreferenceKey = (key: string): boolean => fixedPreferenceKeys.has(key)
  || key.startsWith("characterModelId:")
  || key.startsWith("preset_sort_")
  || key.startsWith("preset_filter_")
  || key.startsWith("worldbook_sort_")
  || key.startsWith("worldbook_filter_");

function preferenceKeys(storage: PreferenceStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && isPreferenceKey(key)) {
      keys.push(key);
    }
  }
  return keys;
}

export function collectLocalPreferences(storage: PreferenceStorage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of preferenceKeys(storage)) {
    const value = storage.getItem(key);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

export function normalizePreferences(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string"
    )),
  );
}

export function clearSensitiveLegacyStorage(storage: PreferenceStorage): void {
  for (const key of sensitiveLegacyKeys) {
    storage.removeItem(key);
  }
}

export function reconcilePreferenceStorage(
  storage: PreferenceStorage,
  values: Record<string, string>,
): void {
  for (const key of preferenceKeys(storage)) {
    if (!(key in values)) {
      storage.removeItem(key);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (isPreferenceKey(key)) {
      storage.setItem(key, value);
    }
  }
}

export function clearLocalPreferenceCache(storage?: PreferenceStorage): void {
  const resolvedStorage = storage
    ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!resolvedStorage) {
    return;
  }
  for (const key of preferenceKeys(resolvedStorage)) {
    resolvedStorage.removeItem(key);
  }
}

function normalizeDocument(document: PreferencesDocument): PreferencesDocument {
  return {
    namespace: "preferences",
    value: normalizePreferences(document.value),
    revision: Number.isSafeInteger(document.revision) && document.revision >= 0
      ? document.revision
      : 0,
  };
}

export async function initializePreferenceStorage(
  userId: string,
  storage: PreferenceStorage,
  transport: PreferencesTransport,
): Promise<PreferencesDocument> {
  clearSensitiveLegacyStorage(storage);

  let document = normalizeDocument(await transport.load());
  const previousOwner = storage.getItem(PREFERENCES_OWNER_KEY);
  const mayClaimLocalPreferences = document.revision === 0
    && Object.keys(document.value).length === 0
    && (!previousOwner || previousOwner === userId);

  if (mayClaimLocalPreferences) {
    const legacyValues = collectLocalPreferences(storage);
    if (Object.keys(legacyValues).length > 0) {
      try {
        document = normalizeDocument(await transport.save(legacyValues, document.revision));
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 409) {
          throw error;
        }
        // Another device initialized the account first, so its backend copy wins.
        document = normalizeDocument(await transport.load());
      }
    }
  }

  reconcilePreferenceStorage(storage, document.value);
  storage.setItem(PREFERENCES_OWNER_KEY, userId);
  return document;
}

type PreferenceChange = string | null;

export class PreferencesSyncSession {
  private values: Record<string, string>;
  private revision: number;
  private readonly pending = new Map<string, PreferenceChange>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeFlush: Promise<void> | null = null;
  private acceptingChanges = true;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    document: PreferencesDocument,
    private readonly transport: PreferencesTransport,
    private readonly onError: (error: unknown) => void = (error) => {
      console.error("Failed to synchronize preferences:", error);
    },
  ) {
    const normalized = normalizeDocument(document);
    this.values = normalized.value;
    this.revision = normalized.revision;
  }

  set(key: string, value: string): void {
    if (!this.acceptingChanges || !isPreferenceKey(key)) {
      return;
    }
    this.values[key] = value;
    this.pending.set(key, value);
    this.schedule(150);
  }

  remove(key: string): void {
    if (!this.acceptingChanges || !isPreferenceKey(key)) {
      return;
    }
    delete this.values[key];
    this.pending.set(key, null);
    this.schedule(150);
  }

  async flushPending(): Promise<void> {
    this.cancelTimer();
    while (true) {
      if (this.activeFlush) {
        await this.activeFlush;
        continue;
      }
      if (this.pending.size === 0) {
        return;
      }

      const changes = new Map(this.pending);
      this.pending.clear();
      const flush = this.writeChanges(changes);
      this.activeFlush = flush;
      try {
        await flush;
      } catch (error) {
        if (!this.closed) {
          for (const [key, value] of changes) {
            if (!this.pending.has(key)) {
              this.pending.set(key, value);
            }
          }
        }
        throw error;
      } finally {
        if (this.activeFlush === flush) {
          this.activeFlush = null;
        }
      }
    }
  }

  async pauseAndFlush(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.acceptingChanges = false;
    try {
      await this.flushPending();
    } catch (error) {
      this.acceptingChanges = true;
      this.schedule(500);
      throw error;
    }
  }

  resume(): void {
    if (this.closed) {
      return;
    }
    this.acceptingChanges = true;
    if (this.pending.size > 0) {
      this.schedule(150);
    }
  }

  closeAndFlush(): Promise<void> {
    if (!this.closePromise) {
      this.acceptingChanges = false;
      this.cancelTimer();
      this.closePromise = this.flushPending().finally(() => {
        this.closed = true;
        this.pending.clear();
      });
    }
    return this.closePromise;
  }

  discard(): void {
    this.acceptingChanges = false;
    this.closed = true;
    this.cancelTimer();
    this.pending.clear();
  }

  private schedule(delay: number): void {
    if (this.closed || !this.acceptingChanges) {
      return;
    }
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushPending().catch((error) => {
        this.onError(error);
        this.schedule(500);
      });
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async writeChanges(changes: Map<string, PreferenceChange>): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const nextValues = { ...this.values };
      for (const [key, value] of changes) {
        if (value === null) {
          delete nextValues[key];
        } else {
          nextValues[key] = value;
        }
      }

      try {
        const saved = normalizeDocument(await this.transport.save(nextValues, this.revision));
        this.values = saved.value;
        this.revision = saved.revision;
        return;
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 409 || attempt > 0) {
          throw error;
        }
        const current = normalizeDocument(await this.transport.load());
        this.values = current.value;
        this.revision = current.revision;
      }
    }
  }
}

interface ActivePreferencesSession {
  token: symbol;
  userId: string;
  session: PreferencesSyncSession;
}

let activeSession: ActivePreferencesSession | null = null;

export function registerActivePreferencesSession(
  userId: string,
  session: PreferencesSyncSession,
): () => void {
  const registration: ActivePreferencesSession = { token: Symbol(userId), userId, session };
  activeSession = registration;
  return () => {
    if (activeSession?.token === registration.token) {
      activeSession = null;
    }
  };
}

export async function pausePreferencesForAccountChange(): Promise<() => void> {
  const registration = activeSession;
  if (!registration) {
    return () => undefined;
  }
  await registration.session.pauseAndFlush();
  return () => {
    if (activeSession?.token === registration.token) {
      registration.session.resume();
    }
  };
}

export function discardActivePreferences(): void {
  activeSession?.session.discard();
  activeSession = null;
}
