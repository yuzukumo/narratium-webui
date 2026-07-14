import { useEffect, useState } from "react";
import { getBlob } from "@/lib/data/local-storage";

const RELEASE_DELAY_MS = 30_000;

interface BlobUrlEntry {
  promise: Promise<string | null>;
  url: string | null;
  references: number;
  invalidated?: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

const entries = new Map<string, BlobUrlEntry>();

function scheduleRelease(key: string, entry: BlobUrlEntry): void {
  if (entry.releaseTimer || entry.references > 0) return;

  entry.releaseTimer = setTimeout(() => {
    if (entry.references > 0 || entries.get(key) !== entry) return;
    if (entry.url) URL.revokeObjectURL(entry.url);
    entries.delete(key);
  }, RELEASE_DELAY_MS);
}

function getOrCreateEntry(key: string): BlobUrlEntry {
  const existing = entries.get(key);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = undefined;
    }
    return existing;
  }

  const entry: BlobUrlEntry = {
    promise: Promise.resolve(null),
    url: null,
    references: 0,
  };

  entry.promise = getBlob(key)
    .then((blob) => {
      if (!blob) return null;
      entry.url = URL.createObjectURL(blob);
      if (entry.invalidated) {
        URL.revokeObjectURL(entry.url);
        entry.url = null;
        return null;
      }
      return entry.url;
    })
    .catch((error: unknown) => {
      if (entries.get(key) === entry) entries.delete(key);
      console.error("Failed to load blob:", key, error);
      return null;
    });

  entries.set(key, entry);
  return entry;
}

function acquireBlobUrl(key: string): { promise: Promise<string | null>; release: () => void } {
  const entry = getOrCreateEntry(key);
  entry.references += 1;
  let released = false;

  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.references = Math.max(0, entry.references - 1);
      scheduleRelease(key, entry);
    },
  };
}

export function invalidateBlobUrl(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.invalidated = true;
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  if (entry.url) URL.revokeObjectURL(entry.url);
  entries.delete(key);
}

export function clearBlobUrlCache(): void {
  for (const entry of entries.values()) {
    entry.invalidated = true;
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  entries.clear();
}

export function useBlobUrl(key: string | null, refreshToken = 0): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }

    let active = true;
    const handle = acquireBlobUrl(key);
    setUrl(null);
    void handle.promise.then((nextUrl) => {
      if (active) setUrl(nextUrl);
    });

    return () => {
      active = false;
      handle.release();
    };
  }, [key, refreshToken]);

  return url;
}
