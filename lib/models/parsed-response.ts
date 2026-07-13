export interface ResponseUsageMetrics {
  costMicrousd?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  durationMs: number;
  firstTokenMs: number;
  tokensPerSecond: number;
}

export interface ContextCompactionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costMicrousd?: string;
  requestCount: number;
}

export interface ContextSummarySnapshot {
  version: 2;
  format: "narrative-continuation-v2";
  coveredNodeIds: string[];
  pathHash: string;
  sourceHash: string;
  content: string;
  verbatimEvidence: string;
  sourceTokenEstimate: number;
  summaryTokenEstimate: number;
  modelId: string;
  generation: number;
  compactionUsage: ContextCompactionUsage;
  createdAt: string;
}

export interface ParsedResponse {
  regexResult?: string;
  nextPrompts?: string[];
  promptDirectives?: string[];
  alternativeIndex?: number;
  alternativeCount?: number;
  alternativeNodeIds?: string[];
  compressedContent?: string;
  usage?: ResponseUsageMetrics;
  modelId?: string;
  modelName?: string;
  contextSummary?: ContextSummarySnapshot;
}
