import { NodeBase } from "@/lib/nodeflow/NodeBase";
import { NodeConfig, NodeInput, NodeOutput, NodeCategory } from "@/lib/nodeflow/types";

export class UserInputNode extends NodeBase {
  static readonly nodeName = "userInput";
  static readonly description = "Node for accepting user input during workflow execution";
  static readonly version = "1.0.0";

  constructor(config: NodeConfig) {
    super(config);
  }

  protected getDefaultCategory(): NodeCategory {
    return NodeCategory.ENTRY;
  }

  protected async beforeExecute(input: NodeInput): Promise<void> {
    await super.beforeExecute(input);
  }

  protected async afterExecute(output: NodeOutput): Promise<void> {
    await super.afterExecute(output);
  }

  protected async _call(input: NodeInput): Promise<NodeOutput> {
    return await super._call(input);
  }
}
