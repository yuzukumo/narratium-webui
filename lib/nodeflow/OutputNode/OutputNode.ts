import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";

export class OutputNode extends NodeBase {
  static readonly nodeName = "output";
  static readonly description = "Standard output node for workflow results";
  static readonly version = "1.0.0";

  constructor(config: NodeConfig) {
    super(config);
  }
  
  protected getDefaultCategory(): NodeCategory {
    return NodeCategory.EXIT;
  }

  protected async _call(input: NodeInput): Promise<NodeOutput> {
    return await super._call(input);
  }
} 
