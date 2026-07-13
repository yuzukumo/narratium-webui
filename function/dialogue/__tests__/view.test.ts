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
});
