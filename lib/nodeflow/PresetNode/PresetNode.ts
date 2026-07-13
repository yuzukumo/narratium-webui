import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";
import { PresetNodeTools } from "./PresetNodeTools";
import { NodeToolRegistry } from "../NodeTool";

export class PresetNode extends NodeBase {
  static readonly nodeName = "preset";
  static readonly description = "Applies preset prompts to the conversation";
  static readonly version = "1.0.0";

  constructor(config: NodeConfig) {
    NodeToolRegistry.register(PresetNodeTools);
    super(config);
    this.toolClass = PresetNodeTools;
  }
  
  protected getDefaultCategory(): NodeCategory {
    return NodeCategory.MIDDLE;
  }

  protected async _call(input: NodeInput): Promise<NodeOutput> {
    const characterId = input.characterId;
    const language = input.language || "zh";
    const charName = input.charName;
    const number = input.number;

    if (!characterId) {
      throw new Error("Character ID is required for PresetNode");
    }

    const result = await this.executeTool(
      "buildPromptFramework",
      characterId,
      language,
      charName,
      number,
    ) as { systemMessage: string; userMessage: string; presetId?: string; protagonistName: string; characterName: string };

    return {
      systemMessage: result.systemMessage,
      userMessage: result.userMessage,
      presetId: result.presetId,
      protagonistName: result.protagonistName,
      characterName: result.characterName,
    };
  }
} 
 
