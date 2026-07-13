import { BaseWorkflow, WorkflowConfig } from "@/lib/workflow/BaseWorkflow";
import { NodeCategory } from "@/lib/nodeflow/types";
import { UserInputNode } from "@/lib/nodeflow/UserInputNode/UserInputNode";
import { ContextNode } from "@/lib/nodeflow/ContextNode/ContextNode";
import { WorldBookNode } from "@/lib/nodeflow/WorldBookNode/WorldBookNode";
import { PresetNode } from "@/lib/nodeflow/PresetNode/PresetNode";
import { LLMNode } from "@/lib/nodeflow/LLMNode/LLMNode";
import { RegexNode } from "@/lib/nodeflow/RegexNode/RegexNode";
import { OutputNode } from "@/lib/nodeflow/OutputNode/OutputNode";
import { PromptType } from "@/lib/models/character-prompts-model";
import type { Language } from "@/lib/i18n/languages";

export interface DialogueWorkflowParams {
  characterId: string;
  userInput: string;
  number?: number;
  promptType?: PromptType;
  language?: Language;
  protagonistName?: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topK?: number;
  repeatPenalty?: number;
}

export class DialogueWorkflow extends BaseWorkflow {
  protected getNodeRegistry() {
    return {
      "userInput": {
        nodeClass: UserInputNode,
      },
      "context": {
        nodeClass: ContextNode,
      },
      "worldBook": {
        nodeClass: WorldBookNode,
      },
      "preset": {
        nodeClass: PresetNode,
      },
      "llm": {
        nodeClass: LLMNode,
      },
      "regex": {
        nodeClass: RegexNode,
      },
      "output": {
        nodeClass: OutputNode,
      },
    };
  }

  protected getWorkflowConfig(): WorkflowConfig {
    return {
      id: "complete-dialogue-workflow",
      name: "Complete Dialogue Processing Workflow",
      nodes: [
        {
          id: "user-input-1",
          name: "userInput",
          category: NodeCategory.ENTRY,
          next: ["preset-1"],
		  initParams: ["characterId", "userInput", "number", "promptType", "language", "protagonistName", "modelId", "temperature"],
          inputFields: [],
		  outputFields: ["characterId", "userInput", "number", "promptType", "language", "protagonistName", "modelId", "temperature"],
        },
        {
          id: "preset-1",
          name: "preset",
          category: NodeCategory.MIDDLE,
          next: ["context-1"],
          initParams: [],
		  inputFields: ["characterId", "language", "number"],
          outputFields: ["systemMessage", "userMessage", "presetId", "characterId", "language", "protagonistName", "characterName"],
        },
        {
          id: "context-1",
          name: "context",
          category: NodeCategory.MIDDLE,
          next: ["world-book-1"],
          initParams: [],
          inputFields: ["userMessage", "characterId"],
          outputFields: ["userMessage", "characterId"],
        },
        {
          id: "world-book-1",
          name: "worldBook",
          category: NodeCategory.MIDDLE,
          next: ["llm-1"],
          initParams: [],
          inputFields: ["systemMessage", "userMessage", "characterId", "language", "protagonistName", "characterName", "userInput"],
          outputFields: ["systemMessage", "userMessage", "protagonistName", "characterName"],
          inputMapping: {
            "userInput": "currentUserInput",
          },
        },
        {
          id: "llm-1",
          name: "llm",
          category: NodeCategory.MIDDLE,
          next: ["regex-1"],
          initParams: [],
          inputFields: ["systemMessage", "userMessage", "modelId", "temperature", "language", "number"],
          outputFields: ["llmResponse", "responseUsage"],
        },
        {
          id: "regex-1",
          name: "regex",
          category: NodeCategory.MIDDLE,
          next: ["output-1"],
          initParams: [],
          inputFields: ["llmResponse", "characterId", "responseUsage", "protagonistName", "characterName"],
          outputFields: ["replacedText", "screenContent", "fullResponse", "nextPrompts", "event", "responseUsage"],
        },
        {
          id: "output-1",
          name: "output",
          category: NodeCategory.EXIT,
          next: [],
          initParams: [],
          inputFields: ["replacedText", "screenContent", "fullResponse", "nextPrompts", "event", "presetId", "responseUsage"],
          outputFields: ["replacedText", "screenContent", "fullResponse", "nextPrompts", "event", "presetId", "responseUsage"],
        },
      ],
    };
  }
}
