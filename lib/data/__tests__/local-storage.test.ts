import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHARACTERS_RECORD_FILE,
  clearDataRevisionCache,
  deleteBlob,
  inheritDataRevision,
  PRESET_FILE,
  readData,
  setBlob,
  writeData,
} from "@/lib/data/local-storage";

interface ServerDocument {
  value: unknown[];
  revision: number;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface TestBlobMetadata {
  key: string;
  content_type: string;
  size: number;
  revision: number;
  updated_at: string;
}

function installDataServer(
  initial: Record<string, ServerDocument>,
  initialBlobs: TestBlobMetadata[] = [{
    key: "existing.png",
    content_type: "image/png",
    size: 8,
    revision: 1,
    updated_at: "2026-01-01T00:00:00Z",
  }],
) {
  const documents = new Map(Object.entries(initial));
  const blobs = new Map(initialBlobs.map((item) => [item.key, item]));
  const blobWrites: string[] = [];
  const blobWriteRevisions: string[] = [];
  const blobDeleteRevisions: string[] = [];
  const nativeFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    if (path.startsWith("data:")) {
      return await nativeFetch(input, init);
    }
    const dataMatch = path.match(/^\/api\/v1\/data\/([^/?]+)$/);
    if (dataMatch) {
      const namespace = decodeURIComponent(dataMatch[1]);
      const current = documents.get(namespace) ?? { value: [], revision: 0 };
      if ((init.method || "GET") === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          value: unknown[];
          expected_revision: number;
        };
        if (body.expected_revision !== current.revision) {
          return jsonResponse({ error: { code: "revision_conflict", message: "conflict" } }, 409);
        }
        const saved = { value: body.value, revision: current.revision + 1 };
        documents.set(namespace, saved);
        return jsonResponse({ namespace, ...saved });
      }
      return jsonResponse({ namespace, ...current });
    }
    if (path.startsWith("/api/v1/blobs?")) {
      const url = new URL(path, "http://narratium.test");
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      const items = [...blobs.values()]
        .sort((left, right) => left.key.localeCompare(right.key))
        .slice(offset, offset + limit);
      return jsonResponse({ items, total: blobs.size, limit, offset });
    }
    const blobMatch = path.match(/^\/api\/v1\/blobs\/(.+)$/);
    if (blobMatch && init.method === "PUT") {
      const key = decodeURIComponent(blobMatch[1]);
      const headers = new Headers(init.headers);
      const ifMatch = headers.get("If-Match") || "";
      const current = blobs.get(key);
      const expectedRevision = current?.revision ?? 0;
      if (ifMatch !== `"${expectedRevision}"`) {
        return jsonResponse({ error: { code: "revision_conflict", message: "conflict" } }, 409);
      }
      const saved = {
        key,
        content_type: headers.get("Content-Type") || "application/octet-stream",
        size: init.body instanceof Blob ? init.body.size : 0,
        revision: expectedRevision + 1,
        updated_at: "2026-01-01T00:00:01Z",
      };
      blobs.set(key, saved);
      blobWrites.push(key);
      blobWriteRevisions.push(ifMatch);
      return jsonResponse(saved);
    }
    if (blobMatch && init.method === "DELETE") {
      const key = decodeURIComponent(blobMatch[1]);
      const headers = new Headers(init.headers);
      const ifMatch = headers.get("If-Match") || "";
      const current = blobs.get(key);
      if (!current || ifMatch !== `"${current.revision}"`) {
        return jsonResponse({ error: { code: "revision_conflict", message: "conflict" } }, 409);
      }
      blobs.delete(key);
      blobDeleteRevisions.push(ifMatch);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { blobs, blobDeleteRevisions, blobWrites, blobWriteRevisions, documents, fetchMock };
}

function testBlobMetadata(key: string, revision = 1): TestBlobMetadata {
  return {
    key,
    content_type: "image/png",
    size: key.length,
    revision,
    updated_at: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  clearDataRevisionCache();
  vi.unstubAllGlobals();
});

describe("backend document revisions", () => {
  it("coalesces concurrent reads while returning independently mutable snapshots", async () => {
    const { fetchMock } = installDataServer({
      [CHARACTERS_RECORD_FILE]: { value: [{ id: "remote" }], revision: 2 },
    });

    const [first, second] = await Promise.all([
      readData(CHARACTERS_RECORD_FILE),
      readData(CHARACTERS_RECORD_FILE),
    ]);
    first.push({ id: "local" });

    expect(second).toEqual([{ id: "remote" }]);
    expect(fetchMock.mock.calls.filter((call) => (call[1]?.method || "GET") === "GET"))
      .toHaveLength(1);
  });

  it("keeps each concurrent edit bound to the revision it read", async () => {
    const { fetchMock } = installDataServer({
      [CHARACTERS_RECORD_FILE]: { value: [{ id: "remote" }], revision: 1 },
    });
    const first = await readData(CHARACTERS_RECORD_FILE);
    const second = await readData(CHARACTERS_RECORD_FILE);

    first.push({ id: "first" });
    await writeData(CHARACTERS_RECORD_FILE, first);
    second.push({ id: "second" });

    await expect(writeData(CHARACTERS_RECORD_FILE, second)).rejects.toThrow(
      "Data changed on another device",
    );
    const putBodies = fetchMock.mock.calls
      .filter((call) => call[1]?.method === "PUT")
      .map((call) => JSON.parse(String(call[1]?.body)) as { expected_revision: number });
    expect(putBodies.map((body) => body.expected_revision)).toEqual([1, 1]);
  });

  it("rejects a snapshot retained across an account cache reset", async () => {
    const { fetchMock } = installDataServer({
      [CHARACTERS_RECORD_FILE]: { value: [{ id: "account-a" }], revision: 4 },
    });
    const accountAData = await readData(CHARACTERS_RECORD_FILE);

    clearDataRevisionCache();

    await expect(writeData(CHARACTERS_RECORD_FILE, accountAData)).rejects.toThrow(
      "signed-in account changed",
    );
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(0);
  });

  it("preserves conflict detection when an empty document creates its first map", async () => {
    installDataServer({
      [PRESET_FILE]: { value: [], revision: 0 },
    });
    const firstRead = await readData(PRESET_FILE);
    const secondRead = await readData(PRESET_FILE);
    const firstMap = { first: { id: "first" } };
    const secondMap = { second: { id: "second" } };
    const firstWrite = [firstMap];
    const secondWrite = [secondMap];
    inheritDataRevision(PRESET_FILE, firstRead, firstWrite);
    inheritDataRevision(PRESET_FILE, secondRead, secondWrite);

    await writeData(PRESET_FILE, firstWrite);

    await expect(writeData(PRESET_FILE, secondWrite)).rejects.toThrow(
      "Data changed on another device",
    );
  });
});

describe("backend blob revisions", () => {
  it("loads every metadata page and uses create/update/delete preconditions", async () => {
    const metadata = Array.from(
      { length: 201 },
      (_, index) => testBlobMetadata(`image-${String(index).padStart(3, "0")}.png`),
    );
    metadata[200] = testBlobMetadata("image-200.png", 7);
    const server = installDataServer({}, metadata);

    await setBlob("image-200.png", new Blob(["updated"], { type: "image/png" }));
    await setBlob("new.png", new Blob(["new"], { type: "image/png" }));
    await deleteBlob("image-200.png");

    const listRequests = server.fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((path) => path.startsWith("/api/v1/blobs?"));
    expect(listRequests).toEqual([
      "/api/v1/blobs?limit=200&offset=0",
      "/api/v1/blobs?limit=200&offset=200",
    ]);
    expect(server.blobWrites).toEqual(["image-200.png", "new.png"]);
    expect(server.blobWriteRevisions).toEqual(["\"7\"", "\"0\""]);
    expect(server.blobDeleteRevisions).toEqual(["\"8\""]);
  });

  it("invalidates stale blob metadata before retrying", async () => {
    const server = installDataServer({}, [testBlobMetadata("image.png", 1)]);
    await setBlob("image.png", new Blob(["first"], { type: "image/png" }));
    server.blobs.set("image.png", testBlobMetadata("image.png", 3));

    await expect(setBlob("image.png", new Blob(["stale"], { type: "image/png" }))).rejects.toThrow(
      "Blob changed on another device",
    );
    await setBlob("image.png", new Blob(["retry"], { type: "image/png" }));

    const putIfMatches = server.fetchMock.mock.calls
      .filter((call) => call[1]?.method === "PUT")
      .map((call) => new Headers(call[1]?.headers).get("If-Match"));
    expect(putIfMatches).toEqual(["\"1\"", "\"2\"", "\"3\""]);
  });

  it("refreshes metadata before deleting a blob created on another device", async () => {
    const server = installDataServer({}, []);
    await setBlob("local.png", new Blob(["local"], { type: "image/png" }));
    server.blobs.set("remote.png", testBlobMetadata("remote.png", 4));

    await deleteBlob("remote.png");

    expect(server.blobs.has("remote.png")).toBe(false);
    expect(server.blobDeleteRevisions).toEqual(["\"4\""]);
    expect(server.fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((path) => path.startsWith("/api/v1/blobs?")))
      .toEqual([
        "/api/v1/blobs?limit=200&offset=0",
        "/api/v1/blobs?limit=200&offset=0",
      ]);
  });

});
