import { readData, writeData, CHARACTER_DIALOGUES_FILE } from "@/lib/data/local-storage";
import { DialogueNode, DialogueTree } from "@/lib/models/node-model";
import { v4 as uuidv4 } from "uuid";
import { ParsedResponse } from "@/lib/models/parsed-response";

export class LocalCharacterDialogueOperations {
  static async createDialogueTree(characterId: string): Promise<DialogueTree> {
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    for (let index = dialogues.length - 1; index >= 0; index--) {
      if (dialogues[index].character_id === characterId) {
        dialogues.splice(index, 1);
      }
    }
    
    const dialogueTree = new DialogueTree(
      characterId,
      characterId,
      [],
      "root",
    );
    
    dialogues.push(dialogueTree);
    await writeData(CHARACTER_DIALOGUES_FILE, dialogues);

    await this.addNodeToDialogueTree(characterId, "", "", "", "", undefined, "root");
    return dialogueTree;
  }
  
  static async getDialogueTreeById(dialogueId: string): Promise<DialogueTree | null> {
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    const dialogue = dialogues.find((d: any) => d.id === dialogueId);
    
    if (!dialogue) return null;
    
    return new DialogueTree(
      dialogue.id,
      dialogue.character_id,
      dialogue.nodes?.map((node: any) => new DialogueNode(
        node.node_id,
        node.parent_node_id,
        node.user_input,
        node.assistant_response,
        node.full_response,
        node.parsed_content,
        node.created_at,
      )) || [],
      dialogue.current_node_id,
      dialogue.created_at,
      dialogue.updated_at,
    );
  }
  
