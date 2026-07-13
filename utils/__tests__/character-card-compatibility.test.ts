import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { parseCharacterBundle, parseCharacterCard, writeCharacterToPng } from "@/utils/character-parser";
import {
  embeddedRegexScripts,
  normalizeCharacterCard,
  normalizeRegexScript,
  normalizeWorldBookEntry,
} from "@/lib/character-card/normalize";
import { Character } from "@/lib/core/character";
import { RegexProcessor } from "@/lib/core/regex-processor";
import { RegexPlacement, type RegexScript } from "@/lib/models/regex-script-model";
import { WorldBookManager } from "@/lib/core/world-book";
import { PresetNodeTools } from "@/lib/nodeflow/PresetNode/PresetNodeTools";
import { PromptAssembler } from "@/lib/core/prompt-assembler";
import { adaptText } from "@/lib/adapter/tagReplacer";
import { validateWorldBookJson } from "@/function/worldbook/import";
import { validateRegexScriptJson } from "@/function/regex/import";
import { selectCanonicalPromptOrder } from "@/lib/data/preset-operation";

async function fixtureCard() {
  const buffer = await readFile(path.join(process.cwd(), "Where_Stars_Are_Tombs_2.3.png"));
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const file = new File([bytes], "Where_Stars_Are_Tombs_2.3.png", { type: "image/png" });
  return normalizeCharacterCard(JSON.parse(await parseCharacterCard(file)));
}

const hasExternalFixture = existsSync(path.join(process.cwd(), "Where_Stars_Are_Tombs_2.3.png"));

