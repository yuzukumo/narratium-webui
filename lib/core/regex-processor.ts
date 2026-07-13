import {
  RegexPlacement,
  RegexReplacementResult,
  RegexScript,
} from "@/lib/models/regex-script-model";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";

export interface RegexProcessorOptions {
  ownerId: string;
  placement?: RegexPlacement;
  isMarkdown?: boolean;
  isPrompt?: boolean;
  isEdit?: boolean;
  depth?: number;
  protagonistName?: string;
  charName?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function substituteMacros(
  value: string,
  options: RegexProcessorOptions,
  escaped: boolean,
): string {
  const replacements: Record<string, string> = {
    user: options.protagonistName || "",
    char: options.charName || "",
  };
  return value.replace(/{{(user|char)}}/gi, (_match, key: string) => {
    const replacement = replacements[key.toLowerCase()] || "";
    return escaped ? escapeRegex(replacement) : replacement;
  });
}

function compileRegex(value: string): RegExp | null {
  const literal = value.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
  try {
    return literal ? new RegExp(literal[1], literal[2]) : new RegExp(value, "g");
  } catch {
    return null;
  }
}

function replacementForMatch(
  script: RegexScript,
  match: string,
  captures: unknown[],
  groups: Record<string, string> | undefined,
  options: RegexProcessorOptions,
): string {
  const trimStrings = script.trimStrings.map((item) => substituteMacros(item, options, false));
  const clean = (value: unknown) => {
    let result = typeof value === "string" ? value : "";
    for (const trimString of trimStrings) {
      result = result.split(trimString).join("");
    }
    return result;
  };
  const template = substituteMacros(script.replaceString || "", options, false)
    .replace(/{{match}}/gi, "$0");
  return template
    .replace(/\$<([^>]+)>/g, (_token, name: string) => clean(groups?.[name]))
    .replace(/\$(\d+)|\$&/g, (token, index: string | undefined) => (
      token === "$&" || index === "0" ? clean(match) : clean(captures[Number(index) - 1])
    ));
}

export class RegexProcessor {
  static applyScript(
    input: string,
    script: RegexScript,
    options: RegexProcessorOptions,
  ): string {
    const substitutionMode = Number(script.substituteRegex || 0);
    const pattern = substitutionMode === 0
      ? script.findRegex
      : substituteMacros(script.findRegex, options, substitutionMode === 2);
    const expression = compileRegex(pattern);
    if (!expression) return input;
    expression.lastIndex = 0;
    return input.replace(expression, (...args: unknown[]) => {
      const match = String(args[0]);
      const possibleGroups = args.at(-1);
      const hasGroups = possibleGroups && typeof possibleGroups === "object";
      const capturesEnd = hasGroups ? args.length - 3 : args.length - 2;
      return replacementForMatch(
        script,
        match,
        args.slice(1, capturesEnd),
        hasGroups ? possibleGroups as Record<string, string> : undefined,
        options,
      );
    });
  }

  static async processFullContext(
    fullContext: string,
    options: RegexProcessorOptions,
  ): Promise<RegexReplacementResult> {
    const result: RegexReplacementResult = {
      originalText: fullContext,
      replacedText: fullContext,
      appliedScripts: [],
      success: false,
    };
    const settings = await RegexScriptOperations.getRegexScriptSettings(options.ownerId);
    if (
      !settings.enabled
      || (options.isPrompt === true && !settings.applyToPrompt)
      || (options.isPrompt !== true && !settings.applyToResponse)
    ) {
      return result;
    }

    const placement = options.placement ?? RegexPlacement.AI_OUTPUT;
    const scripts = await RegexScriptOperations.getAllScriptsForProcessing(options.ownerId);
    let processed = fullContext;
    for (const script of scripts) {
      if (script.disabled || !script.findRegex) continue;
      if (!script.placement.includes(placement) && !script.placement.includes(999)) continue;
      if (options.isEdit && script.runOnEdit === false) continue;
      if (typeof options.depth === "number") {
        if (typeof script.minDepth === "number" && options.depth < script.minDepth) continue;
        if (typeof script.maxDepth === "number" && options.depth > script.maxDepth) continue;
      }
      // Unrestricted scripts run in both prompt and display contexts. The
      // flags narrow a script's scope; they do not opt it into a context.
      if (script.markdownOnly === true && options.isMarkdown !== true) continue;
      if (script.promptOnly === true && options.isPrompt !== true) continue;

      const next = this.applyScript(processed, script, options);
      if (next !== processed) {
        processed = next;
        result.appliedScripts.push(script.scriptKey);
      }
    }
    result.replacedText = processed;
    result.success = result.appliedScripts.length > 0;
    return result;
  }
}
