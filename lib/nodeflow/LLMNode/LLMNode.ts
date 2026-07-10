import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";
import { LLMNodeTools } from "./LLMNodeTools";
import { NodeToolRegistry } from "../NodeTool";
import { ResponseUsageMetrics } from "@/lib/models/parsed-response";
import { ApiProvider } from "@/utils/api-config";

export class LLMNode extends NodeBase {
  static readonly nodeName = "llm";
  static readonly description = "Handles LLM requests and responses";
  static readonly version = "1.0.0";

  constructor(config: NodeConfig) {
    NodeToolRegistry.register(LLMNodeTools);
    super(config);
    this.toolClass = LLMNodeTools;
  }
  
  protected getDefaultCategory(): NodeCategory {
    return NodeCategory.MIDDLE;
  }

  protected async _call(input: NodeInput): Promise<NodeOutput> {    
    const systemMessage = input.systemMessage;
    const userMessage = input.userMessage;
    const modelName = input.modelName;
    const apiKey = input.apiKey;
    const baseUrl = input.baseUrl;
    const llmType = (input.llmType || "openai") as ApiProvider;
    const temperature = input.temperature;
    const language = input.language || "zh";
    const maxTokens = input.number;

    if (!systemMessage) {
      throw new Error("System message is required for LLMNode");
    }

    if (!userMessage) { 
      throw new Error("User message is required for LLMNode");
    }

    const llmResult = await this.executeTool(
      "invokeLLM",
      systemMessage,
      userMessage,
      {
        modelName,
        apiKey,
        baseUrl,
        llmType,
        temperature,
        language,
        maxTokens,
        reasoningEffort: input.reasoningEffort,
      },
    ) as { text: string; usage: ResponseUsageMetrics };

    return {
      llmResponse: llmResult.text,
      responseUsage: llmResult.usage,
      systemMessage,
      userMessage,
      modelName,
      llmType,
    };
  }
} 
