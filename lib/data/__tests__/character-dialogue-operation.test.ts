import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  dialogues: [] as any[],
  readData: vi.fn(),
  writeData: vi.fn(),
}));

vi.mock("@/lib/data/local-storage", () => ({
  CHARACTER_DIALOGUES_FILE: "character_dialogues",
  readData: storage.readData,
  writeData: storage.writeData,
}));

import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { DialogueNode, DialogueTree } from "@/lib/models/node-model";

beforeEach(() => {
  storage.dialogues = [{
    id: "character-1",
    character_id: "character-1",
    current_node_id: "root",
    nodes: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }];
  storage.readData.mockReset().mockImplementation(async () => structuredClone(storage.dialogues));
  storage.writeData.mockReset().mockImplementation(async (_namespace, value) => {
    storage.dialogues = structuredClone(value);
  });
});

describe("dialogue generation persistence", () => {
  it("creates a pending user turn and updates the same node after a partial failure", async () => {
    await LocalCharacterDialogueOperations.upsertNodeToDialogueTree(
      "character-1",
      "root",
      "Continue the scene",
      "",
      "",
      { generationStatus: "pending", modelId: "model-1" },
      "node-1",
    );

    const pending = storage.dialogues[0].nodes[0];
    const createdAt = pending.created_at;
    expect(storage.dialogues[0].current_node_id).toBe("node-1");
    expect(pending).toMatchObject({
      node_id: "node-1",
      user_input: "Continue the scene",
      assistant_response: "",
      parsed_content: { generationStatus: "pending" },
    });

    await LocalCharacterDialogueOperations.upsertNodeToDialogueTree(
      "character-1",
      "root",
      "Continue the scene",
      "Partial response",
      "Partial response<thinking>unfinished",
      {
        regexResult: "Partial response",
        generationStatus: "failed",
        errorCode: "upstream_timeout",
        errorMessage: "The model provider timed out.",
      },
      "node-1",
    );

    expect(storage.dialogues[0].nodes).toHaveLength(1);
    expect(storage.dialogues[0].nodes[0]).toMatchObject({
      node_id: "node-1",
      created_at: createdAt,
      user_input: "Continue the scene",
      assistant_response: "Partial response",
      full_response: "Partial response<thinking>unfinished",
      parsed_content: {
        generationStatus: "failed",
        errorCode: "upstream_timeout",
        errorMessage: "The model provider timed out.",
      },
    });
  });
});

describe("dialogue path indexing", () => {
  it("builds the selected path and stops safely on malformed parent cycles", () => {
    const root = new DialogueNode("root", "", "", "", "");
    const first = new DialogueNode("first", "root", "one", "", "");
    const second = new DialogueNode("second", "first", "two", "", "");
    const tree = new DialogueTree("character-1", "character-1", [root, first, second], "second");

    expect(LocalCharacterDialogueOperations.getDialoguePath(tree, "second").map((node) => node.node_id))
      .toEqual(["root", "first", "second"]);

    first.parent_node_id = "second";
    expect(LocalCharacterDialogueOperations.getDialoguePath(tree, "second").map((node) => node.node_id))
      .toEqual(["first", "second"]);
  });
});
