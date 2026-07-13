import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@/utils/api-client";
import {
  discardActivePreferences,
  initializePreferenceStorage,
  isPreferenceKey,
  pausePreferencesForAccountChange,
  PREFERENCES_OWNER_KEY,
  PreferenceStorage,
  PreferencesDocument,
  PreferencesSyncSession,
  PreferencesTransport,
  registerActivePreferencesSession,
} from "@/lib/data/preferences-sync";

class MemoryStorage implements PreferenceStorage {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value);
    }
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const document = (
  value: Record<string, string>,
  revision: number,
): PreferencesDocument => ({ namespace: "preferences", value, revision });

afterEach(() => {
  discardActivePreferences();
  vi.restoreAllMocks();
});

describe("preference ownership initialization", () => {
  it("synchronizes explicit language preferences", () => {
    expect(isPreferenceKey("language")).toBe(true);
  });

  it("synchronizes per-character model selections", () => {
    expect(isPreferenceKey("characterModelId:character-1")).toBe(true);
  });

  it("clears another account's cached values when the backend document is empty", async () => {
    const storage = new MemoryStorage({
      [PREFERENCES_OWNER_KEY]: "account-a",
      language: "en",
      soundEnabled: "false",
    });
    const transport: PreferencesTransport = {
      load: vi.fn(async () => document({}, 0)),
      save: vi.fn(),
    };

    await initializePreferenceStorage("account-b", storage, transport);

    expect(transport.save).not.toHaveBeenCalled();
    expect(storage.getItem("language")).toBeNull();
    expect(storage.getItem("soundEnabled")).toBeNull();
    expect(storage.getItem(PREFERENCES_OWNER_KEY)).toBe("account-b");
  });

  it("claims unowned legacy preferences exactly once for an empty account", async () => {
    const storage = new MemoryStorage({
      language: "en",
      responseLength: "2048",
      openaiApiKey: "must-not-survive",
    });
    const save = vi.fn(async (value: Record<string, string>, expectedRevision: number) => {
      expect(expectedRevision).toBe(0);
      return document(value, 1);
    });

    await initializePreferenceStorage("account-a", storage, {
      load: vi.fn(async () => document({}, 0)),
      save,
    });

    expect(save).toHaveBeenCalledWith({ language: "en", responseLength: "2048" }, 0);
    expect(storage.getItem("openaiApiKey")).toBeNull();
    expect(storage.getItem(PREFERENCES_OWNER_KEY)).toBe("account-a");
  });

  it("uses the backend copy when another device wins first-write migration", async () => {
    const storage = new MemoryStorage({ language: "en", soundEnabled: "false" });
    const load = vi.fn()
      .mockResolvedValueOnce(document({}, 0))
      .mockResolvedValueOnce(document({ language: "zh", soundEnabled: "true" }, 1));
    const save = vi.fn(async () => {
      throw new APIError(409, "revision_conflict", "conflict");
    });

    await initializePreferenceStorage("account-a", storage, { load, save });

    expect(storage.getItem("language")).toBe("zh");
    expect(storage.getItem("soundEnabled")).toBe("true");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("preference synchronization session", () => {
  it("flushes queued changes before an account transition and can resume after a failed logout", async () => {
    const save = vi.fn(async (value: Record<string, string>, expectedRevision: number) => (
      document(value, expectedRevision + 1)
    ));
    const session = new PreferencesSyncSession(document({}, 0), {
      load: vi.fn(async () => document({}, 0)),
      save,
    });
    const unregister = registerActivePreferencesSession("account-a", session);

    session.set("responseLength", "2048");
    const resume = await pausePreferencesForAccountChange();

    expect(save).toHaveBeenCalledWith({ responseLength: "2048" }, 0);
    session.set("soundEnabled", "false");
    expect(save).toHaveBeenCalledTimes(1);

    resume();
    session.set("soundEnabled", "false");
    await session.flushPending();
    expect(save).toHaveBeenLastCalledWith({ responseLength: "2048", soundEnabled: "false" }, 1);

    unregister();
    await session.closeAndFlush();
  });

  it("rebases a local change after a revision conflict", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new APIError(409, "revision_conflict", "conflict"))
      .mockImplementationOnce(async (value: Record<string, string>, expectedRevision: number) => (
        document(value, expectedRevision + 1)
      ));
    const session = new PreferencesSyncSession(document({ responseLength: "2048" }, 1), {
      load: vi.fn(async () => document({ futurePreference: "preserved" }, 2)),
      save,
    });

    session.set("soundEnabled", "false");
    await session.flushPending();

    expect(save).toHaveBeenNthCalledWith(1, { responseLength: "2048", soundEnabled: "false" }, 1);
    expect(save).toHaveBeenNthCalledWith(2, {
      futurePreference: "preserved",
      soundEnabled: "false",
    }, 2);
    await session.closeAndFlush();
  });
});