  static async addNodeToDialogueTree(
    dialogueId: string, 
    parentNodeId: string,
    userInput: string,
    assistantResponse: string,
    fullResponse: string,
    parsedContent?: ParsedResponse,
    nodeId?: string,
  ): Promise<string> {
    if (!nodeId) {
      nodeId = uuidv4();
    }

    // A completed backend run may be observed by two tabs. Treat the node id
    // as the idempotency key and retry once against the newest document when
    // another tab wins the optimistic-revision write.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
      const index = dialogues.findIndex((d: any) => d.id === dialogueId);
      if (index === -1) {
        throw new Error(`Dialogue tree not found: ${dialogueId}`);
      }
      const nodes = Array.isArray(dialogues[index].nodes) ? dialogues[index].nodes : [];
      if (nodes.some((node: any) => node.node_id === nodeId)) {
        return nodeId;
      }

      nodes.push(new DialogueNode(
        nodeId,
        parentNodeId,
        userInput,
        assistantResponse,
        fullResponse,
        parsedContent,
      ));
      dialogues[index].nodes = nodes;
      dialogues[index].current_node_id = nodeId;
      dialogues[index].updated_at = new Date().toISOString();

      try {
        await writeData(CHARACTER_DIALOGUES_FILE, dialogues);
        return nodeId;
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error(`Unable to persist dialogue node: ${nodeId}`);
  }

  static async updateDialogueTree(dialogueId: string, updatedDialogue: DialogueTree): Promise<boolean> {
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    const index = dialogues.findIndex((d: any) => d.id === dialogueId);
    
    if (index === -1) {
      return false;
    }
    
    dialogues[index] = {
      ...updatedDialogue,
      updated_at: new Date().toISOString(),
    };
    
    await writeData(CHARACTER_DIALOGUES_FILE, dialogues);
    return true;
  }

  static async updateNodeInDialogueTree(
    dialogueId: string, 
    nodeId: string, 
    updates: Partial<DialogueNode>,
  ): Promise<DialogueTree | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
      const dialogueIndex = dialogues.findIndex((dialogue: any) => dialogue.id === dialogueId);
      if (dialogueIndex === -1) return null;

      const nodes = Array.isArray(dialogues[dialogueIndex].nodes)
        ? dialogues[dialogueIndex].nodes
        : [];
      const nodeIndex = nodes.findIndex((node: any) => node.node_id === nodeId);
      if (nodeIndex === -1) return null;

      nodes[nodeIndex] = { ...nodes[nodeIndex], ...updates };
      dialogues[dialogueIndex].nodes = nodes;
      dialogues[dialogueIndex].updated_at = new Date().toISOString();
      try {
        await writeData(CHARACTER_DIALOGUES_FILE, dialogues);
        return this.convertToDialogueTree(dialogues[dialogueIndex]);
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    return null;
  }
  
  static async switchBranch(dialogueId: string, nodeId: string): Promise<DialogueTree | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
      const dialogueIndex = dialogues.findIndex((dialogue: any) => dialogue.id === dialogueId);
      if (dialogueIndex === -1) return null;

      const dialogue = dialogues[dialogueIndex];
      const nodes = Array.isArray(dialogue.nodes) ? dialogue.nodes : [];
      if (!nodes.some((node: any) => node.node_id === nodeId)) return null;

      dialogue.current_node_id = nodeId;
      dialogue.updated_at = new Date().toISOString();
      try {
        await writeData(CHARACTER_DIALOGUES_FILE, dialogues);
        return this.convertToDialogueTree(dialogue);
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    return null;
  }
  
  static async clearDialogueHistory(dialogueId: string): Promise<DialogueTree | null> {
    const dialogueTree = await this.getDialogueTreeById(dialogueId);
    
    if (!dialogueTree) {
      return null;
    }
    
    dialogueTree.nodes = [];
    dialogueTree.current_node_id = "root";
    dialogueTree.updated_at = new Date().toISOString();
    
    await this.updateDialogueTree(dialogueId, dialogueTree);
    
    return dialogueTree;
  }

  static async deleteDialogueTree(dialogueId: string): Promise<boolean> {
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    const index = dialogues.findIndex((dialogue: any) => dialogue.id === dialogueId);

    if (index === -1) {
      return false;
    }

    dialogues.splice(index, 1);
    await writeData(CHARACTER_DIALOGUES_FILE, dialogues);
    
    return true;
  }

  static async deleteNode(dialogueId: string, nodeId: string): Promise<DialogueTree | null> {
    const dialogueTree = await this.getDialogueTreeById(dialogueId);
    
    if (!dialogueTree || nodeId === "root") {
      return null;
    }
    
    const nodeToDelete = dialogueTree.nodes.find(node => node.node_id === nodeId);
    if (!nodeToDelete) {
      return null;
    }

    const nodesToDelete = new Set<string>();
    const collectNodesToDelete = (currentNodeId: string) => {
      nodesToDelete.add(currentNodeId);
      const children = dialogueTree.nodes.filter(node => node.parent_node_id === currentNodeId);
      children.forEach(child => collectNodesToDelete(child.node_id));
    };
    
    collectNodesToDelete(nodeId);
    dialogueTree.nodes = dialogueTree.nodes.filter(node => !nodesToDelete.has(node.node_id));
    if (nodesToDelete.has(dialogueTree.current_node_id)) {
      dialogueTree.current_node_id = nodeToDelete.parent_node_id;
      const newCurrentNode = dialogueTree.nodes.find(node => node.node_id === dialogueTree.current_node_id);
    }
    
    dialogueTree.updated_at = new Date().toISOString();
    
    await this.updateDialogueTree(dialogueId, dialogueTree);
    
    return dialogueTree;
  }

  static async getDialoguePathToNode(dialogueId: string, nodeId: string): Promise<DialogueNode[]> {
    const dialogueTree = await this.getDialogueTreeById(dialogueId);
    
    if (!dialogueTree) {
      return [];
    }
    
    const path: DialogueNode[] = [];
    let currentNode = dialogueTree.nodes.find(node => node.node_id === nodeId);
    
    while (currentNode) {
      path.unshift(currentNode);
      
      if (currentNode.node_id === "root") {
        break;
      }
      
      currentNode = dialogueTree.nodes.find(node => node.node_id === currentNode?.parent_node_id);
    }
    
    return path;
  }

  static async getChildNodes(dialogueId: string, parentNodeId: string): Promise<DialogueNode[]> {
    const dialogueTree = await this.getDialogueTreeById(dialogueId);
    
    if (!dialogueTree) {
      return [];
    }
    
    return dialogueTree.nodes.filter(node => node.parent_node_id === parentNodeId);
  }
  
  static async getAllDialoguesForCharacter(characterId: string): Promise<DialogueTree[]> {
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    return dialogues
      .filter((d: any) => d.character_id === characterId)
      .map((d: any) => this.convertToDialogueTree(d));
  }
  
  private static convertToDialogueTree(data: any): DialogueTree {
    return new DialogueTree(
      data.id,
      data.character_id,
      data.nodes?.map((node: any) => new DialogueNode(
        node.node_id,
        node.parent_node_id,
        node.user_input,
        node.assistant_response,
        node.full_response ?? node.response_summary ?? node.assistant_response,
        node.parsed_content,
        node.created_at,
      )) || [],
      data.current_node_id,
      data.created_at,
      data.updated_at,
    );
  }

  static async getSystemMessage(characterId: string): Promise<string> {
    const dialogueTree = await this.getDialogueTreeById(characterId);
    if (!dialogueTree || !dialogueTree.nodes || dialogueTree.nodes.length === 0) {
      return "";
    }
    const rootNode = dialogueTree.nodes.find(node => node.parent_node_id === "root");
    return rootNode?.assistant_response || "";
  }
  
  static async getLastNodeId(characterId: string): Promise<string> {
    const dialogueTree = await this.getDialogueTreeById(characterId);
    return dialogueTree?.current_node_id || "root";
  }

  static async nodeExists(characterId: string, nodeId: string): Promise<boolean> {
    if (nodeId === "root") return true;
    
    const dialogueTree = await this.getDialogueTreeById(characterId);
    if (!dialogueTree || !dialogueTree.nodes || dialogueTree.nodes.length === 0) {
      return false;
    }

    return dialogueTree.nodes.some(node => node.node_id === nodeId);
  }
}
