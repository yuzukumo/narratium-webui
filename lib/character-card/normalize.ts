import type {
  CharacterBook,
  CharacterDepthPrompt,
  RawCharacterCardData,
  RawCharacterData,
} from "@/lib/models/rawdata-model";
import type { WorldBookEntry } from "@/lib/models/world-book-model";
import type { RegexScript } from "@/lib/models/regex-script-model";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function tagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string"
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedPosition(value: unknown, extensionValue: unknown): number {
  if (typeof extensionValue === "number" && Number.isInteger(extensionValue)) {
    return extensionValue;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_-]+/g, "") : "";
  switch (normalized) {
  case "beforechar":
  case "before":
    return 0;
  case "afterchar":
  case "after":
    return 1;
  case "antop":
    return 2;
  case "anbottom":
    return 3;
  case "atdepth":
  case "depth":
    return 4;
  case "emtop":
    return 5;
  case "embottom":
    return 6;
  case "outlet":
    return 7;
  default:
    return 1;
  }
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

export function normalizeWorldBookEntry(value: unknown, index = 0): WorldBookEntry {
  const source = record(value);
  const extensions = record(source.extensions);
  const keys = stringList(firstDefined(source.keys, source.key));
  const secondaryKeys = stringList(firstDefined(source.secondary_keys, source.keysecondary));
  const outletNameValue = firstDefined(source.outletName, source.outlet_name, extensions.outlet_name);
  const outletName = typeof outletNameValue === "string" ? outletNameValue.trim() : "";
  const role = firstDefined(source.role, extensions.role);
  const enabled = typeof source.enabled === "boolean"
    ? source.enabled
    : typeof source.disable === "boolean" ? !source.disable : true;
  const caseSensitive = firstDefined(source.case_sensitive, source.caseSensitive, extensions.case_sensitive, extensions.caseSensitive);
  const matchWholeWords = firstDefined(source.match_whole_words, source.matchWholeWords, extensions.match_whole_words, extensions.matchWholeWords);
  const useRegex = firstDefined(source.use_regex, source.useRegex, extensions.use_regex, extensions.useRegex);
  const probability = firstDefined(source.probability, extensions.probability);
  const useProbability = firstDefined(source.useProbability, extensions.useProbability);
  const selectiveLogic = firstDefined(source.selectiveLogic, extensions.selectiveLogic);
  const normalizedExtensions = {
    ...extensions,
    ...(typeof caseSensitive === "boolean" ? { case_sensitive: caseSensitive } : {}),
    ...(typeof matchWholeWords === "boolean" ? { match_whole_words: matchWholeWords } : {}),
    ...(typeof useRegex === "boolean" ? { use_regex: useRegex } : {}),
    ...(typeof probability === "number" ? { probability } : {}),
    ...(typeof useProbability === "boolean" ? { useProbability } : {}),
    ...(typeof selectiveLogic === "number" ? { selectiveLogic } : {}),
    ...(outletName ? { outlet_name: outletName } : {}),
    ...(typeof role === "number" ? { role } : {}),
  };

  return {
    ...source,
    id: typeof source.id === "number" ? source.id : index,
    content: text(source.content),
    keys,
    secondary_keys: secondaryKeys,
    selective: typeof source.selective === "boolean" ? source.selective : false,
    constant: typeof source.constant === "boolean" ? source.constant : false,
    position: normalizedPosition(source.position, extensions.position),
    ...(outletName ? { outletName } : {}),
    insertion_order: finiteNumber(source.insertion_order ?? source.order, 0),
    enabled,
    case_sensitive: typeof caseSensitive === "boolean"
      ? caseSensitive
      : undefined,
    use_regex: typeof useRegex === "boolean" ? useRegex : false,
    depth: finiteNumber(firstDefined(source.depth, source.scan_depth, extensions.depth), 4),
    comment: text(source.comment),
    extensions: normalizedExtensions,
  } as WorldBookEntry;
}

export function normalizeCharacterDepthPrompt(value: unknown): CharacterDepthPrompt | undefined {
  const source = record(value);
  const prompt = text(source.prompt);
  if (!prompt.trim()) {
    return undefined;
  }
  const configuredRole = text(source.role).toLowerCase();
  const role: CharacterDepthPrompt["role"] = configuredRole === "user" || configuredRole === "assistant"
    ? configuredRole
    : "system";
  return {
    prompt,
    depth: Math.max(0, Math.trunc(finiteNumber(source.depth, 4))),
    role,
  };
}

