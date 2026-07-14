import { apiFetch, apiJSON, APIError, parseAPIError } from "@/utils/api-client";

export const CHARACTERS_RECORD_FILE = "characters_record";
export const CHARACTER_DIALOGUES_FILE = "character_dialogues";
export const WORLD_BOOK_FILE = "world_book";
export const REGEX_SCRIPTS_FILE = "regex_scripts";
export const PRESET_FILE = "preset_data";

const DOCUMENT_STORES = [
  CHARACTERS_RECORD_FILE,
  CHARACTER_DIALOGUES_FILE,
  WORLD_BOOK_FILE,
  REGEX_SCRIPTS_FILE,
  PRESET_FILE,
] as const;

interface DocumentResponse<T = unknown> {
  namespace: string;
  value: T;
  revision: number;
  updated_at?: string;
}

interface BlobMetadata {
  key: string;
  content_type: string;
  size: number;
  revision: number;
  updated_at: string;
}

interface BlobPage {
  items: BlobMetadata[];
  total: number;
  limit: number;
  offset: number;
}

type BlobWriteResponse = BlobMetadata;

const BLOB_PAGE_LIMIT = 200;
const DOCUMENT_CACHE_TTL_MS = 750;

interface CachedDocument {
  value: any[];
  revision: number;
  expiresAt: number;
}

const revisions = new Map<string, number>();
const documentCache = new Map<string, CachedDocument>();
const documentRequests = new Map<string, Promise<DocumentResponse<any[]>>>();
const blobRevisions = new Map<string, number>();
const revisionSnapshots = new WeakMap<object, {
  generation: number;
  namespace: string;
  revision: number;
}>();
let cacheGeneration = 0;
let blobMetadataLoaded = false;

export function clearDataRevisionCache(): void {
  revisions.clear();
  documentCache.clear();
  documentRequests.clear();
  blobRevisions.clear();
  blobMetadataLoaded = false;
  cacheGeneration += 1;
}

function cloneDocumentValue(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return structuredClone(value);
}

async function fetchDocument(storeName: string): Promise<DocumentResponse<any[]>> {
  const existing = documentRequests.get(storeName);
  if (existing) return existing;

  const request = apiJSON<DocumentResponse<any[]>>(
    `/api/v1/data/${encodeURIComponent(storeName)}`,
  ).finally(() => {
    if (documentRequests.get(storeName) === request) {
      documentRequests.delete(storeName);
    }
  });
  documentRequests.set(storeName, request);
  return request;
}

function accountChangedError(): Error {
  return new Error("The signed-in account changed while data was being synchronized.");
}

function assertCurrentGeneration(generation: number): void {
  if (generation !== cacheGeneration) {
    throw accountChangedError();
  }
}

function rememberRevision(storeName: string, data: unknown[], revision: number): void {
  const snapshot = {
    generation: cacheGeneration,
    namespace: storeName,
    revision,
  };
  revisionSnapshots.set(data, snapshot);
  for (const item of data) {
    if (item && typeof item === "object") {
      revisionSnapshots.set(item, snapshot);
    }
  }
}

function revisionForData(storeName: string, data: unknown[]): number | undefined {
  const candidates = [data, ...data.filter((item): item is object => Boolean(item) && typeof item === "object")];
  for (const candidate of candidates) {
    const snapshot = revisionSnapshots.get(candidate);
    if (!snapshot || snapshot.namespace !== storeName) {
      continue;
    }
    if (snapshot.generation !== cacheGeneration) {
      throw accountChangedError();
    }
    return snapshot.revision;
  }
  return undefined;
}

export function inheritDataRevision(
  storeName: string,
  source: unknown[],
  target: unknown[],
): void {
  assertDocumentStore(storeName);
  const revision = revisionForData(storeName, source);
  if (revision !== undefined) {
    rememberRevision(storeName, target, revision);
  }
}

export async function readData(storeName: string): Promise<any[]> {
  assertDocumentStore(storeName);
  const generation = cacheGeneration;
  const cached = documentCache.get(storeName);
  if (cached && cached.expiresAt > Date.now()) {
    const data = cloneDocumentValue(cached.value);
    rememberRevision(storeName, data, cached.revision);
    return data;
  }

  const document = await fetchDocument(storeName);
  assertCurrentGeneration(generation);
  const data = cloneDocumentValue(document.value);
  revisions.set(storeName, document.revision);
  documentCache.set(storeName, {
    value: cloneDocumentValue(data),
    revision: document.revision,
    expiresAt: Date.now() + DOCUMENT_CACHE_TTL_MS,
  });
  rememberRevision(storeName, data, document.revision);
  return data;
}

export async function writeData(storeName: string, data: any[]): Promise<void> {
  assertDocumentStore(storeName);
  const generation = cacheGeneration;
  let expectedRevision = revisionForData(storeName, data) ?? revisions.get(storeName);
  if (expectedRevision === undefined) {
    const current = await apiJSON<DocumentResponse>(`/api/v1/data/${encodeURIComponent(storeName)}`);
    assertCurrentGeneration(generation);
    expectedRevision = current.revision;
  }
  try {
    assertCurrentGeneration(generation);
    const document = await apiJSON<DocumentResponse>(`/api/v1/data/${encodeURIComponent(storeName)}`, {
      method: "PUT",
      body: JSON.stringify({ value: data, expected_revision: expectedRevision }),
    });
    assertCurrentGeneration(generation);
    revisions.set(storeName, document.revision);
    documentCache.set(storeName, {
      value: cloneDocumentValue(data),
      revision: document.revision,
      expiresAt: Date.now() + DOCUMENT_CACHE_TTL_MS,
    });
    rememberRevision(storeName, data, document.revision);
  } catch (error) {
    assertCurrentGeneration(generation);
    if (error instanceof APIError && error.status === 409) {
      revisions.delete(storeName);
      documentCache.delete(storeName);
      documentRequests.delete(storeName);
      throw new Error("Data changed on another device. Reload and retry the operation.");
    }
    throw error;
  }
}

