"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLanguage } from "@/app/i18n";
import ReactFlow, {
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeTypes,
  ConnectionLineType,
  Panel,
  Handle,
  Position,
  NodeProps,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { trackButtonClick } from "@/utils/google-analytics";
import { switchDialogueBranch } from "@/function/dialogue/truncate";
import { getCharacterDialogue } from "@/function/dialogue/info";
import { editDialaogueNodeContent } from "@/function/dialogue/edit";
import { getActiveApiConfig } from "@/utils/api-config";

interface DialogueTreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  characterId?: string;
  onDialogueEdit?: () => void;
}

interface DialogueNode extends Node {
  data: {
    label: string;
    fullContent: string;
    userInput: string;
    assistantResponse: string;
    parsedContent: any;
    onEditClick: (id: string) => void;
    onJumpClick: (id: string) => void;
    isCurrentPath: boolean;
    characterId: string;
  };
}

function DialogueNodeComponent({ id, data }: NodeProps<DialogueNode["data"]>) {
  const { t, fontClass, serifFontClass } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isJumping, setIsJumping] = useState(false);
  const [showRootTooltip, setShowRootTooltip] = useState(false);
  
  const steps = data.label
    .split(/——>|-->|->/)
    .map(step => step.trim())
    .filter(step => step.length > 0);

  const handleNodeClick = () => {
    data.onEditClick(id);
  };

  const handleToggleExpand = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsExpanded(!isExpanded);
  };
  
  const handleJumpClick = async (event: React.MouseEvent) => {
    event.stopPropagation();

    if (id === "root") {
      setShowRootTooltip(true);
      setTimeout(() => {
        setShowRootTooltip(false);
      }, 3000);
      return;
    }
    
    if (isJumping) return;
    
    try {
      setIsJumping(true);
      await data.onJumpClick(id);
    } finally {
      setIsJumping(false);
    }
  };

  let borderColor, hoverBorderColor, textColor, expandIconColor, jumpButtonColor;
  
  if (id === "root") {
    borderColor = "border-purple-700";
    hoverBorderColor = "hover:border-purple-500";
    textColor = "text-purple-200";
    expandIconColor = "text-purple-400";
    jumpButtonColor = "text-purple-400 hover:text-purple-300";
  }
  else if (data.isCurrentPath) {
    borderColor = "border-red-800";
    hoverBorderColor = "hover:border-red-600";
    textColor = "text-red-200";
    expandIconColor = "text-red-400";
    jumpButtonColor = "text-red-400 hover:text-red-300";
  } 
  else {
    borderColor = "border-[#3a3633]";
    hoverBorderColor = "hover:border-[#6b635d]";
    textColor = "text-[#a8a095]";
    expandIconColor = "text-amber-700";
    jumpButtonColor = "text-amber-700 hover:text-amber-600";
  }

  return (
    <div 
      className={`fantasy-bg border ${borderColor} rounded-md p-3 shadow-md w-72 ${hoverBorderColor} transition-all duration-300 relative cursor-pointer ${fontClass} ${data.isCurrentPath ? "bg-opacity-100" : "bg-opacity-70"}`}
      onClick={handleNodeClick}
    >
      {showRootTooltip && (
        <div className="absolute -top-14 right-0 z-20 bg-[#1c1c1c] border border-amber-700 rounded-md p-2 shadow-lg max-w-[200px] text-xs text-amber-400 animate-fade-in">
          <div className="relative">
            {t("dialogue.rootNodeCannotJump")}
            <div className="absolute -bottom-6 right-4 w-0 h-0 border-8 border-transparent border-t-amber-700"></div>
          </div>
        </div>
      )}
      <div className="absolute top-2 right-2 z-10">
        <button
          onClick={(e) => {trackButtonClick("DialogueTreeModal", "跳转到节点");handleJumpClick(e);}}
          className={`${jumpButtonColor} transition-colors duration-300 p-1 rounded-full hover:bg-[#2a2825] focus:outline-none`}
          title={t("dialogue.jumpToNode")}
          disabled={isJumping}
        >
          {isJumping ? (
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent border-amber-400 animate-spin"></div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 10 20 15 15 20"></polyline>
              <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
            </svg>
          )}
        </button>
      </div>
      <Handle 
        type="target" 
        position={Position.Top} 
        id="a" 
        className={`w-2 h-2 ${
          id === "root" 
            ? "!bg-purple-500 !border-purple-700" 
            : data.isCurrentPath 
              ? "!bg-red-500 !border-red-700" 
              : "!bg-amber-700 !border-amber-900"
        }`}
      />
      <div 
        className={`${textColor} text-sm ${serifFontClass} ${
          id === "root" 
            ? "hover:text-purple-300" 
            : data.isCurrentPath 
              ? "hover:text-red-300" 
              : "hover:text-amber-700"
        } transition-colors duration-300 flex items-center`}
        onClick={handleToggleExpand}
      >
        <div className={`w-5 h-5 mr-2 flex-shrink-0 ${expandIconColor} bg-[#1c1c1c] rounded-full border ${borderColor} flex items-center justify-center`}>
          {isExpanded ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 9l-7 7-7-7" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          )}
        </div>
        {steps.length > 0 ? (
          <ol className={`list-decimal list-inside ml-1 ${serifFontClass} text-sm`}>
            {steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        ) : (
          <div className={`${serifFontClass} text-sm truncate max-w-[200px]`}>
            {data.label || t("dialogue.node")}
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="mt-3 p-3 bg-[#1c1c1c] rounded border border-[#444444] max-h-60 overflow-y-auto fantasy-scrollbar">
          {data.assistantResponse && (
            <div>
              <div className={`text-[#a08c6a] text-xs ${fontClass} mb-1`}>{t("dialogue.assistantResponse") || "助手回复"}:</div>
              <p className={`${data.isCurrentPath ? "text-[#d1a35c]" : "text-[#a08c6a]"} text-xs ${fontClass} leading-relaxed`}>{data.assistantResponse}</p>
            </div>
          )}
        </div>
      )}
      <Handle 
        type="source" 
        position={Position.Bottom} 
        id="b" 
        className={`w-2 h-2 ${
          id === "root" 
            ? "!bg-purple-500 !border-purple-700" 
            : data.isCurrentPath 
              ? "!bg-red-500 !border-red-700" 
              : "!bg-amber-700 !border-amber-900"
        }`}
      />
    </div>
  );
}

const DialogueFlowStyles = () => (
  <style jsx global>{`
    .react-flow__node {
      transition: all 0.3s ease !important;
    }

    .react-flow__edge path {
      stroke-dasharray: none;
      animation: none;
    }
    
    .react-flow__edge.root-source path {
      stroke-dasharray: 10, 5 !important;
      animation: flowLineRoot 1.5s linear infinite !important;
      filter: drop-shadow(0 0 2px rgba(167, 139, 250, 0.5)) !important;
    }
    
    .react-flow__edge.current-path path {
      stroke-dasharray: 8, 4 !important;
      animation: flowLineCurrent 1.8s linear infinite !important;
      filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.5)) !important;
    }
    
    .react-flow__edge.other-path path {
      stroke-dasharray: 6, 4 !important;
      animation: flowLineOther 2s linear infinite !important;
      opacity: 0.8 !important;
    }
    
    @keyframes flowLineRoot {
      from {
        stroke-dashoffset: 0;
      }
      to {
        stroke-dashoffset: -45;
      }
    }
    
    @keyframes flowLineCurrent {
      from {
        stroke-dashoffset: 0;
      }
      to {
        stroke-dashoffset: -40;
      }
    }
    
    @keyframes flowLineOther {
      from {
        stroke-dashoffset: 0;
      }
      to {
        stroke-dashoffset: -30;
      }
    }
  `}</style>
);

const nodeTypes: NodeTypes = {
  dialogueNode: DialogueNodeComponent,
};

export default function DialogueTreeModal({ isOpen, onClose, characterId, onDialogueEdit }: DialogueTreeModalProps) {
  const { t, fontClass, serifFontClass } = useLanguage();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<DialogueNode | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [isJumpingToNode, setIsJumpingToNode] = useState(false);
  const flowRef = useRef(null);
  const nodesRef = useRef<Node[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);
  const editModalRef = useRef<HTMLDivElement>(null);
  
  const defaultEdgeOptions = useMemo(() => ({
    type: "smoothstep", 
    style: { stroke: "#ef4444", strokeWidth: 3 },
    animated: true,
  }), []);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  
  const handleFlowInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = instance;
    adjustViewport(instance);
  }, []);
  
  const adjustViewport = useCallback((instance: ReactFlowInstance) => {
    instance.fitView({ padding: 0.2 });
    
    const nodeCount = nodesRef.current.length;
    
    const baseZoom = 0.85;
    const minZoom = 0.3;
    const zoomReductionRate = 0.05;
    
    const zoomFactor = Math.max(
      minZoom,
      baseZoom - (zoomReductionRate * Math.log10(nodeCount + 1)),
    );
    
    instance.setViewport({
      x: instance.getViewport().x,
      y: instance.getViewport().y,
      zoom: instance.getViewport().zoom * zoomFactor,
    });
  }, []);

  const handleEditNode = useCallback((nodeId: string) => {
    const nodeToEdit = nodesRef.current.find(node => node.id == nodeId);
    if (nodeToEdit) {
      setSelectedNode(nodeToEdit as DialogueNode);
      setEditContent(nodeToEdit.data.assistantResponse || "");
      setIsEditModalOpen(true);
    } else {
      console.error("Node not found with ID:", nodeId, "Available nodes:", nodesRef.current.map(n => n.id));
    }
  }, []);
  
  const handleJumpToNode = useCallback(async (nodeId: string) => {
    
    if (!characterId || isJumpingToNode) return;
    try {
      setIsJumpingToNode(true);
      const response = await switchDialogueBranch({ characterId, nodeId });
      
      if (!response.success) {
        throw new Error("Failed to jump to node");
      }
      if (onDialogueEdit) {
        await onDialogueEdit();
      }
      
      setTimeout(() => {
        onClose();
      }, 300);
      
      return true;
    } catch (error) {
      console.error("Error jumping to node:", error);
      return false;
    } finally {
      setIsJumpingToNode(false);
    }
  }, [characterId, onClose, onDialogueEdit, isJumpingToNode]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (dataLoaded && reactFlowInstanceRef.current && nodes.length > 0) {
      setTimeout(() => {
        adjustViewport(reactFlowInstanceRef.current!);
      }, 50);
    }
  }, [dataLoaded, adjustViewport]);

  useEffect(() => {
    if (isOpen && characterId) {
      fetchDialogueData(characterId);
    } else {
      setDataLoaded(false);
    }
  }, [isOpen, characterId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as HTMLElement)) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    function handleEditModalClickOutside(event: MouseEvent) {
      if (editModalRef.current && !editModalRef.current.contains(event.target as HTMLElement)) {
        setIsEditModalOpen(false);
      }
    }

    if (isEditModalOpen) {
      document.addEventListener("mousedown", handleEditModalClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleEditModalClickOutside);
    };
  }, [isEditModalOpen]);

  const fetchDialogueData = async (characterId: string) => {
    if (!characterId) {
      return;
    }
    
    try {
      const response = await getCharacterDialogue(characterId);
      
      if (!response.success) {
        throw new Error("Failed to fetch dialogue data");
      }
      
      const dialogue = response.dialogue;
      
      if (!dialogue) {
        throw new Error("Failed to fetch dialogue data");
      }
      
      if (!dialogue.tree || !dialogue.tree.nodes) {
        throw new Error("Invalid dialogue tree structure");
      }

      const allNodes = dialogue.tree.nodes || [];
      const currentNodeId = dialogue.tree.currentNodeId || "root";
      
      if (allNodes.length === 0) {
        setDataLoaded(true);
        return;
      }

      const currentPathNodeIds: string[] = [];
      let tempNodeId = currentNodeId;
      
      while (tempNodeId !== "root") {
        currentPathNodeIds.push(tempNodeId);
        const node = allNodes.find((n: { node_id: any; }) => n.node_id === tempNodeId);
        if (!node) break;
        tempNodeId = node.parent_node_id;
      }
      
      const nodeWidth = 220;
      const nodeHeight = 120;
      const newNodes: DialogueNode[] = [];
      const newEdges: Edge[] = [];

      const nodeMap: Record<string, any> = {};
      allNodes.forEach((node: any) => {
        nodeMap[node.node_id] = node;
      });
      
      const calculateOptimalLayout = (nodeCount: number) => {
        const columns = nodeCount <= 3 ? 1 : Math.max(1, Math.round(Math.sqrt(nodeCount)));
        
        const baseHorizontalGap = 500;
        const baseVerticalGap = 250;
        const minHorizontalGap = 200;
        const minVerticalGap = 150;
        
        const horizontalGap = Math.max(
          minHorizontalGap,
          baseHorizontalGap * Math.pow(0.9, nodeCount),
        );
        
        const verticalGap = Math.max(
          minVerticalGap,
          baseVerticalGap * Math.pow(0.95, nodeCount),
        );
        
        return { columns, horizontalGap, verticalGap };
      };
      
      const { columns, horizontalGap, verticalGap } = calculateOptimalLayout(allNodes.length);
      
      const rows = Math.ceil(allNodes.length / columns);
      const gridWidth = (columns * nodeWidth) + ((columns - 1) * horizontalGap);
      const gridHeight = (rows * nodeHeight) + ((rows - 1) * verticalGap);

      allNodes.forEach((node: any, index: number) => {
        const col = index % columns;
        const row = Math.floor(index / columns);

        const xPos = (col * (nodeWidth + horizontalGap)) - (gridWidth / 2) + (nodeWidth / 2);
        const yPos = (row * (nodeHeight + verticalGap)) - (gridHeight / 2) + (nodeHeight / 2);

        const nodeId = node.node_id;
        const isCurrentPath = currentPathNodeIds.includes(nodeId);
        
        let label = "";
        if (node.node_id === "root") {
          label = "root";
        } else if (node.parent_node_id === "root") {
          const rootChildren = allNodes.filter((n: any) => n.parent_node_id === "root");
          const rootChildIndex = rootChildren.findIndex((n: any) => n.node_id === node.node_id);
          const rootChildrenCount = rootChildren.length;
          
          label = `${t("dialogue.startingPoint")}${rootChildrenCount - rootChildIndex}${rootChildrenCount > 1 ? `/${rootChildrenCount}` : ""}`;
        } else if (node.assistant_response) {
          if (node.parsed_content?.compressedContent) {
            label = node.parsed_content.compressedContent;
          } else {
            const shortResponse = node.assistant_response.length > 30 
              ? node.assistant_response.substring(0, 30) + "..." 
              : node.assistant_response;
            label = shortResponse;
          }
        } else {
          label = t("dialogue.systemMessage");
        }
        
        newNodes.push({
          id: nodeId,
          type: "dialogueNode",
          data: {
            label: label,
            fullContent: node.assistant_response || "",
            userInput: (node.user_input.match(/<input_message>([\s\S]*?)<\/input_message>/)?.[1] || "").replace(/^[\s\n\r]*((<[^>]+>\s*)*)?(玩家输入指令|Player Input)[:：]\s*/i, ""),
            assistantResponse: node.assistant_response || "",
            parsedContent: node.parsed_content || {},
            onEditClick: (id: string) => handleEditNode(id),
            onJumpClick: (id: string) => handleJumpToNode(id),
            isCurrentPath: isCurrentPath,
            characterId: characterId,
          },
          position: { x: xPos, y: yPos },
          style: {
            width: nodeWidth,
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.1)",
          },
        });
      });

      allNodes.forEach((node: any) => {
        if (node.node_id && node.node_id !== "root") {
          const sourceId = node.parent_node_id;
          const targetId = node.node_id;
          
          if (nodeMap[sourceId] && nodeMap[targetId]) {
            const isCurrentPathEdge = currentPathNodeIds.includes(sourceId) && currentPathNodeIds.includes(targetId);
            
            const isRootSource = sourceId === "root";
            let edgeStroke, edgeLabelStroke, edgeLabelFill;
            
            if (isRootSource) {
              edgeStroke = "#a78bfa";
              edgeLabelStroke = "#7c3aed";
              edgeLabelFill = "#ddd6fe";
            } else if (isCurrentPathEdge) {
              edgeStroke = "#ef4444";
              edgeLabelStroke = "#991b1b";
              edgeLabelFill = "#fecaca";
            } else {
              edgeStroke = "#8a7a64";
              edgeLabelStroke = "#3a3633";
              edgeLabelFill = "#a8a095";
            }
            
            let edgeClass = "other-path";
            if (isRootSource) {
              edgeClass = "root-source";
            } else if (isCurrentPathEdge) {
              edgeClass = "current-path";
            }

            newEdges.push({
              id: `edge-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              label: node.user_input.match(/<input_message>([\s\S]*?)<\/input_message>/)?.[1].replace(/^[\s\n\r]*((<[^>]+>\s*)*)?(玩家输入指令|Player Input)[:：]\s*/i, "") || "",
              labelBgPadding: [8, 4],
              labelBgBorderRadius: 4,
              labelBgStyle: { 
                fill: "#1e1c1b", 
                fillOpacity: 0.8, 
                stroke: edgeLabelStroke, 
              },
              labelStyle: { 
                fill: edgeLabelFill, 
                fontFamily: "inherit", 
                fontSize: 12, 
              },
              style: { 
                stroke: edgeStroke, 
                strokeWidth: isCurrentPathEdge || isRootSource ? 3 : 2, 
              },
              animated: false,
              className: edgeClass,
              type: "smoothstep",
            });
          }
        }
      });

      setNodes(newNodes);
      setEdges(newEdges);
      nodesRef.current = newNodes;

      setDataLoaded(true);
    } catch (error) {
      console.error("Error fetching dialogue data:", error);
      setDataLoaded(true);
    }
  };

  const saveEditContent = async () => {
    if (selectedNode && characterId) {
      setIsSaving(true);
      try {
        const activeConfig = getActiveApiConfig();
        const language = localStorage.getItem("language") || "zh";

        if (!activeConfig?.model || !activeConfig?.apiKey) {
          throw new Error("Missing active API configuration");
        }
        
        const response = await editDialaogueNodeContent({
          characterId: characterId,
          nodeId: selectedNode.id,
          assistantResponse: editContent,
          model_name: activeConfig.model,
          api_key: activeConfig.apiKey,
          base_url: activeConfig.baseUrl,
          llm_type: activeConfig.type,
          language: language,
          reasoning_effort: activeConfig.reasoningEffortEnabled ? activeConfig.reasoningEffort : undefined,
        });
        
        if (!response.success) {
          throw new Error("Failed to update node content");
        }
        
        setNodes((nds) => {
          const updatedNodes = nds.map((node) => {
            if (node.id === selectedNode.id) {
              return {
                ...node,
                data: {
                  ...node.data,
                  label: node.data.label,
                  assistantResponse: editContent,
                  parsedContent: {
                    compressedContent: response.summary,
                  },
                },
              };
            }
            return node;
          });
          
          nodesRef.current = updatedNodes;
          return updatedNodes;
        });

        setIsEditModalOpen(false);
        
        if (onDialogueEdit) {
          onDialogueEdit();
        }
      } catch (error) {
        console.error("Error saving edited content:", error);
      } finally {
        setIsSaving(false);
      }
    } else {
      setIsEditModalOpen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <DialogueFlowStyles />
      <div className="absolute inset-0 backdrop-blur-sm"></div>
      <div ref={modalRef} className="bg-[#1e1c1b] bg-opacity-75 border border-[#534741] rounded-lg shadow-lg p-4 w-[90%] h-[80%] max-w-5xl mx-4 fantasy-bg relative z-10 backdrop-filter backdrop-blur-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className={`text-[#f4e8c1] text-lg ${serifFontClass}`}>{t("dialogue.treeVisualization")}</h3>
          <button 
            onClick={(e) => {trackButtonClick("DialogueTreeModal", "关闭对话树");onClose();}}
            className="text-[#8a8a8a] hover:text-amber-400 transition-colors duration-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        {!characterId ? (
          <div className="h-[calc(100%-6rem)] w-full flex flex-col items-center justify-center">
            <div className="text-center p-6 border border-[#534741] rounded-lg bg-[#1c1c1c] max-w-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1a35c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <h4 className={`text-amber-400 mb-3 ${serifFontClass}`}>{t("dialogue.noCharacterSelected")}</h4>
              <p className={`text-[#f4e8c1] mb-4 ${fontClass}`}>{t("dialogue.selectCharacterFirst")}</p>
              <button 
                onClick={(e) => {trackButtonClick("DialogueTreeModal", "关闭对话树");onClose();}}
                className={`px-4 py-2 bg-[#2a2825] hover:bg-[#3a3835] text-amber-400 rounded-md transition-all duration-300 border border-amber-700 hover:shadow-[0_0_8px_rgba(251,146,60,0.4)] ${fontClass}`}
              >
                {t("common.return")}
              </button>
            </div>
          </div>
        ) : !dataLoaded ? (
          <div className="h-[calc(100%-6rem)] w-full flex flex-col items-center justify-center">
            <div className="text-center p-6 border border-[#534741] rounded-lg bg-[#1c1c1c] max-w-lg">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-400 mx-auto mb-4"></div>
              <p className={`text-[#f4e8c1] ${fontClass}`}>{t("dialogue.loadingDialogue")}</p>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="h-[calc(100%-6rem)] w-full flex flex-col items-center justify-center">
            <div className="text-center p-6 border border-[#534741] rounded-lg bg-[#1c1c1c] max-w-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1a35c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <h4 className={`text-amber-400 mb-3 ${serifFontClass}`}>{t("dialogue.noDialogueNodes")}</h4>
              <p className={`text-[#f4e8c1] mb-4 ${fontClass}`}>{t("dialogue.startConversation")}</p>
              <button 
                onClick={(e) => {trackButtonClick("DialogueTreeModal", "关闭对话树");onClose();}}
                className={`px-4 py-2 bg-[#2a2825] hover:bg-[#3a3835] text-amber-400 rounded-md transition-all duration-300 border border-amber-700 hover:shadow-[0_0_8px_rgba(251,146,60,0.4)] ${fontClass}`}
              >
                {t("common.return") || "返回"}
              </button>
            </div>
          </div>
        ) : (          <div className="h-[calc(100%-6rem)] w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            onInit={handleFlowInit}
            proOptions={{ hideAttribution: true }}
            connectionLineType={ConnectionLineType.SmoothStep}
            defaultEdgeOptions={defaultEdgeOptions}
            ref={flowRef}
          >
            <MiniMap 
              nodeStrokeWidth={3}
              nodeColor="#d1a35c"
              maskColor="rgba(30, 28, 27, 0.5)"
              className="fantasy-bg border border-[#534741] rounded-md shadow-md overflow-hidden"
              style={{
                backgroundColor: "rgba(28, 28, 27, 0.7)",
                border: "1px solid #534741",
                borderRadius: "0.375rem",
              }}
            />
            <Background color="#534741" gap={16} size={1.5} />
            <Panel position="top-right" className="fantasy-bg border border-[#534741] p-3 rounded-md shadow-md">
              <div className="flex flex-col space-y-2">
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 mr-2">
                    <polyline points="15 10 20 15 15 20"></polyline>
                    <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
                  </svg>
                  <span className={`text-[#d1a35c] text-xs ${fontClass}`}>{t("dialogue.jumpToNode")}</span>
                </div>
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 mr-2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  <span className={`text-[#d1a35c] text-xs ${fontClass}`}>{t("dialogue.expandNode")}</span>
                </div>
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 mr-2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  <span className={`text-[#d1a35c] text-xs ${fontClass}`}>{t("dialogue.editNode")}</span>
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </div>
        )}
                
        {isEditModalOpen && selectedNode && (
          <div className="absolute inset-0 flex items-center justify-center backdrop-blur-md z-20">
            <div ref={editModalRef} className="bg-[#1e1c1b] bg-opacity-85 border border-[#534741] rounded-lg p-6 w-[80%] max-w-2xl backdrop-filter backdrop-blur-sm shadow-lg">
              <div className="flex justify-between items-center mb-4">
                <h4 className={`text-[#f4e8c1] text-lg ${serifFontClass}`}>{t("dialogue.editNode") || "编辑对话节点"}</h4>
                <button 
                  onClick={(e) => {trackButtonClick("DialogueTreeModal", "关闭编辑对话");setIsEditModalOpen(false);}}
                  className="text-[#8a8a8a] hover:text-amber-400 transition-colors duration-300"
                  aria-label={t("common.close")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
                      
              <div className="fantasy-bg border border-[#534741] rounded-md p-3 mb-4 shadow-inner">
                <h5 className={`text-amber-400 text-sm mb-2 ${serifFontClass}`}>{t("dialogue.memorySummary")}:</h5>
                <div className="ml-2">
                  <ol className={`list-decimal list-inside ${fontClass} text-[#f4e8c1] text-sm`}>
                    {selectedNode.data.label.split(/——>|-->|->/).map((step, index) => (
                      <li key={index} className="mb-1">{step.trim()}</li>
                    ))}
                  </ol>
                </div>
              </div>
                      
              <div className="space-y-4">
                <div>
                  <label className={`block text-[#d1a35c] text-sm mb-2 ${serifFontClass}`}>
                    <span className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                      {t("dialogue.response")}
                    </span>
                  </label>
                  <textarea 
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className={`w-full h-64 p-3 bg-[#121212] border border-[#444444] rounded-md text-[#f4e8c1] fantasy-scrollbar focus:outline-none focus:border-amber-400 ${fontClass} text-sm leading-relaxed`}
                    placeholder={t("dialogue.responsePlaceholder")}
                  />
                </div>
              </div>
                      
              <div className="flex justify-end gap-5 mt-4">
                <button 
                  onClick={(e) => {trackButtonClick("DialogueTreeModal", "关闭编辑对话");setIsEditModalOpen(false);}}
                  className={`text-[#8a8a8a] hover:text-amber-400 transition-colors duration-300 ${serifFontClass}`}
                  aria-label={t("common.cancel")}
                  disabled={isSaving}
                >
                  {t("common.cancel")}
                </button>
                {isSaving ? (
                  <div className="relative w-8 h-8">
                    <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
                    <div className="absolute inset-1 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
                  </div>
                ) : (
                  <button 
                    onClick={(e) => {trackButtonClick("DialogueTreeModal", "保存编辑对话");saveEditContent();}}
                    className={`text-amber-400 hover:text-amber-300 transition-colors duration-300 ${serifFontClass}`}
                    aria-label={t("common.save")}
                  >
                    {t("common.save")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