function normalizeCharacterBook(value: unknown): CharacterBook | undefined {
  const source = record(value);
  const extensions = record(source.extensions);
  if (!("entries" in source)) {
    return undefined;
  }
  const sourceEntries = source.entries;
  const entries = Array.isArray(sourceEntries)
    ? sourceEntries.map(normalizeWorldBookEntry)
    : Object.fromEntries(Object.entries(record(sourceEntries)).map(([key, entry], index) => [
      key,
      normalizeWorldBookEntry(entry, index),
    ]));
  return {
    ...source,
    scan_depth: (() => {
      const value = firstDefined(source.scan_depth, source.scanDepth, extensions.scan_depth, extensions.scanDepth);
      return value === undefined ? undefined : Math.max(0, Math.trunc(finiteNumber(value, 0)));
    })(),
    token_budget: (() => {
      const value = firstDefined(source.token_budget, source.tokenBudget, extensions.token_budget, extensions.tokenBudget);
      return value === undefined ? undefined : Math.max(0, Math.trunc(finiteNumber(value, 0)));
    })(),
    recursive_scanning: typeof firstDefined(source.recursive_scanning, source.recursiveScanning, extensions.recursive_scanning, extensions.recursiveScanning) === "boolean"
      ? firstDefined(source.recursive_scanning, source.recursiveScanning, extensions.recursive_scanning, extensions.recursiveScanning) as boolean
      : undefined,
    entries,
    extensions: { ...record(source.extensions) },
  } as CharacterBook;
}

export function normalizeCharacterCard(value: unknown): RawCharacterData {
  const source = record(value);
  const nested = record(source.data);
  const field = (key: string) => text(nested[key] ?? source[key]);
  const name = field("name").trim();
  if (!name) {
    throw new Error("Character card is missing data.name.");
  }

  const characterBook = normalizeCharacterBook(nested.character_book ?? source.character_book);
  const extensions = {
    ...record(source.extensions),
    ...record(nested.extensions),
  };
  const depthPrompt = normalizeCharacterDepthPrompt(extensions.depth_prompt);
  const data: RawCharacterCardData = {
    ...nested,
    name,
    description: field("description"),
    personality: field("personality"),
    first_mes: field("first_mes"),
    scenario: field("scenario"),
    mes_example: field("mes_example"),
    creator_notes: field("creator_notes") || text(source.creatorcomment),
    system_prompt: field("system_prompt"),
    post_history_instructions: field("post_history_instructions"),
    alternate_greetings: stringList(nested.alternate_greetings ?? source.alternate_greetings),
    group_only_greetings: stringList(nested.group_only_greetings ?? source.group_only_greetings),
    tags: tagList(nested.tags ?? source.tags),
    creator: field("creator"),
    character_version: field("character_version"),
    extensions,
    ...(depthPrompt ? { depth_prompt: depthPrompt } : {}),
    ...(characterBook ? { character_book: characterBook } : {}),
  };

  const spec = text(source.spec);
  const specVersion = text(source.spec_version);
  return {
    ...source,
    ...(spec ? { spec } : { spec: "chara_card_v2" }),
    ...(specVersion ? { spec_version: specVersion } : { spec_version: "2.0" }),
    name,
    description: data.description,
    personality: data.personality,
    first_mes: data.first_mes,
    scenario: data.scenario,
    mes_example: data.mes_example,
    creatorcomment: text(source.creatorcomment) || data.creator_notes,
    avatar: text(source.avatar),
    data,
  } as RawCharacterData;
}

export function normalizeRegexScript(value: unknown, index = 0): RegexScript | null {
  const source = record(value);
  const findRegex = text(firstDefined(source.findRegex, source.find_regex));
  if (!findRegex) {
    return null;
  }
  const rawPlacement = firstDefined(source.placement, source.placements);
  const placement = Array.isArray(rawPlacement)
    ? rawPlacement.map((item) => typeof item === "string" ? Number(item) : item)
      .filter((item): item is number => typeof item === "number" && Number.isInteger(item))
    : typeof rawPlacement === "number" && Number.isInteger(rawPlacement)
      ? [rawPlacement]
      : [2];
  return {
    ...source,
    scriptKey: text(source.scriptKey) || text(source.id) || `script_${index}`,
    id: text(source.id) || undefined,
    scriptName: text(source.scriptName) || text(source.id) || `Script ${index + 1}`,
    findRegex,
    replaceString: source.replaceString === null || source.replace_string === null
      ? null
      : text(firstDefined(source.replaceString, source.replace_string)),
    trimStrings: stringList(source.trimStrings),
    placement,
    disabled: source.disabled === true,
    markdownOnly: source.markdownOnly === true,
    promptOnly: source.promptOnly === true,
    runOnEdit: source.runOnEdit !== false,
    substituteRegex: finiteNumber(source.substituteRegex, 0),
    minDepth: typeof source.minDepth === "number" ? source.minDepth : null,
    maxDepth: typeof source.maxDepth === "number" ? source.maxDepth : null,
    extensions: { ...record(source.extensions) },
  };
}

export function embeddedRegexScripts(card: RawCharacterData): RegexScript[] {
  const scripts = card.data.extensions.regex_scripts;
  const entries = Array.isArray(scripts) ? scripts : Object.values(record(scripts));
  return entries
    .map(normalizeRegexScript)
    .filter((script): script is RegexScript => script !== null);
}
