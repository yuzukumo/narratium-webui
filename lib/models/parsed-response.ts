export interface ResponseUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface ParsedResponse {
  regexResult?: string;
  nextPrompts?: string[];
  compressedContent?: string;
  usage?: ResponseUsageMetrics;
}
