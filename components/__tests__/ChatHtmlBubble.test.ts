import { describe, it, expect } from "vitest";

function processText(str: string): string {
  str = str.replace(/(<[^>]+>)|(["“”][^"“”]+["“”])/g, (_match, tag, quote) => {
    if (tag) return tag;
    return `<span class="dialogue">${quote}</span>`;
  });
  return str;
}

describe("ChatHtmlBubble text processing", () => {
  it("should process Chinese quotation marks correctly", () => {
    const input = "这是一段“中文引号”的测试";
    const expected = "这是一段<span class=\"dialogue\">“中文引号”</span>的测试";
    expect(processText(input)).toBe(expected);
  });
});
