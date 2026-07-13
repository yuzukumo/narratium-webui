import { describe, expect, it } from "vitest";
import {
  PresetAssembler,
  responseLengthPreference,
} from "@/lib/core/preset-assembler";
import {
  BASE_NARRATIVE_SYSTEM_PROMPT,
  NARRATIVE_CONTINUATION_GUIDE,
  NARRATIVE_MODE_DIRECTIVES,
  OUTPUT_CONTRACT,
  RESPONSE_LANGUAGE_POLICY,
} from "@/lib/prompts/preset-prompts";

const containsHan = (value: string): boolean => /[\u3400-\u9fff]/u.test(value);

describe("built-in narrative prompts", () => {
  it("keeps all repository-owned prompt text in English", () => {
    const builtIns = [
      BASE_NARRATIVE_SYSTEM_PROMPT,
      NARRATIVE_CONTINUATION_GUIDE,
      OUTPUT_CONTRACT,
      RESPONSE_LANGUAGE_POLICY,
      ...Object.values(NARRATIVE_MODE_DIRECTIVES),
      responseLengthPreference("zh-TW", 4096),
    ];

    expect(builtIns.every((prompt) => !containsHan(prompt))).toBe(true);
  });

  it("adds one stable latest-user-language policy to the default framework", () => {
    const result = PresetAssembler.assemblePrompts([], "ja");

    expect(result.systemMessage).toContain(BASE_NARRATIVE_SYSTEM_PROMPT);
    expect(result.systemMessage.match(/Reply in the language used for the request/g)).toHaveLength(1);
    expect(result.userMessage).toContain(OUTPUT_CONTRACT);
    expect(result.userMessage).not.toContain("high-priority soft length preference");
  });

  it("preserves external preset text while repository-owned instructions stay English", () => {
    const result = PresetAssembler.assemblePrompts([
      {
        identifier: "main",
        name: "外部预设",
        enabled: true,
        content: "保持角色卡原本的叙事风格。",
      },
    ], "zh");

    expect(result.systemMessage).toContain("保持角色卡原本的叙事风格。");
    expect(result.systemMessage).toContain(RESPONSE_LANGUAGE_POLICY);
    expect(result.systemMessage).not.toContain(BASE_NARRATIVE_SYSTEM_PROMPT);
    expect(result.userMessage).toContain(OUTPUT_CONTRACT);
  });

  it("expresses response length as strong English guidance without an API cap", () => {
    const prompt = responseLengthPreference("zh", 512);

    expect(prompt).toContain("approximately 512 characters");
    expect(prompt).toContain("high-priority soft length preference");
    expect(prompt).toContain("0.75x to 1.5x");
    expect(prompt).toContain("not an API truncation limit");
  });
});
