import { readData, writeData, CHARACTER_DIALOGUES_FILE } from "@/lib/data/local-storage";
import { DialogueNode, DialogueTree } from "@/lib/models/node-model";
import { v4 as uuidv4 } from "uuid";
import { ParsedResponse } from "@/lib/models/parsed-response";

export class LocalCharacterDialogueOperations {
  static async createDialogueTree(characterId: string): Promise<DialogueTree> {
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    
    const filteredDialogues = dialogues.filter((d: any) => d.character_id !== characterId);
    
    const dialogueTree = new DialogueTree(
      characterId,
      characterId,
      [],
      "root",
    );
    
    filteredDialogues.push(dialogueTree); 
    await writeData(CHARACTER_DIALOGUES_FILE, filteredDialogues);

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
    const dialogues = await readData(CHARACTER_DIALOGUES_FILE);
    const index = dialogues.findIndex((d: any) => d.id === dialogueId);
    
    if (!nodeId) {
      nodeId = uuidv4();
    }
    
    const newNode = new DialogueNode(
      nodeId,
      parentNodeId,
      userInput,
      assistantResponse,
      fullResponse,
      parsedContent,
    );
    
    if (!dialogues[index].nodes) {
      dialogues[index].nodes = [];
    }
    
    dialogues[index].nodes.push(newNode);
    dialogues[index].current_node_id = nodeId;
    dialogues[index].updated_at = new Date().toISOString();
    
    await writeData(CHARACTER_DIALOGUES_FILE, dialogues);
    
    return nodeId;
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
    const dialogueTree = await this.getDialogueTreeById(dialogueId);
    
    if (!dialogueTree) {
      return null;
    }
    
    const nodeIndex = dialogueTree.nodes.findIndex(node => node.node_id === nodeId);
    
    if (nodeIndex === -1) {
      return null;
    }
    
    dialogueTree.nodes[nodeIndex] = {
      ...dialogueTree.nodes[nodeIndex],
      ...updates,
    };
    
    dialogueTree.updated_at = new Date().toISOString();
    
    await this.updateDialogueTree(dialogueId, dialogueTree);
    
    return dialogueTree;
  }
  
  static async switchBranch(dialogueId: string, nodeId: string): Promise<DialogueTree | null> {
    const dialogueTree = await this.getDialogueTreeById(dialogueId);
    
    if (!dialogueTree) {
      return null;
    }
    
    const node = dialogueTree.nodes.find(n => n.node_id === nodeId);
    
    if (!node) {
      return null;
    }
    
    dialogueTree.current_node_id = nodeId;
    dialogueTree.updated_at = new Date().toISOString();
    
    await this.updateDialogueTree(dialogueId, dialogueTree);
    
    return dialogueTree;
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
    const initialLength = dialogues.length;
    
    const filteredDialogues = dialogues.filter((d: any) => d.id !== dialogueId);
    
    if (filteredDialogues.length === initialLength) {
      return false;
    }
    
    await writeData(CHARACTER_DIALOGUES_FILE, filteredDialogues);
    
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
        node.response_summary,
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
