import { beforeEach, describe, expect, it, vi } from "vitest";
import { DialogueNode, DialogueTree } from "@/lib/models/node-model";
import type { ContextSummarySnapshot } from "@/lib/models/parsed-response";

const {
  getDialogueTreeById,
  getDialoguePathToNode,
  updateNodeInDialogueTree,
  invokePersistentLLM,
  acknowledgePersistentLLMRuns,
} = vi.hoisted(() => ({
  getDialogueTreeById: vi.fn(),
  getDialoguePathToNode: vi.fn(),
  updateNodeInDialogueTree: vi.fn(),
  invokePersistentLLM: vi.fn(),
  acknowledgePersistentLLMRuns: vi.fn(),
}));

vi.mock("@/lib/data/character-dialogue-operation", () => ({
  LocalCharacterDialogueOperations: {
    getDialogueTreeById,
    getDialoguePathToNode,
    updateNodeInDialogueTree,
  },
}));

vi.mock("@/utils/llm-api", () => ({
  invokePersistentLLM,
  acknowledgePersistentLLMRuns,
  isContextOverflowError: (error: unknown) => error instanceof Error
    && (error as Error & { code?: string }).code === "context_window_exceeded",
}));

import { ContextNodeTools } from "@/lib/nodeflow/ContextNode/ContextNodeTools";

const opening = new DialogueNode("opening", "root", "", "Welcome", "Welcome");
const turn = (index: number, size = 20, sentinel = "") => new DialogueNode(
  `turn-${index}`,
  index === 0 ? "opening" : `turn-${index - 1}`,
  `question-${index}-${sentinel}-${"u".repeat(size)}`,
  `answer-${index}-${sentinel}-${"a".repeat(size)}`,
  "",
  { compressedContent: `event-${index}` },
);

