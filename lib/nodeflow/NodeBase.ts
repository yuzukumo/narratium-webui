import { NodeConfig, NodeInput, NodeOutput, NodeExecutionStatus, NodeExecutionResult, NodeCategory } from "@/lib/nodeflow/types";
import { NodeContext } from "@/lib/nodeflow/NodeContext";
import { NodeTool, NodeToolRegistry } from "@/lib/nodeflow/NodeTool";

export abstract class NodeBase {
  protected id: string;
  protected name: string;
  protected category: NodeCategory;
  protected next: string[];
  protected toolClass?: typeof NodeTool;
  protected params: Record<string, any>;
  protected state: Record<string, any> = {};

  constructor(config: NodeConfig) {
    this.id = config.id;
    this.name = config.name;
    this.category = this.getDefaultCategory();
    this.next = config.next || [];
    
    this.params = {
      initParams: config.initParams || [],
      inputFields: config.inputFields || [],
      outputFields: config.outputFields || [],
      inputMapping: config.inputMapping || {},
    };
    this.initializeTools();
  }

  protected getInitParams(): string[] {
    return this.getConfigValue("initParams") || [];
  }
  
  protected getInputFields(): string[] {
    return this.getConfigValue("inputFields") || [];
  }

  protected getOutputFields(): string[] {
    return this.getConfigValue("outputFields") || [];
  }
  
  protected getConfigValue<T>(key: string, defaultValue?: T): T | undefined {
    if (this.params && this.params[key] !== undefined) {
      return this.params[key] as T;
    }
    return defaultValue;
  }

  protected getState<T>(key: string, defaultValue?: T): T | undefined {
    return (this.state[key] as T) ?? defaultValue;
  }

  protected setState<T>(key: string, value: T): void {
    this.state[key] = value;
  }

  protected abstract getDefaultCategory(): NodeCategory;

  getCategory(): NodeCategory {
    return this.category;
  }

  isEntryNode(): boolean {
    return this.category === NodeCategory.ENTRY;
  }

  isExitNode(): boolean {
    return this.category === NodeCategory.EXIT;
  }

  isMiddleNode(): boolean {
    return this.category === NodeCategory.MIDDLE;
  }
  
  protected initializeTools(): void {
    try {
      const registeredToolClass = NodeToolRegistry.get(this.getName());
      if (registeredToolClass) {
        this.toolClass = registeredToolClass;
      } else {
        console.warn(`找不到节点类型的工具类: ${this.getName()}`);
      }
    } catch (error: any) {
      console.warn(`查找工具类失败: ${error?.message || "未知错误"}`);
    }
  }

  protected async executeTool(methodName: string, ...params: any[]): Promise<any> {
    if (!this.toolClass) {
      throw new Error(`No tool class available for node type: ${this.getName()}`);
    }
    return await this.toolClass.executeMethod(methodName, ...params);
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getNext(): string[] {
    return [...this.next];
  }

  protected async resolveInput(context: NodeContext): Promise<NodeInput> {
    const resolvedInput: NodeInput = {};
    const initParams = this.getInitParams();
    const inputFields = this.getInputFields();
    const inputMapping = this.getConfigValue<Record<string, string>>("inputMapping") || {};

    for (const fieldName of initParams) {
      if (context.hasInput(fieldName)) {
        resolvedInput[fieldName] = context.getInput(fieldName);
      } else {
        console.warn(`Node ${this.id}: Required input '${fieldName}' not found in Input`);
      }
    }

    for (const workflowFieldName of inputFields) {
      const nodeFieldName = inputMapping[workflowFieldName] || workflowFieldName;
      
      if (context.hasCache(workflowFieldName)) {
        resolvedInput[nodeFieldName] = context.getCache(workflowFieldName);
      } else {
        console.warn(`Node ${this.id}: Required input '${workflowFieldName}' (mapped to node field '${nodeFieldName}') not found in cache`);
      }
    }

    return resolvedInput;
  }

  protected async publishOutput(output: NodeOutput, context: NodeContext): Promise<void> {
    const outputFields = this.getOutputFields();
    
    const storeData = (key: string, value: any) => {
      switch (this.category) {
      case NodeCategory.EXIT:
        context.setOutput(key, value);
        break;
      default:
        context.setCache(key, value);
        break;
      }
    };
    
    for (const fieldName of outputFields) {
      if (output[fieldName] !== undefined) {
        storeData(fieldName, output[fieldName]);
      }
    }
  }

  async execute(context: NodeContext): Promise<NodeExecutionResult> {
    const startTime = new Date();
    const result: NodeExecutionResult = {
      nodeId: this.id,
      status: NodeExecutionStatus.RUNNING,
      input: {},
      startTime,
    };
    try {
      const resolvedNodeInput = await this.resolveInput(context);
      await this.beforeExecute(resolvedNodeInput);
      result.input = resolvedNodeInput;
      
      const output = await this._call(resolvedNodeInput);
      await this.publishOutput(output, context);
      await this.afterExecute(output);

      result.status = NodeExecutionStatus.COMPLETED;
      result.output = output;
    } catch (error) {
      result.status = NodeExecutionStatus.FAILED;
      result.error = error as Error;
    } finally {
      result.endTime = new Date();
    }

    return result;
  }

  protected async beforeExecute(input: NodeInput): Promise<void> {
    console.log(`Node ${this.id}: Processing workflow beforeExecute`);
  }

  protected async afterExecute(output: NodeOutput): Promise<void> {
    console.log(`Node ${this.id}: Processing workflow afterExecute`);
  }

  protected async _call(input: NodeInput): Promise<NodeOutput>{
    const outputFields = this.getOutputFields();
    const output: NodeOutput = {};
    
    if (outputFields.length === 0) {
      return { ...input };
    }
    
    for (const field of outputFields) {
      if (input[field] !== undefined) {
        output[field] = input[field];
      }
    }
    
    return output;
  }

  getStatus(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
    };
  }

  toJSON(): NodeConfig {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      next: this.next,
    };
  }
} 
