import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";
import { DialogueMessage } from "@/lib/models/character-dialogue-model";
import { ContextNodeTools } from "./ContextNodeTools";
import { NodeToolRegistry } from "../NodeTool";

export class ContextNode extends NodeBase {
  static readonly nodeName = "context";
  static readonly description = "Assembles chat history and system messages";
  static readonly version = "1.0.0";

  constructor(config: NodeConfig) {
    NodeToolRegistry.register(ContextNodeTools);
    super(config);
    this.toolClass = ContextNodeTools;
  }

  protected getDefaultCategory(): NodeCategory {
    return NodeCategory.MIDDLE;
  }

  protected async _call(input: NodeInput): Promise<NodeOutput> {
    const userMessage = input.userMessage;
    const characterId = input.characterId;
    const memoryLength = input.memoryLength || 10;

    if (!userMessage) {
      throw new Error("User message is required for ContextNode");
    }

    if (!characterId) {
      throw new Error("Character ID is required for ContextNode");
    }

    const result = await this.executeTool(
      "assembleChatHistory",
      userMessage,
      characterId,
      memoryLength,
    ) as { userMessage: string; messages: DialogueMessage[] };

    return {
      userMessage: result.userMessage,
      characterId,
      memoryLength,
    };
  }
} 
