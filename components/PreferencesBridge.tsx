"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { apiJSON } from "@/utils/api-client";
import { useAuth } from "@/contexts/AuthContext";
import { PREFERENCES_CHANGED_EVENT, useLanguage } from "@/app/i18n";
import {
  initializePreferenceStorage,
  isPreferenceKey,
  PreferencesDocument,
  PreferencesSyncSession,
  PreferencesTransport,
  registerActivePreferencesSession,
} from "@/lib/data/preferences-sync";

function createTransport(): PreferencesTransport {
  return {
    load: () => apiJSON<PreferencesDocument>("/api/v1/data/preferences"),
    save: (value, expectedRevision) => apiJSON<PreferencesDocument>("/api/v1/data/preferences", {
      method: "PUT",
      body: JSON.stringify({
        value,
        expected_revision: expectedRevision,
      }),
    }),
  };
}

export default function PreferencesBridge({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t, fontClass, titleFontClass } = useLanguage();
  const userId = user?.id || "";
  const translateRef = useRef(t);
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let disposed = false;
    let session: PreferencesSyncSession | null = null;
    let unregisterSession: () => void = () => undefined;
    const storagePrototype = Storage.prototype;
    const originalSetItem = storagePrototype.setItem;
    const originalRemoveItem = storagePrototype.removeItem;
    const originalClear = storagePrototype.clear;
    let synchronizedSetItem: typeof Storage.prototype.setItem | null = null;
    let synchronizedRemoveItem: typeof Storage.prototype.removeItem | null = null;
    let synchronizedClear: typeof Storage.prototype.clear | null = null;

    setReady(false);
    setFatalError("");

    const initialize = async () => {
      try {
        const transport = createTransport();
        const document = await initializePreferenceStorage(userId, window.localStorage, transport);
        if (disposed) {
          return;
        }
        window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));

        session = new PreferencesSyncSession(document, transport);

        synchronizedSetItem = function setSynchronizedItem(
          this: Storage,
          key: string,
          value: string,
        ) {
          const normalizedKey = String(key);
          const normalizedValue = String(value);
          originalSetItem.call(this, normalizedKey, normalizedValue);
          if (this === window.localStorage && isPreferenceKey(normalizedKey)) {
            session?.set(normalizedKey, normalizedValue);
          }
        };
        synchronizedRemoveItem = function removeSynchronizedItem(this: Storage, key: string) {
          const normalizedKey = String(key);
          originalRemoveItem.call(this, normalizedKey);
          if (this === window.localStorage && isPreferenceKey(normalizedKey)) {
            session?.remove(normalizedKey);
          }
        };
        synchronizedClear = function clearSynchronizedStorage(this: Storage) {
          const removedPreferenceKeys: string[] = [];
          if (this === window.localStorage) {
            for (let index = 0; index < this.length; index++) {
              const key = this.key(index);
              if (key && isPreferenceKey(key)) {
                removedPreferenceKeys.push(key);
              }
            }
          }
          originalClear.call(this);
          for (const key of removedPreferenceKeys) {
            session?.remove(key);
          }
        };

        storagePrototype.setItem = synchronizedSetItem;
        storagePrototype.removeItem = synchronizedRemoveItem;
        storagePrototype.clear = synchronizedClear;
        unregisterSession = registerActivePreferencesSession(userId, session);
        setReady(true);
      } catch (error) {
        if (!disposed) {
          setFatalError(
            error instanceof Error ? error.message : translateRef.current("preferences.loadError"),
          );
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      unregisterSession();
      if (synchronizedSetItem && storagePrototype.setItem === synchronizedSetItem) {
        storagePrototype.setItem = originalSetItem;
      }
      if (synchronizedRemoveItem && storagePrototype.removeItem === synchronizedRemoveItem) {
        storagePrototype.removeItem = originalRemoveItem;
      }
      if (synchronizedClear && storagePrototype.clear === synchronizedClear) {
        storagePrototype.clear = originalClear;
      }
      if (session) {
        void session.closeAndFlush().catch((error) => {
          console.error("Failed to flush preferences during cleanup:", error);
        });
      }
    };
  }, [retryKey, userId]);

  if (fatalError) {
    return (
      <div className={`flex h-full items-center justify-center overflow-y-auto bg-gradient-to-b from-[#1a1816] to-[#211e1c] px-4 py-8 ${fontClass}`}>
        <section className="relative w-full max-w-md overflow-hidden rounded-lg border border-[#534741] bg-gradient-to-br from-[#252220] to-[#1a1816] p-6 text-center shadow-2xl shadow-black/40">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/50 to-transparent" />
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-red-500/30 bg-red-950/20 text-red-300">
            <AlertTriangle size={22} />
          </span>
          <h2 className={`mt-4 text-lg font-semibold text-[#f4e8c1] ${titleFontClass}`}>
            {t("preferences.unavailable")}
          </h2>
          <p role="alert" className="mt-2 break-words text-sm leading-6 text-red-300/90">{fatalError}</p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void logout()}
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#534741] bg-gradient-to-br from-[#252220] to-[#1a1816] px-4 text-sm text-[#c0a480] transition-all hover:border-[#756655] hover:text-[#eae6db]"
            >
              <LogOut size={15} />
              {t("userMenu.signOut")}
            </button>
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-gradient-to-r from-amber-700/40 to-orange-700/30 px-4 text-sm font-medium text-[#f9c86d] transition-all hover:border-amber-400/60 hover:text-[#fff0c7]"
            >
              <RefreshCw size={15} />
              {t("preferences.retry")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className={`flex h-full flex-col items-center justify-center bg-gradient-to-b from-[#1a1816] to-[#211e1c] text-[#c0a480] ${fontClass}`} aria-busy="true">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-b-[#a18d6f] border-l-transparent border-r-[#c0a480] border-t-[#f9c86d]" />
          <div className="animate-spin-slow absolute inset-2 rounded-full border-2 border-b-[#c0a480] border-l-[#a18d6f] border-r-transparent border-t-[#f9c86d]" />
        </div>
        <span className="mt-3 text-xs">{t("preferences.syncing")}</span>
      </div>
    );
  }

  return children;
}
