export enum NodeCategory {
  ENTRY = "entry",
  MIDDLE = "middle", 
  EXIT = "exit"
}

export interface NodeConfig {
  id: string;
  name: string;
  category: NodeCategory;
  next?: string[];
  initParams?: string[];
  inputFields?: string[];
  outputFields?: string[];
  inputMapping?: Record<string, string>;
}

export type NodeInput = Record<string, any>;
export type NodeOutput = Record<string, any>;

export enum NodeExecutionStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped"
}

export interface NodeExecutionResult {
  nodeId: string;
  status: NodeExecutionStatus;
  input: NodeInput;
  output?: NodeOutput;
  error?: Error;
  startTime: Date;
  endTime?: Date;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  nodes: NodeConfig[];
}

export interface WorkflowExecutionResult {
  workflowId: string;
  status: NodeExecutionStatus;
  results: NodeExecutionResult[];
  outputData?: Record<string, any>;
  startTime: Date;
  endTime?: Date;
}

export interface NodeRegistryEntry {
  nodeClass: any;
}

export type NodeRegistry = Record<string, NodeRegistryEntry>;
