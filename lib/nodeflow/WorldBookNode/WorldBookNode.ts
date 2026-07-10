import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";
import { WorldBookNodeTools } from "./WorldBookNodeTools";
import { NodeToolRegistry } from "../NodeTool";

export class WorldBookNode extends NodeBase {
  static readonly nodeName = "worldBook";
  static readonly description = "Assembles world book content into system and user messages";
  static readonly version = "1.0.0";

  constructor(config: NodeConfig) {
    NodeToolRegistry.register(WorldBookNodeTools);
    super(config);
    this.toolClass = WorldBookNodeTools;
  }
  
  protected getDefaultCategory(): NodeCategory {
    return NodeCategory.MIDDLE;
  }

  protected async _call(input: NodeInput): Promise<NodeOutput> {
    const systemMessage = input.systemMessage;
    const userMessage = input.userMessage;
    const characterId = input.characterId;
    const language = input.language || "zh";
    const username = input.username;
    const charName = input.charName;
    const currentUserInput = input.currentUserInput || "";
    const contextWindow = input.contextWindow || 5;

    if (!systemMessage) {
      throw new Error("System message is required for WorldBookNode");
    }

    if (!characterId) {
      throw new Error("Character ID is required for WorldBookNode");
    }
    const result = await this.executeTool(
      "assemblePromptWithWorldBook",
      characterId,
      systemMessage,
      userMessage,
      currentUserInput,
      language,
      contextWindow,
      username,
      charName,
    ) as { systemMessage: string; userMessage: string };

    return {
      systemMessage: result.systemMessage,
      userMessage: result.userMessage,
      characterId,
      language,
      username,
      charName,
      contextWindow,
      currentUserInput,
    };
  }
} 
