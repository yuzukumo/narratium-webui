import { NodeContext } from "../nodeflow/NodeContext";
import { WorkflowEngine } from "../nodeflow/WorkflowEngine";
import { NodeCategory } from "../nodeflow/types";

export interface WorkflowConfig {
  id: string;
  name: string;
  nodes: WorkflowNode[];
}

export interface WorkflowNode {
  id: string;
  name: string;
  category: NodeCategory;
  next: string[];
  initParams: string[];
  inputFields: string[];
  outputFields: string[];
  inputMapping?: Record<string, string>;
}

export interface WorkflowParams {
  [key: string]: any;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export abstract class BaseWorkflow {
  protected config: WorkflowConfig;
  protected registry: { [key: string]: any };
  protected context: NodeContext;

  constructor() {
    this.context = new NodeContext();
    this.registry = this.getNodeRegistry();
    this.config = this.getWorkflowConfig();
    this.validateWorkflowConfig();
  }

  protected abstract getNodeRegistry(): { [key: string]: any };
  protected abstract getWorkflowConfig(): WorkflowConfig;

  protected validateWorkflowConfig(): void {
    const { nodes } = this.config;
    
    const availableOutputs = new Set<string>();
    
    nodes.forEach((node, index) => {
      if (node.category === NodeCategory.ENTRY) {
        this.validateEntryNode(node);
      } else {
        this.validateInputFields(node, availableOutputs);
      }

      node.outputFields.forEach(field => availableOutputs.add(field));

      this.validateNodeConnections(node, index, nodes);
    });

    this.validateNodeCategories(nodes);
  }

  private validateEntryNode(node: WorkflowNode): void {
    if (node.inputFields.length > 0) {
      throw new ValidationError(
        `Entry node '${node.id}' must have empty input fields, but got: ${node.inputFields.join(", ")}`,
      );
    }

    const outputSet = new Set(node.outputFields);
    const initParamSet = new Set(node.initParams);

    if (outputSet.size !== initParamSet.size) {
      throw new ValidationError(
        `Entry node '${node.id}' output fields must match init params in size`,
      );
    }

    node.initParams.forEach(param => {
      if (!outputSet.has(param)) {
        throw new ValidationError(
          `Entry node '${node.id}' output fields must contain init param: ${param}`,
        );
      }
    });
  }

  private validateInputFields(node: WorkflowNode, availableOutputs: Set<string>): void {
    node.inputFields.forEach(field => {
      if (!availableOutputs.has(field)) {
        throw new ValidationError(
          `Node '${node.id}' requires input field '${field}' which is not available from previous nodes. Available fields: ${Array.from(availableOutputs).join(", ")}`,
        );
      }
    });
  }

  private validateNodeConnections(node: WorkflowNode, index: number, nodes: WorkflowNode[]): void {
    node.next.forEach(nextNodeId => {
      const nextNode = nodes.find(n => n.id === nextNodeId);
      if (!nextNode) {
        throw new ValidationError(
          `Node '${node.id}' references non-existent next node: ${nextNodeId}`,
        );
      }
    });

    if (node.category === NodeCategory.EXIT && node.next.length > 0) {
      throw new ValidationError(
        `Exit node '${node.id}' should not have next nodes`,
      );
    }
  }

  private validateNodeCategories(nodes: WorkflowNode[]): void {
    const hasEntry = nodes.some(node => node.category === NodeCategory.ENTRY);
    const hasExit = nodes.some(node => node.category === NodeCategory.EXIT);

    if (!hasEntry) {
      throw new ValidationError("Workflow must have at least one entry node");
    }

    if (!hasExit) {
      throw new ValidationError("Workflow must have at least one exit node");
    }
  }

  public async execute(params: WorkflowParams): Promise<any> {
    try {
      const engine = new WorkflowEngine(this.config, this.registry, this.context);
      const result = await engine.execute(params, this.context);
      return result;
    } catch (error) {
      console.error(`Workflow execution failed: ${this.config.id}`, error);
      throw error;
    }
  }

  public getContext(): NodeContext {
    return this.context;
  }

  public resetContext(): void {
    this.context = new NodeContext();
  }
}
