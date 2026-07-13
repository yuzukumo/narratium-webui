import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";
import { LLMNodeTools } from "./LLMNodeTools";
import { NodeToolRegistry } from "../NodeTool";
import { ResponseUsageMetrics } from "@/lib/models/parsed-response";

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
    const modelId = input.modelId;
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
        modelId,
        temperature,
        language,
        maxTokens,
      },
    ) as { text: string; usage: ResponseUsageMetrics };

    return {
      llmResponse: llmResult.text,
      responseUsage: llmResult.usage,
      systemMessage,
      userMessage,
      modelId,
    };
  }
} 