export async function initializeDataFiles(): Promise<void> {
  const generation = cacheGeneration;
  await Promise.all(DOCUMENT_STORES.map(async (storeName) => {
    assertCurrentGeneration(generation);
    if (!revisions.has(storeName)) {
      await readData(storeName);
    }
  }));
  assertCurrentGeneration(generation);
}

export async function setBlob(key: string, blob: Blob): Promise<void> {
  const generation = cacheGeneration;
  const expectedRevision = await revisionForBlob(key, generation);
  assertCurrentGeneration(generation);
  const response = await apiFetch(`/api/v1/blobs/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "If-Match": formatRevisionETag(expectedRevision),
    },
    body: blob,
  });
  assertCurrentGeneration(generation);
  if (!response.ok) {
    await throwBlobWriteError(response, key, generation);
  }
  const saved = await response.json() as BlobWriteResponse;
  assertCurrentGeneration(generation);
  if (!isPositiveRevision(saved.revision)) {
    blobMetadataLoaded = false;
    throw new Error("The server returned an invalid blob revision.");
  }
  blobRevisions.set(key, saved.revision);
}

export async function getBlob(key: string): Promise<Blob | null> {
  const generation = cacheGeneration;
  const response = await apiFetch(`/api/v1/blobs/${encodeURIComponent(key)}`);
  assertCurrentGeneration(generation);
  if (response.status === 404) {
    blobRevisions.delete(key);
    return null;
  }
  if (!response.ok) {
    throw await parseAPIError(response);
  }
  const blob = await response.blob();
  assertCurrentGeneration(generation);
  rememberBlobETag(key, response.headers.get("ETag"));
  return blob;
}

export async function deleteBlob(key: string): Promise<void> {
  const generation = cacheGeneration;
  const expectedRevision = await revisionForBlob(key, generation, true);
  assertCurrentGeneration(generation);
  if (expectedRevision === 0) {
    return;
  }
  const response = await apiFetch(`/api/v1/blobs/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { "If-Match": formatRevisionETag(expectedRevision) },
  });
  assertCurrentGeneration(generation);
  if (!response.ok) {
    await throwBlobWriteError(response, key, generation);
  }
  blobRevisions.delete(key);
}

function assertDocumentStore(storeName: string): void {
  if (!DOCUMENT_STORES.includes(storeName as typeof DOCUMENT_STORES[number])) {
    throw new Error(`Unsupported data store: ${storeName}`);
  }
}

async function revisionForBlob(
  key: string,
  generation: number,
  refreshWhenMissing = false,
): Promise<number> {
  const knownRevision = blobRevisions.get(key);
  if (knownRevision !== undefined) {
    return knownRevision;
  }
  if (!blobMetadataLoaded || refreshWhenMissing) {
    await loadAllBlobMetadata(generation);
  }
  assertCurrentGeneration(generation);
  return blobRevisions.get(key) ?? 0;
}

async function loadAllBlobMetadata(generation: number): Promise<BlobMetadata[]> {
  const items: BlobMetadata[] = [];
  let offset = 0;
  while (true) {
    const page = await apiJSON<BlobPage>(
      `/api/v1/blobs?limit=${BLOB_PAGE_LIMIT}&offset=${offset}`,
    );
    assertCurrentGeneration(generation);
    if (
      !Array.isArray(page.items)
      || !Number.isSafeInteger(page.total)
      || page.total < 0
      || !Number.isSafeInteger(page.limit)
      || page.limit <= 0
      || page.offset !== offset
    ) {
      throw new Error("The server returned invalid blob pagination metadata.");
    }
    items.push(...page.items);
    const nextOffset = offset + page.items.length;
    if (page.items.length === 0 || nextOffset >= page.total) {
      break;
    }
    offset = nextOffset;
  }

  assertCurrentGeneration(generation);
  blobRevisions.clear();
  for (const item of items) {
    if (!isPositiveRevision(item.revision)) {
      blobMetadataLoaded = false;
      throw new Error("The server returned an invalid blob revision.");
    }
    blobRevisions.set(item.key, item.revision);
  }
  blobMetadataLoaded = true;
  return items;
}

function formatRevisionETag(revision: number): string {
  return `"${revision}"`;
}

function rememberBlobETag(key: string, value: string | null): void {
  if (!value) {
    return;
  }
  const match = /^"([1-9][0-9]*)"$/.exec(value);
  if (!match) {
    return;
  }
  const revision = Number(match[1]);
  if (isPositiveRevision(revision)) {
    blobRevisions.set(key, revision);
  }
}

function isPositiveRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

async function throwBlobWriteError(
  response: Response,
  key: string,
  generation: number,
): Promise<never> {
  const error = await parseAPIError(response);
  assertCurrentGeneration(generation);
  if (error.status === 409 && error.code === "revision_conflict") {
    blobRevisions.delete(key);
    blobMetadataLoaded = false;
    throw new Error("Blob changed on another device. Reload and retry the operation.");
  }
  throw error;
}