function stableHash(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function sourceHash(turns: DialogueNode[]): string {
  return stableHash(turns.map((node) => [
    node.node_id,
    node.user_input,
    node.assistant_response,
  ].join("\u001e")).join("\u001f"));
}

function validSummary(facts = "No special sentinel facts were present."): string {
  return `<narrative_summary version="2">
<section id="premise_and_constraints">The established story premise and all durable constraints remain active.</section>
<section id="immutable_facts">Exact identities, names, quantities, and stable facts: ${facts}</section>
<section id="chronology_and_causality">Events remain ordered with their causes, consequences, and state changes.</section>
<section id="characters">Character locations, goals, emotions, injuries, abilities, and possessions are retained.</section>
<section id="relationships_and_knowledge">Relationships, secrets, beliefs, lies, and knowledge boundaries are retained.</section>
<section id="world_state">Persistent locations, factions, objects, inventory, resources, and rules are retained.</section>
<section id="commitments_and_unresolved_threads">Promises, plans, mysteries, conflicts, uncertainty, and pending decisions remain open.</section>
<section id="style_and_user_preferences">The established language, point of view, tense, tone, formatting, and boundaries remain active.</section>
<section id="exact_anchors">Exact literal anchors are retained: ${facts}</section>
<section id="continuation_anchor">Continue from the latest established situation without inventing an intervening event.</section>
</narrative_summary>`;
}

function snapshotFor(turns: DialogueNode[], content = validSummary()): ContextSummarySnapshot {
  const ids = turns.map((node) => node.node_id);
  return {
    version: 2,
    format: "narrative-continuation-v2",
    coveredNodeIds: ids,
    pathHash: stableHash(ids.join("\u001f")),
    sourceHash: sourceHash(turns),
    content,
    verbatimEvidence: "Verbatim evidence from the covered transcript.",
    sourceTokenEstimate: 2_000,
    summaryTokenEstimate: ContextNodeTools.estimateTokens(content),
    modelId: "model-id",
    generation: 1,
    compactionUsage: {
      inputTokens: 2_100,
      outputTokens: 300,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requestCount: 1,
    },
    createdAt: new Date().toISOString(),
  };
}

function setActivePath(turns: DialogueNode[]): void {
  const path = [opening, ...turns];
  getDialogueTreeById.mockResolvedValue(new DialogueTree(
    "dialogue",
    "character",
    path,
    turns.at(-1)?.node_id || "root",
  ));
  getDialoguePathToNode.mockImplementation(async (_characterId: string, nodeId: string) => {
    const index = path.findIndex((node) => node.node_id === nodeId);
    return index >= 0 ? path.slice(0, index + 1) : [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateNodeInDialogueTree.mockResolvedValue({});
  acknowledgePersistentLLMRuns.mockResolvedValue(undefined);
  let run = 0;
  invokePersistentLLM.mockImplementation(async (request: { userMessage: string }) => {
    const sentinels = [...new Set(request.userMessage.match(/SENTINEL_[A-Z0-9_]+/g) || [])];
    const text = validSummary(sentinels.join(", ") || undefined);
    run += 1;
    return {
      runId: `run-${run}`,
      raw: { text },
      text,
      usage: {
        inputTokens: 1_000,
        outputTokens: 300,
        totalTokens: 1_300,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        durationMs: 10,
        firstTokenMs: 1,
        tokensPerSecond: 100,
      },
    };
  });
});

describe("ContextNodeTools", () => {
  it("stops before reading or compacting history when the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(ContextNodeTools.assembleChatHistory(
      "History: {{chatHistory}}",
      "aborted-test",
      { modelId: "model-id", signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(getDialogueTreeById).not.toHaveBeenCalled();
    expect(invokePersistentLLM).not.toHaveBeenCalled();
  });

  it("uses a conservative cross-provider estimate for non-ASCII text", () => {
    expect(ContextNodeTools.estimateTokens("a".repeat(40))).toBe(14);
    expect(ContextNodeTools.estimateTokens("故事".repeat(20))).toBe(44);
  });

  it("does not reuse a summary whose branch path or source text differs", async () => {
    const turns = [turn(0), turn(1), turn(2)];
    turns[1].parsed_content = {
      contextSummary: {
        ...snapshotFor(turns.slice(0, 2)),
        sourceHash: "stale-source",
        content: validSummary("LEAKED_BRANCH_SUMMARY"),
      },
    };
    setActivePath(turns);

    const result = await ContextNodeTools.assembleChatHistory(
      "History: {{chatHistory}}",
      "branch-test",
      { contextWindow: 128_000, maxOutputTokens: 1_024, deferCompaction: true },
    );

    expect(result.userMessage).not.toContain("LEAKED_BRANCH_SUMMARY");
    expect(result.userMessage).toContain("answer-0");
    expect(invokePersistentLLM).not.toHaveBeenCalled();
  });

  it("compacts a complete old prefix from verbatim turns and persists a validated v2 boundary", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(index, 1_200, `SENTINEL_${index}`));
    setActivePath(turns);

    const result = await ContextNodeTools.assembleChatHistory(
      "History: {{chatHistory}}",
      "compact-test",
      {
        contextWindow: 16_000,
        historyTokenBudget: 4_500,
        maxOutputTokens: 512,
        modelMaxOutputTokens: 2_048,
        modelId: "model-id",
        language: "en",
      },
    );

    expect(invokePersistentLLM).toHaveBeenCalledTimes(1);
    expect(invokePersistentLLM.mock.calls[0][0].systemMessage).toContain("<analysis>...</analysis>");
    expect(invokePersistentLLM.mock.calls[0][0].systemMessage).toContain("The analysis block is discarded");
    const request = invokePersistentLLM.mock.calls[0][0];
    expect(request.userMessage).toContain("answer-0-SENTINEL_0");
    expect(request.userMessage).not.toContain("event-0");
    expect(updateNodeInDialogueTree).toHaveBeenCalledTimes(1);
    const [dialogueID, boundaryID, update] = updateNodeInDialogueTree.mock.calls[0];
    expect(dialogueID).toBe("compact-test");
    expect(boundaryID).toBe("turn-5");
    const snapshot = update.parsed_content.contextSummary as ContextSummarySnapshot;
    expect(snapshot.version).toBe(2);
    expect(snapshot.format).toBe("narrative-continuation-v2");
    expect(snapshot.coveredNodeIds).toEqual(turns.slice(0, 6).map((node) => node.node_id));
    expect(snapshot.sourceHash).toBe(sourceHash(turns.slice(0, 6)));
    expect(snapshot.verbatimEvidence).toContain("SENTINEL_0");
    expect(snapshot.summaryTokenEstimate).toBeGreaterThan(100);
    expect(snapshot.compactionUsage.requestCount).toBe(1);
    expect(result.userMessage).toContain("SENTINEL_0");
    expect(result.userMessage).toContain("answer-7-SENTINEL_7");
    expect(result.userMessage).not.toContain("event-0");
    expect(result.compacted).toBe(true);
    expect(acknowledgePersistentLLMRuns).toHaveBeenCalledWith(request.runNamespace);
  });

  it("lets the base model choose summary length while keeping only a physical output ceiling", async () => {
    // This source is deliberately much larger than the compact XML response.
    // The request must not derive maxTokens from the source length, and the
    // concise schema-complete response must still be accepted.
    const turns = Array.from({ length: 100 }, (_, index) => turn(index, 4_000));
    setActivePath(turns);

    const result = await ContextNodeTools.assembleChatHistory("{{chatHistory}}", "natural-summary-test", {
      contextWindow: 1_000_000,
      historyTokenBudget: 300_000,
      maxOutputTokens: 4_096,
      modelMaxOutputTokens: 128_000,
      modelId: "model-id",
      language: "en",
      forceCompaction: true,
    });

    expect(invokePersistentLLM).toHaveBeenCalledTimes(1);
    expect(invokePersistentLLM.mock.calls[0][0].maxTokens).toBe(20_000);
    expect(result.compacted).toBe(true);
    expect(updateNodeInDialogueTree).toHaveBeenCalledTimes(1);
  });

  it("uses hierarchical complete-turn summaries when the source cannot fit one request", async () => {
    const sentinels = Array.from({ length: 14 }, (_, index) => `SENTINEL_FACT_${index}`);
    const turns = sentinels.map((sentinel, index) => turn(index, 1_800, sentinel));
    setActivePath(turns);

    const result = await ContextNodeTools.assembleChatHistory(
      "History: {{chatHistory}}",
      "hierarchy-test",
      {
        contextWindow: 8_192,
        historyTokenBudget: 6_000,
        maxOutputTokens: 256,
        modelMaxOutputTokens: 512,
        modelId: "model-id",
        language: "en",
      },
    );

    expect(invokePersistentLLM.mock.calls.length).toBeGreaterThan(2);
    for (const [request] of invokePersistentLLM.mock.calls) {
      const requestTokens = ContextNodeTools.estimateTokens(request.systemMessage)
        + ContextNodeTools.estimateTokens(request.userMessage)
        + request.maxTokens;
      expect(requestTokens).toBeLessThan(8_192);
      const source = request.userMessage.split("SOURCE MATERIAL START")[1] || "";
      const userCount = (source.match(/User:/g) || []).length;
      const characterCount = (source.match(/Character:/g) || []).length;
      expect(userCount).toBe(characterCount);
    }
    const snapshot = updateNodeInDialogueTree.mock.calls[0][2]
      .parsed_content.contextSummary as ContextSummarySnapshot;
    for (const sentinel of sentinels.slice(0, snapshot.coveredNodeIds.length)) {
      expect(snapshot.content).toContain(sentinel);
    }
    expect(result.compacted).toBe(true);
  });

  it("recompacts incrementally from a valid snapshot and advances its generation", async () => {
    const initialTurns = Array.from({ length: 8 }, (_, index) => turn(index, 1_200, `SENTINEL_OLD_${index}`));
    setActivePath(initialTurns);
    await ContextNodeTools.assembleChatHistory("{{chatHistory}}", "incremental-test", {
      contextWindow: 16_000,
      historyTokenBudget: 4_500,
      maxOutputTokens: 512,
      modelMaxOutputTokens: 2_048,
      modelId: "model-id",
      language: "en",
    });
    const firstSnapshot = updateNodeInDialogueTree.mock.calls[0][2]
      .parsed_content.contextSummary as ContextSummarySnapshot;
    const firstBoundary = firstSnapshot.coveredNodeIds.length - 1;
    initialTurns[firstBoundary].parsed_content = { contextSummary: firstSnapshot };

    const extended = [
      ...initialTurns,
      ...Array.from({ length: 5 }, (_, offset) => turn(8 + offset, 1_200, `SENTINEL_NEW_${offset}`)),
    ];
    setActivePath(extended);
    invokePersistentLLM.mockClear();
    updateNodeInDialogueTree.mockClear();

    await ContextNodeTools.assembleChatHistory("{{chatHistory}}", "incremental-test", {
      contextWindow: 16_000,
      historyTokenBudget: 4_500,
      maxOutputTokens: 512,
      modelMaxOutputTokens: 2_048,
      modelId: "model-id",
      language: "en",
    });

    expect(invokePersistentLLM.mock.calls[0][0].userMessage).toContain(firstSnapshot.content);
    expect(invokePersistentLLM.mock.calls[0][0].userMessage).toContain("SENTINEL_NEW_0");
    const secondSnapshot = updateNodeInDialogueTree.mock.calls[0][2]
      .parsed_content.contextSummary as ContextSummarySnapshot;
    expect(secondSnapshot.generation).toBe(2);
    expect(secondSnapshot.coveredNodeIds.length).toBeGreaterThan(firstSnapshot.coveredNodeIds.length);
    expect(secondSnapshot.sourceTokenEstimate).toBeGreaterThan(firstSnapshot.sourceTokenEstimate);
  });

  it("rejects malformed or implausibly short summaries without changing history", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(index, 800));
    setActivePath(turns);
    invokePersistentLLM.mockResolvedValue({
      runId: "invalid-run",
      raw: { text: "Chronology: too short" },
      text: "Chronology: too short",
      usage: {
        inputTokens: 100,
        outputTokens: 5,
        totalTokens: 105,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        durationMs: 10,
        firstTokenMs: 1,
        tokensPerSecond: 10,
      },
    });

    await expect(ContextNodeTools.assembleChatHistory("{{chatHistory}}", "invalid-test", {
      contextWindow: 16_000,
      historyTokenBudget: 1_800,
      maxOutputTokens: 512,
      modelMaxOutputTokens: 2_048,
      modelId: "model-id",
      language: "en",
    })).rejects.toMatchObject({ code: "invalid_compaction_summary" });
    expect(invokePersistentLLM).toHaveBeenCalledTimes(3);
    expect(updateNodeInDialogueTree).not.toHaveBeenCalled();
    expect(acknowledgePersistentLLMRuns).not.toHaveBeenCalled();
  });

  it("does not commit a summary if a covered turn changed while the model was running", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(index, 800));
    const originalPath = [opening, ...turns];
    const changedTurns = turns.map((node, index) => index === 0
      ? new DialogueNode(
        node.node_id,
        node.parent_node_id,
        node.user_input,
        `${node.assistant_response}-edited-concurrently`,
        node.full_response,
        node.parsed_content,
      )
      : node);
    getDialogueTreeById.mockResolvedValue(new DialogueTree(
      "dialogue", "character", originalPath, turns.at(-1)!.node_id,
    ));
    getDialoguePathToNode.mockImplementation(async (_characterId: string, nodeId: string) => {
      if (nodeId === turns.at(-1)!.node_id) return originalPath;
      const changedPath = [opening, ...changedTurns];
      const boundary = changedPath.findIndex((node) => node.node_id === nodeId);
      return changedPath.slice(0, boundary + 1);
    });

    await expect(ContextNodeTools.assembleChatHistory("{{chatHistory}}", "changed-test", {
      contextWindow: 16_000,
      historyTokenBudget: 1_800,
      maxOutputTokens: 512,
      modelMaxOutputTokens: 2_048,
      modelId: "model-id",
      language: "en",
    })).rejects.toMatchObject({ code: "compaction_source_changed" });
    expect(updateNodeInDialogueTree).not.toHaveBeenCalled();
  });

  it("never falls back to destructive trimming when compaction cannot run", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(index, 800, `SENTINEL_KEEP_${index}`));
    setActivePath(turns);

    await expect(ContextNodeTools.assembleChatHistory("{{chatHistory}}", "no-model-test", {
      contextWindow: 4_096,
      historyTokenBudget: 500,
      maxOutputTokens: 256,
    })).rejects.toMatchObject({ code: "compaction_model_required" });
    expect(updateNodeInDialogueTree).not.toHaveBeenCalled();
  });
});
