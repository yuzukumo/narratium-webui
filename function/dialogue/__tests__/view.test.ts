import { describe, expect, it } from "vitest";
import { dialoguePathToMessages } from "@/function/dialogue/view";
import { DialogueNode, DialogueTree } from "@/lib/models/node-model";

describe("dialogue branch view", () => {
  it("exposes sibling candidates without changing the selected path", () => {
    const first = new DialogueNode("first", "root", "", "Opening A", "Opening A");
    const second = new DialogueNode("second", "root", "", "Opening B", "Opening B");
    const replyA = new DialogueNode("reply-a", "first", "Go left", "Left result", "Left result");
    const replyB = new DialogueNode("reply-b", "first", "Go left", "Right result", "Right result");
    const tree = new DialogueTree("dialogue", "character", [first, second, replyA, replyB], "reply-b");

    const messages = dialoguePathToMessages(tree, [first, replyB]);
    const opening = messages.find((message) => message.nodeId === "first");
    const reply = messages.find((message) => message.nodeId === "reply-b" && message.role === "assistant");

    expect(opening?.alternativeIndex).toBe(1);
    expect(opening?.alternativeCount).toBe(2);
    expect(opening?.alternativeNodeIds).toEqual(["first", "second"]);
    expect(reply?.alternativeIndex).toBe(2);
    expect(reply?.alternativeCount).toBe(2);
    expect(reply?.alternativeNodeIds).toEqual(["reply-a", "reply-b"]);
  });

  it("uses distinct message ids while retaining the shared dialogue node id", () => {
    const turn = new DialogueNode("turn", "root", "Choose north", "North result", "North result");
    const tree = new DialogueTree("dialogue", "character", [turn], "turn");

    const messages = dialoguePathToMessages(tree, [turn]);

    expect(messages.map((message) => message.id)).toEqual(["turn:user", "turn:assistant"]);
    expect(messages.map((message) => message.nodeId)).toEqual(["turn", "turn"]);
  });

  it("keeps a persisted pending user turn visible without inventing a response", () => {
    const pending = new DialogueNode(
      "pending",
      "root",
      "Keep this message",
      "",
      "",
      { generationStatus: "pending", modelId: "model-1" },
    );
    const tree = new DialogueTree("dialogue", "character", [pending], "pending");

    const messages = dialoguePathToMessages(tree, [pending]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", content: "Keep this message" });
  });

  it("retains partial output and failure metadata as a retryable assistant turn", () => {
    const failed = new DialogueNode(
      "failed",
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
    );
    const tree = new DialogueTree("dialogue", "character", [failed], "failed");

    const messages = dialoguePathToMessages(tree, [failed]);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "Partial response",
      parsedContent: {
        generationStatus: "failed",
        errorMessage: "The model provider timed out.",
      },
    });
  });

  it("renders a failed or canceled empty response as an error turn", () => {
    const canceled = new DialogueNode(
      "canceled",
      "root",
      "Stop here",
      "",
      "",
      {
        generationStatus: "canceled",
        errorMessage: "Generation stopped.",
      },
    );
    const tree = new DialogueTree("dialogue", "character", [canceled], "canceled");

    const messages = dialoguePathToMessages(tree, [canceled]);

    expect(messages[1]).toMatchObject({ role: "error", content: "Generation stopped." });
  });
});
