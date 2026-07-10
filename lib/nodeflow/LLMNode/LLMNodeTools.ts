import { NodeTool } from "@/lib/nodeflow/NodeTool";
import { invokeLLM as invokeLLMApi } from "@/utils/llm-api";
import { ApiProvider, DEFAULT_RESPONSE_LENGTH, ReasoningEffort } from "@/utils/api-config";

export interface LLMConfig {
  modelName: string;
  apiKey: string;
  baseUrl?: string;
  llmType?: ApiProvider;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  language?: "zh" | "en";
  reasoningEffort?: ReasoningEffort;
}
export class LLMNodeTools extends NodeTool {
  protected static readonly toolType: string = "llm";
  protected static readonly version: string = "1.0.0";

  static getToolType(): string {
    return this.toolType;
  }

  static async executeMethod(methodName: string, ...params: any[]): Promise<any> {
    const method = (this as any)[methodName];
    
    if (typeof method !== "function") {
      console.error(`Method lookup failed: ${methodName} not found in LLMNodeTools`);
      console.log("Available methods:", Object.getOwnPropertyNames(this).filter(name => 
        typeof (this as any)[name] === "function" && !name.startsWith("_"),
      ));
      throw new Error(`Method ${methodName} not found in ${this.getToolType()}Tool`);
    }

    try {
      this.logExecution(methodName, params);
      return await (method as Function).apply(this, params);
    } catch (error) {
      console.error(`Method execution failed: ${methodName}`, error);
      throw error;
    }
  }

  static async invokeLLM(
    systemMessage: string,
    userMessage: string,
    config: LLMConfig,
  ): Promise<Awaited<ReturnType<typeof invokeLLMApi>>> {
    try {
      return await invokeLLMApi({
        provider: config.llmType || "openai",
        baseUrl: config.baseUrl || "",
        apiKey: config.apiKey || "",
        model: config.modelName || "",
        systemMessage,
        userMessage,
        maxTokens: config.maxTokens || DEFAULT_RESPONSE_LENGTH,
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort,
      });
    } catch (error) {
      this.handleError(error as Error, "invokeLLM");
    }
  }
}
