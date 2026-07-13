import { NodeTool } from "@/lib/nodeflow/NodeTool";
import { RegexProcessor } from "@/lib/core/regex-processor";
import { RegexPlacement } from "@/lib/models/regex-script-model";

export class RegexNodeTools extends NodeTool {
  protected static readonly toolType: string = "regex";
  protected static readonly version: string = "1.0.0";

  static getToolType(): string {
    return this.toolType;
  }

  static async executeMethod(methodName: string, ...params: any[]): Promise<any> {
    const method = (this as any)[methodName];
    
    if (typeof method !== "function") {
      console.error(`Method lookup failed: ${methodName} not found in RegexNodeTools`);
      console.log("Available methods:", Object.getOwnPropertyNames(this).filter(name => 
        typeof (this as any)[name] === "function" && !name.startsWith("_"),
      ));
      throw new Error(`Method ${methodName} not found in ${this.getToolType()}Tool`);
    }

    try {
      this.logExecution(methodName, params);
      return await (method as Function).apply(this, params);
    } catch (error) {
      this.handleError(error as Error, methodName);
    }
  }

  static async processRegex(
    response: string,
    characterId: string,
    protagonistName?: string,
    characterName?: string,
  ): Promise<{ replacedText: string}> {
    try {
      const result = await RegexProcessor.processFullContext(response, {
        ownerId: characterId,
        placement: RegexPlacement.AI_OUTPUT,
        isMarkdown: true,
        protagonistName,
        charName: characterName,
      });

      return {
        replacedText: result.replacedText,
      };
    } catch (error) {
      this.handleError(error as Error, "processRegex");
    }
  }
} 