describe("SillyTavern character card compatibility", () => {
  it.skipIf(!hasExternalFixture)("reads the real V3 fixture and preserves embedded extensions", async () => {
    const card = await fixtureCard();
    expect(card.spec).toBe("chara_card_v3");
    expect(card.spec_version).toBe("3.0");
    expect(card.data.name).toBe("《星辰为冢》Where_Stars_Are_Tombs_2.3");
    expect(Array.isArray(card.data.character_book?.entries)).toBe(true);
    expect(Object.values(card.data.character_book?.entries || {})).toHaveLength(3);
    expect(embeddedRegexScripts(card)).toHaveLength(4);
  });

  it.skipIf(!hasExternalFixture)("keeps the primary greeting before alternate greetings", async () => {
    const card = await fixtureCard();
    const character = new Character({
      id: "fixture",
      data: card,
      imagePath: "fixture.png",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    });
    const greetings = await character.getFirstMessage();
    expect(greetings).toHaveLength(2);
    expect(greetings[0]).toContain("DnerhyYH");
    expect(greetings[1]).toContain("【始开事故】");
  });

  it("preserves disabled entries and SillyTavern position values", () => {
    const entry = normalizeWorldBookEntry({
      content: "hidden",
      keys: ["star"],
      enabled: false,
      position: "after_char",
      extensions: { position: 3, depth: 5 },
    });
    expect(entry.enabled).toBe(false);
    expect(entry.position).toBe(3);
    expect(entry.depth).toBe(5);
    expect(WorldBookManager.getMatchingEntries([entry], "star", [])).toEqual([]);
  });

  it("preserves advanced SillyTavern world-book extensions", () => {
    const entry = normalizeWorldBookEntry({
      uid: 42,
      key: ["star"],
      keysecondary: ["tomb"],
      content: "Advanced lore",
      selective: true,
      extensions: {
        selectiveLogic: 3,
        exclude_recursion: true,
        prevent_recursion: true,
        delay_until_recursion: 2,
        group: "location",
        group_override: true,
        group_weight: 75,
        scan_depth: 9,
        sticky: 3,
        cooldown: 2,
        delay: 1,
        match_character_description: true,
        foreign_extension: { retained: true },
      },
    });
    expect(entry.keys).toEqual(["star"]);
    expect(entry.secondary_keys).toEqual(["tomb"]);
    expect(entry.extensions).toMatchObject({
      exclude_recursion: true,
      prevent_recursion: true,
      delay_until_recursion: 2,
      group: "location",
      group_weight: 75,
      scan_depth: 9,
      sticky: 3,
      cooldown: 2,
      delay: 1,
      match_character_description: true,
      foreign_extension: { retained: true },
    });
  });

  it("preserves SillyTavern regex execution options", () => {
    const script = normalizeRegexScript({
      id: "regex-id",
      scriptName: "Advanced regex",
      findRegex: "/TARGET/s",
      replaceString: "$1",
      trimStrings: ["trim"],
      placement: [1, 2],
      disabled: true,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 2,
      minDepth: 2,
      maxDepth: 8,
      extensions: { foreign_extension: true },
    });
    expect(script).toMatchObject({
      id: "regex-id",
      scriptName: "Advanced regex",
      placement: [1, 2],
      disabled: true,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 2,
      minDepth: 2,
      maxDepth: 8,
      extensions: { foreign_extension: true },
    });
  });

  it("runs unrestricted regex scripts in both prompt and display contexts", () => {
    const script: RegexScript = {
      scriptKey: "unrestricted",
      scriptName: "Unrestricted",
      findRegex: "TARGET",
      replaceString: "replacement",
      trimStrings: [],
      placement: [RegexPlacement.AI_OUTPUT],
    };

    expect(RegexProcessor.applyScript("TARGET", script, {
      ownerId: "fixture",
      placement: RegexPlacement.AI_OUTPUT,
      isPrompt: true,
    })).toBe("replacement");
    expect(RegexProcessor.applyScript("TARGET", script, {
      ownerId: "fixture",
      placement: RegexPlacement.AI_OUTPUT,
      isMarkdown: true,
    })).toBe("replacement");
  });

  it.skipIf(!hasExternalFixture)("supports dotAll regex and separates display scripts from prompt scripts", async () => {
    const card = await fixtureCard();
    const scripts = embeddedRegexScripts(card);
    const statusScript = scripts.find((script) => script.scriptName === "状态栏");
    expect(statusScript).toBeDefined();
    const status: RegexScript = {
      ...statusScript!,
      scriptKey: "status",
      trimStrings: [],
      disabled: false,
    };
    const input = "<statusblock>\n地点:舰桥\n时间:清晨\n船员状态:\n科学官正常\n总工程师正常\n医疗官正常\n剧情摘要:启航\n1.前进\n2.等待\n3.返航</statusblock>";
    const rendered = RegexProcessor.applyScript(input, status, {
      ownerId: "fixture",
      placement: RegexPlacement.AI_OUTPUT,
      isMarkdown: true,
    });
    expect(rendered).toContain("舰桥");
    expect(rendered).not.toContain("<statusblock>");

    const promptScript = scripts.find((script) => script.scriptName === "删除正文");
    expect(promptScript).toBeDefined();
    const promptOnly: RegexScript = {
      ...promptScript!,
      scriptKey: "prompt",
      trimStrings: [],
      disabled: false,
    };
    expect(RegexProcessor.applyScript("<content>secret</content>", promptOnly, {
      ownerId: "fixture",
      placement: RegexPlacement.AI_OUTPUT,
      isPrompt: true,
    })).toBe("");
  });

  it("retains unknown V3 fields for future round trips", () => {
    const card = normalizeCharacterCard({
      spec: "chara_card_v3",
      spec_version: "3.1",
      custom_root: { retained: true },
      data: { name: "Test", custom_extension: { retained: true } },
    });
    expect(card.custom_root).toEqual({ retained: true });
    expect(card.data.custom_extension).toEqual({ retained: true });
  });

  it("normalizes legacy V1 fields without discarding foreign data", () => {
    const card = normalizeCharacterCard({
      name: "Legacy",
      description: "Root description",
      first_mes: "Hello",
      alternate_greetings: "Second greeting",
      tags: "one, two",
      creatorcomment: "Legacy notes",
      group_only_greetings: "Group greeting",
      extensions: {
        regex_scripts: [{
          id: "legacy-script",
          findRegex: "TARGET",
          replaceString: "replacement",
          placement: [2],
        }],
      },
      foreign_setting: { retained: true },
    });

    expect(card.spec).toBe("chara_card_v2");
    expect(card.data.description).toBe("Root description");
    expect(card.data.alternate_greetings).toEqual(["Second greeting"]);
    expect(card.data.tags).toEqual(["one", "two"]);
    expect(card.data.group_only_greetings).toEqual(["Group greeting"]);
    expect(card.data.creator_notes).toBe("Legacy notes");
    expect(embeddedRegexScripts(card)).toHaveLength(1);
    expect(card.foreign_setting).toEqual({ retained: true });
  });

  it("uses nested V2/V3 fields and adapts the character depth prompt", () => {
    const card = normalizeCharacterCard({
      name: "Stale root name",
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Nested name",
        system_prompt: "System for {{user}} and {{char}}",
        post_history_instructions: "Remember {{user}}",
        extensions: {
          depth_prompt: { prompt: "Protect {{user}}", depth: "3", role: "assistant" },
        },
      },
    });
    const character = new Character({
      id: "depth",
      protagonistName: "Alice",
      data: card,
      imagePath: "depth.png",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    });
    const adapted = character.getData("en");

    expect(adapted.name).toBe("Nested name");
    expect(adapted.system_prompt).toBe("System for Alice and Nested name");
    expect(adapted.post_history_instructions).toBe("Remember Alice");
    expect(adapted.depth_prompt).toEqual({
      prompt: "Protect Alice",
      depth: 3,
      role: "assistant",
    });

    const injected = PresetNodeTools.injectCharacterCardPrompts(
      "<main></main>",
      "<dialogueExamples></dialogueExamples><chatHistory>{{chatHistory}}</chatHistory><userInput></userInput>",
      adapted,
    );
    expect(injected.userMessage).toContain(
      "<characterDepthPrompt role=\"assistant\" depth=\"3\">\nProtect Alice\n</characterDepthPrompt>",
    );
  });

  it("uses the imported protagonist name in world books and regex macros", () => {
    const worldBook = normalizeWorldBookEntry({
      content: "{{user}} meets {{char}}",
      constant: true,
      position: 0,
    });
    const assembled = new PromptAssembler({ language: "en" }).assemblePrompt(
      [worldBook],
      "{{worldInfoBefore}}",
      "<userInput>{{userInput}}</userInput>",
      [],
      "Hello",
      "Alice",
      "Nova",
    );
    expect(assembled.systemMessage).toContain("Alice meets Nova");

    const script: RegexScript = {
      scriptKey: "protagonist-macro",
      scriptName: "Protagonist macro",
      findRegex: "TARGET",
      replaceString: "{{user}} meets {{char}}",
      trimStrings: [],
      placement: [RegexPlacement.AI_OUTPUT],
    };
    expect(RegexProcessor.applyScript("TARGET", script, {
      ownerId: "fixture",
      placement: RegexPlacement.AI_OUTPUT,
      protagonistName: "Alice",
      charName: "Nova",
    })).toBe("Alice meets Nova");
  });

  it("expands deterministic SillyTavern content macros and preserves unknown macros", () => {
    const result = adaptText(
      "<USER> and <BOT>: {{description}} / {{personality}} / {{scenario}} / {{lastMessage}} / {{random::a::b}}",
      "en",
      "Alice",
      "Nova",
      {
        description: "Navigator",
        personality: "Careful",
        scenario: "Deep space",
        lastMessage: "Hold course",
      },
    );
    expect(result).toMatch(/^Alice and Nova: Navigator \/ Careful \/ Deep space \/ Hold course \/ [ab]$/);
    expect(result).toBe(adaptText(
      "<USER> and <BOT>: {{description}} / {{personality}} / {{scenario}} / {{lastMessage}} / {{random::a::b}}",
      "en",
      "Alice",
      "Nova",
      {
        description: "Navigator",
        personality: "Careful",
        scenario: "Deep space",
        lastMessage: "Hold course",
      },
    ));
  });

  it("uses per-entry scan depth and opt-in character fields for world-book activation", () => {
    const shallow = normalizeWorldBookEntry({
      keys: ["old signal"],
      content: "Too old",
      extensions: { scan_depth: 1 },
    });
    const characterMatch = normalizeWorldBookEntry({
      keys: ["astronomer"],
      content: "Character lore",
      extensions: { match_character_description: true },
    });
    const history = [
      { role: "user" as const, content: "old signal", id: 1 },
      { role: "assistant" as const, content: "new reply", id: 2 },
    ];
    expect(WorldBookManager.getMatchingEntries([shallow], "continue", history)).toEqual([]);
    expect(WorldBookManager.getMatchingEntries(
      [characterMatch],
      "continue",
      history,
      { scanSources: { characterDescription: "An astronomer aboard the ship" } },
    )).toEqual([characterMatch]);
  });

  it("treats scan depth zero as current input only", () => {
    const entry = normalizeWorldBookEntry({
      keys: ["old signal"],
      content: "Activated lore",
      extensions: { scan_depth: 0 },
    });
    const history = [{ role: "assistant" as const, content: "old signal", id: 1 }];

    expect(WorldBookManager.getMatchingEntries([entry], "continue", history)).toEqual([]);
    expect(WorldBookManager.getMatchingEntries([entry], "old signal", history)).toEqual([entry]);
  });

  it("preserves an explicit character-book scan depth of zero", () => {
    const card = normalizeCharacterCard({
      data: {
        name: "Zero depth",
        character_book: { scan_depth: 0, entries: [] },
      },
    });
    expect(card.data.character_book?.scan_depth).toBe(0);
  });

  it("injects every SillyTavern world-book position at its intended anchor", () => {
    const entry = (position: number, content: string, extra: Record<string, unknown> = {}) => (
      normalizeWorldBookEntry({ constant: true, position, content, ...extra })
    );
    const entries = [
      entry(0, "BEFORE_CHARACTER"),
      entry(1, "AFTER_CHARACTER"),
      entry(2, "AN_TOP_VALUE"),
      entry(3, "AN_BOTTOM_VALUE"),
      entry(4, "AT_DEPTH", { depth: 2, extensions: { role: 2 } }),
      entry(5, "EM_TOP_VALUE"),
      entry(6, "EM_BOTTOM_VALUE"),
      entry(7, "OUTLET_VALUE", { extensions: { outlet_name: "status" } }),
    ];
    const assembled = new PromptAssembler({ language: "en" }).assemblePrompt(
      entries,
      "{{worldInfoBefore}}\n<character>CHARACTER</character>\n{{worldInfoAfter}}\n{{outlet::status}}",
      [
        "<dialogueExamples>EXAMPLE_BODY</dialogueExamples>",
        "<chatHistory>Recent story transcript (verbatim):\n[TURN 1]\nUser: old\nCharacter: old reply\n\n[TURN 2]\nUser: latest\nCharacter: latest reply</chatHistory>",
        "<postHistoryInstructions>AUTHOR_NOTE_BODY</postHistoryInstructions>",
        "<userInput>continue</userInput>",
      ].join("\n"),
      [],
      "continue",
      "Alice",
      "Nova",
    );

    expect(assembled.systemMessage.indexOf("BEFORE_CHARACTER"))
      .toBeLessThan(assembled.systemMessage.indexOf("CHARACTER"));
    expect(assembled.systemMessage.indexOf("AFTER_CHARACTER"))
      .toBeGreaterThan(assembled.systemMessage.indexOf("CHARACTER"));
    expect(assembled.systemMessage).toContain("OUTLET_VALUE");
    expect(assembled.systemMessage).not.toContain("{{outlet::");
    expect(assembled.userMessage.indexOf("AN_TOP_VALUE"))
      .toBeLessThan(assembled.userMessage.indexOf("AUTHOR_NOTE_BODY"));
    expect(assembled.userMessage.indexOf("AN_BOTTOM_VALUE"))
      .toBeGreaterThan(assembled.userMessage.indexOf("AUTHOR_NOTE_BODY"));
    expect(assembled.userMessage.indexOf("EM_TOP_VALUE"))
      .toBeLessThan(assembled.userMessage.indexOf("EXAMPLE_BODY"));
    expect(assembled.userMessage.indexOf("EM_BOTTOM_VALUE"))
      .toBeGreaterThan(assembled.userMessage.indexOf("EXAMPLE_BODY"));
    expect(assembled.userMessage.indexOf("AT_DEPTH"))
      .toBeLessThan(assembled.userMessage.indexOf("[TURN 2]"));
    expect(assembled.userMessage).toContain("role=\"assistant\"");
  });

  it("accepts SillyTavern world-book and regex wrapper variants", () => {
    expect(validateWorldBookJson({ entries: { 0: { keys: ["star"] } } }).valid).toBe(true);
    expect(validateWorldBookJson({ world_book: [{ key: ["star"] }] }).valid).toBe(true);
    expect(validateWorldBookJson({ key: ["star"], content: "Single entry" }).valid).toBe(true);
    expect(validateRegexScriptJson({
      regex_scripts: { remove: { find_regex: "TARGET", replace_string: "" } },
    }).valid).toBe(true);
    expect(validateRegexScriptJson({
      remove: { findRegex: "TARGET", replaceString: "" },
    }).valid).toBe(true);
  });

  it("selects the canonical non-persona SillyTavern prompt order", () => {
    const canonical = selectCanonicalPromptOrder([
      { character_id: 100001, order: [{ identifier: "personaDescription" }] },
      { character_id: 100000, order: [{ identifier: "main" }] },
    ]);
    expect(canonical?.character_id).toBe(100000);
    expect(canonical?.order?.map((item) => item.identifier)).toEqual(["main"]);

    const direct = selectCanonicalPromptOrder([
      { identifier: "main", enabled: true },
      { identifier: "chatHistory", enabled: true },
    ]);
    expect(direct?.order?.map((item) => item.identifier)).toEqual(["main", "chatHistory"]);
  });

  it("recognizes SillyTavern regex-literal world-book keys", () => {
    const literal = normalizeWorldBookEntry({
      keys: ["/star\\s+tomb/i"],
      content: "Regex lore",
    });
    expect(WorldBookManager.getMatchingEntries([literal], "A STAR tomb", [])).toEqual([literal]);
    expect(WorldBookManager.getMatchingEntries([literal], "starship", [])).toEqual([]);
  });

  it("honors standard world-book case sensitivity, recursion, and token budgets", () => {
    const initial = normalizeWorldBookEntry({
      id: 1,
      keys: ["Star"],
      content: "The hidden key is nebula.",
      case_sensitive: true,
      insertion_order: 1,
    });
    const recursive = normalizeWorldBookEntry({
      id: 2,
      keys: ["nebula"],
      content: "Recursive lore",
      insertion_order: 2,
    });

    expect(WorldBookManager.getMatchingEntries([initial], "star", [])).toEqual([]);
    expect(WorldBookManager.getMatchingEntries([initial], "Star", [])).toEqual([initial]);
    expect(WorldBookManager.getMatchingEntries([initial, recursive], "Star", [])).toEqual([initial]);
    expect(WorldBookManager.getMatchingEntries(
      [initial, recursive],
      "Star",
      [],
      { recursiveScanning: true },
    )).toEqual([initial, recursive]);
    expect(WorldBookManager.getMatchingEntries(
      [initial, recursive],
      "Star",
      [],
      { recursiveScanning: true, tokenBudget: 12 },
    )).toEqual([initial]);
  });

  it.skipIf(!hasExternalFixture)("writes compatible chara and ccv3 chunks and reads V3 first", async () => {
    const fixture = await readFile(path.join(process.cwd(), "Where_Stars_Are_Tombs_2.3.png"));
    const source = new File([fixture], "source.png", { type: "image/png" });
    const payload = normalizeCharacterCard({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Round trip", custom_data: "retained" },
    });
    const written = await writeCharacterToPng(source, JSON.stringify(payload));
    const parsed = JSON.parse(await parseCharacterCard(
      new File([written], "round-trip.png", { type: "image/png" }),
    ));

    expect(parsed.spec).toBe("chara_card_v3");
    expect(parsed.spec_version).toBe("3.0");
    expect(parsed.data.name).toBe("Round trip");
    expect(parsed.data.custom_data).toBe("retained");
  });

  it("imports a CharX card and its embedded assets", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "CharX character",
        assets: [
          { type: "icon", name: "main", ext: "apng", uri: "__asset:assets/icon.apng" },
          { type: "background", name: "bridge", ext: "webp", uri: "embedded://assets/bridge.webp" },
        ],
      },
    };
    const archive = zipSync({
      "card.json": new TextEncoder().encode(JSON.stringify(card)),
      "assets/icon.apng": new Uint8Array([137, 80, 78, 71]),
      "assets/bridge.webp": new Uint8Array([82, 73, 70, 70]),
    });
    const bundle = await parseCharacterBundle(new File([archive], "character.charx"));
    expect(JSON.parse(bundle.data).data.name).toBe("CharX character");
    expect(bundle.image?.type).toBe("image/apng");
    expect(bundle.imageExtension).toBe("apng");
    expect(bundle.assets.map((asset) => asset.sourcePath)).toEqual([
      "assets/icon.apng",
      "assets/bridge.webp",
    ]);
  });

  it("rejects unsafe paths referenced by CharX assets", async () => {
    const card = {
      spec: "chara_card_v3",
      data: {
        name: "Unsafe",
        assets: [{ type: "icon", uri: "embedded://../icon.png" }],
      },
    };
    const archive = zipSync({
      "card.json": new TextEncoder().encode(JSON.stringify(card)),
      "icon.png": new Uint8Array([1]),
    });
    await expect(parseCharacterBundle(new File([archive], "unsafe.charx")))
      .rejects.toThrow("unsafe asset path");
  });
});
