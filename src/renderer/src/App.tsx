import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Background,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnNodeDrag,
  type OnConnectEnd,
  type OnConnectStart,
  type OnMove,
  PanOnScrollMode,
  type ReactFlowInstance,
  applyNodeChanges,
  applyEdgeChanges,
  type EdgeTypes,
  type NodeTypes,
  SelectionMode,
  getBezierPath,
  Position,
  type ConnectionLineComponentProps
} from "@xyflow/react";
import { nanoid } from "nanoid";
import type {
  AchievementState,
  AppUpdateState,
  AssistantProvider,
  Attachment,
  AttachmentInput,
  CanvasGroup,
  CanvasGroupLayout,
  LanguagePreference,
  OpenProjectResult,
  PixverseCreateMode,
  PixverseGenerationParameter,
  ReplicationCategoryField,
  ReplicationDifference,
  ReplicationMode,
  RunMode,
  ScatterDocument,
  ScatterEdge,
  ScatterNode,
  ScatterNodeData,
  ScatterProjectInfo,
  ThemePreference,
  WorkflowNodeKind
} from "../../shared/types";
import { defaultAchievementState, defaultAppSettings } from "../../shared/types";
import { buildMarkdown } from "./lib/markdown";
import { I18nProvider } from "./lib/i18n";
import { shortcuts } from "./lib/shortcuts";
import { createTranslator } from "./lib/translations";
import {
  alignSelectedNodes,
  applyGroupLayoutPositions,
  applyPositionPatch,
  collectGroupMemberIds,
  collectGroupTreeIds,
  defaultGroupLayout,
  distributeSelectedNodes,
  groupFrameBox,
  groupNodes,
  planGroupAfterDrag,
  pruneGroupsAfterNodeRemoval,
  recommendSelectionLayoutAction,
  renderedGroupFrames,
  tidyUpNodes,
  ungroupGroups,
  syncNodeGroupsToSections,
  type CanvasBox,
  type AlignMode,
  type DistributeAxis
} from "./domain/canvasGrouping";
import { achievements, type AchievementDefinition } from "./lib/achievements";
import { AchievementToast } from "./components/AchievementToast";
import { AchievementsWall } from "./components/AchievementsWall";
import { AccessibilityPermissionDialog } from "./components/AccessibilityPermissionDialog";
import { AssistantProviderPreferenceDialog } from "./components/AssistantProviderPreferenceDialog";
import { Sidebar } from "./components/Sidebar";
import { ScatterEdge as ScatterFlowEdge } from "./components/ScatterEdge";
import { SearchDialog } from "./components/SearchDialog";
import { SettingsDialog, type SettingsValues } from "./components/SettingsDialog";
import { Topbar } from "./components/Topbar";
import { RightDrawer } from "./components/RightDrawer";
import { TaskNode, setTaskNodeActions } from "./components/TaskNode";
import { DropdownMenu, DropdownMenuItem } from "./components/ui/dropdown-menu";
import { Icon } from "./components/ui/icon";
import { IconButton } from "./components/ui/icon-button";
import { TooltipAnchor } from "./components/ui/tooltip";
import { ToolbarItem } from "./components/ui/toolbar-item";
import { CanvasGroupLayoutControls } from "./components/CanvasGroupLayoutControls";
import { useScatterStore } from "./store/scatterStore";
import { createWorkflowNode } from "./domain/seedanceWorkflow";
import { preventNodeOverlaps } from "./domain/nodeCollisions";
import { createTemplateReplicationDemoDocument } from "./domain/templateReplicationDemo";
import { hasContinuousVideoSegmentCoverage, normalizeReplicationScopes, parseReplicationSections, replicationSectionSpecs, replicationScopeSectionSpecs, type ReplicationScopeKind } from "./domain/replicationSections";
import { geminiPhotoReversePrompt, parseGeminiPhotoAnalysis } from "./domain/geminiPhotoAnalysis";
import {
  depthOutputVideoIds,
  targetAnalysisVideoIds,
  canUseGenerationMedia,
  normalizeTaskAssignments,
  isValidAlias,
  defaultAliasFor,
  replaceAliasInBody,
  updateTaskReferenceRole,
  isReplicationPipelineCompatible,
  isReplicationPromptCompatible
} from "./domain/referenceAssignments";
import { type MediaAccept } from "./components/nodeRuntimeActions";
import startupBulbImage from "./assets/startup-bulb.jpg";
import "@xyflow/react/dist/style.css";
import "./styles/app.css";

const nodeTypes = { task: TaskNode } satisfies NodeTypes;
const edgeTypes = { scatter: ScatterFlowEdge } satisfies EdgeTypes;
const defaultEdgeOptions = { type: "scatter" };
const proOptions = { hideAttribution: true };
const TASK_NODE_WIDTH = 400;
const TASK_NODE_HEIGHT = 220;
const TASK_NODE_HORIZONTAL_GAP = 180;
const TASK_NODE_VERTICAL_GAP = 72;
const NODE_CONNECT_BUTTON_SIZE = 20;
const MARKDOWN_PANEL_DEFAULT_RATIO = 0.5;
const MARKDOWN_PANEL_MIN_WIDTH = 360;
const zoomOptions = [
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
  { label: "150%", value: 1.5 },
  { label: "200%", value: 2 }
];

const initialUpdateState = {
  status: "idle",
  currentVersion: "0.0.0",
  isPackaged: false,
  canCheck: false,
  canInstall: false
} satisfies AppUpdateState;

type FlowPosition = { x: number; y: number };
type MeasuredScatterNode = ScatterNode & { measured?: { width?: number; height?: number } };
type AppView = "canvas" | "achievements";
type CanvasTool = "select" | "pan" | "section";
type GroupResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type ConnectedNodeSide = "left" | "right";
interface ConnectionStart {
  nodeId: string;
  handleType: "source" | "target";
  handleId?: string;
}
interface ConnectionHoverTarget {
  sourceId: string;
  targetId: string;
  hoveredNodeId: string;
}
interface OptionDuplicateDrag {
  sourceId: string;
  duplicateId: string;
  originalNodes: ScatterNode[];
  lastPosition: FlowPosition;
  hasPreview: boolean;
}

const CONNECTION_PREVIEW_EDGE_ID = "__scatter-connection-preview__";

function connectionLineStartX(x: number, position: Position): number {
  const offset = NODE_CONNECT_BUTTON_SIZE / 2;
  if (position === Position.Left) return x - offset;
  if (position === Position.Right) return x + offset;
  return x;
}

function ScatterConnectionLine({
  connectionLineStyle,
  fromPosition,
  fromX,
  fromY,
  toPosition,
  toX,
  toY
}: ConnectionLineComponentProps): ReactElement {
  const [path] = getBezierPath({
    sourceX: connectionLineStartX(fromX, fromPosition),
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    curvature: 0.45
  });

  return <path className="scatter-connection-path" d={path} style={connectionLineStyle} />;
}

function systemColorTheme(): "light" | "dark" {
  if (!window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function roundPosition(position: FlowPosition): FlowPosition {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function scatterEdgesEqual(left: ScatterEdge[], right: ScatterEdge[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((edge, index) => {
    const other = right[index];
    return edge.id === other.id
      && edge.source === other.source
      && edge.sourceHandle === other.sourceHandle
      && edge.target === other.target
      && edge.targetHandle === other.targetHandle
      && edge.label === other.label
      && JSON.stringify(edge.routePoints || []) === JSON.stringify(other.routePoints || []);
  });
}

function scatterNodesEqualForLive(left: ScatterNode[], right: ScatterNode[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((node, index) => {
    const other = right[index];
    return (
      node.id === other.id &&
      node.type === other.type &&
      node.position.x === other.position.x &&
      node.position.y === other.position.y &&
      node.width === other.width &&
      node.height === other.height &&
      node.selected === other.selected &&
      node.data === other.data
    );
  });
}

function eventClientPosition(event: MouseEvent | TouchEvent): FlowPosition | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  return { x: event.clientX, y: event.clientY };
}

function nodeIdFromConnectionEvent(event: MouseEvent | TouchEvent): string | null {
  const clientPosition = eventClientPosition(event);
  const pointTarget = clientPosition ? document.elementFromPoint(clientPosition.x, clientPosition.y) : null;
  const eventTarget = event.target instanceof Element ? event.target : null;

  for (const target of [pointTarget, eventTarget]) {
    const nodeElement = target?.closest(".react-flow__node[data-id]");
    const nodeId = nodeElement?.getAttribute("data-id");
    if (nodeId) return nodeId;
  }

  return null;
}

function nodeBounds(node: ScatterNode): { width: number; height: number } {
  const measured = (node as MeasuredScatterNode).measured;
  const renderedNode = typeof document === "undefined" || typeof CSS === "undefined"
    ? null
    : document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);

  return {
    width: renderedNode?.offsetWidth || measured?.width || node.width || TASK_NODE_WIDTH,
    height: renderedNode?.offsetHeight || measured?.height || node.height || TASK_NODE_HEIGHT
  };
}

function positionOverlapsNode(position: FlowPosition, node: ScatterNode): boolean {
  const margin = 32;
  const bounds = nodeBounds(node);
  const left = position.x;
  const right = position.x + TASK_NODE_WIDTH;
  const top = position.y;
  const bottom = position.y + TASK_NODE_HEIGHT;
  const nodeLeft = node.position.x - margin;
  const nodeRight = node.position.x + bounds.width + margin;
  const nodeTop = node.position.y - margin;
  const nodeBottom = node.position.y + bounds.height + margin;

  return left < nodeRight && right > nodeLeft && top < nodeBottom && bottom > nodeTop;
}

function isOpenPosition(position: FlowPosition, nodes: ScatterNode[]): boolean {
  return nodes.every((node) => !positionOverlapsNode(position, node));
}

function positionIntersectsNode(position: FlowPosition, node: ScatterNode): boolean {
  const bounds = nodeBounds(node);
  const left = position.x;
  const right = position.x + TASK_NODE_WIDTH;
  const top = position.y;
  const bottom = position.y + TASK_NODE_HEIGHT;
  const nodeLeft = node.position.x;
  const nodeRight = node.position.x + bounds.width;
  const nodeTop = node.position.y;
  const nodeBottom = node.position.y + bounds.height;

  return left < nodeRight && right > nodeLeft && top < nodeBottom && bottom > nodeTop;
}

function isConnectionDropPositionOpen(position: FlowPosition, nodes: ScatterNode[]): boolean {
  return nodes.every((node) => !positionIntersectsNode(position, node));
}

function findConnectionDropPosition(dropPosition: FlowPosition, handleType: ConnectionStart["handleType"], sourceNode: ScatterNode, nodes: ScatterNode[]): FlowPosition {
  const sourceBounds = nodeBounds(sourceNode);
  const directionalGap = 16;
  const base = roundPosition({
    x: handleType === "source" ? dropPosition.x : dropPosition.x - TASK_NODE_WIDTH,
    y: dropPosition.y - TASK_NODE_HEIGHT / 2
  });

  const directionAdjusted = positionIntersectsNode(base, sourceNode)
    ? roundPosition({
        ...base,
        x: handleType === "source" ? sourceNode.position.x + sourceBounds.width + directionalGap : sourceNode.position.x - TASK_NODE_WIDTH - directionalGap
      })
    : base;
  if (isConnectionDropPositionOpen(directionAdjusted, nodes)) return directionAdjusted;

  const offsets = [0, 48, -48, 96, -96, 144, -144, 192, -192, 240, -240, 288, -288];
  for (const yOffset of offsets) {
    const candidate = roundPosition({
      x: directionAdjusted.x,
      y: directionAdjusted.y + yOffset
    });
    if (isConnectionDropPositionOpen(candidate, nodes)) return candidate;
  }

  for (const xOffset of offsets.slice(1)) {
    for (const yOffset of offsets) {
      const candidate = roundPosition({
        x: directionAdjusted.x + xOffset,
        y: directionAdjusted.y + yOffset
      });
      if (isConnectionDropPositionOpen(candidate, nodes)) return candidate;
    }
  }

  return directionAdjusted;
}

function findOpenPositionNear(preferred: FlowPosition, nodes: ScatterNode[]): FlowPosition {
  const base = roundPosition(preferred);
  if (isOpenPosition(base, nodes)) return base;

  const stepX = TASK_NODE_WIDTH + TASK_NODE_HORIZONTAL_GAP;
  const stepY = TASK_NODE_HEIGHT + TASK_NODE_VERTICAL_GAP;
  for (let ring = 1; ring <= 6; ring += 1) {
    for (let column = -ring; column <= ring; column += 1) {
      for (let row = -ring; row <= ring; row += 1) {
        if (Math.abs(column) !== ring && Math.abs(row) !== ring) continue;
        const candidate = roundPosition({
          x: preferred.x + column * stepX,
          y: preferred.y + row * stepY
        });
        if (isOpenPosition(candidate, nodes)) return candidate;
      }
    }
  }

  return base;
}

function findOpenPositionToRight(preferred: FlowPosition, nodes: ScatterNode[]): FlowPosition {
  const base = roundPosition(preferred);
  if (isOpenPosition(base, nodes)) return base;

  const stepX = TASK_NODE_WIDTH + TASK_NODE_HORIZONTAL_GAP;
  const stepY = TASK_NODE_HEIGHT + TASK_NODE_VERTICAL_GAP;
  const rowOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
  for (let column = 0; column <= 4; column += 1) {
    for (const row of rowOffsets) {
      const candidate = roundPosition({
        x: preferred.x + column * stepX,
        y: preferred.y + row * stepY
      });
      if (isOpenPosition(candidate, nodes)) return candidate;
    }
  }

  return base;
}

function findOpenPositionToLeft(preferred: FlowPosition, nodes: ScatterNode[]): FlowPosition {
  const base = roundPosition(preferred);
  if (isOpenPosition(base, nodes)) return base;

  const stepX = TASK_NODE_WIDTH + TASK_NODE_HORIZONTAL_GAP;
  const stepY = TASK_NODE_HEIGHT + TASK_NODE_VERTICAL_GAP;
  const rowOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
  for (let column = 0; column <= 4; column += 1) {
    for (const row of rowOffsets) {
      const candidate = roundPosition({
        x: preferred.x - column * stepX,
        y: preferred.y + row * stepY
      });
      if (isOpenPosition(candidate, nodes)) return candidate;
    }
  }

  return base;
}

function connectionFromStart(connectionStart: ConnectionStart, targetNodeId: string): Pick<ScatterEdge, "source" | "sourceHandle" | "target" | "targetHandle"> | null {
  if (connectionStart.nodeId === targetNodeId) return null;

  return connectionStart.handleType === "source"
    ? { source: connectionStart.nodeId, sourceHandle: connectionStart.handleId, target: targetNodeId }
    : { source: targetNodeId, target: connectionStart.nodeId, targetHandle: connectionStart.handleId };
}

function isConnectionAllowed(connection: Pick<ScatterEdge, "source" | "sourceHandle" | "target" | "targetHandle">, edges: ScatterEdge[], nodes: ScatterNode[]): boolean {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target && (!connection.sourceHandle || edge.sourceHandle === connection.sourceHandle) && (!connection.targetHandle || edge.targetHandle === connection.targetHandle))) return false;
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  const pendingEdges = [...edges, { ...connection, id: "pending-replication-connection" }];
  const replicationModeOf = (node: ScatterNode | undefined): ReplicationMode | undefined => node?.data.replicationMode
    || (node?.data.pixverseMode === "image" ? "photo" : node?.data.pixverseMode === "video" ? "video" : undefined)
    || (node ? inferReplicationMode(node, nodes, pendingEdges) : undefined);

  if (targetNode?.data.nodeKind === "generic-prompt"
    && (sourceNode?.data.nodeKind === "replication-analysis"
      || sourceNode?.data.nodeKind === "replication-section"
      || sourceNode?.data.nodeKind === "replication-comparison")) {
    const sourceMode = replicationModeOf(sourceNode);
    const targetMode = replicationModeOf(targetNode);
    const sourceAnalysisId = sourceNode.data.nodeKind === "replication-analysis"
      ? sourceNode.id
      : sourceNode.data.replicationAnalysisNodeId;
    if (!isReplicationPromptCompatible(sourceMode, targetMode, sourceAnalysisId, targetNode.data.replicationAnalysisNodeId)) return false;
  }

  if (connection.targetHandle) {
    if (edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)) return false;
  } else {
    if (targetNode?.data.nodeKind === "pixverse-generation") {
      const sourceKind = sourceNode?.data.nodeKind;
      const isTargetAnalysisVideo = sourceKind === "video-reference" && Boolean(sourceNode && targetAnalysisVideoIds(nodes, edges).has(sourceNode.id));
      const isDepthOutput = Boolean(sourceNode && depthOutputVideoIds(nodes, edges).has(sourceNode.id));
      const targetMode = replicationModeOf(targetNode);
      const sourceMode = sourceKind === "generic-prompt" ? replicationModeOf(sourceNode) : undefined;
      const belongsToVideoReplication = targetNode.data.replicationMode === "video"
        || Boolean(targetNode.data.replicationAnalysisNodeId)
        || sourceMode === "video";
      if (sourceKind === "generic-prompt" && !isReplicationPromptCompatible(sourceMode, targetMode,
        sourceNode?.data.replicationAnalysisNodeId, targetNode.data.replicationAnalysisNodeId)) return false;
      if (belongsToVideoReplication && sourceKind === "video-reference" && !isDepthOutput) return false;
      return (!sourceKind || sourceKind === "image-reference" || sourceKind === "video-reference" || sourceKind === "task" || sourceKind === "generic-prompt" || sourceKind === "seedance-generation")
        && (!isTargetAnalysisVideo || isDepthOutput);
    }
    if (targetNode?.data.nodeKind === "replication-comparison") {
      const expectedMediaKind = targetNode.data.replicationMode === "photo" ? "image" : "video";
      const incomingCount = edges.filter((edge) => edge.target === targetNode.id && !edge.targetHandle).length;
      const sourceMediaKind = sourceNode?.data.mediaKind
        || (sourceNode?.data.nodeKind === "image-reference" ? "image" : sourceNode?.data.nodeKind === "video-reference" ? "video" : undefined);
      return incomingCount < 2
        && (sourceNode?.data.nodeKind === "image-reference" || sourceNode?.data.nodeKind === "video-reference")
        && sourceMediaKind === expectedMediaKind;
    }
    if (targetNode?.data.nodeKind === "generic-prompt"
      && (sourceNode?.data.nodeKind === "replication-analysis"
        || sourceNode?.data.nodeKind === "replication-section"
        || sourceNode?.data.nodeKind === "replication-comparison")) return true;
    const incomingEdges = edges.filter((edge) => edge.target === connection.target);
    const isTaskTarget = !targetNode?.data.nodeKind || targetNode.data.nodeKind === "task" || targetNode.data.nodeKind === "generic-prompt" || targetNode.data.nodeKind === "seedance-generation";
    const isMediaReferenceSource = sourceNode?.data.nodeKind === "image-reference" || sourceNode?.data.nodeKind === "video-reference";

    if (isTaskTarget && isMediaReferenceSource) return true;
    if (incomingEdges.some((edge) => {
      const parent = nodes.find((node) => node.id === edge.source);
      return parent?.data.nodeKind !== "image-reference" && parent?.data.nodeKind !== "video-reference";
    })) return false;
    if (incomingEdges.length && !isTaskTarget) return false;
  }
  return true;
}

function inferReplicationMode(node: ScatterNode, nodes: ScatterNode[], edges: ScatterEdge[]): ReplicationMode | undefined {
  if (node.data.replicationMode) return node.data.replicationMode;
  const parentModes = new Set(edges
    .filter((edge) => edge.target === node.id && !edge.targetHandle)
    .map((edge) => nodes.find((parent) => parent.id === edge.source))
    .map((parent) => parent?.data.replicationMode
      || (parent?.data.mediaKind === "image" ? "photo" : parent?.data.mediaKind === "video" ? "video" : undefined))
    .filter((mode): mode is ReplicationMode => mode === "photo" || mode === "video"));
  return parentModes.size === 1 ? [...parentModes][0] : undefined;
}

function promptForReplicationAnalysis(
  nodes: ScatterNode[],
  edges: ScatterEdge[],
  analysisNodeId: string,
  mode: ReplicationMode
): ScatterNode | undefined {
  const analysisSectionIds = new Set(nodes
    .filter((node) => node.data.nodeKind === "replication-section" && node.data.replicationAnalysisNodeId === analysisNodeId)
    .map((node) => node.id));
  const linkedPromptIds = new Set(edges
    .filter((edge) => analysisSectionIds.has(edge.source))
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter((node): node is ScatterNode => node?.data.nodeKind === "generic-prompt")
    .map((node) => node.id));
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source);
    if (source?.data.nodeKind !== "replication-analysis"
      && !(source?.data.nodeKind === "replication-comparison" && source.data.replicationAnalysisNodeId === analysisNodeId)) continue;
    if (edge.source !== analysisNodeId && source?.data.replicationAnalysisNodeId !== analysisNodeId) continue;
    const target = nodes.find((node) => node.id === edge.target);
    if (target?.data.nodeKind === "generic-prompt") linkedPromptIds.add(target.id);
  }
  return nodes
    .filter((node) => {
      if (node.data.nodeKind !== "generic-prompt"
        || (node.data.replicationAnalysisNodeId !== analysisNodeId && !linkedPromptIds.has(node.id))
        || (node.data.replicationAnalysisNodeId && node.data.replicationAnalysisNodeId !== analysisNodeId)) return false;
      const hasForeignSectionInputs = edges.some((edge) => {
        if (edge.target !== node.id) return false;
        const source = nodes.find((candidate) => candidate.id === edge.source);
        return source?.data.nodeKind === "replication-section"
          && (source.data.replicationAnalysisNodeId !== analysisNodeId || (source.data.replicationMode && source.data.replicationMode !== mode));
      });
      if (hasForeignSectionInputs) return false;
      const inferredMode = node.data.replicationMode || inferReplicationMode(node, nodes, edges);
      return inferredMode === mode || (!inferredMode && node.data.replicationAnalysisNodeId === analysisNodeId);
    })
    .sort((a, b) => Number(b.data.replicationAnalysisNodeId === analysisNodeId) - Number(a.data.replicationAnalysisNodeId === analysisNodeId))[0];
}

function edgesForExistingNodes(edges: ScatterEdge[], nodes: ScatterNode[]): ScatterEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function nextSectionName(groups: CanvasGroup[], formatName: (index: number) => string): string {
  const existingNames = new Set(groups.map((group) => group.name));
  let index = 1;
  while (existingNames.has(formatName(index))) index += 1;
  return formatName(index);
}

function defaultTaskTitle(nodes: ScatterNode[], t: ReturnType<typeof createTranslator>): string {
  const nextNumber =
    nodes.reduce((max, node) => {
      const match = /^(?:新建任务|New task)\s+(\d+)$/.exec(node.data.title.trim());
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return t("task.defaultTitle", { count: nextNumber });
}

function emptyNode(position: { x: number; y: number }, existingNodes: ScatterNode[], t: ReturnType<typeof createTranslator>): ScatterNode {
  return {
    id: nanoid(),
    type: "task",
    position,
    data: {
      nodeKind: "task",
      title: defaultTaskTitle(existingNodes, t),
      body: "",
      attachments: [],
      effort: "xhigh",
      planMode: false,
      runMode: "flow"
    }
  };
}

function cloneCanvasNode(node: ScatterNode): ScatterNode {
  return {
    ...node,
    position: { ...node.position },
    data: {
      ...node.data,
      attachments: node.data.attachments.map((attachment) => ({ ...attachment }))
    }
  };
}

function duplicateNodeAt(source: ScatterNode, position: FlowPosition, id = nanoid()): ScatterNode {
  return {
    ...cloneCanvasNode(source),
    id,
    selected: true,
    position: roundPosition(position)
  };
}

function optionDuplicatePreviewNodes(drag: OptionDuplicateDrag, position: FlowPosition): ScatterNode[] {
  const source = drag.originalNodes.find((node) => node.id === drag.sourceId);
  if (!source) return drag.originalNodes.map(cloneCanvasNode);

  const restoredNodes = drag.originalNodes.map((node) => ({
    ...cloneCanvasNode(node),
    selected: false
  }));
  return [...restoredNodes, duplicateNodeAt(source, position, drag.duplicateId)];
}

function nodeForDocument(node: ScatterNode): ScatterNode {
  const { attachments, ...dataRest } = node.data;
  const documentNode: ScatterNode = {
    id: node.id,
    type: "task",
    position: { ...node.position },
    data: {
      ...dataRest,
      attachments: attachments.map((attachment) => ({ ...attachment }))
    } as ScatterNodeData
  };

  if (typeof node.width === "number") documentNode.width = node.width;
  if (typeof node.height === "number") documentNode.height = node.height;
  return documentNode;
}

function edgeForDocument(edge: ScatterEdge): ScatterEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    label: edge.label,
    ...(edge.routePoints?.length ? { routePoints: edge.routePoints.map((point) => ({ ...point })) } : {})
  };
}

function groupForDocument(group: CanvasGroup): CanvasGroup {
  const doc: CanvasGroup = {
    id: group.id,
    name: group.name,
    nodeIds: [...group.nodeIds],
    childGroupIds: [...group.childGroupIds]
  };
  if (group.bounds) doc.bounds = { ...group.bounds };
  if (group.parentGroupId) doc.parentGroupId = group.parentGroupId;
  if (group.layout) doc.layout = group.layout;
  return doc;
}

function toDocument(
  projectName: string,
  nodes: ScatterNode[],
  edges: ScatterEdge[],
  groups: CanvasGroup[] = [],
  executionMode?: ScatterDocument["executionMode"]
): ScatterDocument {
  return {
    version: 1,
    projectName,
    updatedAt: new Date().toISOString(),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodes.map(nodeForDocument),
    edges: edges.map(edgeForDocument),
    ...(groups.length ? { groups: groups.map(groupForDocument) } : {}),
    ...(executionMode ? { executionMode } : {})
  };
}

function documentContentKey(
  projectName: string,
  nodes: ScatterNode[],
  edges: ScatterEdge[],
  groups: CanvasGroup[] = [],
  executionMode?: ScatterDocument["executionMode"]
): string {
  const document = toDocument(projectName, nodes, edges, groups, executionMode);
  return JSON.stringify({
    projectName: document.projectName,
    viewport: document.viewport,
    nodes: document.nodes,
    edges: document.edges,
    groups: document.groups ?? [],
    executionMode: document.executionMode
  });
}

async function filesToInputs(files: FileList | File[], source: "upload" | "drop" | "paste"): Promise<AttachmentInput[]> {
  const inputs: AttachmentInput[] = [];
  for (const file of Array.from(files)) {
    const maybePath = (file as File & { path?: string }).path;
    if (maybePath) {
      inputs.push({
        name: file.name,
        mime: file.type,
        source,
        path: maybePath
      });
      continue;
    }

    const bytes = await file.arrayBuffer();
    inputs.push({
      name: file.name || `pasted-${Date.now()}`,
      mime: file.type,
      source,
      bytes
    });
  }
  return inputs;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function App(): ReactElement {
  const {
    project,
    document: scatterDocument,
    nodes,
    edges,
    groups,
    selectedNodeId,
    drawer,
    theme,
    canUndo,
    canRedo,
    setProjectDocument,
    clearProject,
    replaceCanvasLive,
    commitCanvasChange,
    beginHistoryTransaction,
    commitHistoryTransaction,
    cancelHistoryTransaction,
    undo,
    redo,
    updateNodeData,
    appendAttachments,
    setSelectedNodeId,
    setDrawer,
    setTheme,
    setStatus,
    setPixverseImageDefaultModel: setCommittedPixverseImageDefaultModel,
    setRunningNodeId,
    setSaving,
    removeAttachment,
    markNodeRun
  } = useScatterStore();

  // Recover legacy depth outputs in the currently open canvas as well as when
  // a project is loaded. Some saved graphs contain the output node reference
  // but are missing the corresponding edge.
  // Return node data with per-task reference allocations normalized (seed a
  // stable alias for newly connected media, prune dangling records). This is
  // applied to the SAME commit as edge/node structural changes so an alias is
  // never written as a separate history entry that undo could fight.
  const normalizeReferenceNodes = useCallback(
    (baseNodes: ScatterNode[], baseEdges: ScatterEdge[]): ScatterNode[] => {
      const depthOutputIds = depthOutputVideoIds(baseNodes, baseEdges);
      return baseNodes.map((node) => {
        const kind = node.data.nodeKind;
        if (kind && !["task", "generic-prompt", "seedance-generation", "pixverse-generation"].includes(kind)) return node;
        const { assignments, body } = normalizeTaskAssignments(node, baseNodes, baseEdges, depthOutputIds);
        if (assignments === node.data.referenceAssignments && body === undefined) return node;
        return {
          ...node,
          data: {
            ...node.data,
            referenceAssignments: assignments,
            ...(body !== undefined ? { body } : {})
          }
        };
      });
    },
    []
  );

  useEffect(() => {
    const existingPairs = new Set(edges.map((edge) => `${edge.source}\u0000${edge.target}`));
    const restoredEdges = nodes.flatMap((node) => {
      if (node.data.nodeKind !== "depth-conversion" || !node.data.depthOutputNodeId) return [];
      const outputId = node.data.depthOutputNodeId;
      const outputNode = nodes.find((candidate) => candidate.id === outputId && candidate.data.nodeKind === "video-reference");
      if (!outputNode) return [];
      const hasOtherVideoOutput = edges.some((edge) => edge.source === node.id
        && edge.target !== outputId
        && nodes.some((candidate) => candidate.id === edge.target && candidate.data.nodeKind === "video-reference"));
      const pair = `${node.id}\u0000${outputId}`;
      if (hasOtherVideoOutput || existingPairs.has(pair)) return [];
      existingPairs.add(pair);
      return [{ id: nanoid(), source: node.id, target: outputId }];
    });
    if (restoredEdges.length) {
      const nextEdges = [...edges, ...restoredEdges];
      commitCanvasChange({ nodes: normalizeReferenceNodes(nodes, nextEdges), edges: nextEdges });
    }
  }, [commitCanvasChange, edges, nodes, normalizeReferenceNodes]);

  const [recentProjects, setRecentProjects] = useState<ScatterProjectInfo[]>([]);
  const [achievementState, setAchievementState] = useState<AchievementState>(() => ({
    ...defaultAchievementState,
    unlockedAt: {},
    projectPaths: [],
    usageDates: []
  }));
  const [achievementToastQueue, setAchievementToastQueue] = useState<AchievementDefinition[]>([]);
  const [activeView, setActiveView] = useState<AppView>("canvas");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(defaultAppSettings.themePreference);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => systemColorTheme());
  const [language, setLanguage] = useState<LanguagePreference>(defaultAppSettings.language);
  const [translucentBackground, setTranslucentBackground] = useState<boolean>(defaultAppSettings.translucentBackground);
  const [assistantProvider, setAssistantProvider] = useState<AssistantProvider>(defaultAppSettings.assistantProvider);
  const [pixverseImageDefaultModel, setPixverseImageDefaultModel] = useState(defaultAppSettings.pixverseImageDefaultModel);
  const [assistantProviderOnboardingCompleted, setAssistantProviderOnboardingCompleted] = useState<boolean>(
    defaultAppSettings.assistantProviderOnboardingCompleted
  );
  const [assistantProviderPreferenceOpen, setAssistantProviderPreferenceOpen] = useState(false);
  const [accessibilityPermissionOpen, setAccessibilityPermissionOpen] = useState(false);
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [updateState, setUpdateState] = useState<AppUpdateState>(initialUpdateState);
  const [markdownPanelRatio, setMarkdownPanelRatio] = useState(MARKDOWN_PANEL_DEFAULT_RATIO);
  const [isResizingMarkdownPanel, setIsResizingMarkdownPanel] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionHoverTarget | null>(null);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("select");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingGroupName, setRenamingGroupName] = useState("");
  const [sectionDraft, setSectionDraft] = useState<CanvasBox | null>(null);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [shiftSelectionActive, setShiftSelectionActive] = useState(false);
  const [viewportZoom, setViewportZoom] = useState(1);
  const [canvasViewport, setCanvasViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [canvasRevealActive, setCanvasRevealActive] = useState(false);
  const windowSearchParams = new URLSearchParams(window.location.search);
  const isSplashWindow = windowSearchParams.get("window") === "splash";
  const appVersion = windowSearchParams.get("version")?.trim() || "0.0.0";
  const appPlatform = windowSearchParams.get("platform")?.trim() || "darwin";
  const isWindows = appPlatform === "win32";
  const supportsMacAutomation = appPlatform === "darwin";
  const saveTimerRef = useRef<number | null>(null);
  const loadedProjectPathRef = useRef<string | null>(null);
  const skipNextAutosavePathRef = useRef<string | null>(null);
  const lastSavedDocumentKeyRef = useRef<string | null>(null);
  const latestMouseRef = useRef({ x: 360, y: 240 });
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const focusedReplicationDemoPathsRef = useRef(new Set<string>());
  const focusingReplicationDemoInstancesRef = useRef(new Map<string, ReactFlowInstance>());
  const replicationDemoViewportsRef = useRef(new Map<string, { x: number; y: number; zoom: number }>());
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const workspaceContentRef = useRef<HTMLDivElement | null>(null);
  const nodeDragActiveRef = useRef(false);
  const nodeDragHistoryOpenRef = useRef(false);
  const previousNodePositionsRef = useRef(new Map<string, FlowPosition>());
  const nodeCollisionProjectPathRef = useRef<string | null>(null);
  const nodeCollisionRepairFrameRef = useRef<number | null>(null);
  const nodeCollisionPriorityIdsRef = useRef(new Set<string>());
  const nodeCollisionReflowLayoutRef = useRef(false);
  const optionDuplicateDragRef = useRef<OptionDuplicateDrag | null>(null);
  const optionDuplicateSettledSourceRef = useRef<string | null>(null);
  const sectionDrawRef = useRef<{ startFlow: FlowPosition; startClient: FlowPosition } | null>(null);
  const groupResizeRef = useRef<{ groupId: string; handle: GroupResizeHandle; startFlow: FlowPosition; startBounds: CanvasBox; moved: boolean } | null>(null);
  const connectionStartRef = useRef<ConnectionStart | null>(null);
  const connectionSucceededRef = useRef(false);
  const connectionHoverTargetRef = useRef<ConnectionHoverTarget | null>(null);
  const achievementStateRef = useRef<AchievementState>(achievementState);
  const achievementsLoadedRef = useRef(false);
  const settingsSnapshotRef = useRef<SettingsValues | null>(null);
  const settingsSaveRequestedRef = useRef(false);
  const assistantRunInFlightRef = useRef(false);
  const promptOutputRunInFlightRef = useRef(new Set<string>());
  const accessibilityStartupPromptShownRef = useRef(false);
  const accessibilityPromptDismissedRef = useRef(false);
  const [taskRunModeOverride, setTaskRunModeOverride] = useState<{ nodeId: string; mode: RunMode } | null>(null);
  const t = useMemo(() => createTranslator(language), [language]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const selectedRunModeOverride = taskRunModeOverride && taskRunModeOverride.nodeId === selectedNode?.id ? taskRunModeOverride.mode : null;
  const selectedRunMode = selectedRunModeOverride ?? selectedNode?.data.runMode ?? "flow";
  const previewOnly = scatterDocument?.executionMode === "preview-only";
  const isReplicationDemo = previewOnly && scatterDocument?.projectName === "照片与视频模板复刻闭环演示";
  const replicationDemoProjectPath = project?.path ?? null;
  const replicationDemoPhotoEntryNodeIds = useMemo(() => {
    if (!isReplicationDemo) return [] as string[];
    const photoAnalysisIds = new Set(nodes
      .filter((node) => node.data.nodeKind === "replication-analysis" && node.data.replicationMode === "photo")
      .map((node) => node.id));
    const ids = new Set(photoAnalysisIds);
    for (const edge of edges) {
      if (!photoAnalysisIds.has(edge.target)) continue;
      const source = nodes.find((node) => node.id === edge.source);
      if (source?.data.nodeKind === "image-reference") ids.add(source.id);
    }
    return [...ids];
  }, [edges, isReplicationDemo, nodes]);
  const isCanvasView = activeView === "canvas";
  const isAchievementsView = activeView === "achievements";
  const panModeActive = canvasTool === "pan" || spacePanActive;
  const effectiveTranslucentBackground = !isWindows && translucentBackground;

  const focusReplicationDemo = useCallback((instance: ReactFlowInstance | null = flowInstanceRef.current): void => {
    if (!replicationDemoProjectPath || !isReplicationDemo || !instance) return;
    if (!focusedReplicationDemoPathsRef.current.has(replicationDemoProjectPath)) {
      if (focusingReplicationDemoInstancesRef.current.get(replicationDemoProjectPath) === instance) return;
      focusingReplicationDemoInstancesRef.current.set(replicationDemoProjectPath, instance);
      void instance.fitView({
        nodes: replicationDemoPhotoEntryNodeIds.map((id) => ({ id })),
        padding: 0.16,
        minZoom: 0.6,
        maxZoom: 1,
        duration: 240
      }).then(() => {
        if (focusingReplicationDemoInstancesRef.current.get(replicationDemoProjectPath) !== instance) return;
        const viewport = instance.getViewport();
        focusedReplicationDemoPathsRef.current.add(replicationDemoProjectPath);
        focusingReplicationDemoInstancesRef.current.delete(replicationDemoProjectPath);
        replicationDemoViewportsRef.current.set(replicationDemoProjectPath, viewport);
        setCanvasViewport(viewport);
        setViewportZoom(viewport.zoom);
      }).catch(() => {
        if (focusingReplicationDemoInstancesRef.current.get(replicationDemoProjectPath) === instance) {
          focusingReplicationDemoInstancesRef.current.delete(replicationDemoProjectPath);
        }
      });
      return;
    }
    const viewport = replicationDemoViewportsRef.current.get(replicationDemoProjectPath) || { x: 36, y: 24, zoom: 0.32 };
    void instance.setViewport(viewport, { duration: 0 });
    setCanvasViewport(viewport);
    setViewportZoom(viewport.zoom);
  }, [isReplicationDemo, replicationDemoPhotoEntryNodeIds, replicationDemoProjectPath]);

  useEffect(() => {
    if (!replicationDemoProjectPath || !isReplicationDemo
      || focusedReplicationDemoPathsRef.current.has(replicationDemoProjectPath)) return;
    const frame = window.requestAnimationFrame(() => {
      focusReplicationDemo();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusReplicationDemo, isReplicationDemo, replicationDemoProjectPath]);

  const updateConnectionHoverTarget = useCallback((target: ConnectionHoverTarget | null) => {
    const current = connectionHoverTargetRef.current;
    const unchanged =
      current?.sourceId === target?.sourceId &&
      current?.targetId === target?.targetId &&
      current?.hoveredNodeId === target?.hoveredNodeId;
    if (unchanged) return;

    connectionHoverTargetRef.current = target;
    setConnectionPreview(target);
  }, []);

  const clearConnectionHoverTarget = useCallback(() => {
    updateConnectionHoverTarget(null);
  }, [updateConnectionHoverTarget]);

  useEffect(() => {
    setSelectedEdgeIds((current) => {
      const next = current.filter((id) => edges.some((edge) => edge.id === id));
      return stringArraysEqual(current, next) ? current : next;
    });
  }, [edges]);

  useEffect(() => {
    if (hoveredEdgeId && !edges.some((edge) => edge.id === hoveredEdgeId)) setHoveredEdgeId(null);
  }, [edges, hoveredEdgeId]);

  useEffect(() => {
    if (!connectionPreview) return;
    const nodeIds = new Set(nodes.map((node) => node.id));
    if (!nodeIds.has(connectionPreview.sourceId) || !nodeIds.has(connectionPreview.targetId)) {
      clearConnectionHoverTarget();
    }
  }, [clearConnectionHoverTarget, connectionPreview, nodes]);

  const zoomPercent = Math.round(viewportZoom * 100);
  const markdownResult = useMemo(
    () =>
      project && selectedNode
        ? buildMarkdown(nodes, edges, selectedNode.id, "flow", project.name, project.path, language)
        : {
            markdown: "",
            nodes: [],
            attachments: [],
            imagePaths: [],
            planMode: false,
            hasCycle: false
          },
    [edges, language, nodes, project, selectedNode]
  );

  const flowNodeIdsKey = useMemo(() => nodes.map((node) => node.id).join("\u0000"), [nodes]);
  const flowNodeIds = useMemo(() => new Set(flowNodeIdsKey ? flowNodeIdsKey.split("\u0000") : []), [flowNodeIdsKey]);
  const traceEdgeId = hoveredEdgeId || selectedEdgeIds[selectedEdgeIds.length - 1] || null;
  const tracedEndpointIds = useMemo(() => {
    const edge = traceEdgeId ? edges.find((candidate) => candidate.id === traceEdgeId) : undefined;
    return new Set(edge ? [edge.source, edge.target] : []);
  }, [edges, traceEdgeId]);
  const flowNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      className: [(node as ScatterNode & { className?: string }).className, tracedEndpointIds.has(node.id) ? "is-link-trace-endpoint" : ""].filter(Boolean).join(" ")
    })) as Node[],
    [nodes, tracedEndpointIds]
  );

  const updateEdgeRoutePoints = useCallback((edgeId: string, routePoints: Array<{ x: number; y: number }>) => {
    const nextEdges = edges.map((edge) => edge.id === edgeId ? { ...edge, routePoints } : edge);
    if (scatterEdgesEqual(edges, nextEdges)) return;
    commitCanvasChange({ edges: nextEdges });
  }, [commitCanvasChange, edges]);

  const handleEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (edge.id === CONNECTION_PREVIEW_EDGE_ID) return;
    const position = flowInstanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (!position) return;
    const sourceEdge = edges.find((candidate) => candidate.id === edge.id);
    if (!sourceEdge) return;
    const sourceNode = nodes.find((node) => node.id === sourceEdge.source);
    const targetNode = nodes.find((node) => node.id === sourceEdge.target);
    const routePoints = sourceEdge.routePoints || [];
    if (!sourceNode || !targetNode) {
      updateEdgeRoutePoints(edge.id, [...routePoints, position]);
      return;
    }
    const sourceBounds = nodeBounds(sourceNode);
    const targetBounds = nodeBounds(targetNode);
    const renderedPath = typeof CSS !== "undefined"
      ? document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(edge.id)}"] .react-flow__edge-path`)
      : null;
    const renderedPathLength = renderedPath?.getTotalLength() || 0;
    const renderedStart = renderedPathLength ? renderedPath?.getPointAtLength(0) : undefined;
    const renderedEnd = renderedPathLength ? renderedPath?.getPointAtLength(renderedPathLength) : undefined;
    const pathPoints = [
      renderedStart
        ? { x: renderedStart.x, y: renderedStart.y }
        : { x: sourceNode.position.x + sourceBounds.width, y: sourceNode.position.y + sourceBounds.height / 2 },
      ...routePoints,
      renderedEnd
        ? { x: renderedEnd.x, y: renderedEnd.y }
        : { x: targetNode.position.x, y: targetNode.position.y + targetBounds.height / 2 }
    ];
    let nearestSegment = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < pathPoints.length - 1; index += 1) {
      const start = pathPoints[index];
      const end = pathPoints[index + 1];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const lengthSquared = deltaX * deltaX + deltaY * deltaY || 1;
      const amount = Math.max(0, Math.min(1, ((position.x - start.x) * deltaX + (position.y - start.y) * deltaY) / lengthSquared));
      const distance = Math.hypot(position.x - (start.x + deltaX * amount), position.y - (start.y + deltaY * amount));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestSegment = index;
      }
    }
    const nextRoutePoints = [...routePoints];
    nextRoutePoints.splice(nearestSegment, 0, position);
    updateEdgeRoutePoints(edge.id, nextRoutePoints);
  }, [edges, nodes, updateEdgeRoutePoints]);

  const flowEdges = useMemo(() => {
    const activeNodeIds = new Set(
      [selectedNodeId, hoveredNodeId, connectionPreview?.sourceId, connectionPreview?.targetId].filter(Boolean) as string[]
    );
    const hasFocusedConnection = Boolean(traceEdgeId || activeNodeIds.size);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const validEdges = edges.filter((edge) => flowNodeIds.has(edge.source) && flowNodeIds.has(edge.target));
    const canSelectEdges = !shiftSelectionActive;
    const renderedEdges = validEdges.map((edge) => ({
      ...edge,
      type: "scatter",
      selectable: canSelectEdges,
      selected: canSelectEdges && selectedEdgeIds.includes(edge.id),
      data: (() => {
        const sourceNode = nodesById.get(edge.source);
        const targetNode = nodesById.get(edge.target);
        const isTracedEdge = traceEdgeId === edge.id;
        const isConnectedToFocus = !traceEdgeId && (activeNodeIds.has(edge.source) || activeNodeIds.has(edge.target));
        const fieldLabelKey = {
          appearance: "canvas.portAppearance",
          outfit: "canvas.portOutfit",
          scene: "canvas.portScene",
          lighting: "canvas.portLighting",
          props: "canvas.portProps",
          "target-video": "canvas.portTargetVideo",
          "depth-video": "canvas.portDepthVideo"
        } as const;
        const handleLabel = (node: ScatterNode | undefined, handleId: string | undefined, direction: "input" | "output"): string => {
          if (handleId?.startsWith("category:")) {
            const categoryId = handleId.slice("category:".length);
            const category = node?.data.replicationCategoryFields?.find((field) => field.id === categoryId);
            if (category?.title) return category.title;
          }
          if (handleId?.startsWith("field:")) {
            const fieldId = handleId.slice("field:".length);
            const labelKey = fieldLabelKey[fieldId as keyof typeof fieldLabelKey];
            if (labelKey) return t(labelKey);
          }
          if (handleId) return handleId;
          return t(direction === "output" ? "canvas.connectionOutput" : "canvas.connectionInput");
        };
        const endpointName = (node: ScatterNode | undefined, handleId: string | undefined, direction: "input" | "output"): string => {
          const title = node?.data.title?.trim() || t("canvas.unnamedNode");
          return `${title} · ${handleLabel(node, handleId, direction)}`;
        };

        return {
          active: selectedEdgeIds.includes(edge.id) || isTracedEdge || isConnectedToFocus,
          dimmed: hasFocusedConnection && !isTracedEdge && !isConnectedToFocus && !selectedEdgeIds.includes(edge.id),
          traceLabel: isTracedEdge
            ? `${endpointName(sourceNode, edge.sourceHandle, "output")} → ${endpointName(targetNode, edge.targetHandle, "input")}`
            : undefined,
          routePointLabel: t("canvas.routePointLabel"),
          routePointHint: t("canvas.routePointHint"),
          routePoints: edge.routePoints,
          onRoutePointsChange: (points: Array<{ x: number; y: number }>) => updateEdgeRoutePoints(edge.id, points)
        };
      })()
    })) as Edge[];

    if (connectionPreview && flowNodeIds.has(connectionPreview.sourceId) && flowNodeIds.has(connectionPreview.targetId)) {
      renderedEdges.push({
        id: CONNECTION_PREVIEW_EDGE_ID,
        source: connectionPreview.sourceId,
        target: connectionPreview.targetId,
        type: "scatter",
        selectable: false,
        data: {
          active: true
        }
      } as Edge);
    }

    return renderedEdges;
  }, [connectionPreview, edges, flowNodeIds, hoveredNodeId, nodes, selectedEdgeIds, selectedNodeId, shiftSelectionActive, t, traceEdgeId, updateEdgeRoutePoints]);

  useEffect(() => {
    if (drawer === "markdown" && !selectedNode) {
      setDrawer(null);
    }
  }, [drawer, selectedNode, setDrawer]);

  useEffect(() => {
    if (!canvasRevealActive) return;
    const timer = window.setTimeout(() => setCanvasRevealActive(false), 520);
    return () => window.clearTimeout(timer);
  }, [canvasRevealActive]);

  const refreshRecentProjects = useCallback(async () => {
    setRecentProjects(await window.scatter.getRecentProjects());
  }, []);

  const refreshAchievements = useCallback(async (options: { notify?: boolean } = {}) => {
    const previousState = achievementStateRef.current;
    const nextState = await window.scatter.getAchievements();
    achievementStateRef.current = nextState;
    setAchievementState(nextState);

    if (options.notify && achievementsLoadedRef.current) {
      const newlyUnlocked = achievements.filter((achievement) => !previousState.unlockedAt[achievement.id] && nextState.unlockedAt[achievement.id]);
      if (newlyUnlocked.length) {
        setAchievementToastQueue((queue) => [...queue, ...newlyUnlocked]);
      }
    }

    achievementsLoadedRef.current = true;
    return nextState;
  }, []);

  const closeAchievementToast = useCallback((): void => {
    setAchievementToastQueue((queue) => queue.slice(1));
  }, []);

  useEffect(() => {
    if (!achievementToastQueue[0]) return undefined;
    const timer = window.setTimeout(closeAchievementToast, 4800);
    return () => window.clearTimeout(timer);
  }, [achievementToastQueue, closeAchievementToast]);

  const removeRecentProject = useCallback(
    async (projectPath: string) => {
      const removesCurrentProject = project?.path === projectPath;
      const currentDocumentKey =
        removesCurrentProject && project ? documentContentKey(project.name, nodes, edges, groups, scatterDocument?.executionMode) : lastSavedDocumentKeyRef.current;
      if (removesCurrentProject && saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (removesCurrentProject) {
        loadedProjectPathRef.current = null;
        lastSavedDocumentKeyRef.current = null;
      }

      try {
        setRecentProjects(await window.scatter.removeRecentProject(projectPath));
        await refreshAchievements({ notify: true });
        if (removesCurrentProject) {
          clearProject();
          setCanvasRevealActive(false);
        }
        setStatus(t("status.removedRecent"));
      } catch (error) {
        if (removesCurrentProject && useScatterStore.getState().project?.path === projectPath) {
          loadedProjectPathRef.current = projectPath;
          lastSavedDocumentKeyRef.current = currentDocumentKey;
        }
        setStatus(error instanceof Error ? error.message : t("status.removeRecentFailed"));
      }
    },
    [clearProject, edges, groups, nodes, project, refreshAchievements, scatterDocument?.executionMode, setStatus, t]
  );

  const reorderRecentProjects = useCallback(
    async (projectPaths: string[]) => {
      const previousProjects = recentProjects;
      const byPath = new Map(recentProjects.map((recentProject) => [recentProject.path, recentProject]));
      const orderedProjects = projectPaths
        .map((projectPath) => byPath.get(projectPath))
        .filter((recentProject): recentProject is ScatterProjectInfo => Boolean(recentProject));
      const orderedPathSet = new Set(orderedProjects.map((recentProject) => recentProject.path));
      const optimisticProjects = [
        ...orderedProjects,
        ...recentProjects.filter((recentProject) => !orderedPathSet.has(recentProject.path))
      ];

      setRecentProjects(optimisticProjects);
      try {
        setRecentProjects(await window.scatter.reorderRecentProjects(projectPaths));
        setStatus(t("status.projectOrderSaved"));
      } catch {
        setRecentProjects(previousProjects);
        setStatus(t("status.projectOrderSaveFailed"));
      }
    },
    [recentProjects, setStatus, t]
  );

  const applySettingsValues = useCallback((values: SettingsValues): void => {
    setThemePreference(values.themePreference);
    setLanguage(values.language);
    setTranslucentBackground(values.translucentBackground);
    setAssistantProvider(values.assistantProvider);
    setAssistantProviderOnboardingCompleted(values.assistantProviderOnboardingCompleted);
    setPixverseImageDefaultModel(values.pixverseImageDefaultModel);
    setCommittedPixverseImageDefaultModel(values.pixverseImageDefaultModel);
  }, [setCommittedPixverseImageDefaultModel]);

  const previewSettingsValues = useCallback((values: SettingsValues): void => {
    setThemePreference(values.themePreference);
    setLanguage(values.language);
    setTranslucentBackground(values.translucentBackground);
    setAssistantProvider(values.assistantProvider);
    setAssistantProviderOnboardingCompleted(values.assistantProviderOnboardingCompleted);
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.scatter
      .getSettings()
      .then((settings) => {
        if (!cancelled) {
          applySettingsValues(settings);
          setSettingsLoaded(true);
          if (!isSplashWindow && !settings.assistantProviderOnboardingCompleted) {
            setAssistantProviderPreferenceOpen(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          applySettingsValues(defaultAppSettings);
          setSettingsLoaded(true);
          if (!isSplashWindow) {
            setAssistantProviderPreferenceOpen(true);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applySettingsValues, isSplashWindow]);

  const openSettingsDialog = useCallback((): void => {
    settingsSaveRequestedRef.current = false;
    settingsSnapshotRef.current = {
      themePreference,
      language,
      translucentBackground,
      assistantProvider,
      assistantProviderOnboardingCompleted,
      pixverseImageDefaultModel
    };
    setSettingsOpen(true);
  }, [assistantProvider, assistantProviderOnboardingCompleted, language, pixverseImageDefaultModel, themePreference, translucentBackground]);

  const handleSettingsOpenChange = useCallback(
    (open: boolean): void => {
      if (open) {
        openSettingsDialog();
        return;
      }

      setSettingsOpen(false);
      if (settingsSaveRequestedRef.current) {
        settingsSaveRequestedRef.current = false;
        settingsSnapshotRef.current = null;
        return;
      }

      const snapshot = settingsSnapshotRef.current;
      if (snapshot) {
        applySettingsValues(snapshot);
      }
      settingsSnapshotRef.current = null;
    },
    [applySettingsValues, openSettingsDialog]
  );

  const handleSaveSettings = useCallback(
    async (values: SettingsValues): Promise<void> => {
      try {
        const savedSettings = await window.scatter.saveSettings(values);
        settingsSaveRequestedRef.current = true;
        settingsSnapshotRef.current = null;
        applySettingsValues(savedSettings);
        setStatus(createTranslator(savedSettings.language)("settings.saved"));
      } catch (error) {
        const message = error instanceof Error ? error.message : t("settings.saveFailed");
        setStatus(message);
        throw new Error(message);
      }
    },
    [applySettingsValues, setStatus, t]
  );

  const saveAssistantProviderPreference = useCallback(
    async (nextAssistantProvider: AssistantProvider): Promise<void> => {
      const savedSettings = await window.scatter.saveSettings({
        themePreference,
        language,
        translucentBackground,
        assistantProvider: nextAssistantProvider,
        assistantProviderOnboardingCompleted: true,
        pixverseImageDefaultModel
      });
      applySettingsValues(savedSettings);
      setAssistantProviderPreferenceOpen(false);
    },
    [applySettingsValues, language, pixverseImageDefaultModel, themePreference, translucentBackground]
  );

  const dismissAssistantProviderPreference = useCallback(async (): Promise<void> => {
    const savedSettings = await window.scatter.saveSettings({
      themePreference,
      language,
      translucentBackground,
      assistantProvider,
      assistantProviderOnboardingCompleted: true,
      pixverseImageDefaultModel
    });
    applySettingsValues(savedSettings);
    setAssistantProviderPreferenceOpen(false);
  }, [applySettingsValues, assistantProvider, language, pixverseImageDefaultModel, themePreference, translucentBackground]);

  const refreshAccessibilityPermission = useCallback(async (): Promise<boolean> => {
    if (!supportsMacAutomation) {
      setAccessibilityTrusted(true);
      setAccessibilityPermissionOpen(false);
      return true;
    }

    const status = await window.scatter.accessibility.getStatus();
    setAccessibilityTrusted(status.trusted);
    if (status.trusted) {
      setAccessibilityPermissionOpen(false);
      void window.scatter.accessibility.closeGuide().catch(() => undefined);
    }
    return status.trusted;
  }, [supportsMacAutomation]);

  const openAccessibilityGuide = useCallback(async (): Promise<void> => {
    if (!supportsMacAutomation) return;

    const resetStatus = await window.scatter.accessibility.resetPermission();
    setAccessibilityTrusted(resetStatus.trusted);
    const guideStatus = await window.scatter.accessibility.openGuide();
    setAccessibilityTrusted(guideStatus.trusted);
    if (guideStatus.trusted) {
      setAccessibilityPermissionOpen(false);
      void window.scatter.accessibility.closeGuide().catch(() => undefined);
      return;
    }
  }, [supportsMacAutomation]);

  const dismissAccessibilityPermission = useCallback((): void => {
    accessibilityPromptDismissedRef.current = true;
    setAccessibilityPermissionOpen(false);
    void window.scatter.accessibility.closeGuide().catch(() => undefined);
  }, []);

  const ensureAccessibilityPermission = useCallback(async (): Promise<boolean> => {
    if (!supportsMacAutomation) return true;

    try {
      const trusted = await refreshAccessibilityPermission();
      if (trusted) return true;
      accessibilityPromptDismissedRef.current = false;
      setAccessibilityPermissionOpen(true);
      setStatus(t("status.accessibilityPermissionRequired"));
      return false;
    } catch {
      setAccessibilityPermissionOpen(true);
      setStatus(t("status.accessibilityPermissionRequired"));
      return false;
    }
  }, [refreshAccessibilityPermission, setStatus, supportsMacAutomation, t]);

  useEffect(() => {
    if (
      !supportsMacAutomation ||
      isSplashWindow ||
      !settingsLoaded ||
      assistantProviderPreferenceOpen ||
      accessibilityStartupPromptShownRef.current
    ) {
      return;
    }
    accessibilityStartupPromptShownRef.current = true;
    let cancelled = false;

    window.scatter.accessibility
      .getStatus()
      .then((status) => {
        if (cancelled) return;
        setAccessibilityTrusted(status.trusted);
        if (!status.trusted && !accessibilityPromptDismissedRef.current) {
          setAccessibilityPermissionOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessibilityPermissionOpen(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assistantProviderPreferenceOpen, isSplashWindow, settingsLoaded, supportsMacAutomation]);

  useEffect(() => {
    if (isSplashWindow || !supportsMacAutomation) return undefined;

    const handleFocus = (): void => {
      void refreshAccessibilityPermission().catch(() => undefined);
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isSplashWindow, refreshAccessibilityPermission, supportsMacAutomation]);

  useEffect(() => {
    if (isSplashWindow || !supportsMacAutomation || !accessibilityPermissionOpen || accessibilityTrusted === true) return undefined;

    const timer = window.setInterval(() => {
      void refreshAccessibilityPermission().catch(() => undefined);
    }, 1500);

    return () => window.clearInterval(timer);
  }, [accessibilityPermissionOpen, accessibilityTrusted, isSplashWindow, refreshAccessibilityPermission, supportsMacAutomation]);

  useEffect(() => {
    if (!isSplashWindow) {
      void refreshRecentProjects();
      void refreshAchievements();
    }
  }, [isSplashWindow, refreshAchievements, refreshRecentProjects]);

  useEffect(() => {
    if (isSplashWindow) return undefined;

    let cancelled = false;
    window.scatter.updates
      .getState()
      .then((state) => {
        if (!cancelled) setUpdateState(state);
      })
      .catch(() => undefined);

    const unsubscribe = window.scatter.updates.onStateChange((state) => {
      setUpdateState(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isSplashWindow]);

  const runTopbarUpdateAction = useCallback(async (): Promise<void> => {
    if (updateState.status === "checking" || updateState.status === "downloading" || updateState.status === "installing") return;

    try {
      const nextState =
        updateState.canInstall || updateState.status === "downloaded"
          ? await window.scatter.updates.install()
          : updateState.status === "available"
            ? await window.scatter.updates.download()
            : updateState;
      setUpdateState(nextState);
    } catch {
      return;
    }
  }, [updateState]);

  useEffect(() => {
    if (isSplashWindow) return undefined;

    const refresh = (): void => {
      void refreshRecentProjects();
    };
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [isSplashWindow, refreshRecentProjects]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (): void => {
      setSystemTheme(media.matches ? "dark" : "light");
    };

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const resolvedTheme = themePreference === "system" ? systemTheme : themePreference;
    if (theme !== resolvedTheme) {
      setTheme(resolvedTheme);
    }
  }, [setTheme, systemTheme, theme, themePreference]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.window = isSplashWindow ? "splash" : "main";
    document.documentElement.dataset.platform = appPlatform;
    document.documentElement.dataset.translucent = effectiveTranslucentBackground ? "true" : "false";
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [appPlatform, effectiveTranslucentBackground, isSplashWindow, language, theme]);

  useEffect(() => {
    function isSpaceKey(event: KeyboardEvent): boolean {
      return event.code === "Space" || event.key === " ";
    }

    function isShiftKey(event: KeyboardEvent): boolean {
      return event.key === "Shift" || event.code === "ShiftLeft" || event.code === "ShiftRight";
    }

    function canvasShortcutBlocked(event: KeyboardEvent): boolean {
      return (
        !isCanvasView ||
        assistantProviderPreferenceOpen ||
        accessibilityPermissionOpen ||
        settingsOpen ||
        searchOpen ||
        isEditableTarget(event.target)
      );
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (canvasShortcutBlocked(event)) return;

      if (isShiftKey(event)) {
        setShiftSelectionActive(true);
        setSelectedEdgeIds((current) => (current.length ? [] : current));
        return;
      }

      if (!isSpaceKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSpacePanActive(true);
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (isShiftKey(event) && !event.shiftKey) {
        setShiftSelectionActive(false);
        return;
      }

      if (!isSpaceKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSpacePanActive(false);
    }

    function resetTransientCanvasKeys(): void {
      setSpacePanActive(false);
      setShiftSelectionActive(false);
    }

    function handlePointerUp(event: PointerEvent): void {
      if (!event.shiftKey) setShiftSelectionActive(false);
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState !== "visible") resetTransientCanvasKeys();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("pointercancel", resetTransientCanvasKeys, { capture: true });
    window.addEventListener("blur", resetTransientCanvasKeys);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", resetTransientCanvasKeys, { capture: true });
      window.removeEventListener("blur", resetTransientCanvasKeys);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [accessibilityPermissionOpen, assistantProviderPreferenceOpen, isCanvasView, searchOpen, settingsOpen]);

  useEffect(() => {
    if (isCanvasView && !assistantProviderPreferenceOpen && !accessibilityPermissionOpen && !settingsOpen && !searchOpen) return;
    setSpacePanActive(false);
    setShiftSelectionActive(false);
  }, [accessibilityPermissionOpen, assistantProviderPreferenceOpen, isCanvasView, searchOpen, settingsOpen]);

  const hydrateProject = useCallback(
    async (result: OpenProjectResult | null) => {
      if (!result) return;
      const shouldRevealCanvas = useScatterStore.getState().project === null;
      loadedProjectPathRef.current = result.project.path;
      skipNextAutosavePathRef.current = result.project.path;
      lastSavedDocumentKeyRef.current = documentContentKey(result.project.name, result.document.nodes, result.document.edges, result.document.groups ?? [], result.document.executionMode);
      setActiveView("canvas");
      setCanvasRevealActive(shouldRevealCanvas);
      const document = {
        ...result.document,
        nodes: normalizeReferenceNodes(result.document.nodes, result.document.edges)
      };
      setProjectDocument(result.project, document);
      setStatus(t("app.openedProject", { name: result.project.name }));
      await Promise.all([refreshRecentProjects(), refreshAchievements({ notify: true })]);
    },
    [normalizeReferenceNodes, refreshAchievements, refreshRecentProjects, setProjectDocument, setStatus, t]
  );

  const createProject = useCallback(() => {
    void window.scatter.createProject().then(hydrateProject);
  }, [hydrateProject]);

  const createReplicationDemo = useCallback(async () => {
    try {
      const result = await window.scatter.createProject();
      if (!result) return;
      const active = useScatterStore.getState();
      const isCurrentPreviewDemo = active.project?.path === result.project.path
        && active.document?.executionMode === "preview-only"
        && active.project.path.endsWith("/照片与视频模板复刻闭环演示");
      if (!isCurrentPreviewDemo && (result.document.nodes.length > 0 || result.document.edges.length > 0)) {
        setStatus("该文件夹已有画布内容。请选择一个新的空文件夹来创建独立演示，以免覆盖现有项目。");
        return;
      }
      const demoDocument = createTemplateReplicationDemoDocument();
      const savedDocument = await window.scatter.saveDocument(result.project.path, demoDocument);
      await hydrateProject({
        project: { ...result.project, name: demoDocument.projectName },
        document: savedDocument
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创建复刻流程演示失败。");
    }
  }, [hydrateProject, setStatus]);

  const openRecentProject = useCallback(
    async (projectPath: string) => {
      const recentProject = recentProjects.find((item) => item.path === projectPath);
      if (recentProject?.missing) {
        setStatus(t("status.projectMissing"));
        return;
      }

      try {
        await hydrateProject(await window.scatter.openKnownProject(projectPath));
      } catch (error) {
        await refreshRecentProjects();
        setStatus(error instanceof Error ? error.message : t("status.projectMissing"));
      }
    },
    [hydrateProject, recentProjects, refreshRecentProjects, setStatus, t]
  );

  const openAchievements = useCallback((): void => {
    setActiveView("achievements");
    setDrawer(null);
  }, [setDrawer]);

  const viewAchievementToast = useCallback((): void => {
    openAchievements();
    closeAchievementToast();
  }, [closeAchievementToast, openAchievements]);

  const saveDocumentSnapshot = useCallback(async (targetProject: ScatterProjectInfo, document: ScatterDocument) => {
    if (loadedProjectPathRef.current !== targetProject.path) return;
    if (useScatterStore.getState().project?.path !== targetProject.path) return;

    setSaving(true);
    try {
      await window.scatter.saveDocument(targetProject.path, document);
      lastSavedDocumentKeyRef.current = documentContentKey(document.projectName, document.nodes, document.edges, document.groups ?? [], document.executionMode);
      setStatus(t("status.saved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("status.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [setSaving, setStatus, t]);

  useEffect(() => {
    if (!project || loadedProjectPathRef.current !== project.path) return;
    if (nodeDragActiveRef.current) return;
    if (skipNextAutosavePathRef.current === project.path) {
      skipNextAutosavePathRef.current = null;
      return;
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const nextDocument = toDocument(project.name, nodes, edges, groups, scatterDocument?.executionMode);
    const documentKey = documentContentKey(project.name, nodes, edges, groups, scatterDocument?.executionMode);
    if (documentKey === lastSavedDocumentKeyRef.current) return;
    const targetProject = project;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveDocumentSnapshot(targetProject, nextDocument);
    }, 550);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, groups, project, scatterDocument?.executionMode, saveDocumentSnapshot]);

  const getVisibleCanvasCenterPosition = useCallback((): FlowPosition => {
    const canvasRect = canvasShellRef.current?.getBoundingClientRect();
    const screenCenter = canvasRect
      ? {
          x: canvasRect.left + canvasRect.width / 2,
          y: canvasRect.top + canvasRect.height / 2
        }
      : latestMouseRef.current;
    const flowCenter = flowInstanceRef.current?.screenToFlowPosition(screenCenter) ?? screenCenter;

    return {
      x: flowCenter.x - TASK_NODE_WIDTH / 2,
      y: flowCenter.y - TASK_NODE_HEIGHT / 2
    };
  }, []);

  const addNode = useCallback((kind: WorkflowNodeKind = "task") => {
    if (!project || !isCanvasView) return;
    const position = selectedNode
      ? findOpenPositionToRight(
          {
            x: selectedNode.position.x + nodeBounds(selectedNode).width + TASK_NODE_HORIZONTAL_GAP,
            y: selectedNode.position.y
          },
          nodes
        )
      : findOpenPositionNear(getVisibleCanvasCenterPosition(), nodes);
    const titles: Partial<Record<WorkflowNodeKind, string>> = {
      "generic-prompt": t("workflow.genericPromptNode"),
      "replication-comparison": t("workflow.replicationComparisonNode"),
      "seedance-generation": t("workflow.seedanceGenerationNode"),
      "image-reference": t("workflow.imageNode"),
      "video-reference": t("workflow.videoNode"),
      "reference-binding": t("workflow.referenceBindingNode"),
      "role-binding": t("workflow.roleBindingNode"),
      "depth-conversion": t("workflow.depthNode"),
      "pixverse-generation": t("workflow.pixverseGenerationNode")
    };
    const node = kind === "task"
      ? emptyNode(position, nodes, t)
      : createWorkflowNode(kind, position, titles[kind] || kind);
    if (kind === "replication-comparison") {
      node.data.replicationMode = selectedNode?.data.replicationMode || "video";
      node.data.skills = node.data.replicationMode === "photo" ? ["nano-prompt-studio"] : ["video-prompt-expert", "seedance-reverse-workflow"];
    }
    const nextNodes: ScatterNode[] = [...nodes.map((item) => ({ ...item, selected: false })), { ...node, selected: true }];
    commitCanvasChange({ nodes: nextNodes });
    setSelectedNodeId(node.id);
  }, [commitCanvasChange, edges, getVisibleCanvasCenterPosition, isCanvasView, nodes, project, selectedNode, setSelectedNodeId, t]);

  const addReplicationAnalysis = useCallback((mode: ReplicationMode) => {
    if (!project || !isCanvasView) return;
    const title = mode === "photo" ? t("workflow.replicationAnalysisPhoto") : t("workflow.replicationAnalysisVideo");
    const position = selectedNode
      ? findOpenPositionToRight({ x: selectedNode.position.x + nodeBounds(selectedNode).width + TASK_NODE_HORIZONTAL_GAP, y: selectedNode.position.y }, nodes)
      : findOpenPositionNear(getVisibleCanvasCenterPosition(), nodes);
    const node = createWorkflowNode("replication-analysis", position, title);
    node.data = {
      ...node.data,
      replicationMode: mode,
      replicationStatus: "idle",
      skills: mode === "photo" ? ["nano-prompt-studio", "nano-prompt"] : ["video-prompt-expert", "seedance-reverse-workflow"],
      body: mode === "photo"
        ? "分析连接的目标写真，按写真整体与每个可区分人物拆分可观察分类并返回分类 JSON。运行后分类会收纳在本节点内，可逐项审阅编辑，也可从每个分类端口单独连线。区分目标模板与用户身份参考；不确定的细节标记待确认，不要臆测。"
        : "逐帧分析连接的目标视频，建立且只建立一个视频整体分类组；为每个可确认角色建立独立角色分类组，并按动作/镜头变化拆分覆盖全片、时间准确且互不重叠的时间段分类组。角色组记录稳定特征，动态事实记入对应时间段。目标视频仅作分析与对比依据，不自动成为 @视频1；只有用户明确选择的深度视频才可作为生成参考。"
    };
    commitCanvasChange({ nodes: [...nodes.map((item) => ({ ...item, selected: false })), { ...node, selected: true }] });
    setSelectedNodeId(node.id);
  }, [commitCanvasChange, getVisibleCanvasCenterPosition, isCanvasView, nodes, project, selectedNode, setSelectedNodeId, t]);

  const addReplicationScope = useCallback((scopeKind: ReplicationScopeKind) => {
    if (!project || !isCanvasView) return;
    const current = useScatterStore.getState();
    const anchor = current.nodes.find((node) => node.id === current.selectedNodeId) || selectedNode;
    const mode: ReplicationMode = scopeKind === "photo"
      ? "photo"
      : scopeKind === "video" || scopeKind === "segment"
        ? "video"
      : anchor?.data.nodeKind === "image-reference"
        ? "photo"
        : anchor?.data.nodeKind === "video-reference"
          ? "video"
      : anchor?.data.replicationMode
        || (anchor?.data.title?.toLowerCase().includes("photo") || anchor?.data.title?.includes("写真") ? "photo" : "video");
    const analysisId = anchor?.data.nodeKind === "replication-analysis"
      ? anchor.id
      : anchor?.data.replicationAnalysisNodeId;
    let analysisNode = current.nodes.find((node) => node.id === analysisId && node.data.nodeKind === "replication-analysis")
      || current.nodes
        .filter((node) => node.data.nodeKind === "replication-analysis" && (node.data.replicationMode || "video") === mode)
        .sort((a, b) => Math.hypot(a.position.x - (anchor?.position.x || 0), a.position.y - (anchor?.position.y || 0)) - Math.hypot(b.position.x - (anchor?.position.x || 0), b.position.y - (anchor?.position.y || 0)))[0];
    let baseNodes = [...current.nodes];
    if (!analysisNode) {
      const analysisTitle = mode === "photo" ? t("workflow.replicationAnalysisPhoto") : t("workflow.replicationAnalysisVideo");
      analysisNode = createWorkflowNode("replication-analysis", findOpenPositionNear(getVisibleCanvasCenterPosition(), baseNodes), analysisTitle);
      analysisNode.data = {
        ...analysisNode.data,
        replicationMode: mode,
        replicationStatus: "idle",
        skills: mode === "photo" ? ["nano-prompt-studio", "nano-prompt"] : ["video-prompt-expert", "seedance-reverse-workflow"],
        body: mode === "photo"
          ? "分析连接的目标写真，将可见事实拆分为写真整体与角色分类组；不确定内容标记待确认。"
          : "逐帧分析连接的目标视频，建立一个视频整体组、每个角色一个稳定特征组，并按动作/镜头变化建立完整、互不重叠的时间段组；目标视频仅作分析依据，不自动成为 @视频1。"
      };
      baseNodes.push(analysisNode);
    }
    const effectiveAnalysisId = analysisNode?.id;
    const relatedPrompt = analysisNode
      ? promptForReplicationAnalysis(current.nodes, current.edges, analysisNode.id, mode)
      : undefined;
    const index = current.nodes.filter((node) => node.data.nodeKind === "replication-scope"
      && node.data.replicationScopeKind === scopeKind
      && node.data.replicationAnalysisNodeId === effectiveAnalysisId).length + 1;
    const scopeName = scopeKind === "photo" ? `写真整体 ${index}` : scopeKind === "video" ? `视频整体 ${index}` : scopeKind === "role" ? `角色 ${index <= 26 ? String.fromCharCode(64 + index) : index}` : `时间段 ${index}`;
    const origin = analysisNode || anchor;
    const scopePosition = origin
      ? findOpenPositionToRight({ x: origin.position.x + nodeBounds(origin).width + TASK_NODE_HORIZONTAL_GAP, y: origin.position.y }, baseNodes)
      : findOpenPositionNear(getVisibleCanvasCenterPosition(), baseNodes);
    const scopeId = nanoid();
    const scopeNode = createWorkflowNode("replication-scope", scopePosition, scopeName);
    scopeNode.data = {
      ...scopeNode.data,
      title: scopeName,
      replicationMode: mode,
      replicationScopeId: scopeId,
      replicationScopeKind: scopeKind,
      replicationScopeName: scopeName,
      replicationScopeKey: `manual-${scopeKind}-${index}`,
      replicationScopeNameEdited: false,
      replicationTimeRangeEdited: false,
      replicationTimeRange: "",
      replicationAnalysisNodeId: effectiveAnalysisId
    };

    const templates = replicationScopeSectionSpecs[scopeKind];
    let nextNodes = [...baseNodes, scopeNode];
    const sectionNodes = templates.map((spec, sectionIndex) => {
      const position = findOpenPositionNear({
        x: scopePosition.x + 470 + (sectionIndex % 2) * 410,
        y: scopePosition.y + Math.floor(sectionIndex / 2) * 250
      }, nextNodes);
      const section = createWorkflowNode("replication-section", position, `${scopeName} · ${spec.title}`);
      section.data = {
        ...section.data,
        body: `分析重点：${spec.focus}\n\n等待分析节点回填；此分类可以单独编辑。`,
        replicationMode: mode,
        replicationSectionId: `${scopeId}:${spec.id}`,
        replicationSectionEdited: false,
        replicationAnalysisNodeId: effectiveAnalysisId,
        replicationScopeId: scopeId,
        replicationScopeKind: scopeKind,
        replicationScopeName: scopeName,
        replicationTimeRange: ""
      };
      nextNodes.push(section);
      return section;
    });
    const nextEdges: ScatterEdge[] = [...current.edges];
    const anchorIsCompatibleMedia = anchor?.data.nodeKind === "image-reference" && mode === "photo"
      || anchor?.data.nodeKind === "video-reference" && mode === "video";
    if (anchor && anchorIsCompatibleMedia
      && analysisNode && !nextEdges.some((edge) => edge.source === anchor.id && edge.target === analysisNode?.id && !edge.targetHandle)) {
      nextEdges.push({ id: nanoid(), source: anchor.id, target: analysisNode.id });
    }
    if (analysisNode && !nextEdges.some((edge) => edge.source === analysisNode?.id && edge.target === scopeNode.id)) {
      nextEdges.push({ id: nanoid(), source: analysisNode.id, target: scopeNode.id });
    }
    for (const section of sectionNodes) {
      nextEdges.push({ id: nanoid(), source: scopeNode.id, target: section.id });
      if (relatedPrompt) nextEdges.push({ id: nanoid(), source: section.id, target: relatedPrompt.id });
    }
    if (relatedPrompt) {
      const promptWithMode = { ...relatedPrompt, data: { ...relatedPrompt.data, replicationMode: mode, replicationAnalysisNodeId: effectiveAnalysisId } };
      nextNodes = nextNodes.map((node) => node.id === relatedPrompt.id ? promptWithMode : node);
    }
    commitCanvasChange({
      nodes: [...nextNodes.map((node) => ({ ...node, selected: node.id === scopeNode.id }))],
      edges: nextEdges
    });
    setSelectedNodeId(scopeNode.id);
    setStatus(t("workflow.replicationScopeCategories", { count: sectionNodes.length }));
  }, [commitCanvasChange, getVisibleCanvasCenterPosition, isCanvasView, project, selectedNode, setSelectedNodeId, setStatus, t]);

  const updateReplicationScope = useCallback((scopeNodeId: string, patch: Partial<ScatterNodeData>) => {
    const current = useScatterStore.getState();
    const scopeNode = current.nodes.find((node) => node.id === scopeNodeId && node.data.nodeKind === "replication-scope");
    if (!scopeNode) return;
    const scopeId = scopeNode.data.replicationScopeId;
    const oldName = scopeNode.data.replicationScopeName || scopeNode.data.title;
    const nextName = typeof patch.replicationScopeName === "string" ? patch.replicationScopeName : oldName;
    let nextNodes = current.nodes.map((node) => {
      if (node.id === scopeNodeId) return {
        ...node,
        data: {
          ...node.data,
          ...patch,
          ...(typeof patch.replicationScopeName === "string" ? { replicationScopeNameEdited: true } : {}),
          ...(typeof patch.replicationTimeRange === "string" ? { replicationTimeRangeEdited: true } : {})
        }
      };
      if (node.data.nodeKind !== "replication-section" || node.data.replicationScopeId !== scopeId) return node;
      const categoryTitle = node.data.title.startsWith(`${oldName} · `)
        ? node.data.title.slice(oldName.length + 3)
        : node.data.title;
      return {
        ...node,
        data: {
          ...node.data,
          ...(typeof patch.replicationScopeName === "string" ? {
            replicationScopeName: nextName,
            title: `${nextName} · ${categoryTitle}`
          } : {}),
          ...(typeof patch.replicationTimeRange === "string" ? { replicationTimeRange: patch.replicationTimeRange } : {})
        }
      };
    });
    const analysisId = scopeNode.data.replicationAnalysisNodeId;
    if (analysisId && scopeNode.data.replicationScopeKind === "segment") {
      const segmentNodes = nextNodes.filter((node) => node.data.nodeKind === "replication-scope"
        && node.data.replicationScopeKind === "segment"
        && node.data.replicationAnalysisNodeId === analysisId
        && !node.data.replicationScopeStale);
      const scopes = segmentNodes.map((node) => ({
        key: node.data.replicationScopeKey || node.id,
        kind: "segment" as const,
        name: node.data.replicationScopeName || node.data.title,
        timeRange: node.data.replicationTimeRange || "",
        categories: new Map<string, string>()
      }));
      const incomingAnalysis = current.edges
        .filter((edge) => edge.target === analysisId && !edge.targetHandle)
        .map((edge) => current.nodes.find((node) => node.id === edge.source))
        .find((node) => node?.data.nodeKind === "video-reference");
      const videoDurationMs = incomingAnalysis?.data.attachments
        .find((attachment) => attachment.kind === "video")?.durationMs;
      const valid = hasContinuousVideoSegmentCoverage(scopes, videoDurationMs);
      nextNodes = nextNodes.map((node) => node.data.nodeKind === "replication-scope"
        && node.data.replicationScopeKind === "segment"
        && node.data.replicationAnalysisNodeId === analysisId
        ? { ...node, data: { ...node.data, replicationTimeRangeValid: valid } }
        : node);
    }
    commitCanvasChange({ nodes: nextNodes });
  }, [commitCanvasChange]);

  const createConnectedNode = useCallback(
    (nodeId: string, side: ConnectedNodeSide) => {
      if (!project || !isCanvasView) return;
      const sourceNode = nodes.find((node) => node.id === nodeId);
      if (!sourceNode) return;
      clearConnectionHoverTarget();

      const sourceBounds = nodeBounds(sourceNode);
      const position =
        side === "right"
          ? findOpenPositionToRight(
              {
                x: sourceNode.position.x + sourceBounds.width + TASK_NODE_HORIZONTAL_GAP,
                y: sourceNode.position.y
              },
              nodes
            )
          : findOpenPositionToLeft(
              {
                x: sourceNode.position.x - TASK_NODE_WIDTH - TASK_NODE_HORIZONTAL_GAP,
                y: sourceNode.position.y
              },
              nodes
            );
      const newNode = {
        ...emptyNode(position, nodes, t),
        selected: true
      };
      const connection =
        side === "right"
          ? { source: sourceNode.id, target: newNode.id }
          : { source: newNode.id, target: sourceNode.id };

      if (!isConnectionAllowed(connection, edges, nodes)) return;

      commitCanvasChange({
        nodes: [...nodes.map((node) => ({ ...node, selected: false })), newNode],
        edges: [...edges, { id: nanoid(), ...connection }]
      });
      setSelectedNodeId(newNode.id);
    },
    [clearConnectionHoverTarget, commitCanvasChange, edges, isCanvasView, nodes, project, setSelectedNodeId, t]
  );

  const chooseFilesForNode = useCallback(
    async (nodeId: string) => {
      if (!project) return;

      try {
        const saved = await window.scatter.chooseAttachments(project.path);
        if (!saved.length) return;
        appendAttachments(nodeId, saved);
        setStatus(t("status.attachmentsAdded", { count: saved.length }));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("status.addAttachmentFailed"));
      }
    },
    [appendAttachments, project, setStatus, t]
  );

  const addFilesToNode = useCallback(
    async (nodeId: string, files: FileList | File[], source: "upload" | "drop" | "paste", accept: MediaAccept = "any") => {
      if (!project) return;
      const acceptedFiles = Array.from(files).filter((file) => {
        if (accept === "any") return true;
        if (file.type.startsWith(`${accept}/`)) return true;
        return accept === "video"
          ? /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)
          : /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name);
      });
      const inputs = await filesToInputs(acceptedFiles, source);
      if (!inputs.length) return;
      const saved = await window.scatter.saveAttachments(project.path, inputs);
      appendAttachments(nodeId, saved);
      setStatus(t("status.attachmentsAdded", { count: saved.length }));
    },
    [appendAttachments, project, setStatus, t]
  );

  const replaceFilesForNode = useCallback(
    async (nodeId: string, files: FileList | File[], source: "upload" | "drop" | "paste", accept: MediaAccept = "any") => {
      if (!project) return;
      const acceptedFiles = Array.from(files).filter((file) => {
        if (accept === "any") return true;
        if (file.type.startsWith(`${accept}/`)) return true;
        return accept === "video"
          ? /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)
          : /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name);
      });
      const inputs = await filesToInputs(acceptedFiles, source);
      if (!inputs.length) return;
      const saved = await window.scatter.saveAttachments(project.path, inputs);
      commitCanvasChange({
        nodes: nodes.map((node) => node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                attachments: [...node.data.attachments.filter((attachment) => accept === "any" || attachment.kind !== accept), ...saved]
              }
            }
          : node)
      });
      setStatus(t("status.attachmentsAdded", { count: saved.length }));
    },
    [commitCanvasChange, nodes, project, setStatus, t]
  );

  const ensureTargetNode = useCallback((): ScatterNode | null => {
    if (!project) return null;
    const existing = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) : null;
    if (existing) return existing;
    const node = emptyNode(findOpenPositionNear(getVisibleCanvasCenterPosition(), nodes), nodes, t);
    replaceCanvasLive({ nodes: [...nodes.map((item) => ({ ...item, selected: false })), { ...node, selected: true }] });
    setSelectedNodeId(node.id);
    return node;
  }, [getVisibleCanvasCenterPosition, nodes, project, replaceCanvasLive, selectedNodeId, setSelectedNodeId, t]);

  const runNode = useCallback(
    async (nodeId: string, mode: RunMode, promptOutputPath?: string): Promise<boolean> => {
      if (useScatterStore.getState().document?.executionMode === "preview-only") {
        setStatus(t("status.previewOnly"));
        return false;
      }
      if (!project) return false;
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return false;
      const result = buildMarkdown(nodes, edges, nodeId, mode, project.name, project.path, language, promptOutputPath);
      if (result.nodes.every((item) => item.data.body.trim().length === 0 && item.data.attachments.length === 0 && item.data.nodeKind === "task")) {
        setStatus(t("status.cannotSendEmpty"));
        return false;
      }
      if (isWindows) {
        try {
          await navigator.clipboard.writeText(result.markdown);
          setStatus(t("status.manualRunnerCopied"));
          return true;
        } catch {
          setStatus(t("status.manualRunnerCopyFailed"));
          return false;
        }
      }
      if (assistantRunInFlightRef.current) {
        setStatus(t("status.sendingAssistant"));
        return false;
      }
      if (!(await ensureAccessibilityPermission())) {
        return false;
      }
      const threadName = mode === "flow" ? `Scatter Flow: ${node.data.title || t("drawer.unnamedTask")}` : `Scatter: ${node.data.title || t("drawer.unnamedTask")}`;
      assistantRunInFlightRef.current = true;
      setRunningNodeId(nodeId);
      setStatus(t("status.sendingAssistant"));
      try {
        const runResult = await window.scatter.runAssistant({
          provider: assistantProvider,
          projectPath: project.path,
          threadName,
          markdown: result.markdown,
          imagePaths: result.imagePaths,
          effort: node.data.effort || "xhigh",
          planMode: result.planMode
        });
        markNodeRun(nodeId, mode);
        if (runResult.provider === "codex") {
          await refreshAchievements({ notify: true });
        }
        setStatus(t("status.sentAssistant"));
        return true;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("status.sendAssistantFailed"));
        return false;
      } finally {
        setRunningNodeId(null);
        assistantRunInFlightRef.current = false;
      }
    },
    [assistantProvider, edges, ensureAccessibilityPermission, isWindows, language, markNodeRun, nodes, project, refreshAchievements, setRunningNodeId, setStatus, t]
  );

  const runPromptNode = useCallback(async (nodeId: string): Promise<void> => {
    if (useScatterStore.getState().document?.executionMode === "preview-only") {
      setStatus(t("status.previewOnly"));
      return;
    }
    if (!project) return;
    const node = useScatterStore.getState().nodes.find((item) => item.id === nodeId);
    if (!node || node.data.nodeKind !== "generic-prompt" || node.data.genericPromptStatus === "generating") return;
    const runKey = `prompt:${nodeId}`;
    if (promptOutputRunInFlightRef.current.has(runKey)) return;
    promptOutputRunInFlightRef.current.add(runKey);
    updateNodeData(nodeId, { genericPromptStatus: "generating", genericPromptError: undefined });

    try {
      const outputPath = await window.scatter.preparePromptOutput(project.path, nodeId);
      const submitted = await runNode(nodeId, "node", outputPath);
      if (!submitted) {
        updateNodeData(nodeId, { genericPromptStatus: "error", genericPromptError: t("workflow.genericPromptFailed") });
        return;
      }

      const deadline = Date.now() + 10 * 60 * 1000;
      let previousContent = "";
      let stableReads = 0;
      while (Date.now() < deadline) {
        const current = useScatterStore.getState();
        if (current.project?.path !== project.path || !current.nodes.some((item) => item.id === nodeId)) return;
        const output = await window.scatter.readPromptOutput(project.path, nodeId);
        const content = output?.content.trim() || "";
        if (content && content === previousContent) stableReads += 1;
        else stableReads = 0;
        previousContent = content;
        if (content && stableReads >= 2) {
          updateNodeData(nodeId, { genericPromptText: content, genericPromptStatus: "ready", genericPromptError: undefined });
          setStatus(t("workflow.genericPromptReady"));
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      updateNodeData(nodeId, { genericPromptStatus: "error", genericPromptError: t("workflow.genericPromptTimeout") });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("workflow.genericPromptFailed");
      updateNodeData(nodeId, { genericPromptStatus: "error", genericPromptError: message });
      setStatus(message);
    } finally {
      promptOutputRunInFlightRef.current.delete(runKey);
    }
  }, [project, runNode, setStatus, t, updateNodeData]);

  const runGeminiPhotoAnalysis = useCallback(async (projectPath: string, nodeId: string): Promise<void> => {
    const initial = useScatterStore.getState();
    const analysisNode = initial.nodes.find((item) => item.id === nodeId && item.data.nodeKind === "replication-analysis");
    if (!analysisNode) throw new Error("找不到写真分析节点。");

    const sourceEdge = initial.edges.find((edge) => edge.target === nodeId
      && initial.nodes.find((item) => item.id === edge.source)?.data.nodeKind === "image-reference");
    const sourceNode = sourceEdge ? initial.nodes.find((item) => item.id === sourceEdge.source) : undefined;
    const targetImage = sourceNode?.data.attachments.find((item) => item.kind === "image");
    if (!sourceNode || !targetImage) throw new Error("请先把包含目标照片的图片节点连接到分析节点。");

    const result = await window.scatter.analyzeGeminiImage({
      projectPath,
      nodeId: sourceNode.id,
      attachmentId: targetImage.id,
      prompt: geminiPhotoReversePrompt
    });
    if (!result.ok || !result.text) {
      const messages: Record<string, string> = {
        "key-not-configured": "尚未配置 Gemini API Key。请到设置中填写 Gemini API Key 后重试。",
        "encryption-unavailable": "本机安全存储不可用，Gemini API Key 未能安全读取。",
        "invalid-request": "目标照片或分析请求无效。",
        "model-unavailable": "Gemini 图片分析模型不可用。",
        "auth-failed": "Gemini API Key 无效或没有调用权限。",
        "rate-limited": "Gemini 免费额度或请求频率已达到限制，请稍后重试。",
        "service-error": "Gemini 服务暂时出错，请稍后重试。",
        timeout: "Gemini 图片分析超时，请稍后重试。",
        "empty-response": "Gemini 没有返回分析文本，请重试。",
        "request-failed": "连接 Gemini 失败，请检查网络后重试。"
      };
      throw new Error(messages[result.error || ""] || "Gemini 图片分析失败。");
    }

    const parsed = parseGeminiPhotoAnalysis(result.text);
    if (!parsed) throw new Error("Gemini 返回格式不完整，未能生成 A、B 两份可编辑提示词；请重试分析。");

    const current = useScatterStore.getState();
    if (current.project?.path !== projectPath || !current.nodes.some((item) => item.id === nodeId)) return;
    const outgoingPrompts = current.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => current.nodes.find((item) => item.id === edge.target))
      .filter((item): item is ScatterNode => item?.data.nodeKind === "generic-prompt");
    const modelPromptNode = outgoingPrompts.find((item) => item.data.genericPromptRole === "model-portrait")
      || outgoingPrompts.find((item) => /模特|肖像/.test(item.data.title));
    const scenePromptNode = outgoingPrompts.find((item) => item.id !== modelPromptNode?.id && item.data.genericPromptRole === "scene-recreation")
      || outgoingPrompts.find((item) => item.id !== modelPromptNode?.id && /复刻|画面/.test(item.data.title));
    if (!modelPromptNode || !scenePromptNode) {
      throw new Error("分析节点需要分别连接「模特肖像提示词 A」和「目标画面复刻提示词 B」两个可编辑提示词节点。");
    }

    const nextNodes = current.nodes.map((item) => {
      if (item.id === nodeId) {
        return { ...item, data: {
          ...item.data,
          replicationOutputText: parsed.summary || `分析完成（${result.modelUsed || "Gemini"}）。目标照片仅用于反推和后续对比，没有传给 PixVerse。`,
          replicationStatus: "ready" as const,
          replicationError: undefined
        } };
      }
      if (item.id === modelPromptNode.id) {
        return { ...item, data: {
          ...item.data,
          genericPromptText: parsed.modelPortraitPrompt,
          genericPromptStatus: "ready" as const,
          genericPromptError: undefined,
          replicationMode: "photo" as const,
          replicationAnalysisNodeId: nodeId
        } };
      }
      if (item.id === scenePromptNode.id) {
        return { ...item, data: {
          ...item.data,
          genericPromptText: parsed.sceneRecreationPrompt,
          genericPromptStatus: "ready" as const,
          genericPromptError: undefined,
          replicationMode: "photo" as const,
          replicationAnalysisNodeId: nodeId
        } };
      }
      return item;
    });
    commitCanvasChange({ nodes: nextNodes });
    setStatus("Gemini 已完成反推；A、B 提示词已写入节点，请审阅后手动运行 PixVerse。");
  }, [commitCanvasChange, setStatus]);

  const runReplicationNode = useCallback(async (nodeId: string): Promise<void> => {
    const snapshot = useScatterStore.getState();
    if (snapshot.document?.executionMode === "preview-only") {
      setStatus(t("status.previewOnly"));
      return;
    }
    const activeProject = snapshot.project;
    const node = snapshot.nodes.find((item) => item.id === nodeId);
    if (!activeProject || !node || (node.data.nodeKind !== "replication-analysis" && node.data.nodeKind !== "replication-comparison") || node.data.replicationStatus === "running") return;
    const runKey = `replication:${nodeId}`;
    if (promptOutputRunInFlightRef.current.has(runKey)) return;
    promptOutputRunInFlightRef.current.add(runKey);
    updateNodeData(nodeId, { replicationStatus: "running", replicationError: undefined });

    try {
      if (node.data.nodeKind === "replication-analysis"
        && node.data.replicationMode === "photo"
        && node.data.replicationProvider === "gemini") {
        await runGeminiPhotoAnalysis(activeProject.path, nodeId);
        return;
      }

      const outputPath = await window.scatter.preparePromptOutput(activeProject.path, nodeId);
      const submitted = await runNode(nodeId, "node", outputPath);
      if (!submitted) {
        updateNodeData(nodeId, { replicationStatus: "error", replicationError: "未能提交本节点任务。" });
        return;
      }

      const deadline = Date.now() + 10 * 60 * 1000;
      let previousContent = "";
      let stableReads = 0;
      while (Date.now() < deadline) {
        const current = useScatterStore.getState();
        if (current.project?.path !== activeProject.path || !current.nodes.some((item) => item.id === nodeId)) return;
        const output = await window.scatter.readPromptOutput(activeProject.path, nodeId);
        const content = output?.content.trim() || "";
        if (content && content === previousContent) stableReads += 1;
        else stableReads = 0;
        previousContent = content;
        if (content && stableReads >= 2) {
          if (node.data.nodeKind === "replication-analysis") {
            const currentCanvas = useScatterStore.getState();
            const analysisNode = currentCanvas.nodes.find((item) => item.id === nodeId);
            if (!analysisNode) return;
      const incomingKinds = currentCanvas.edges
              .filter((edge) => edge.target === nodeId && !edge.targetHandle)
              .map((edge) => currentCanvas.nodes.find((item) => item.id === edge.source)?.data.nodeKind);
            const mode = analysisNode.data.replicationMode || (incomingKinds.includes("image-reference") ? "photo" : "video");
            const parsed = parseReplicationSections(content);
            if (!parsed) {
              updateNodeData(nodeId, {
                replicationOutputText: content,
                replicationStatus: "error",
                replicationError: analysisNode?.data.replicationMode === "photo"
                  ? "分析报告不是分类 JSON，未能回填本节点的分类面板。请重试分析。"
                  : "分析报告不是分类 JSON，未能自动回填分类节点。请重试分析。"
              });
              return;
            }

            const normalizedScopes = normalizeReplicationScopes(parsed.scopes, mode);

            const hasStructuredScopes = parsed.scopes.length > 0;
            const hasRequiredOverallScope = mode === "video"
              ? normalizedScopes.some((scope) => scope.kind === "video")
              : normalizedScopes.some((scope) => scope.kind === "photo");
            const hasExistingScopes = currentCanvas.nodes.some((item) => item.data.nodeKind === "replication-scope" && item.data.replicationAnalysisNodeId === nodeId);
            if ((mode === "video" && !hasRequiredOverallScope)
              || (mode === "photo" && hasStructuredScopes && !hasRequiredOverallScope)
              || (!normalizedScopes.length && hasExistingScopes && mode !== "photo")) {
              updateNodeData(nodeId, {
                replicationOutputText: content,
                replicationStatus: "error",
                replicationError: mode === "video"
                  ? "视频分析结果缺少必需的视频整体组，未覆盖到画布。请重新运行分析。"
                  : "写真分析结果缺少必需的写真整体组，未覆盖到画布。请重新运行分析。"
              });
              return;
            }

            const inputVideoDurationMs = currentCanvas.edges
              .filter((edge) => edge.target === nodeId && !edge.targetHandle)
              .map((edge) => currentCanvas.nodes.find((item) => item.id === edge.source))
              .flatMap((source) => source?.data.attachments || [])
              .find((attachment) => attachment.kind === "video" && Number.isFinite(attachment.durationMs) && Number(attachment.durationMs) > 0)
              ?.durationMs;
            if (mode === "video" && !hasContinuousVideoSegmentCoverage(normalizedScopes, inputVideoDurationMs)) {
              updateNodeData(nodeId, {
                replicationOutputText: content,
                replicationStatus: "error",
                replicationError: t("workflow.replicationInvalidVideoTimeline")
              });
              return;
            }

            if (mode === "photo") {
              let nextNodes = [...currentCanvas.nodes];
              let nextEdges = [...currentCanvas.edges];
              const previousFields = analysisNode.data.replicationCategoryFields || [];
              const previousFieldById = new Map(previousFields.map((field) => [field.id, field]));
              const legacyPhotoSections = currentCanvas.nodes.filter((item) => item.data.nodeKind === "replication-section" && item.data.replicationMode === "photo");
              const findLegacySection = (scopeKind: "photo" | "role", scopeName: string, sectionId: string): ScatterNode | undefined => legacyPhotoSections.find((item) => {
                if (item.data.replicationScopeKind !== scopeKind) return false;
                const itemSectionId = item.data.replicationSectionId || "";
                if (itemSectionId.split(":").at(-1) !== sectionId) return false;
                const itemScopeName = item.data.replicationScopeName?.trim().toLocaleLowerCase();
                return !itemScopeName || itemScopeName === scopeName.trim().toLocaleLowerCase();
              });
              const categoryFields: ReplicationCategoryField[] = normalizedScopes.length
                ? normalizedScopes.flatMap((candidate) => replicationScopeSectionSpecs[candidate.kind].map((spec) => {
                    const groupId = candidate.kind === "photo" ? "photo-overall" : `role:${candidate.key}`;
                    const id = `${groupId}:${spec.id}`;
                    const previous = previousFieldById.get(id);
                    const legacy = candidate.kind === "photo" || candidate.kind === "role"
                      ? findLegacySection(candidate.kind, candidate.name, spec.id)
                      : undefined;
                    const analyzedText = candidate.categories.get(spec.id)
                      || parsed.sections.get(spec.id)
                      || "待确认：分析结果未包含此分类，请手动补充。";
                    return {
                      id,
                      groupId,
                      groupTitle: candidate.kind === "photo" ? "写真整体" : candidate.name,
                      title: spec.title,
                      body: previous?.edited ? previous.body : legacy?.data.replicationSectionEdited ? legacy.data.body : analyzedText,
                      edited: previous?.edited || legacy?.data.replicationSectionEdited || false
                    };
                  }))
                : replicationSectionSpecs.photo.map((spec) => {
                    const id = `photo-overall:${spec.id}`;
                    const previous = previousFieldById.get(id);
                    const legacy = findLegacySection("photo", "写真整体", spec.id);
                    return {
                      id,
                      groupId: "photo-overall",
                      groupTitle: "写真整体",
                      title: spec.title,
                      body: previous?.edited ? previous.body : legacy?.data.replicationSectionEdited ? legacy.data.body : parsed.sections.get(spec.id) || "待确认：分析结果未包含此分类，请手动补充。",
                      edited: previous?.edited || legacy?.data.replicationSectionEdited || false
                    };
                  });

              let promptNode = promptForReplicationAnalysis(nextNodes, nextEdges, nodeId, mode);
              if (!promptNode) {
                promptNode = createWorkflowNode("generic-prompt", findOpenPositionToRight({
                  x: analysisNode.position.x + nodeBounds(analysisNode).width + TASK_NODE_HORIZONTAL_GAP,
                  y: analysisNode.position.y
                }, nextNodes), "写真提示词（可编辑）");
                promptNode.data = {
                  ...promptNode.data,
                  replicationMode: "photo",
                  replicationAnalysisNodeId: nodeId,
                  body: "汇总上游写真反推分析节点中的整体画面与各角色分类，整理成完整、可直接用于生图的提示词。保留分类职责，避免重复；区分目标模板与用户身份参考，只描述可观察事实，不确定内容标记待确认。每次先生成提示词供我审阅，不自动触发生图。",
                  skills: ["nano-prompt-studio", "nano-prompt"]
                };
                nextNodes.push(promptNode);
              }

              const photoScopeIds = new Set(currentCanvas.nodes
                .filter((item) => item.data.nodeKind === "replication-scope"
                  && item.data.replicationMode === "photo"
                  && (item.data.replicationAnalysisNodeId === nodeId || currentCanvas.edges.some((edge) => edge.source === nodeId && edge.target === item.id)))
                .map((item) => item.id));
              const retiredPhotoNodeIds = new Set(currentCanvas.nodes
                .filter((item) => item.data.nodeKind === "replication-section"
                  && item.data.replicationMode === "photo"
                  && (item.data.replicationAnalysisNodeId === nodeId
                    || currentCanvas.edges.some((edge) => edge.source === nodeId && edge.target === item.id)
                    || currentCanvas.edges.some((edge) => photoScopeIds.has(edge.source) && edge.target === item.id)))
                .map((item) => item.id));
              for (const id of photoScopeIds) retiredPhotoNodeIds.add(id);
              nextNodes = nextNodes.filter((item) => !retiredPhotoNodeIds.has(item.id));
              nextEdges = nextEdges.filter((edge) => !retiredPhotoNodeIds.has(edge.source) && !retiredPhotoNodeIds.has(edge.target));
              if (!nextEdges.some((edge) => edge.source === nodeId && edge.target === promptNode!.id)) {
                nextEdges.push({ id: nanoid(), source: nodeId, target: promptNode.id });
              }

              nextNodes = nextNodes.map((item) => {
                if (item.id === nodeId) {
                  return { ...item, data: {
                    ...item.data,
                    replicationMode: "photo",
                    replicationCategoryFields: categoryFields,
                    replicationOutputText: parsed.summary || "写真分析已完成；可在本节点展开分类审阅和修改。",
                    replicationStatus: "ready" as const,
                    replicationError: undefined
                  } };
                }
                if (item.id === promptNode!.id) {
                  return { ...item, data: { ...item.data, replicationMode: "photo", replicationAnalysisNodeId: nodeId } };
                }
                return item;
              });
              commitCanvasChange({ nodes: nextNodes, edges: nextEdges });
            } else if (normalizedScopes.length) {
              let nextNodes = [...currentCanvas.nodes];
              let nextEdges = [...currentCanvas.edges];
              const existingScopeNodes = nextNodes.filter((item) => item.data.nodeKind === "replication-scope" && item.data.replicationAnalysisNodeId === nodeId);
              const existingSectionNodes = nextNodes.filter((item) => item.data.nodeKind === "replication-section" && item.data.replicationAnalysisNodeId === nodeId);
              let promptNode = promptForReplicationAnalysis(nextNodes, nextEdges, nodeId, mode);
              const activeScopeIds = new Set<string>();
              const activeSectionIds = new Set<string>();
              const matchedExistingScopeIds = new Set<string>();

              for (const [scopeIndex, candidate] of normalizedScopes.entries()) {
                const candidateKey = candidate.key.trim();
                const normalizedName = candidate.name.trim().toLocaleLowerCase();
                const normalizedRange = candidate.timeRange.trim().toLocaleLowerCase();
                const existingScope = existingScopeNodes.find((item) => !matchedExistingScopeIds.has(item.id)
                  && item.data.replicationScopeKind === candidate.kind && item.data.replicationScopeKey === candidateKey)
                  || existingScopeNodes.find((item) => !matchedExistingScopeIds.has(item.id)
                    && item.data.replicationScopeKind === candidate.kind
                    && ((item.data.replicationScopeName || item.data.title).trim().toLocaleLowerCase() === normalizedName
                      || (candidate.kind === "segment" && normalizedRange && (item.data.replicationTimeRange || "").trim().toLocaleLowerCase() === normalizedRange)));
                if (existingScope) matchedExistingScopeIds.add(existingScope.id);
                const scopeId = existingScope?.data.replicationScopeId || nanoid();
                const nextName = existingScope?.data.replicationScopeNameEdited
                  ? existingScope.data.replicationScopeName || existingScope.data.title
                  : candidate.name;
                const nextTimeRange = existingScope?.data.replicationTimeRangeEdited
                  ? existingScope.data.replicationTimeRange || candidate.timeRange
                  : candidate.timeRange;
                let scopeNode: ScatterNode;
                if (existingScope) {
                  scopeNode = {
                    ...existingScope,
                    data: {
                      ...existingScope.data,
                      title: nextName,
                      replicationMode: mode,
                      replicationScopeKind: candidate.kind,
                      replicationScopeKey: candidateKey,
                      replicationScopeName: nextName,
                      replicationScopeId: scopeId,
                      replicationTimeRange: nextTimeRange,
                      replicationScopeStale: undefined,
                      replicationAnalysisNodeId: nodeId
                    }
                  };
                  nextNodes = nextNodes.map((item) => item.id === scopeNode.id ? scopeNode : item);
                } else {
                  const scopePosition = findOpenPositionNear({
                    x: analysisNode.position.x + nodeBounds(analysisNode).width + TASK_NODE_HORIZONTAL_GAP + 80,
                    y: analysisNode.position.y + scopeIndex * 290
                  }, nextNodes);
                  scopeNode = createWorkflowNode("replication-scope", scopePosition, nextName);
                  scopeNode.data = {
                    ...scopeNode.data,
                    title: nextName,
                    replicationMode: mode,
                    replicationScopeId: scopeId,
                    replicationScopeKind: candidate.kind,
                    replicationScopeKey: candidateKey,
                    replicationScopeName: nextName,
                    replicationScopeNameEdited: false,
                    replicationTimeRange: nextTimeRange,
                    replicationTimeRangeEdited: false,
                    replicationScopeStale: undefined,
                    replicationAnalysisNodeId: nodeId
                  };
                  nextNodes.push(scopeNode);
                }
                activeScopeIds.add(scopeNode.id);

                if (!nextEdges.some((edge) => edge.source === nodeId && edge.target === scopeNode.id)) {
                  nextEdges.push({ id: nanoid(), source: nodeId, target: scopeNode.id });
                }
                const specs = replicationScopeSectionSpecs[candidate.kind];
                for (const [categoryIndex, spec] of specs.entries()) {
                  const sectionId = `${scopeId}:${spec.id}`;
                  const existingSection = existingSectionNodes.find((item) => item.data.replicationScopeId === scopeId && item.data.replicationSectionId === sectionId);
                  const categoryTitle = `${nextName} · ${spec.title}`;
                  const analyzedText = candidate.categories.get(spec.id) || "待确认：分析结果未包含此分类，请手动补充。";
                  let sectionNode: ScatterNode;
                  if (existingSection) {
                    const managedTitle = existingSection.data.title.startsWith(`${existingScope?.data.replicationScopeName || existingScope?.data.title || candidate.name} · `)
                      ? categoryTitle
                      : existingSection.data.title;
                    sectionNode = {
                        ...existingSection,
                        data: {
                          ...existingSection.data,
                          title: managedTitle,
                          body: existingSection.data.replicationSectionEdited ? existingSection.data.body : analyzedText,
                          replicationMode: mode,
                          replicationSectionId: sectionId,
                          replicationScopeKind: candidate.kind,
                          replicationScopeName: nextName,
                          replicationTimeRange: nextTimeRange,
                          replicationAnalysisNodeId: nodeId,
                          replicationScopeId: scopeId,
                          replicationScopeStale: undefined
                        }
                      };
                    nextNodes = nextNodes.map((item) => item.id === sectionNode.id ? sectionNode : item);
                  } else {
                    const sectionPosition = findOpenPositionNear({
                      x: scopeNode.position.x + nodeBounds(scopeNode).width + TASK_NODE_HORIZONTAL_GAP,
                      y: scopeNode.position.y + categoryIndex * 235
                    }, nextNodes);
                    sectionNode = createWorkflowNode("replication-section", sectionPosition, categoryTitle);
                    sectionNode.data = {
                      ...sectionNode.data,
                      title: categoryTitle,
                      body: analyzedText,
                      replicationMode: mode,
                      replicationSectionId: sectionId,
                      replicationSectionEdited: false,
                      replicationAnalysisNodeId: nodeId,
                      replicationScopeId: scopeId,
                      replicationScopeKind: candidate.kind,
                      replicationScopeName: nextName,
                      replicationTimeRange: nextTimeRange,
                      replicationScopeStale: undefined
                    };
                    nextNodes.push(sectionNode);
                  }
                  activeSectionIds.add(sectionNode.id);
                  if (!nextEdges.some((edge) => edge.source === scopeNode.id && edge.target === sectionNode.id)) {
                    nextEdges.push({ id: nanoid(), source: scopeNode.id, target: sectionNode.id });
                  }
                  if (!promptNode) {
                    const promptPosition = findOpenPositionToRight({
                      x: sectionNode.position.x + nodeBounds(sectionNode).width + TASK_NODE_HORIZONTAL_GAP,
                      y: analysisNode.position.y
                    }, nextNodes);
                    promptNode = createWorkflowNode("generic-prompt", promptPosition, "视频提示词（可编辑）");
                    promptNode.data.replicationMode = mode;
                    promptNode.data.replicationAnalysisNodeId = nodeId;
                    promptNode.data.body = "汇总视频整体、各角色稳定特征与各时间段分类节点的分析和人工修订，整理成完整、可直接用于视频生成的提示词；避免重复角色与时段动态事实。目标视频只作分析依据，不标成 @视频1。";
                    promptNode.data.skills = ["video-prompt-expert", "seedance-reverse-workflow"];
                    nextNodes.push(promptNode);
                  }
                  if (!nextEdges.some((edge) => edge.source === sectionNode.id && edge.target === promptNode!.id)) {
                    nextEdges.push({ id: nanoid(), source: sectionNode.id, target: promptNode.id });
                  }
                }
              }

              if (promptNode) {
                promptNode = { ...promptNode, data: { ...promptNode.data, replicationMode: mode, replicationAnalysisNodeId: nodeId } };
                nextNodes = nextNodes.map((item) => item.id === promptNode!.id ? promptNode! : item);
              }
              const staleSectionIds = new Set(existingSectionNodes.filter((section) => !activeSectionIds.has(section.id)).map((section) => section.id));
              nextNodes = nextNodes.map((item) => {
                if (item.data.nodeKind === "replication-scope" && item.data.replicationAnalysisNodeId === nodeId) {
                  return { ...item, data: { ...item.data, replicationScopeStale: !activeScopeIds.has(item.id) || undefined } };
                }
                if (item.data.nodeKind === "replication-section" && item.data.replicationAnalysisNodeId === nodeId) {
                  return { ...item, data: { ...item.data, replicationScopeStale: !activeSectionIds.has(item.id) || undefined } };
                }
                return item;
              });
              if (mode === "video") {
                const activeSegments = nextNodes.filter((item) => item.data.nodeKind === "replication-scope"
                  && item.data.replicationScopeKind === "segment"
                  && item.data.replicationAnalysisNodeId === nodeId
                  && !item.data.replicationScopeStale);
                const timelineValid = hasContinuousVideoSegmentCoverage(activeSegments.map((item) => ({
                  key: item.data.replicationScopeKey || item.id,
                  kind: "segment" as const,
                  name: item.data.replicationScopeName || item.data.title,
                  timeRange: item.data.replicationTimeRange || "",
                  categories: new Map<string, string>()
                })), inputVideoDurationMs);
                nextNodes = nextNodes.map((item) => item.data.nodeKind === "replication-scope"
                  && item.data.replicationScopeKind === "segment"
                  && item.data.replicationAnalysisNodeId === nodeId
                  ? { ...item, data: { ...item.data, replicationTimeRangeValid: timelineValid } }
                  : item);
              }
              if (promptNode) {
                nextEdges = nextEdges.filter((edge) => {
                  if (edge.target !== promptNode!.id) return true;
                  const source = nextNodes.find((item) => item.id === edge.source);
                  if (source?.data.nodeKind === "replication-section") return activeSectionIds.has(source.id);
                  if (source?.data.nodeKind === "replication-analysis") return source.id === nodeId;
                  if (source?.data.nodeKind === "replication-comparison") {
                    return source.data.replicationAnalysisNodeId === nodeId
                      || (!source.data.replicationAnalysisNodeId && source.data.replicationMode === mode);
                  }
                  return true;
                });
              }

              const analysisSummary = parsed.summary || "分析已拆分为角色/时段分类组；请逐项审核并编辑。";
              nextNodes = nextNodes.map((item) => item.id === nodeId
                ? { ...item, data: { ...item.data, replicationMode: mode, replicationOutputText: analysisSummary, replicationStatus: "ready" as const, replicationError: undefined } }
                : item);
              commitCanvasChange({ nodes: nextNodes, edges: nextEdges });
            } else {
            let nextNodes = [...currentCanvas.nodes];
            let nextEdges = [...currentCanvas.edges];
            const existingSectionNodes = nextNodes.filter((item) => item.data.nodeKind === "replication-section" && item.data.replicationAnalysisNodeId === nodeId);
            // Structured role scopes/sections belong to the scoped pipeline. A flat
            // fallback run must not reactivate them, or the same person facts would
            // enter the prompt twice (once flat, once per role). Only genuinely flat
            // categories (no scope id) stay eligible to keep user-added ones.
            const structuredSectionIds = new Set(existingSectionNodes
              .filter((item) => Boolean(item.data.replicationScopeId))
              .map((item) => item.id));
            const flatSectionNodes = existingSectionNodes.filter((item) => !structuredSectionIds.has(item.id));
            const sectionSpecs = [
              ...replicationSectionSpecs[mode],
              ...flatSectionNodes
                .filter((item) => !replicationSectionSpecs[mode].some((spec) => spec.id === item.data.replicationSectionId))
                .map((item) => ({
                  id: item.data.replicationSectionId || item.id,
                  title: item.data.title,
                  focus: item.data.body?.trim() || "记录该分类下可观察到的事实；不确定内容标记待确认。"
                }))
            ];
            const uniqueSectionSpecs = [...new Map(sectionSpecs.map((spec) => [spec.id, spec])).values()];
            // Flat user categories without a replicationSectionId fall back to their
            // node id as the spec id, so the lookup must also match by node id;
            // otherwise a duplicate node is created and the original is marked stale.
            const findExistingSection = (specId: string): ScatterNode | undefined =>
              existingSectionNodes.find((item) => item.data.replicationSectionId === specId)
              ?? flatSectionNodes.find((item) => !item.data.replicationSectionId && item.id === specId);
            let promptNode = promptForReplicationAnalysis(nextNodes, nextEdges, nodeId, mode);

            const columns = 3;
            const rowStep = 300;
            const columnStep = 420;
            const sectionStartY = analysisNode.position.y + nodeBounds(analysisNode).height + 100;
            const activeSectionIds = new Set<string>();
            for (const [index, spec] of uniqueSectionSpecs.entries()) {
              const existing = findExistingSection(spec.id);
              let sectionNode = existing;
              // A user-made flat category has no analysis category id, so the
              // analysis result never carries text for it; keep its handwritten body.
              const userFlatSection = Boolean(existing) && !existing?.data.replicationSectionId;
              const analyzedText = userFlatSection
                ? (existing?.data.body?.trim() || "")
                : parsed.sections.get(spec.id) || "待确认：分析结果未包含此分类，请手动补充。";
              if (sectionNode) {
                if (!sectionNode.data.replicationSectionEdited) {
                  sectionNode = {
                    ...sectionNode,
                    data: { ...sectionNode.data, title: userFlatSection ? sectionNode.data.title : spec.title, body: analyzedText || sectionNode.data.body, replicationMode: mode, replicationScopeStale: undefined }
                  };
                  nextNodes = nextNodes.map((item) => item.id === sectionNode!.id ? sectionNode! : item);
                }
              } else {
                const position = findOpenPositionNear({
                  x: analysisNode.position.x + (index % columns) * columnStep,
                  y: sectionStartY + Math.floor(index / columns) * rowStep
                }, nextNodes);
                sectionNode = createWorkflowNode("replication-section", position, spec.title);
                sectionNode.data = {
                  ...sectionNode.data,
                  body: analyzedText,
                  replicationMode: mode,
                  replicationSectionId: spec.id,
                  replicationSectionEdited: false,
                  replicationAnalysisNodeId: nodeId,
                  replicationScopeStale: undefined
                };
                nextNodes.push(sectionNode);
              }

              if (!nextEdges.some((edge) => edge.source === nodeId && edge.target === sectionNode!.id)) {
                nextEdges.push({ id: nanoid(), source: nodeId, target: sectionNode.id });
              }
              activeSectionIds.add(sectionNode.id);
              if (!promptNode) {
                promptNode = createWorkflowNode("generic-prompt", {
                  x: analysisNode.position.x + 3 * columnStep + 300,
                  y: sectionStartY + Math.floor((uniqueSectionSpecs.length - 1) / columns) * rowStep / 2
                }, "视频提示词（可编辑）");
                promptNode.data.replicationMode = mode;
                promptNode.data.replicationAnalysisNodeId = nodeId;
                promptNode.data.body = "汇总视频整体、各角色稳定特征与各时间段分类节点中的分析和人工修订，整理成一份完整、可直接用于视频生成的提示词。保留角色连续性、时间段动作、镜头、道具、光影、声音及已确认内容，避免重复动态事实；目标视频只作分析依据，不标成 @视频1。每次运行先生成新版本供用户审阅，不自动触发生成。";
                promptNode.data.skills = ["video-prompt-expert", "seedance-reverse-workflow"];
                nextNodes.push(promptNode);
              }
              if (!nextEdges.some((edge) => edge.source === sectionNode!.id && edge.target === promptNode!.id)) {
                nextEdges.push({ id: nanoid(), source: sectionNode.id, target: promptNode.id });
              }
            }

            if (promptNode) {
              promptNode = { ...promptNode, data: { ...promptNode.data, replicationMode: mode, replicationAnalysisNodeId: nodeId } };
              nextNodes = nextNodes.map((item) => item.id === promptNode!.id ? promptNode! : item);
            }
            // A flat video result retires structured scopes from an earlier run,
            // even if the prompt node was removed. Keep current flat sections
            // active and preserve any text the user edited.
            nextNodes = nextNodes.map((item) => {
              if (item.data.nodeKind === "replication-scope" && item.data.replicationAnalysisNodeId === nodeId) {
                return { ...item, data: { ...item.data, replicationScopeStale: true } };
              }
              if (item.data.nodeKind === "replication-section" && item.data.replicationAnalysisNodeId === nodeId) {
                return { ...item, data: { ...item.data, replicationScopeStale: !activeSectionIds.has(item.id) || undefined } };
              }
              return item;
            });
            nextEdges = nextEdges.filter((edge) => {
              if (!promptNode || edge.target !== promptNode.id) return true;
              const source = nextNodes.find((item) => item.id === edge.source);
              const retiredSection = source?.data.nodeKind === "replication-section"
                && source.data.replicationAnalysisNodeId === nodeId
                && !activeSectionIds.has(source.id);
              return !retiredSection;
            });

            const analysisSummary = parsed.summary || "逐项分析完成；请审核并编辑右侧分类节点。";
            nextNodes = nextNodes.map((item) => item.id === nodeId
              ? { ...item, data: { ...item.data, replicationMode: mode, replicationOutputText: analysisSummary, replicationStatus: "ready" as const, replicationError: undefined } }
              : item);
            commitCanvasChange({ nodes: nextNodes, edges: nextEdges });
            }
          } else {
            const json = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
            try {
              const parsed = JSON.parse(json) as { summary?: unknown; differences?: unknown };
              const currentComparison = useScatterStore.getState().nodes.find((item) => item.id === nodeId);
              const previousDifferences = currentComparison?.data.replicationDifferences || [];
              const usedPrevious = new Set<string>();
              const differences = Array.isArray(parsed.differences)
                ? parsed.differences.map((item, index): ReplicationDifference => {
                    const difference = item && typeof item === "object" ? item as Record<string, unknown> : {};
                    const nextValue = {
                      timeRange: typeof difference.timeRange === "string" ? difference.timeRange : "",
                      category: typeof difference.category === "string" ? difference.category : "",
                      target: typeof difference.target === "string" ? difference.target : "",
                      generated: typeof difference.generated === "string" ? difference.generated : ""
                    };
                    const exactMatch = previousDifferences.find((previous) => !usedPrevious.has(previous.id)
                      && previous.timeRange === nextValue.timeRange
                      && previous.category === nextValue.category
                      && previous.target === nextValue.target
                      && previous.generated === nextValue.generated);
                    const contextualMatch = exactMatch || previousDifferences.find((previous) => !usedPrevious.has(previous.id)
                      && previous.timeRange === nextValue.timeRange
                      && previous.category === nextValue.category);
                    if (contextualMatch) usedPrevious.add(contextualMatch.id);
                    return {
                      id: contextualMatch?.id || `diff-${Date.now()}-${index}`,
                      ...nextValue,
                      correction: contextualMatch?.correction || ""
                    };
                  })
                : [];
              const carriedDifferences = previousDifferences.filter((previous) => !usedPrevious.has(previous.id)
                && (previous.manual || Boolean(previous.correction.trim())));
              differences.push(...carriedDifferences);
              const summary = typeof parsed.summary === "string" ? `对比总结：${parsed.summary}\n\n` : "";
              updateNodeData(nodeId, {
                replicationOutputText: `${summary}${content}`,
                replicationDifferences: differences,
                replicationStatus: "ready",
                replicationError: undefined
              });
            } catch {
              updateNodeData(nodeId, {
                replicationOutputText: content,
                replicationStatus: "error",
                replicationError: "对比报告格式无法解析。请重新运行，或手动添加差异项。"
              });
            }
          }
          setStatus(node.data.nodeKind === "replication-analysis"
            ? node.data.replicationMode === "photo" ? "写真分类已收纳在分析节点，可逐项编辑或单独连线。" : "逐项分析已回填，可审核各分类。"
            : "对比结果已回填，可填写逐项修改要求。 ");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      updateNodeData(nodeId, { replicationStatus: "error", replicationError: "等待输出超时。请检查 Codex 是否完成并写入指定结果文件。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "节点运行失败。";
      updateNodeData(nodeId, { replicationStatus: "error", replicationError: message });
      setStatus(message);
    } finally {
      promptOutputRunInFlightRef.current.delete(runKey);
    }
  }, [commitCanvasChange, runGeminiPhotoAnalysis, runNode, setStatus, t, updateNodeData]);

  const runDepthConversion = useCallback(
    async (nodeId: string) => {
      if (useScatterStore.getState().document?.executionMode === "preview-only") {
        setStatus(t("status.previewOnly"));
        return;
      }
      if (!project) return;
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const inputEdge = edges.find((edge) => edge.target === nodeId);
      const source = inputEdge ? nodes.find((item) => item.id === inputEdge.source) : null;
      const attachment = source?.data.attachments.find((item) => item.kind === "video");
      if (!attachment) {
        updateNodeData(nodeId, { depthStatus: "error", depthError: t("workflow.depthMissingVideo") });
        return;
      }
      updateNodeData(nodeId, { depthStatus: "preparing", depthProgress: 0, depthError: undefined });
      const requestId = nanoid();
      let lastProgressAt = 0;
      const unsubscribeDepthProgress = window.scatter.onDepthProgress((progress) => {
        if (progress.requestId !== requestId) return;
        const now = Date.now();
        if (progress.progress < 100 && now - lastProgressAt < 250) return;
        lastProgressAt = now;
        updateNodeData(nodeId, {
          depthStatus: progress.phase === "model-download" ? "preparing" : progress.phase === "cpu-fallback" ? "cpu-fallback" : "converting",
          depthProgress: progress.progress
        });
      });
      try {
        const result = await window.scatter.runDepthConversion({
          requestId,
          projectPath: project.path,
          inputPath: attachment.storedPath,
          model: node.data.depthModel || "small",
          modelPrecision: typeof navigator !== "undefined" && Boolean((navigator as Navigator & { gpu?: unknown }).gpu) ? "fp16" : "q8",
          processingMode: node.data.depthProcessingMode || "quality",
          resolution: node.data.depthResolution || "original",
          temporalSmoothing: node.data.temporalSmoothing ?? 60,
          invert: Boolean(node.data.invertDepth),
          preserveAudio: Boolean(node.data.preserveAudio)
        });
        // A conversion can take long enough for the user to edit the graph.
        // Read the live canvas instead of the nodes/edges captured when Run began.
        const latestCanvas = useScatterStore.getState();
        if (latestCanvas.project?.path !== project.path) return;
        const latestNodes = latestCanvas.nodes;
        const latestEdges = latestCanvas.edges;
        const latestDepthNode = latestNodes.find((item) => item.id === nodeId);
        if (!latestDepthNode) return;
        const connectedVideoOutputs = latestEdges
          .filter((edge) => edge.source === nodeId)
          .map((edge) => latestNodes.find((item) => item.id === edge.target))
          .filter((item): item is ScatterNode => Boolean(item && item.data.nodeKind === "video-reference"));
        const storedConnectedOutput = connectedVideoOutputs.find((item) => item.id === latestDepthNode.data.depthOutputNodeId);
        const storedOutput = latestNodes.find((item) => item.id === latestDepthNode.data.depthOutputNodeId && item.data.nodeKind === "video-reference");
        const outputNode = connectedVideoOutputs.find((item) => item.id !== latestDepthNode.data.depthOutputNodeId) || storedConnectedOutput || connectedVideoOutputs[0] || storedOutput;
        if (outputNode) {
          const nextNodes = latestNodes.map((item) => item.id === nodeId
              ? { ...item, data: { ...item.data, depthOutputNodeId: outputNode.id } }
              : item.id === outputNode.id
                ? { ...item, data: { ...item.data, title: t("workflow.videoNode"), attachments: [result.attachment], mediaKind: "video" as const, token: undefined } }
                : item);
          const nextEdges = latestEdges.some((edge) => edge.source === nodeId && edge.target === outputNode.id)
            ? latestEdges
            : [...latestEdges, { id: nanoid(), source: nodeId, target: outputNode.id }];
          commitCanvasChange({ nodes: nextNodes, edges: nextEdges });
        } else {
          const fallbackOutput = createWorkflowNode("video-reference", findOpenPositionToRight({ x: latestDepthNode.position.x + nodeBounds(latestDepthNode).width + TASK_NODE_HORIZONTAL_GAP, y: latestDepthNode.position.y }, latestNodes), t("workflow.videoNode"));
          fallbackOutput.data.attachments = [result.attachment];
          fallbackOutput.selected = false;
          commitCanvasChange({
            nodes: [...latestNodes.map((item) => item.id === nodeId ? { ...item, data: { ...item.data, depthOutputNodeId: fallbackOutput.id } } : item), fallbackOutput],
            edges: [...latestEdges, { id: nanoid(), source: nodeId, target: fallbackOutput.id }]
          });
        }
        updateNodeData(nodeId, { depthStatus: "completed", depthProgress: 100, depthError: undefined });
      } catch (error) {
        updateNodeData(nodeId, { depthStatus: "error", depthError: error instanceof Error ? error.message : t("workflow.depthConversionError") });
      } finally {
        unsubscribeDepthProgress();
      }
    },
    [commitCanvasChange, edges, nodes, project, t, updateNodeData]
  );

  const runPixverseGeneration = useCallback(async (nodeId: string): Promise<void> => {
    if (useScatterStore.getState().document?.executionMode === "preview-only") {
      setStatus(t("status.previewOnly"));
      return;
    }
    if (!project) return;
    const canvasAtStart = useScatterStore.getState();
    const node = canvasAtStart.nodes.find((item) => item.id === nodeId && item.data.nodeKind === "pixverse-generation");
    if (!node || node.data.pixverseStatus === "running") return;

    const connectedSources = canvasAtStart.edges
      .filter((edge) => edge.target === nodeId && !edge.targetHandle)
      .map((edge) => canvasAtStart.nodes.find((item) => item.id === edge.source))
      .filter((item): item is ScatterNode => Boolean(item));
    const generationMode: ReplicationMode = node.data.pixverseMode === "image" ? "photo" : "video";
    const promptCandidates = connectedSources.filter((item) => item.data.nodeKind === "generic-prompt" && item.data.genericPromptText?.trim());
    const promptMode = (item: ScatterNode) => item.data.replicationMode || inferReplicationMode(item, canvasAtStart.nodes, canvasAtStart.edges);
    const mismatchedPrompt = promptCandidates.find((item) => {
      const mode = promptMode(item);
      return Boolean(mode && mode !== generationMode);
    });
    if (node.data.replicationMode && node.data.replicationMode !== generationMode) {
      updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: "invalid-request" });
      setStatus(t("workflow.replicationPromptModeMismatch"));
      return;
    }
    const expectedAnalysisId = node.data.replicationAnalysisNodeId;
    const matchingPromptSource = promptCandidates.find((item) => isReplicationPromptCompatible(
      promptMode(item), generationMode, item.data.replicationAnalysisNodeId, expectedAnalysisId));
    const scopedPromptIds = new Set(promptCandidates.map((item) => item.data.replicationAnalysisNodeId).filter((id): id is string => Boolean(id)));
    const promptLoopMismatch = expectedAnalysisId ? !matchingPromptSource : scopedPromptIds.size > 1;
    if (promptLoopMismatch || (!matchingPromptSource && mismatchedPrompt)) {
      updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: "invalid-request" });
      setStatus(t("workflow.replicationPromptModeMismatch"));
      return;
    }
    const promptSource = matchingPromptSource
      || connectedSources.find((item) => (item.data.nodeKind === "task" || !item.data.nodeKind) && item.data.body?.trim());
    const prompt = promptSource?.data.genericPromptText?.trim()
      || promptSource?.data.body?.trim()
      || node.data.body.trim()
      || "";
    if (!prompt) {
      updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: "prompt-required" });
      return;
    }

    const mode: PixverseCreateMode = node.data.pixverseMode === "image"
      ? "image"
      : node.data.pixverseVideoMethod === "reference" ? "reference" : "video";
    const requiresDepthVideo = node.data.replicationMode === "video"
      || promptSource?.data.replicationMode === "video";
    const replicationAnalysisId = node.data.replicationAnalysisNodeId || promptSource?.data.replicationAnalysisNodeId;
    if (promptSource?.data.replicationAnalysisNodeId && !node.data.replicationAnalysisNodeId) {
      updateNodeData(nodeId, {
        replicationMode: promptSource.data.replicationMode || generationMode,
        replicationAnalysisNodeId: promptSource.data.replicationAnalysisNodeId
      });
    }
    if (requiresDepthVideo && replicationAnalysisId) {
      const segmentNodes = canvasAtStart.nodes.filter((item) => item.data.nodeKind === "replication-scope"
        && item.data.replicationScopeKind === "segment"
        && item.data.replicationAnalysisNodeId === replicationAnalysisId
        && !item.data.replicationScopeStale);
      const scopes = segmentNodes.map((item) => ({
        key: item.data.replicationScopeKey || item.id,
        kind: "segment" as const,
        name: item.data.replicationScopeName || item.data.title,
        timeRange: item.data.replicationTimeRange || "",
        categories: new Map<string, string>()
      }));
      const analysisNode = canvasAtStart.nodes.find((item) => item.id === replicationAnalysisId);
      const sourceVideo = canvasAtStart.edges
        .filter((edge) => edge.target === replicationAnalysisId && !edge.targetHandle)
        .map((edge) => canvasAtStart.nodes.find((item) => item.id === edge.source))
        .find((item) => item?.data.nodeKind === "video-reference");
      const videoDurationMs = sourceVideo?.data.attachments.find((attachment) => attachment.kind === "video")?.durationMs;
      if (!analysisNode || !hasContinuousVideoSegmentCoverage(scopes, videoDurationMs)) {
        updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: "invalid-request" });
        setStatus(t("workflow.replicationTimelineRunBlocked"));
        return;
      }
    }
    const followsImageDefault = node.data.pixverseModelSource === "default"
      || (node.data.pixverseModelSource !== "custom"
        && (!node.data.pixverseModel || node.data.pixverseModel === canvasAtStart.pixverseImageCliDefaultModel));
    const depthOutputs = depthOutputVideoIds(canvasAtStart.nodes, canvasAtStart.edges);
    const analysisSourceIds = new Set(canvasAtStart.edges
      .filter((edge) => {
        const target = canvasAtStart.nodes.find((item) => item.id === edge.target);
        return !edge.targetHandle && (target?.data.nodeKind === "replication-analysis" || target?.data.nodeKind === "replication-comparison");
      })
      .map((edge) => edge.source)
      .filter((sourceId) => {
        const kind = canvasAtStart.nodes.find((item) => item.id === sourceId)?.data.nodeKind;
        return kind === "image-reference" || kind === "video-reference";
      }));
    const assignedMediaSources = connectedSources
      .filter((source) => source.data.nodeKind === "image-reference" || source.data.nodeKind === "video-reference")
      .filter((source) => {
        const assignment = node.data.referenceAssignments?.[source.id];
        return canUseGenerationMedia(
          assignment,
          source.data.nodeKind === "video-reference",
          analysisSourceIds.has(source.id),
          depthOutputs.has(source.id),
          requiresDepthVideo
        );
      })
      .map((source, index) => ({ source, order: node.data.referenceAssignments?.[source.id]?.order ?? index }))
      .sort((a, b) => a.order - b.order)
      .map(({ source }) => source);
    const hasMissingAssignedImage = connectedSources.some((source) => {
      if (source.data.nodeKind !== "image-reference") return false;
      const assignment = node.data.referenceAssignments?.[source.id];
      return Boolean(assignment && !assignment.analysisOnly && assignment.kind === "image" && assignment.alias.trim())
        && !source.data.attachments.some((attachment) => attachment.kind === "image");
    });
    if (hasMissingAssignedImage) {
      updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: "reference-required" });
      setStatus(t("workflow.pixverseFailed"));
      return;
    }
    const imagePaths = assignedMediaSources.flatMap((source) => source.data.nodeKind === "image-reference"
      ? source.data.attachments.filter((attachment) => attachment.kind === "image").map((attachment) => attachment.storedPath)
      : []);
    const videoPaths = assignedMediaSources.flatMap((source) => source.data.nodeKind === "video-reference"
      ? source.data.attachments.filter((attachment) => attachment.kind === "video").map((attachment) => attachment.storedPath)
      : []);

    updateNodeData(nodeId, { pixverseStatus: "running", pixverseError: undefined });
    try {
      const result = await window.scatter.runPixverseGeneration({
        projectPath: project.path,
        mode,
        model: mode === "image" && followsImageDefault
          ? canvasAtStart.pixverseImageDefaultModel
          : node.data.pixverseModel || "",
        prompt,
        imagePaths,
        videoPaths,
        parameters: (node.data.pixverseSettings || {}) as Record<string, PixverseGenerationParameter>
      });
      if (!result.ok || !result.attachments.length) {
        const error = result.error || "generation-failed";
        updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: error });
        setStatus(t("workflow.pixverseFailed"));
        return;
      }

      const latestCanvas = useScatterStore.getState();
      if (latestCanvas.project?.path !== project.path) return;
      const latestNode = latestCanvas.nodes.find((item) => item.id === nodeId && item.data.nodeKind === "pixverse-generation");
      if (!latestNode) return;
      const outputKind = mode === "image" ? "image" : "video";
      const outputNodeKind = outputKind === "image" ? "image-reference" : "video-reference";
      const outputTitle = outputKind === "image" ? t("workflow.imageNode") : t("workflow.videoNode");
      const connectedOutputs = latestCanvas.edges
        .filter((edge) => edge.source === nodeId)
        .map((edge) => latestCanvas.nodes.find((item) => item.id === edge.target))
        .filter((item): item is ScatterNode => Boolean(item && item.data.nodeKind === outputNodeKind));
      const emptyOutputSlots = connectedOutputs.filter((item) => item.data.attachments.length === 0);
      const previousOutputHasAttachment = connectedOutputs.some((item) =>
        item.id === latestNode.data.pixverseOutputNodeId && item.data.attachments.length > 0);
      const knownRunNumbers = connectedOutputs
        .map((item) => item.data.pixverseRunNumber)
        .filter((value): value is number => typeof value === "number");
      const runNumber = Math.max(latestNode.data.pixverseRunCount || 0, previousOutputHasAttachment ? 1 : 0, ...knownRunNumbers) + 1;
      const matchingComparisons = latestNode.data.replicationAnalysisNodeId
        ? latestCanvas.nodes.filter((item) => item.data.nodeKind === "replication-comparison"
          && item.data.replicationAnalysisNodeId === latestNode.data.replicationAnalysisNodeId)
        : [];
      let nextNodes = [...latestCanvas.nodes];
      let nextEdges = [...latestCanvas.edges];
      const outputIds: string[] = [];

      for (const [index, attachment] of result.attachments.entries()) {
        let outputNode = emptyOutputSlots[index];
        if (!outputNode) {
          const position = findOpenPositionToRight({
            x: latestNode.position.x + nodeBounds(latestNode).width + TASK_NODE_HORIZONTAL_GAP,
            y: latestNode.position.y + index * (TASK_NODE_HEIGHT + TASK_NODE_VERTICAL_GAP)
          }, nextNodes);
          const resultTitle = outputTitle + " · " + t("workflow.pixverseRoundLabel", { round: runNumber }) + " · " + (index + 1);
          outputNode = createWorkflowNode(outputNodeKind, position, resultTitle);
          nextNodes.push(outputNode);
        }
        outputIds.push(outputNode.id);
        nextNodes = nextNodes.map((item) => item.id === outputNode!.id
          ? { ...item, data: {
            ...item.data,
            title: item.data.title || outputTitle,
            mediaKind: outputKind,
            attachments: [attachment],
            token: undefined,
            pixverseGenerationNodeId: nodeId,
            pixverseRunNumber: runNumber,
            pixverseResultIndex: index + 1
          } }
          : item);
        if (!nextEdges.some((edge) => edge.source === nodeId && edge.target === outputNode!.id)) {
          nextEdges.push({ id: nanoid(), source: nodeId, target: outputNode.id });
        }
      }

      for (const comparison of matchingComparisons) {
        for (const outputId of outputIds) {
          if (!nextEdges.some((edge) => edge.source === outputId && edge.target === comparison.id)) {
            nextEdges.push({ id: nanoid(), source: outputId, target: comparison.id });
          }
          const currentComparison = nextNodes.find((item) => item.id === comparison.id);
          if (!currentComparison?.data.referenceAssignments?.[outputId]) {
            const assignments = currentComparison?.data.referenceAssignments || {};
            const nextOrder = Math.max(-1, ...Object.values(assignments).map((assignment) => assignment.order)) + 1;
            const outputNode = nextNodes.find((item) => item.id === outputId);
            const round = outputNode?.data.pixverseRunNumber || runNumber;
            nextNodes = nextNodes.map((item) => item.id === comparison.id
              ? { ...item, data: { ...item.data, referenceAssignments: {
                ...assignments,
                [outputId]: {
                  kind: outputKind,
                  alias: "",
                  purpose: "PixVerse 生成结果，第 " + round + " 轮",
                  order: nextOrder,
                  analysisOnly: true,
                  analysisOnlyManual: true
                }
              } } }
              : item);
          }
        }
      }

      nextNodes = nextNodes.map((item) => item.id === nodeId
        ? { ...item, data: { ...item.data, pixverseOutputNodeId: outputIds[0], pixverseRunCount: runNumber, pixverseStatus: "completed" as const, pixverseError: undefined } }
        : item);
      commitCanvasChange({ nodes: nextNodes, edges: nextEdges });
      setStatus(t("workflow.pixverseCompleted", { count: result.attachments.length }));
    } catch {
      updateNodeData(nodeId, { pixverseStatus: "error", pixverseError: "generation-failed" });
      setStatus(t("workflow.pixverseError.generation-failed"));
    }
  }, [commitCanvasChange, project, setStatus, t, updateNodeData]);

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodes.find((node) => node.id === nodeId);
      if (!source) return;
      const duplicate: ScatterNode = {
        ...duplicateNodeAt(source, {
          x: source.position.x + 32,
          y: source.position.y + 32
        }),
        data: {
          ...source.data,
          attachments: source.data.attachments.map((attachment) => ({ ...attachment })),
          title: defaultTaskTitle(nodes, t),
          ...(source.data.nodeKind === "generic-prompt" ? {
            genericPromptStatus: source.data.genericPromptText?.trim() ? "ready" as const : "idle" as const,
            genericPromptError: undefined
          } : {}),
          ...(source.data.nodeKind === "pixverse-generation" ? {
            pixverseStatus: "idle" as const,
            pixverseError: undefined,
            pixverseOutputNodeId: undefined
          } : {})
        }
      };
      commitCanvasChange({ nodes: [...nodes.map((node) => ({ ...node, selected: false })), duplicate] });
      setSelectedNodeId(duplicate.id);
    },
    [commitCanvasChange, nodes, setSelectedNodeId, t]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const nextNodes0 = nodes.filter((node) => node.id !== nodeId);
      const nextEdges = edgesForExistingNodes(edges, nextNodes0);
      const nextNodes = normalizeReferenceNodes(nextNodes0, nextEdges);
      clearConnectionHoverTarget();
      commitCanvasChange({
        nodes: nextNodes,
        edges: nextEdges
      });
      setSelectedEdgeIds((current) => current.filter((edgeId) => nextEdges.some((edge) => edge.id === edgeId)));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [clearConnectionHoverTarget, commitCanvasChange, edges, nodes, normalizeReferenceNodes, selectedNodeId, setSelectedNodeId]
  );

  const deleteSelectedEdges = useCallback(() => {
    if (!selectedEdgeIds.length) return;

    const selectedEdgeIdSet = new Set(selectedEdgeIds);
    const nextEdges = edges.filter((edge) => !selectedEdgeIdSet.has(edge.id));
    commitCanvasChange({
      nodes: normalizeReferenceNodes(nodes, nextEdges),
      edges: nextEdges
    });
    setSelectedEdgeIds([]);
  }, [commitCanvasChange, edges, nodes, normalizeReferenceNodes, selectedEdgeIds]);

  // --- Figma-style grouping / alignment (pure canvas metadata, never edges) ---
  const selectedCanvasNodes = useMemo(() => nodes.filter((node) => Boolean(node.selected)), [nodes]);
  const boundsOfNode = useCallback((node: ScatterNode) => nodeBounds(node), []);
  const repairCanvasNodeOverlaps = useCallback((priorityIds: string[] = [], reflowAutoLayout = false) => {
    const state = useScatterStore.getState();
    if (state.nodes.length < 2) return;

    let nextNodes = state.nodes;
    const preferredIds = new Set(priorityIds);
    if (reflowAutoLayout) {
      for (const group of state.groups) {
        if (!group.layout || !group.nodeIds.some((id) => preferredIds.has(id))) continue;
        const patch = applyGroupLayoutPositions(group, nextNodes, state.groups, (node) => nodeBounds(node));
        nextNodes = applyPositionPatch(nextNodes, patch);
        for (const id of collectGroupMemberIds(group.id, state.groups)) preferredIds.add(id);
      }
    }

    const rigidGroups = state.groups
      .filter((group) => !group.parentGroupId)
      .map((group) => collectGroupMemberIds(group.id, state.groups));
    const collisionPatch = preventNodeOverlaps(nextNodes, [...preferredIds], (node) => nodeBounds(node), rigidGroups);
    if (collisionPatch.length) nextNodes = applyPositionPatch(nextNodes, collisionPatch);

    const positionsChanged = nextNodes.some((node, index) => {
      const previous = state.nodes[index];
      return !previous || previous.id !== node.id
        || previous.position.x !== node.position.x
        || previous.position.y !== node.position.y;
    });
    if (!positionsChanged) return;

    previousNodePositionsRef.current = new Map(nextNodes.map((node) => [node.id, { ...node.position }]));
    state.replaceCanvasLive({ nodes: nextNodes });
  }, []);

  const flushNodeCollisionRepair = useCallback((priorityIds: string[] = []) => {
    for (const id of priorityIds) nodeCollisionPriorityIdsRef.current.add(id);
    const pendingIds = [...nodeCollisionPriorityIdsRef.current];
    const reflowAutoLayout = nodeCollisionReflowLayoutRef.current;
    nodeCollisionPriorityIdsRef.current.clear();
    nodeCollisionReflowLayoutRef.current = false;
    if (nodeDragActiveRef.current) {
      for (const id of pendingIds) nodeCollisionPriorityIdsRef.current.add(id);
      nodeCollisionReflowLayoutRef.current ||= reflowAutoLayout;
      return;
    }
    repairCanvasNodeOverlaps(pendingIds, reflowAutoLayout);
  }, [repairCanvasNodeOverlaps]);

  const scheduleNodeCollisionRepair = useCallback((priorityIds: string[] = [], reflowAutoLayout = false) => {
    for (const id of priorityIds) nodeCollisionPriorityIdsRef.current.add(id);
    nodeCollisionReflowLayoutRef.current ||= reflowAutoLayout;
    if (nodeCollisionRepairFrameRef.current !== null) return;
    nodeCollisionRepairFrameRef.current = window.requestAnimationFrame(() => {
      nodeCollisionRepairFrameRef.current = null;
      if (nodeDragActiveRef.current) return;
      flushNodeCollisionRepair();
    });
  }, [flushNodeCollisionRepair]);

  useEffect(() => {
    const projectPath = project?.path ?? null;
    if (nodeCollisionProjectPathRef.current !== projectPath) {
      nodeCollisionProjectPathRef.current = projectPath;
      previousNodePositionsRef.current.clear();
    }

    const previous = previousNodePositionsRef.current;
    const current = new Map(nodes.map((node) => [node.id, { ...node.position }]));
    const movedOrAddedIds = nodes
      .filter((node) => {
        const old = previous.get(node.id);
        return !old || old.x !== node.position.x || old.y !== node.position.y;
      })
      .map((node) => node.id);
    const removedNode = previous.size !== current.size;
    previousNodePositionsRef.current = current;

    if (!project || !isCanvasView || nodeDragActiveRef.current) return;
    if (movedOrAddedIds.length || removedNode) scheduleNodeCollisionRepair(movedOrAddedIds);
  }, [isCanvasView, nodes, project, scheduleNodeCollisionRepair]);

  useEffect(() => {
    const root = canvasShellRef.current;
    if (!project || !isCanvasView || !root || typeof ResizeObserver === "undefined") return;

    const sizes = new Map<HTMLElement, { width: number; height: number }>();
    const resizeObserver = new ResizeObserver((entries) => {
      const resizedIds: string[] = [];
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.getAttribute("data-id");
        if (!id) continue;
        const next = { width: element.offsetWidth, height: element.offsetHeight };
        if (next.width < 1 || next.height < 1) continue;
        const previous = sizes.get(element);
        sizes.set(element, next);
        if (!previous || Math.abs(previous.width - next.width) > 1 || Math.abs(previous.height - next.height) > 1) {
          resizedIds.push(id);
        }
      }
      if (resizedIds.length) scheduleNodeCollisionRepair(resizedIds, true);
    });

    const observe = (element: HTMLElement): void => {
      if (!element.matches(".react-flow__node[data-id]") || sizes.has(element)) return;
      sizes.set(element, { width: element.offsetWidth, height: element.offsetHeight });
      resizeObserver.observe(element);
    };
    const scan = (element: HTMLElement): string[] => {
      const found: string[] = [];
      if (element.matches(".react-flow__node[data-id]")) {
        observe(element);
        const id = element.getAttribute("data-id");
        if (id) found.push(id);
      }
      for (const node of element.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) {
        observe(node);
        const id = node.getAttribute("data-id");
        if (id) found.push(id);
      }
      return found;
    };
    const unobserve = (element: HTMLElement): void => {
      if (element.matches(".react-flow__node[data-id]")) {
        resizeObserver.unobserve(element);
        sizes.delete(element);
      }
      for (const node of element.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) {
        resizeObserver.unobserve(node);
        sizes.delete(node);
      }
    };

    const initialIds = [...root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")]
      .map((element) => element.getAttribute("data-id"))
      .filter((id): id is string => Boolean(id));
    for (const element of root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) observe(element);
    if (initialIds.length) scheduleNodeCollisionRepair(initialIds, true);

    const mutationObserver = new MutationObserver((records) => {
      const addedIds = new Set<string>();
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (!(added instanceof HTMLElement)) continue;
          for (const id of scan(added)) addedIds.add(id);
        }
        for (const removed of record.removedNodes) {
          if (removed instanceof HTMLElement) unobserve(removed);
        }
      }
      if (addedIds.size) scheduleNodeCollisionRepair([...addedIds], true);
    });
    mutationObserver.observe(root, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (nodeCollisionRepairFrameRef.current !== null) {
        window.cancelAnimationFrame(nodeCollisionRepairFrameRef.current);
        nodeCollisionRepairFrameRef.current = null;
      }
      nodeCollisionPriorityIdsRef.current.clear();
      nodeCollisionReflowLayoutRef.current = false;
    };
  }, [isCanvasView, project, scheduleNodeCollisionRepair]);
  const renderedGroups = useMemo(
    () => renderedGroupFrames(nodes, groups, boundsOfNode),
    [nodes, groups, boundsOfNode]
  );

  // Upgrade old visual groups into persistent sections once their node geometry is measurable.
  useEffect(() => {
    if (!groups.some((group) => !group.bounds)) return;
    const frames = new Map(renderedGroups.map((group) => [group.id, {
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.height
    }]));
    let changed = false;
    const nextGroups = groups.map((group) => {
      if (group.bounds) return group;
      const bounds = frames.get(group.id);
      if (!bounds) return group;
      changed = true;
      return { ...group, bounds };
    });
    if (changed) commitCanvasChange({ groups: nextGroups });
  }, [commitCanvasChange, groups, renderedGroups]);

  const groupSelection = useCallback(() => {
    const ids = [...new Set(selectedCanvasNodes.map((node) => node.id))];
    if (!ids.length) return;
    const name = nextSectionName(groups, (index) => t("canvas.sectionName", { index }));
    let nextGroups: CanvasGroup[];
    let created: CanvasGroup;

    if (ids.length === 1) {
      const node = nodes.find((item) => item.id === ids[0]);
      if (!node) return;
      const size = boundsOfNode(node);
      const owner = groups.find((group) => group.nodeIds.includes(node.id));
      created = {
        id: nanoid(),
        name,
        nodeIds: [node.id],
        childGroupIds: [],
        bounds: { x: node.position.x - 24, y: node.position.y - 40, width: size.width + 48, height: size.height + 64 },
        ...(owner ? { parentGroupId: owner.id } : {})
      };
      nextGroups = groups.map((group) => group.id === owner?.id
        ? { ...group, nodeIds: group.nodeIds.filter((id) => id !== node.id), childGroupIds: [...group.childGroupIds, created.id] }
        : group).concat(created);
    } else {
      const grouped = groupNodes(ids, groups, () => nanoid());
      const newGroup = grouped.find((group) => !groups.some((existing) => existing.id === group.id));
      if (!newGroup) return;
      const bounds = groupFrameBox(newGroup, nodes, grouped, boundsOfNode);
      if (!bounds) return;
      created = { ...newGroup, name, bounds };
      nextGroups = grouped.map((group) => group.id === created.id ? created : group);
    }

    commitCanvasChange({ groups: nextGroups, nodes: nodes.map((node) => ({ ...node, selected: false })) });
    setSelectedNodeId(null);
    setSelectedGroupId(created.id);
    setStatus(t("canvas.grouped"));
  }, [boundsOfNode, commitCanvasChange, groups, nodes, selectedCanvasNodes, setSelectedNodeId, setStatus, t]);

  const ungroupSelection = useCallback(() => {
    const selectedIds = new Set(selectedCanvasNodes.map((node) => node.id));
    const targetGroupIds = selectedGroupId
      ? [selectedGroupId]
      : groups
        .filter((group) => group.nodeIds.some((id) => selectedIds.has(id)))
        .filter((group) => group.nodeIds.every((id) => selectedIds.has(id)))
        .map((group) => group.id);
    if (!targetGroupIds.length) return;
    commitCanvasChange({ groups: ungroupGroups(targetGroupIds, groups) });
    setSelectedGroupId(null);
    setStatus(t("canvas.ungrouped"));
  }, [commitCanvasChange, groups, selectedCanvasNodes, selectedGroupId, setStatus, t]);

  const createSectionInBounds = useCallback((bounds: CanvasBox) => {
    const state = useScatterStore.getState();
    const id = nanoid();
    const sectionBoxes = new Map<string, CanvasBox | null>(state.groups.map((group) => [
      group.id,
      groupFrameBox(group, state.nodes, state.groups, (node) => nodeBounds(node))
    ] as const));
    const containedGroupIds = new Set(state.groups.filter((group) => {
      const box = sectionBoxes.get(group.id);
      return Boolean(box && box.x >= bounds.x && box.y >= bounds.y
        && box.x + box.width <= bounds.x + bounds.width
        && box.y + box.height <= bounds.y + bounds.height);
    }).map((group) => group.id));
    const childGroupIds = state.groups
      .filter((group) => containedGroupIds.has(group.id) && (!group.parentGroupId || !containedGroupIds.has(group.parentGroupId)))
      .map((group) => group.id);
    const childMemberIds = new Set(childGroupIds.flatMap((groupId) => collectGroupMemberIds(groupId, state.groups)));
    const memberIds = state.nodes.filter((node) => {
      const box = nodeBounds(node);
      return !childMemberIds.has(node.id)
        && node.position.x >= bounds.x
        && node.position.y >= bounds.y
        && node.position.x + box.width <= bounds.x + bounds.width
        && node.position.y + box.height <= bounds.y + bounds.height;
    }).map((node) => node.id);
    const memberIdSet = new Set(memberIds);
    const parentGroup = state.groups
      .filter((group) => !containedGroupIds.has(group.id))
      .map((group) => ({ group, box: sectionBoxes.get(group.id) }))
      .filter((entry): entry is { group: CanvasGroup; box: CanvasBox } => entry.box !== null && entry.box !== undefined
        && bounds.x >= entry.box.x && bounds.y >= entry.box.y
        && bounds.x + bounds.width <= entry.box.x + entry.box.width
        && bounds.y + bounds.height <= entry.box.y + entry.box.height)
      .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0]?.group;
    const section: CanvasGroup = {
      id,
      name: nextSectionName(state.groups, (index) => t("canvas.sectionName", { index })),
      nodeIds: [...memberIds],
      childGroupIds: [...childGroupIds],
      bounds: { ...bounds },
      ...(parentGroup ? { parentGroupId: parentGroup.id } : {})
    };
    const childGroupIdSet = new Set(childGroupIds);
    const nextGroups = state.groups.map((group) => {
      const next = {
        ...group,
        nodeIds: group.nodeIds.filter((nodeId) => !memberIdSet.has(nodeId)),
        childGroupIds: group.childGroupIds.filter((childId) => !childGroupIdSet.has(childId))
      };
      if (childGroupIdSet.has(group.id)) next.parentGroupId = id;
      if (parentGroup?.id === group.id) next.childGroupIds = [...next.childGroupIds, id];
      return next;
    }).concat(section);
    state.commitCanvasChange({ groups: nextGroups, nodes: state.nodes.map((node) => ({ ...node, selected: false })) });
    setSelectedNodeId(null);
    setSelectedEdgeIds([]);
    setSelectedGroupId(id);
    setStatus(t("canvas.grouped"));
  }, [setSelectedNodeId, setStatus, t]);

  const commitGroupRename = useCallback((groupId: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      commitCanvasChange({ groups: groups.map((group) => group.id === groupId ? { ...group, name: trimmed } : group) });
    }
    setRenamingGroupId(null);
  }, [commitCanvasChange, groups]);

  const alignSelection = useCallback(
    (mode: AlignMode) => {
      const ids = selectedCanvasNodes.map((node) => node.id);
      const patch = alignSelectedNodes(nodes, ids, mode, boundsOfNode);
      if (!patch.length) return;
      commitCanvasChange({ nodes: applyPositionPatch(nodes, patch) });
    },
    [boundsOfNode, commitCanvasChange, nodes, selectedCanvasNodes]
  );

  // Whether the current selection includes a direct member of any group with
  // an active Auto Layout: such nodes' positions are governed by the group
  // layout, so a manual distribute would be overwritten by the next re-flow.
  const selectionHasLayoutGroupNode = useMemo(() => {
    const ids = new Set(selectedCanvasNodes.map((n) => n.id));
    return groups.some((g) => g.layout && g.nodeIds.some((id) => ids.has(id)));
  }, [groups, selectedCanvasNodes]);

  // Recommended one-click layout action for the current selection, from the
  // domain pure helper; drives the trigger icon/label of the bar dropdown.
  const recommendedLayoutAction = useMemo<"tidy" | "distribute-horizontal" | "distribute-vertical" | null>(() => {
    const ids = selectedCanvasNodes.map((n) => n.id);
    if (ids.length < 2) return null;
    if (selectionHasLayoutGroupNode) return "tidy";
    return recommendSelectionLayoutAction(nodes, ids, boundsOfNode);
  }, [nodes, selectedCanvasNodes, boundsOfNode, selectionHasLayoutGroupNode]);

  const recommendIconByAction = {
    tidy: "tidy-up",
    "distribute-horizontal": "distribute-horizontal-menu",
    "distribute-vertical": "distribute-vertical-menu"
  } as const;
  const recommendIcon = recommendIconByAction[recommendedLayoutAction ?? "tidy"];
  const recommendLabel =
    recommendedLayoutAction === "distribute-horizontal"
      ? t("canvas.distributeHorizontal")
      : recommendedLayoutAction === "distribute-vertical"
        ? t("canvas.distributeVertical")
        : t("canvas.tidyUp");
  const arrangementMenuLabel = `${t("canvas.openArrangementMenu")} · ${t("canvas.recommendedAction", { action: recommendLabel })}`;

  // Auto Layout controls: the innermost group that has a layout and contains
  // every currently selected node. The Coze component now consumes the repo's
  // own CanvasGroupLayout directly; onChange merges the patch into the
  // persisted layout (preserving childOrder) and re-flows in one commit.
  const activeLayoutGroup = useMemo(() => {
    const ids = new Set(selectedCanvasNodes.map((n) => n.id));
    if (!ids.size) return null;
    const candidates = groups.filter(
      (g) => g.layout && [...ids].every((id) => g.nodeIds.includes(id))
    );
    candidates.sort((a, b) => a.nodeIds.length - b.nodeIds.length);
    return candidates[0] ?? null;
  }, [groups, selectedCanvasNodes]);

  const updateActiveGroupLayout = useCallback(
    (patch: Partial<CanvasGroupLayout>) => {
      const layout = activeLayoutGroup?.layout;
      if (!activeLayoutGroup || !layout) return;
      const g = activeLayoutGroup;
      const old = layout;
      // Capture the frame BEFORE the layout change so the outer top-left stays
      // fixed while changed padding shifts content (frame is derived live, so
      // re-deriving it after the change would cancel the new padding).
      const baseline = groupFrameBox(g, nodes, groups, (node) => nodeBounds(node));
      const nextGroups = groups.map((item) =>
        item.id === g.id
          ? {
              ...item,
              layout: {
                axis: patch.axis ?? old.axis,
                gap: patch.gap ?? old.gap,
                alignment: patch.alignment ?? old.alignment,
                padding: { ...old.padding, ...(patch.padding ?? {}) },
                childOrder: [...old.childOrder]
              }
            }
          : item
      );
      const updated = nextGroups.find((item) => item.id === g.id)!;
      const reflow = applyGroupLayoutPositions(updated, nodes, nextGroups, (node) => nodeBounds(node), baseline ?? undefined);
      commitCanvasChange({ nodes: applyPositionPatch(nodes, reflow), groups: nextGroups });
    },
    [activeLayoutGroup, applyPositionPatch, applyGroupLayoutPositions, commitCanvasChange, groups, nodes]
  );

  const distributeSelection = useCallback(
    (axis: DistributeAxis) => {
      const ids = selectedCanvasNodes.map((node) => node.id);
      const patch = distributeSelectedNodes(nodes, ids, axis, boundsOfNode);
      if (!patch.length) return;
      commitCanvasChange({ nodes: applyPositionPatch(nodes, patch) });
    },
    [boundsOfNode, commitCanvasChange, nodes, selectedCanvasNodes]
  );

  const tidySelection = useCallback(() => {
    const ids = selectedCanvasNodes.map((node) => node.id);
    const patch = tidyUpNodes(nodes, ids, boundsOfNode);
    if (!patch.length) return;
    commitCanvasChange({ nodes: applyPositionPatch(nodes, patch) });
  }, [boundsOfNode, commitCanvasChange, nodes, selectedCanvasNodes]);

  const toggleAutoLayout = useCallback(() => {
    const selectedIds = new Set(selectedCanvasNodes.map((node) => node.id));
    const owning = groups.filter((group) => group.nodeIds.some((id) => selectedIds.has(id)));
    if (owning.length !== 1) return;
    const target = owning[0];
    const turningOn = !target.layout;

    let nextGroups: CanvasGroup[];
    if (turningOn) {
      const memberNodes = target.nodeIds
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is ScatterNode => Boolean(n));
      // Persisted container state: axis/gap/padding/alignment/child order.
      const childOrder = [...memberNodes].sort((a, b) => a.position.x - b.position.x).map((n) => n.id);
      const layout = defaultGroupLayout("horizontal", childOrder);
      nextGroups = groups.map((group) =>
        group.id === target.id
          ? { ...group, nodeIds: [...group.nodeIds], childGroupIds: [...group.childGroupIds], layout }
          : group
      );
    } else {
      nextGroups = groups.map((group) => {
        if (group.id !== target.id) return group;
        const { layout: _layout, ...rest } = { ...group, nodeIds: [...group.nodeIds], childGroupIds: [...group.childGroupIds] };
        return rest;
      });
    }

    const updated = nextGroups.find((g) => g.id === target.id)!;
    let nextNodes = nodes;
    if (turningOn) {
      const patch = applyGroupLayoutPositions(updated, nodes, nextGroups, boundsOfNode);
      nextNodes = applyPositionPatch(nodes, patch);
    }
    commitCanvasChange({ nodes: nextNodes, groups: nextGroups });
    setStatus(turningOn ? t("canvas.autoLayoutOn") : t("canvas.autoLayoutOff"));
  }, [boundsOfNode, commitCanvasChange, groups, nodes, selectedCanvasNodes, setStatus, t]);

  const deleteSelectedNodes = useCallback(() => {
    const removedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    if (!removedIds.size) return;
    const nextNodes0 = nodes.filter((node) => !removedIds.has(node.id));
    const nextEdges = edgesForExistingNodes(edges, nextNodes0);
    const nextNodes = normalizeReferenceNodes(nextNodes0, nextEdges);
    const nextGroups = pruneGroupsAfterNodeRemoval([...removedIds], groups);
    clearConnectionHoverTarget();
    commitCanvasChange({
      nodes: nextNodes,
      edges: nextEdges,
      groups: nextGroups
    });
    setSelectedEdgeIds((current) => current.filter((edgeId) => nextEdges.some((edge) => edge.id === edgeId)));
    if (selectedNodeId && removedIds.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [clearConnectionHoverTarget, commitCanvasChange, edges, groups, nodes, normalizeReferenceNodes, selectedNodeId, setSelectedNodeId]);

  const updateReferenceAlias = useCallback(
    (nodeId: string, mediaNodeId: string, alias: string) => {
      const taskNode = nodes.find((node) => node.id === nodeId);
      if (!taskNode) return;
      const assignments = taskNode.data.referenceAssignments ?? {};
      const record = assignments[mediaNodeId];
      if (!record) return;
      const trimmed = alias.trim();
      if (!isValidAlias(trimmed, record.kind)) return;
      const takenByOther = Object.entries(assignments).some(
        ([id, item]) => id !== mediaNodeId && item.alias === trimmed
      );
      if (takenByOther || trimmed === record.alias) return;

      const body = replaceAliasInBody(taskNode.data.body ?? "", record.alias, trimmed);
      const nextAssignments = { ...assignments, [mediaNodeId]: { ...record, alias: trimmed } };
      commitCanvasChange({
        nodes: nodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, referenceAssignments: nextAssignments, body } }
            : node
        )
      });
    },
    [commitCanvasChange, nodes]
  );

  const updateReferencePurpose = useCallback(
    (nodeId: string, mediaNodeId: string, purpose: string) => {
      const taskNode = nodes.find((node) => node.id === nodeId);
      if (!taskNode) return;
      const assignments = taskNode.data.referenceAssignments ?? {};
      const record = assignments[mediaNodeId];
      if (!record) return;
      const nextAssignments = { ...assignments, [mediaNodeId]: { ...record, purpose } };
      commitCanvasChange({
        nodes: nodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, referenceAssignments: nextAssignments } }
            : node
        )
      });
    },
    [commitCanvasChange, nodes]
  );

  const updateReferenceRole = useCallback(
    (nodeId: string, mediaNodeId: string, analysisOnly: boolean) => {
      const taskNode = nodes.find((node) => node.id === nodeId);
      if (!taskNode) return;
      const assignments = taskNode.data.referenceAssignments ?? {};
      const record = assignments[mediaNodeId];
      if (!record) return;
      const depthOutputIds = depthOutputVideoIds(nodes, edges);
      const mediaNode = nodes.find((node) => node.id === mediaNodeId);
      const isProtectedTargetVideo = mediaNode?.data.nodeKind === "video-reference"
        && !depthOutputIds.has(mediaNodeId)
        && targetAnalysisVideoIds(nodes, edges).has(mediaNodeId);
      const result = updateTaskReferenceRole(assignments, taskNode.data.body ?? "", mediaNodeId, analysisOnly || isProtectedTargetVideo, depthOutputIds.has(mediaNodeId));
      if (result.assignments === assignments && result.body === undefined) return;
      commitCanvasChange({
        nodes: nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  referenceAssignments: result.assignments,
                  body: result.body ?? taskNode.data.body ?? ""
                }
              }
            : node
        )
      });
    },
    [commitCanvasChange, edges, nodes]
  );

  const moveReference = useCallback(
    (nodeId: string, mediaNodeId: string, direction: -1 | 1) => {
      const taskNode = nodes.find((node) => node.id === nodeId);
      if (!taskNode) return;
      const assignments = taskNode.data.referenceAssignments ?? {};
      const entries = Object.entries(assignments).sort((a, b) => a[1].order - b[1].order);
      const index = entries.findIndex(([id]) => id === mediaNodeId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) return;

      const next = [...entries];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      const nextAssignments: typeof assignments = {};
      next.forEach(([id, item], i) => {
        nextAssignments[id] = { ...item, order: i + 1 };
      });
      commitCanvasChange({
        nodes: nodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, referenceAssignments: nextAssignments } }
            : node
        )
      });
    },
    [commitCanvasChange, nodes]
  );

  const unlinkReference = useCallback(
    (nodeId: string, mediaNodeId: string) => {
      const nextEdges = edges.filter((edge) => !(edge.source === mediaNodeId && edge.target === nodeId && !edge.targetHandle));
      const nextNodes = normalizeReferenceNodes(nodes, nextEdges);
      commitCanvasChange({
        nodes: nextNodes,
        edges: nextEdges
      });
    },
    [commitCanvasChange, edges, nodes, normalizeReferenceNodes]
  );

  useEffect(() => {
    setTaskNodeActions({
      updateNodeData,
      updateReplicationScope,
      beginNodeEdit: beginHistoryTransaction,
      commitNodeEdit: commitHistoryTransaction,
      chooseFilesForNode,
      addFilesToNode,
      replaceFilesForNode,
      removeAttachment,
      createConnectedNode,
      duplicateNode,
      deleteNode,
      runNode,
      runPromptNode,
      runReplicationNode,
      runDepthConversion,
      runPixverseGeneration,
      updateReferenceAlias,
      updateReferencePurpose,
      updateReferenceRole,
      moveReference,
      unlinkReference
    });
  }, [addFilesToNode, beginHistoryTransaction, chooseFilesForNode, commitHistoryTransaction, createConnectedNode, deleteNode, duplicateNode, moveReference, removeAttachment, replaceFilesForNode, runDepthConversion, runNode, runPromptNode, runReplicationNode, runPixverseGeneration, unlinkReference, updateNodeData, updateReferenceAlias, updateReferencePurpose, updateReferenceRole, updateReplicationScope]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ScatterNode>[]) => {
      const next = applyNodeChanges(changes as NodeChange[], nodes as Node<ScatterNodeData>[]) as Node<ScatterNodeData>[];
      const nextNodes = next.map((node) => ({ ...node, type: "task" as const })) as ScatterNode[];
      const hasStructuralChange = changes.some((change) => change.type === "add" || change.type === "remove" || change.type === "replace");
      const hasPositionChange = changes.some((change) => change.type === "position");
      const hasDraggingPosition = changes.some((change) => change.type === "position" && change.dragging);
      const removedNodeIds = changes.flatMap((change) => (change.type === "remove" ? [change.id] : []));

      if (hasStructuralChange) {
        clearConnectionHoverTarget();
        commitCanvasChange({
          nodes: nextNodes,
          edges: removedNodeIds.length ? edgesForExistingNodes(edges, nextNodes) : edges
        });
        return;
      }

      if (hasPositionChange) {
        const settledSourceId = optionDuplicateSettledSourceRef.current;
        if (settledSourceId && changes.some((change) => change.type === "position" && change.id === settledSourceId)) {
          return;
        }

        const optionDuplicateDrag = optionDuplicateDragRef.current;
        if (optionDuplicateDrag) {
          const draggedNode = nextNodes.find((node) => node.id === optionDuplicateDrag.sourceId);
          const nextPosition = draggedNode?.position ?? optionDuplicateDrag.lastPosition;
          optionDuplicateDrag.lastPosition = roundPosition(nextPosition);
          optionDuplicateDrag.hasPreview = true;
          nodeDragActiveRef.current = true;
          replaceCanvasLive({ nodes: optionDuplicatePreviewNodes(optionDuplicateDrag, optionDuplicateDrag.lastPosition) });
          setSelectedNodeId(optionDuplicateDrag.duplicateId);
          return;
        }

        if (hasDraggingPosition) {
          nodeDragActiveRef.current = true;
          if (!nodeDragHistoryOpenRef.current) {
            beginHistoryTransaction();
            nodeDragHistoryOpenRef.current = true;
          }
          replaceCanvasLive({ nodes: nextNodes });
          return;
        }

        if (nodeDragHistoryOpenRef.current) {
          nodeDragActiveRef.current = false;
          replaceCanvasLive({ nodes: nextNodes });
          commitHistoryTransaction();
          nodeDragHistoryOpenRef.current = false;
          return;
        }

        nodeDragActiveRef.current = false;
        commitCanvasChange({ nodes: nextNodes });
        return;
      }

      if (!scatterNodesEqualForLive(nodes, nextNodes)) {
        replaceCanvasLive({ nodes: nextNodes });
      }
    },
    [beginHistoryTransaction, clearConnectionHoverTarget, commitCanvasChange, commitHistoryTransaction, edges, nodes, replaceCanvasLive, setSelectedNodeId]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ScatterEdge>[]) => {
      const next = applyEdgeChanges(changes as EdgeChange[], edges as Edge[]);
      const nextEdges = next.map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined,
        target: edge.target,
        targetHandle: typeof edge.targetHandle === "string" ? edge.targetHandle : undefined,
        label: typeof (edge as Edge).label === "string" ? ((edge as Edge).label as string) : undefined,
        routePoints: (edge as Edge & { routePoints?: ScatterEdge["routePoints"] }).routePoints
      }));
      const hasDocumentChange = changes.some((change) => change.type !== "select");

      if (hasDocumentChange) {
        commitCanvasChange({
          nodes: normalizeReferenceNodes(nodes, nextEdges),
          edges: nextEdges
        });
        return;
      }

      if (shiftSelectionActive) {
        setSelectedEdgeIds((current) => (current.length ? [] : current));
        return;
      }

      const nextSelectedEdgeIds = next.filter((edge) => Boolean(edge.selected)).map((edge) => edge.id);
      setSelectedEdgeIds((current) => (stringArraysEqual(current, nextSelectedEdgeIds) ? current : nextSelectedEdgeIds));
      if (!scatterEdgesEqual(edges, nextEdges)) {
        replaceCanvasLive({ edges: nextEdges });
      }
    },
    [commitCanvasChange, edges, nodes, normalizeReferenceNodes, replaceCanvasLive, shiftSelectionActive, setSelectedEdgeIds]
  );

  const commitExistingConnection = useCallback(
    (connection: Pick<ScatterEdge, "source" | "sourceHandle" | "target" | "targetHandle">, selectedNodeIdAfterCommit: string) => {
      if (!isConnectionAllowed(connection, edges, nodes)) return false;

      const nextEdges = [...edges, { id: nanoid(), ...connection }];
      const normalizedNodes = normalizeReferenceNodes(
        nodes.map((node) => ({ ...node, selected: node.id === selectedNodeIdAfterCommit })),
        nextEdges
      );
      const sourceNode = normalizedNodes.find((node) => node.id === connection.source);
      const targetNode = normalizedNodes.find((node) => node.id === connection.target);
      const carriesReplicationContext = targetNode?.data.nodeKind === "generic-prompt"
        && (sourceNode?.data.nodeKind === "replication-analysis"
          || sourceNode?.data.nodeKind === "replication-section"
          || sourceNode?.data.nodeKind === "replication-comparison");
      const promptFeedsGeneration = targetNode?.data.nodeKind === "pixverse-generation"
        && sourceNode?.data.nodeKind === "generic-prompt";
      const contextSourceMode = sourceNode?.data.replicationMode
        || (sourceNode ? inferReplicationMode(sourceNode, normalizedNodes, nextEdges) : undefined);
      const contextAnalysisId = sourceNode?.data.nodeKind === "replication-analysis"
        ? sourceNode.id
        : sourceNode?.data.replicationAnalysisNodeId;
      const nextNodes = normalizedNodes.map((node) => {
        if (node.id !== connection.target) return node;
        if (carriesReplicationContext && contextAnalysisId) {
          return {
            ...node,
            data: {
              ...node.data,
              replicationMode: contextSourceMode || node.data.replicationMode,
              replicationAnalysisNodeId: contextAnalysisId
            }
          };
        }
        if (promptFeedsGeneration && sourceNode?.data.replicationAnalysisNodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              replicationMode: sourceNode.data.replicationMode || contextSourceMode || node.data.replicationMode,
              replicationAnalysisNodeId: sourceNode.data.replicationAnalysisNodeId
            }
          };
        }
        return node;
      });
      commitCanvasChange({
        nodes: nextNodes,
        edges: nextEdges
      });
      setSelectedNodeId(selectedNodeIdAfterCommit);
      return true;
    },
    [commitCanvasChange, edges, nodes, normalizeReferenceNodes, setSelectedNodeId]
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      return isConnectionAllowed({ source: connection.source, sourceHandle: connection.sourceHandle || undefined, target: connection.target, targetHandle: connection.targetHandle || undefined }, edges, nodes);
    },
    [edges, nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const didCommit = commitExistingConnection({ source: connection.source, sourceHandle: connection.sourceHandle || undefined, target: connection.target, targetHandle: connection.targetHandle || undefined }, connection.target);
      connectionSucceededRef.current = didCommit;
      if (didCommit) clearConnectionHoverTarget();
    },
    [clearConnectionHoverTarget, commitExistingConnection]
  );

  const handleConnectStart = useCallback<OnConnectStart>(
    (_event, params) => {
      setIsConnecting(true);
      connectionSucceededRef.current = false;
      clearConnectionHoverTarget();

      if (!params.nodeId || !params.handleType) {
        connectionStartRef.current = null;
        return;
      }

      const hasExistingParent = params.handleType === "target" && edges.some((edge) => edge.target === params.nodeId);
      const hasExistingHandleParent = params.handleType === "target" && Boolean(params.handleId) && edges.some((edge) => edge.target === params.nodeId && edge.targetHandle === params.handleId);
      if ((hasExistingParent && !params.handleId) || hasExistingHandleParent) {
        connectionStartRef.current = null;
        return;
      }

      connectionStartRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
        handleId: params.handleId || undefined
      };
      setSelectedNodeId(params.nodeId);
      replaceCanvasLive({ nodes: nodes.map((node) => ({ ...node, selected: node.id === params.nodeId })) });
    },
    [clearConnectionHoverTarget, edges, nodes, replaceCanvasLive, setSelectedNodeId]
  );

  const handleConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      setIsConnecting(false);

      const connectionStart = connectionStartRef.current;
      const connectedSuccessfully = connectionSucceededRef.current || connectionState.isValid === true;
      const hoveredNodeId = connectionHoverTargetRef.current?.hoveredNodeId ?? nodeIdFromConnectionEvent(event);
      connectionStartRef.current = null;
      connectionSucceededRef.current = false;
      clearConnectionHoverTarget();

      if (connectedSuccessfully || !project || !isCanvasView || !connectionStart) return;

      if (hoveredNodeId) {
        const hoveredConnection = connectionFromStart(connectionStart, hoveredNodeId);
        if (hoveredConnection) {
          commitExistingConnection(hoveredConnection, hoveredNodeId);
        }
        return;
      }

      if (connectionState.toHandle || connectionState.toNode) return;

      const clientPosition = eventClientPosition(event);
      const canvasRect = canvasShellRef.current?.getBoundingClientRect();
      if (!clientPosition || !canvasRect) return;
      const isInsideCanvas =
        clientPosition.x >= canvasRect.left &&
        clientPosition.x <= canvasRect.right &&
        clientPosition.y >= canvasRect.top &&
        clientPosition.y <= canvasRect.bottom;
      if (!isInsideCanvas) return;

      const flowPosition = flowInstanceRef.current?.screenToFlowPosition(clientPosition);
      if (!flowPosition) return;

      const sourceNode = nodes.find((node) => node.id === connectionStart.nodeId);
      if (!sourceNode) return;

      const nodePosition = findConnectionDropPosition(flowPosition, connectionStart.handleType, sourceNode, nodes);
      const newNode = {
        ...emptyNode(nodePosition, nodes, t),
        selected: true
      };
      const newEdge =
        connectionStart.handleType === "source"
          ? { id: nanoid(), source: sourceNode.id, sourceHandle: connectionStart.handleId, target: newNode.id }
          : { id: nanoid(), source: newNode.id, target: sourceNode.id, targetHandle: connectionStart.handleId };

      const nextEdges = [...edges, newEdge];
      const nextNodes = normalizeReferenceNodes(
        [...nodes.map((node) => ({ ...node, selected: false })), newNode],
        nextEdges
      );
      commitCanvasChange({
        nodes: nextNodes,
        edges: nextEdges
      });
      setSelectedNodeId(newNode.id);
    },
    [clearConnectionHoverTarget, commitCanvasChange, commitExistingConnection, edges, isCanvasView, nodes, normalizeReferenceNodes, project, setSelectedNodeId, t]
  );

  const handleNodeDragStart = useCallback<OnNodeDrag<Node>>(
    (event, node) => {
      nodeDragActiveRef.current = true;

      if (!event.altKey) return;
      const source = nodes.find((item) => item.id === node.id);
      if (!source) return;

      optionDuplicateDragRef.current = {
        sourceId: node.id,
        duplicateId: nanoid(),
        originalNodes: nodes.map(cloneCanvasNode),
        lastPosition: source.position,
        hasPreview: false
      };
      beginHistoryTransaction();
    },
    [beginHistoryTransaction, nodes]
  );

  // --- Interactive section title: selecting/moving the title acts on the
  // section container and all its descendants, while clicks on child nodes
  // remain available to React Flow.
  const groupFrameDragRef = useRef<{
    groupId: string;
    startFlow: FlowPosition;
    startPositions: Map<string, FlowPosition>;
    startGroupBounds: Map<string, CanvasBox>;
    moved: boolean;
  } | null>(null);

  const onGroupFramePointerDown = useCallback(
    (groupId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || panModeActive) return;
      event.stopPropagation();
      const state = useScatterStore.getState();
      const memberIds = collectGroupMemberIds(groupId, state.groups);
      const sectionIds = new Set(collectGroupTreeIds(groupId, state.groups));
      const startFlow =
        flowInstanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
          x: event.clientX,
          y: event.clientY
        };
      const startPositions = new Map(
        state.nodes.filter((n) => memberIds.includes(n.id)).map((n) => [n.id, { ...n.position }])
      );
      const startGroupBounds = new Map(
        state.groups
          .filter((group) => sectionIds.has(group.id))
          .map((group) => [group.id, groupFrameBox(group, state.nodes, state.groups, (node) => nodeBounds(node))])
          .filter((entry): entry is [string, CanvasBox] => Boolean(entry[1]))
      );
      groupFrameDragRef.current = { groupId, startFlow, startPositions, startGroupBounds, moved: false };
      setSelectedGroupId(groupId);
      setRenamingGroupId(null);
      replaceCanvasLive({ nodes: state.nodes.map((node) => ({ ...node, selected: false })) });
      setSelectedNodeId(null);
      setSelectedEdgeIds([]);

      const onMove = (ev: PointerEvent): void => {
        const drag = groupFrameDragRef.current;
        if (!drag) return;
        const cur =
          flowInstanceRef.current?.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) ?? {
            x: ev.clientX,
            y: ev.clientY
          };
        const dx = cur.x - drag.startFlow.x;
        const dy = cur.y - drag.startFlow.y;
        if (!drag.moved && Math.hypot(dx, dy) < 2) return;
        if (!drag.moved) {
          drag.moved = true;
          beginHistoryTransaction();
        }
        const current = useScatterStore.getState();
        replaceCanvasLive({
          nodes: current.nodes.map((node) => {
            const start = drag.startPositions.get(node.id);
            return start ? { ...node, position: { x: start.x + dx, y: start.y + dy } } : node;
          }),
          groups: current.groups.map((group) => {
            const start = drag.startGroupBounds.get(group.id);
            return start ? { ...group, bounds: { ...start, x: start.x + dx, y: start.y + dy } } : group;
          })
        });
      };

      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const drag = groupFrameDragRef.current;
        groupFrameDragRef.current = null;
        if (!drag) return;
        if (drag.moved) {
          commitHistoryTransaction();
          return;
        }
        const current = useScatterStore.getState();
        replaceCanvasLive({ nodes: current.nodes.map((node) => ({ ...node, selected: false })) });
        setSelectedNodeId(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [beginHistoryTransaction, commitHistoryTransaction, panModeActive, replaceCanvasLive, setSelectedEdgeIds, setSelectedGroupId, setSelectedNodeId]
  );

  const onGroupResizePointerDown = useCallback(
    (groupId: string, handle: GroupResizeHandle, event: ReactPointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0 || panModeActive) return;
      event.stopPropagation();
      event.preventDefault();
      const state = useScatterStore.getState();
      const group = state.groups.find((item) => item.id === groupId);
      const startBounds = group && groupFrameBox(group, state.nodes, state.groups, (node) => nodeBounds(node));
      if (!startBounds) return;
      const startFlow = flowInstanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: event.clientX,
        y: event.clientY
      };
      groupResizeRef.current = { groupId, handle, startFlow, startBounds, moved: false };
      setSelectedGroupId(groupId);
      setRenamingGroupId(null);
      replaceCanvasLive({ nodes: state.nodes.map((node) => ({ ...node, selected: false })) });
      setSelectedNodeId(null);
      setSelectedEdgeIds([]);

      const onMove = (ev: PointerEvent): void => {
        const drag = groupResizeRef.current;
        if (!drag) return;
        const currentFlow = flowInstanceRef.current?.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) ?? {
          x: ev.clientX,
          y: ev.clientY
        };
        const dx = currentFlow.x - drag.startFlow.x;
        const dy = currentFlow.y - drag.startFlow.y;
        if (!drag.moved && Math.hypot(dx, dy) < 2) return;
        if (!drag.moved) {
          drag.moved = true;
          beginHistoryTransaction();
        }
        const minimum = 80 / Math.max(canvasViewport.zoom, 0.01);
        let left = drag.startBounds.x;
        let top = drag.startBounds.y;
        let right = drag.startBounds.x + drag.startBounds.width;
        let bottom = drag.startBounds.y + drag.startBounds.height;
        if (drag.handle.includes("w")) left = Math.min(right - minimum, drag.startBounds.x + dx);
        if (drag.handle.includes("e")) right = Math.max(left + minimum, drag.startBounds.x + drag.startBounds.width + dx);
        if (drag.handle.includes("n")) top = Math.min(bottom - minimum, drag.startBounds.y + dy);
        if (drag.handle.includes("s")) bottom = Math.max(top + minimum, drag.startBounds.y + drag.startBounds.height + dy);
        const bounds = { x: left, y: top, width: right - left, height: bottom - top };
        const current = useScatterStore.getState();
        replaceCanvasLive({
          groups: current.groups.map((item) => item.id === drag.groupId ? { ...item, bounds } : item)
        });
      };

      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const drag = groupResizeRef.current;
        groupResizeRef.current = null;
        if (!drag?.moved) return;
        const current = useScatterStore.getState();
        const resized = current.groups.find((item) => item.id === drag.groupId);
        const resizedBounds = resized?.bounds;
        if (resizedBounds) {
          const memberIds = collectGroupMemberIds(drag.groupId, current.groups);
          const newlyContainedIds = current.nodes.filter((node) => {
            const box = nodeBounds(node);
            return node.position.x >= resizedBounds.x
              && node.position.y >= resizedBounds.y
              && node.position.x + box.width <= resizedBounds.x + resizedBounds.width
              && node.position.y + box.height <= resizedBounds.y + resizedBounds.height;
          }).map((node) => node.id);
          const affectedIds = [...new Set([...memberIds, ...newlyContainedIds])];
          const referenceNodes = current.history?.transactionStart?.nodes ?? current.nodes;
          const nextGroups = syncNodeGroupsToSections(affectedIds, current.nodes, current.groups, (node) => nodeBounds(node), referenceNodes);
          current.commitCanvasChange({ groups: nextGroups });
        }
        commitHistoryTransaction();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [beginHistoryTransaction, canvasViewport.zoom, commitHistoryTransaction, panModeActive, replaceCanvasLive, setSelectedEdgeIds, setSelectedGroupId, setSelectedNodeId]
  );

  const onSectionDrawPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || canvasTool !== "section" || panModeActive) return;
      event.preventDefault();
      event.stopPropagation();
      const startFlow = flowInstanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: event.clientX,
        y: event.clientY
      };
      const startClient = { x: event.clientX, y: event.clientY };
      sectionDrawRef.current = { startFlow, startClient };
      setSectionDraft(null);
      setSelectedGroupId(null);
      setRenamingGroupId(null);
      const state = useScatterStore.getState();
      replaceCanvasLive({ nodes: state.nodes.map((node) => ({ ...node, selected: false })) });
      setSelectedNodeId(null);
      setSelectedEdgeIds([]);

      const toBounds = (flowX: number, flowY: number): CanvasBox => ({
        x: Math.min(startFlow.x, flowX),
        y: Math.min(startFlow.y, flowY),
        width: Math.abs(flowX - startFlow.x),
        height: Math.abs(flowY - startFlow.y)
      });
      const onMove = (ev: PointerEvent): void => {
        const drag = sectionDrawRef.current;
        if (!drag || Math.hypot(ev.clientX - drag.startClient.x, ev.clientY - drag.startClient.y) < 4) return;
        const flow = flowInstanceRef.current?.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) ?? { x: ev.clientX, y: ev.clientY };
        setSectionDraft(toBounds(flow.x, flow.y));
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const drag = sectionDrawRef.current;
        sectionDrawRef.current = null;
        setSectionDraft(null);
        if (!drag) return;
        const flow = flowInstanceRef.current?.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) ?? { x: ev.clientX, y: ev.clientY };
        const bounds = toBounds(flow.x, flow.y);
        const minimumSize = 32 / Math.max(canvasViewport.zoom, 0.01);
        if (bounds.width < minimumSize || bounds.height < minimumSize) return;
        createSectionInBounds(bounds);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [canvasTool, canvasViewport.zoom, createSectionInBounds, panModeActive, replaceCanvasLive, setSelectedEdgeIds, setSelectedNodeId]
  );

  // After a drag settles inside an open drag transaction, re-flow every touched
  // Auto Layout group: children dropped inside the frame re-order along the
  // main axis; children whose center landed OUTSIDE the frame detach from the
  // group. Runs INSIDE the drag transaction so it stays one undo step.
  const reflowAutoLayoutAfterDrag = useCallback(() => {
    const state = useScatterStore.getState();
    const draggedIds = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id));
    if (!draggedIds.size) return;
    const touched = state.groups.filter((group) => group.layout && group.nodeIds.some((id) => draggedIds.has(id)));
    if (!touched.length) return;

    let nextNodes = state.nodes;
    let nextGroups = state.groups;
    const baselineNodes = state.history?.transactionStart?.nodes ?? state.nodes;
    for (const group of touched) {
      const baseline = groupFrameBox(group, baselineNodes, nextGroups, (node) => nodeBounds(node));
      if (!baseline) continue;
      const plan = planGroupAfterDrag(group, nextNodes, nextGroups, (node) => nodeBounds(node), baseline);
      if (!plan) continue;
      nextGroups = nextGroups.map((item) => (item.id === plan.group.id ? plan.group : item));
      nextNodes = applyPositionPatch(nextNodes, plan.patch);
    }
    state.commitCanvasChange({ nodes: nextNodes, groups: nextGroups });
  }, []);

  const syncMovedNodesToSections = useCallback((nodeIds: string[]) => {
    const state = useScatterStore.getState();
    const referenceNodes = state.history?.transactionStart?.nodes ?? state.nodes;
    const nextGroups = syncNodeGroupsToSections(nodeIds, state.nodes, state.groups, (node) => nodeBounds(node), referenceNodes);
    if (JSON.stringify(nextGroups) !== JSON.stringify(state.groups)) state.commitCanvasChange({ groups: nextGroups });
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<Node>>(
    (_event, draggedNode) => {
      const optionDuplicateDrag = optionDuplicateDragRef.current;
      if (optionDuplicateDrag) {
        if (!optionDuplicateDrag.hasPreview) {
          optionDuplicateDragRef.current = null;
          nodeDragActiveRef.current = false;
          cancelHistoryTransaction();
          return;
        }

        optionDuplicateDragRef.current = null;
        nodeDragHistoryOpenRef.current = false;
        nodeDragActiveRef.current = false;
        optionDuplicateSettledSourceRef.current = optionDuplicateDrag.sourceId;
        replaceCanvasLive({ nodes: optionDuplicatePreviewNodes(optionDuplicateDrag, optionDuplicateDrag.lastPosition) });
        setSelectedNodeId(optionDuplicateDrag.duplicateId);
        flushNodeCollisionRepair([optionDuplicateDrag.duplicateId]);
        syncMovedNodesToSections([optionDuplicateDrag.duplicateId]);
        commitHistoryTransaction();
        window.setTimeout(() => {
          if (optionDuplicateSettledSourceRef.current === optionDuplicateDrag.sourceId) {
            optionDuplicateSettledSourceRef.current = null;
          }
        }, 0);
        return;
      }

      window.setTimeout(() => {
        nodeDragActiveRef.current = false;
        const selectedIds = useScatterStore.getState().nodes.filter((node) => node.selected).map((node) => node.id);
        const priorityIds = [...selectedIds, draggedNode.id];
        if (!nodeDragHistoryOpenRef.current) {
          flushNodeCollisionRepair(priorityIds);
          return;
        }
        reflowAutoLayoutAfterDrag();
        flushNodeCollisionRepair(priorityIds);
        syncMovedNodesToSections(priorityIds);
        commitHistoryTransaction();
        nodeDragHistoryOpenRef.current = false;
      }, 0);
    },
    [cancelHistoryTransaction, commitHistoryTransaction, flushNodeCollisionRepair, reflowAutoLayoutAfterDrag, replaceCanvasLive, setSelectedNodeId, syncMovedNodesToSections]
  );

  const selectCanvasNode = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      setSelectedGroupId(null);
      setRenamingGroupId(null);
    },
    [setSelectedNodeId, setSelectedGroupId]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectCanvasNode(node.id);
    },
    [selectCanvasNode]
  );

  const handlePaneClick = useCallback(() => {
    selectCanvasNode(null);
    setSelectedEdgeIds([]);
    setHoveredEdgeId(null);
  }, [selectCanvasNode]);

  const handleSelectionEnd = useCallback(() => {
    const selectedNode = flowInstanceRef.current?.getNodes().find((node) => node.selected);
    selectCanvasNode(selectedNode?.id ?? null);
  }, [selectCanvasNode]);

  const handleNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setHoveredNodeId(node.id);

      const connectionStart = connectionStartRef.current;
      if (!connectionStart) return;

      const hoverConnection = connectionFromStart(connectionStart, node.id);
      if (!hoverConnection || !isConnectionAllowed(hoverConnection, edges, nodes)) {
        clearConnectionHoverTarget();
        return;
      }

      updateConnectionHoverTarget({
        sourceId: hoverConnection.source,
        targetId: hoverConnection.target,
        hoveredNodeId: node.id
      });
    },
    [clearConnectionHoverTarget, edges, nodes, updateConnectionHoverTarget]
  );

  const handleNodeMouseLeave = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setHoveredNodeId(null);
      if (connectionHoverTargetRef.current?.hoveredNodeId === node.id) {
        clearConnectionHoverTarget();
      }
    },
    [clearConnectionHoverTarget]
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      if (!project || !isCanvasView || assistantProviderPreferenceOpen || accessibilityPermissionOpen || settingsOpen || searchOpen) return;

      const files = event.clipboardData.files;
      if (files.length > 0) {
        event.preventDefault();
        beginHistoryTransaction();
        const target = ensureTargetNode();
        if (!target) {
          cancelHistoryTransaction();
          return;
        }

        try {
          await addFilesToNode(target.id, files, "paste");
          commitHistoryTransaction();
        } catch (error) {
          cancelHistoryTransaction();
          setStatus(error instanceof Error ? error.message : t("status.addAttachmentFailed"));
        }
        return;
      }

      const text = event.clipboardData.getData("text/plain");
      const savedImage = await window.scatter.saveClipboardImage(project.path);
      if (savedImage) {
        event.preventDefault();
        beginHistoryTransaction();
        const target = ensureTargetNode();
        if (!target) {
          cancelHistoryTransaction();
          return;
        }
        appendAttachments(target.id, [savedImage]);
        commitHistoryTransaction();
        return;
      }

      const savedFiles = await window.scatter.saveClipboardFiles(project.path);
      if (savedFiles.length) {
        event.preventDefault();
        beginHistoryTransaction();
        const target = ensureTargetNode();
        if (!target) {
          cancelHistoryTransaction();
          return;
        }
        appendAttachments(target.id, savedFiles);
        commitHistoryTransaction();
        return;
      }

      if (text && !isEditableTarget(event.target)) {
        event.preventDefault();
        beginHistoryTransaction();
        const target = ensureTargetNode();
        if (!target) {
          cancelHistoryTransaction();
          return;
        }
        updateNodeData(target.id, {
          body: `${target.data.body ? `${target.data.body}\n` : ""}${text}`
        });
        commitHistoryTransaction();
      }
    },
    [
      addFilesToNode,
      appendAttachments,
      accessibilityPermissionOpen,
      assistantProviderPreferenceOpen,
      beginHistoryTransaction,
      cancelHistoryTransaction,
      commitHistoryTransaction,
      ensureTargetNode,
      isCanvasView,
      project,
      searchOpen,
      settingsOpen,
      setStatus,
      t,
      updateNodeData
    ]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      if (
        !project ||
        !isCanvasView ||
        assistantProviderPreferenceOpen ||
        accessibilityPermissionOpen ||
        settingsOpen ||
        searchOpen ||
        event.dataTransfer.files.length === 0
      ) {
        return;
      }
      event.preventDefault();
      beginHistoryTransaction();
      const target = ensureTargetNode();
      if (!target) {
        cancelHistoryTransaction();
        return;
      }

      try {
        await addFilesToNode(target.id, event.dataTransfer.files, "drop");
        commitHistoryTransaction();
      } catch (error) {
        cancelHistoryTransaction();
        setStatus(error instanceof Error ? error.message : t("status.addAttachmentFailed"));
      }
    },
    [accessibilityPermissionOpen, addFilesToNode, assistantProviderPreferenceOpen, beginHistoryTransaction, cancelHistoryTransaction, commitHistoryTransaction, ensureTargetNode, isCanvasView, project, searchOpen, settingsOpen, setStatus, t]
  );

  const runActiveNode = useCallback(() => {
    if (!isCanvasView) return;
    if (!selectedNode) return;
    if (selectedNode.data.nodeKind === "depth-conversion") {
      void runDepthConversion(selectedNode.id);
      return;
    }
    if (selectedNode.data.nodeKind === "pixverse-generation") {
      void runPixverseGeneration(selectedNode.id);
      return;
    }
    if (selectedNode.data.nodeKind === "generic-prompt") {
      void runPromptNode(selectedNode.id);
      return;
    }
    if (selectedNode.data.nodeKind === "replication-analysis" || selectedNode.data.nodeKind === "replication-comparison") {
      void runReplicationNode(selectedNode.id);
      return;
    }
    if (selectedNode.data.nodeKind === "seedance-generation") {
      setStatus(t("workflow.seedanceIntegrationPending"));
      return;
    }
    setTaskRunModeOverride({ nodeId: selectedNode.id, mode: "flow" });
    void runNode(selectedNode.id, "flow");
  }, [isCanvasView, runDepthConversion, runNode, runPixverseGeneration, runPromptNode, runReplicationNode, selectedNode, setStatus, t]);

  const fitCanvas = useCallback(() => {
    if (!isCanvasView) return;
    flowInstanceRef.current?.fitView({ padding: 0.24 });
  }, [isCanvasView]);

  const handleMove = useCallback<OnMove>((_event, viewport) => {
    setViewportZoom(viewport.zoom);
    setCanvasViewport(viewport);
    if (isReplicationDemo && replicationDemoProjectPath) replicationDemoViewportsRef.current.set(replicationDemoProjectPath, viewport);
  }, [isReplicationDemo, replicationDemoProjectPath]);

  const toggleTasksDrawer = useCallback(() => {
    if (!project || !isCanvasView) return;
    setDrawer(drawer === "tasks" ? null : "tasks");
  }, [drawer, isCanvasView, project, setDrawer]);

  const toggleMarkdownDrawer = useCallback(() => {
    if (!project || !isCanvasView || !selectedNode) return;
    setDrawer(drawer === "markdown" ? null : "markdown");
  }, [drawer, isCanvasView, project, selectedNode, setDrawer]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (assistantProviderPreferenceOpen || accessibilityPermissionOpen || settingsOpen || searchOpen || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;

      if (hasPrimaryModifier && !event.altKey) {
        if (!event.shiftKey && key === "f") {
          event.preventDefault();
          setSearchOpen(true);
          return;
        }

        if (event.shiftKey && key === "n") {
          event.preventDefault();
          createProject();
          return;
        }

        if (!event.shiftKey && event.key === ",") {
          event.preventDefault();
          openSettingsDialog();
          return;
        }

        if (!event.shiftKey && key === "b") {
          event.preventDefault();
          setSidebarCollapsed((collapsed) => !collapsed);
          return;
        }

        if (!isCanvasView) return;

        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }

        if (project && key === "g") {
          event.preventDefault();
          if (event.shiftKey) {
            ungroupSelection();
          } else {
            groupSelection();
          }
          return;
        }

        if (project && !event.shiftKey && event.key === "Enter") {
          event.preventDefault();
          runActiveNode();
          return;
        }

        if (project && !event.shiftKey && key === "n") {
          event.preventDefault();
          addNode();
          return;
        }

        if (project && !event.shiftKey && key === "0") {
          event.preventDefault();
          fitCanvas();
          return;
        }

        if (project && event.shiftKey && key === "t") {
          event.preventDefault();
          toggleTasksDrawer();
          return;
        }

        if (project && event.shiftKey && key === "m") {
          event.preventDefault();
          toggleMarkdownDrawer();
          return;
        }
      }

      if (!isCanvasView) return;

      // Figma real shortcut for toggling Auto Layout: Shift+A.
      if (project && event.shiftKey && !hasPrimaryModifier && !event.altKey && key === "a") {
        event.preventDefault();
        toggleAutoLayout();
        return;
      }

      if (project && event.shiftKey && !hasPrimaryModifier && !event.altKey && key === "s") {
        event.preventDefault();
        setSelectedGroupId(null);
        setCanvasTool("section");
        return;
      }

      if (event.key === "Escape" && canvasTool === "section") {
        event.preventDefault();
        setCanvasTool("select");
        setSectionDraft(null);
        return;
      }

      if (project && !hasPrimaryModifier && !event.altKey && !event.shiftKey) {
        if (key === "v") {
          event.preventDefault();
          setCanvasTool("select");
          return;
        }

        if (key === "h") {
          event.preventDefault();
          setCanvasTool("pan");
          return;
        }
      }

      if (event.key !== "Backspace" && event.key !== "Delete") return;

      if (selectedEdgeIds.length) {
        event.preventDefault();
        deleteSelectedEdges();
        return;
      }

      const hasSelectedNodes = nodes.some((node) => node.selected);
      if (!hasSelectedNodes && !selectedNodeId && !selectedGroupId) return;

      event.preventDefault();
      if (selectedGroupId && !hasSelectedNodes && !selectedNodeId) {
        ungroupSelection();
        return;
      }
      // Figma semantics: Delete removes the whole multi-selection, and any
      // emptied groups are dropped in the SAME commit.
      if (hasSelectedNodes) {
        deleteSelectedNodes();
      } else if (selectedNodeId) {
        deleteNode(selectedNodeId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    accessibilityPermissionOpen,
    addNode,
    assistantProviderPreferenceOpen,
    canvasTool,
    createProject,
    deleteNode,
    deleteSelectedEdges,
    deleteSelectedNodes,
    fitCanvas,
    groupSelection,
    isCanvasView,
    nodes,
    openSettingsDialog,
    project,
    redo,
    runActiveNode,
    searchOpen,
    selectedEdgeIds,
    selectedNodeId,
    selectedGroupId,
    settingsOpen,
    toggleAutoLayout,
    toggleMarkdownDrawer,
    toggleTasksDrawer,
    undo,
    ungroupSelection
  ]);

  const focusCanvasNode = useCallback(
    (nodeId: string, mode: RunMode) => {
      setTaskRunModeOverride({ nodeId, mode });
      setSelectedNodeId(nodeId);
      replaceCanvasLive({ nodes: nodes.map((node) => ({ ...node, selected: node.id === nodeId })) });

      const target = nodes.find((node) => node.id === nodeId);
      if (!target) return;
      const bounds = nodeBounds(target);
      void flowInstanceRef.current?.setCenter(target.position.x + bounds.width / 2, target.position.y + bounds.height / 2, {
        duration: 240,
        zoom: viewportZoom
      });
    },
    [nodes, replaceCanvasLive, setSelectedNodeId, viewportZoom]
  );

  const startMarkdownResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drawer !== "markdown") return;
    const container = workspaceContentRef.current;
    if (!container) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingMarkdownPanel(true);

    const updateRatio = (clientX: number): void => {
      const rect = container.getBoundingClientRect();
      const totalWidth = rect.width - 12;
      if (totalWidth <= MARKDOWN_PANEL_MIN_WIDTH * 2) return;
      const markdownWidth = rect.right - clientX;
      const minRatio = MARKDOWN_PANEL_MIN_WIDTH / totalWidth;
      const maxRatio = 1 - minRatio;
      const nextRatio = Math.min(maxRatio, Math.max(minRatio, markdownWidth / totalWidth));
      setMarkdownPanelRatio(nextRatio);
    };

    updateRatio(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      updateRatio(moveEvent.clientX);
    };
    const stopResize = (): void => {
      setIsResizingMarkdownPanel(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [drawer]);

  if (isSplashWindow) {
    return (
      <I18nProvider language={language}>
        <main className="startup-shell" data-theme={theme}>
          <section className="startup-panel" aria-label={t("startup.loading")}>
            <div className="startup-copy">
              <div className="startup-title-group">
                <h1>Scatter</h1>
                <p>{t("startup.tagline")}</p>
              </div>
              <p className="startup-status">{t("startup.version", { version: appVersion })}</p>
            </div>
            <div className="startup-visual" aria-hidden="true">
              <div className="startup-image-frame">
                <img src={startupBulbImage} alt="" />
              </div>
            </div>
          </section>
        </main>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={language}>
      <main
        className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onMouseMove={(event) => {
          latestMouseRef.current = { x: event.clientX, y: event.clientY };
        }}
      >
      <Sidebar
        recentProjects={recentProjects}
        activePath={isCanvasView ? project?.path : undefined}
        achievementsActive={isAchievementsView}
        collapsed={sidebarCollapsed}
        onCreateProject={createProject}
        onCreateReplicationDemo={() => void createReplicationDemo()}
        onOpenAchievements={openAchievements}
        onOpenRecent={(projectPath) => void openRecentProject(projectPath)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={openSettingsDialog}
        onRemoveRecent={(projectPath) => void removeRecentProject(projectPath)}
        onReorderRecent={(projectPaths) => void reorderRecentProjects(projectPaths)}
      />
      <section className="workspace">
        <Topbar
          activeDrawer={isCanvasView ? drawer : null}
          canOpenMarkdown={isCanvasView && Boolean(selectedNode)}
          canRun={isCanvasView && Boolean(selectedNode) && !previewOnly}
          sidebarCollapsed={sidebarCollapsed}
          updateState={updateState}
          disabled={!project || !isCanvasView}
          onCreateProject={createProject}
          onUpdate={() => void runTopbarUpdateAction()}
          onRunActive={runActiveNode}
          onOpenTasks={toggleTasksDrawer}
          onOpenMarkdown={toggleMarkdownDrawer}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        />
        <div
          className={`workspace-content ${isCanvasView && drawer ? "has-right-sidebar" : ""} ${isCanvasView && drawer === "markdown" ? "has-markdown-sidebar" : ""} ${isCanvasView && isResizingMarkdownPanel ? "is-resizing-markdown" : ""}`}
          ref={workspaceContentRef}
          style={
            isCanvasView && drawer === "markdown"
              ? ({
                  "--markdown-panel-ratio": markdownPanelRatio,
                  "--canvas-panel-ratio": 1 - markdownPanelRatio
                } as CSSProperties)
              : undefined
          }
        >
          {isAchievementsView ? (
            <AchievementsWall achievementState={achievementState} />
          ) : project ? (
            <>
              <div
                className={`canvas-shell ${canvasRevealActive ? "is-revealing" : ""} ${isConnecting ? "is-connecting" : ""} ${connectionPreview ? "has-connection-preview" : ""}`}
                ref={canvasShellRef}
                onAnimationEnd={(event) => {
                  if (event.animationName === "canvas-project-reveal") setCanvasRevealActive(false);
                }}
              >
                {previewOnly ? (
                  <div className="canvas-preview-only-banner" role="status">
                    <strong>{t("canvas.previewOnlyTitle")}</strong>
                    <span>{t("canvas.previewOnlyDescription")}</span>
                  </div>
                ) : null}
                {/* Floating alignment bar: only while >=2 nodes are selected.
                    Fixed screen-space, NOT scaled by canvas zoom. Pointer events
                    are stopped so clicking buttons never starts box-select/pan. */}
                {selectedCanvasNodes.length >= 2 && (
                  <div className="canvas-align-bar" onPointerDown={(e) => e.stopPropagation()}>
                    <TooltipAnchor label={t("canvas.alignLeft")} side="bottom">
                      <ToolbarItem icon="align-left" aria-label={t("canvas.alignLeft")} onClick={() => alignSelection("left")} />
                    </TooltipAnchor>
                    <TooltipAnchor label={t("canvas.alignCenterX")} side="bottom">
                      <ToolbarItem icon="align-center-x" aria-label={t("canvas.alignCenterX")} onClick={() => alignSelection("centerX")} />
                    </TooltipAnchor>
                    <TooltipAnchor label={t("canvas.alignRight")} side="bottom">
                      <ToolbarItem icon="align-right" aria-label={t("canvas.alignRight")} onClick={() => alignSelection("right")} />
                    </TooltipAnchor>
                    <span className="canvas-align-bar-divider" />
                    <TooltipAnchor label={t("canvas.alignTop")} side="bottom">
                      <ToolbarItem icon="align-top" aria-label={t("canvas.alignTop")} onClick={() => alignSelection("top")} />
                    </TooltipAnchor>
                    <TooltipAnchor label={t("canvas.alignCenterY")} side="bottom">
                      <ToolbarItem icon="align-center-y" aria-label={t("canvas.alignCenterY")} onClick={() => alignSelection("centerY")} />
                    </TooltipAnchor>
                    <TooltipAnchor label={t("canvas.alignBottom")} side="bottom">
                      <ToolbarItem icon="align-bottom" aria-label={t("canvas.alignBottom")} onClick={() => alignSelection("bottom")} />
                    </TooltipAnchor>
                    <span className="canvas-align-bar-divider" />
                    <TooltipAnchor label={t("canvas.quickTidyUp")} side="bottom">
                      <ToolbarItem
                        icon="tidy-up"
                        aria-label={t("canvas.quickTidyUp")}
                        disabled={selectedCanvasNodes.length < 2 || selectionHasLayoutGroupNode}
                        onClick={tidySelection}
                      />
                    </TooltipAnchor>
                    <RadixDropdownMenu.Root>
                      <TooltipAnchor label={t("canvas.moreActions")} side="bottom">
                        <RadixDropdownMenu.Trigger asChild>
                          <ToolbarItem icon={recommendIcon} aria-label={arrangementMenuLabel} />
                        </RadixDropdownMenu.Trigger>
                      </TooltipAnchor>
                      <RadixDropdownMenu.Portal>
                        <RadixDropdownMenu.Content
                          className="dropdown-content workflow-node-menu"
                          sideOffset={10}
                          align="end"
                        >
                          <RadixDropdownMenu.Item
                            className="workflow-node-menu-item canvas-layout-menu-item"
                            disabled={selectedCanvasNodes.length < 2}
                            onSelect={tidySelection}
                          >
                            <Icon name="tidy-up-menu" size={20} />
                            {t("canvas.tidyUp")}
                          </RadixDropdownMenu.Item>
                          <RadixDropdownMenu.Item
                            className="workflow-node-menu-item canvas-layout-menu-item"
                            disabled={selectedCanvasNodes.length < 3 || selectionHasLayoutGroupNode}
                            onSelect={() => distributeSelection("vertical")}
                          >
                            <Icon name="distribute-vertical-menu" size={20} />
                            {t("canvas.distributeVertical")}
                          </RadixDropdownMenu.Item>
                          <RadixDropdownMenu.Item
                            className="workflow-node-menu-item canvas-layout-menu-item"
                            disabled={selectedCanvasNodes.length < 3 || selectionHasLayoutGroupNode}
                            onSelect={() => distributeSelection("horizontal")}
                          >
                            <Icon name="distribute-horizontal-menu" size={20} />
                            {t("canvas.distributeHorizontal")}
                          </RadixDropdownMenu.Item>
                        </RadixDropdownMenu.Content>
                      </RadixDropdownMenu.Portal>
                    </RadixDropdownMenu.Root>
                  </div>
                )}
                {activeLayoutGroup?.layout && (
                  <div
                    className="canvas-layout-controls-panel"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <CanvasGroupLayoutControls
                      layout={activeLayoutGroup.layout}
                      onChange={updateActiveGroupLayout}
                    />
                  </div>
                )}
                <div
                  className="canvas-section-layer"
                  style={{
                    transform: `translate(${canvasViewport.x}px, ${canvasViewport.y}px) scale(${canvasViewport.zoom})`
                  }}
                >
                  {renderedGroups.map((group) => {
                    const inverseZoom = 1 / Math.max(canvasViewport.zoom, 0.01);
                    const memberIds = collectGroupMemberIds(group.id, groups);
                    const isSelected = selectedGroupId === group.id || (selectedGroupId === null
                      && memberIds.length > 0
                      && memberIds.every((id) => selectedCanvasNodes.some((node) => node.id === id)));
                    return (
                      <div
                        key={group.id}
                        className={`canvas-section-frame ${group.layout ? "has-autolayout" : ""} ${isSelected ? "is-selected" : ""}`}
                        style={{
                          left: group.x,
                          top: group.y,
                          width: group.width,
                          height: group.height,
                          borderWidth: (isSelected ? 1.5 : 1) * inverseZoom,
                          borderRadius: 16 * inverseZoom
                        }}
                        role="group"
                        aria-label={group.name}
                      >
                        <span
                          className="canvas-section-label"
                          style={{
                            top: -28 * inverseZoom,
                            left: 0,
                            transform: `scale(${inverseZoom})`,
                            transformOrigin: "top left"
                          }}
                          onPointerDown={(event) => onGroupFramePointerDown(group.id, event)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            setRenamingGroupId(group.id);
                            setRenamingGroupName(group.name);
                          }}
                        >
                          {renamingGroupId === group.id ? (
                            <input
                              className="canvas-section-name-input"
                              aria-label={t("canvas.renameSection")}
                              autoFocus
                              value={renamingGroupName}
                              style={{ width: `${Math.max(100, renamingGroupName.length * 9) * inverseZoom}px` }}
                              onPointerDown={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onChange={(event) => setRenamingGroupName(event.target.value)}
                              onBlur={(event) => commitGroupRename(group.id, event.currentTarget.value)}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") event.currentTarget.blur();
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.currentTarget.value = group.name;
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          ) : group.name}
                        </span>
                        {isSelected && (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as GroupResizeHandle[]).map((handle) => (
                          <span
                            key={handle}
                            className={`canvas-section-resize-handle is-${handle}`}
                            style={{ width: 8 * inverseZoom, height: 8 * inverseZoom, borderWidth: inverseZoom, borderRadius: 2 * inverseZoom }}
                            aria-hidden="true"
                            onPointerDown={(event) => onGroupResizePointerDown(group.id, handle, event)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  connectionLineComponent={ScatterConnectionLine}
                  onNodesChange={onNodesChange as any}
                  onEdgesChange={onEdgesChange as any}
                  onConnect={onConnect}
                  onNodeClick={handleNodeClick}
                  onPaneClick={handlePaneClick}
                  onSelectionEnd={handleSelectionEnd}
                  selectionKeyCode={null}
                  selectionOnDrag={!panModeActive}
                  selectionMode={SelectionMode.Partial}
                  multiSelectionKeyCode="Shift"
                  panOnDrag={panModeActive ? true : [1]}
                  panActivationKeyCode={null}
                  panOnScroll
                  panOnScrollMode={PanOnScrollMode.Free}
                  zoomOnScroll={false}
                  zoomOnPinch
                  zoomOnDoubleClick={false}
                  zoomActivationKeyCode="Meta"
                  nodesDraggable={!panModeActive && !shiftSelectionActive}
                  disableKeyboardA11y
                  onConnectStart={handleConnectStart}
                  onConnectEnd={handleConnectEnd}
                  onNodeMouseEnter={handleNodeMouseEnter}
                  onNodeMouseLeave={handleNodeMouseLeave}
                  onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
                  onEdgeMouseLeave={(_event, edge) => setHoveredEdgeId((current) => current === edge.id ? null : current)}
                  onEdgeDoubleClick={handleEdgeDoubleClick}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragStop={handleNodeDragStop}
                  connectOnClick={false}
                  isValidConnection={isValidConnection}
                  onInit={(instance) => {
                    flowInstanceRef.current = instance;
                    if (isReplicationDemo) {
                      focusReplicationDemo(instance);
                    } else {
                      setCanvasViewport(instance.getViewport());
                    }
                  }}
                  onMove={handleMove}
                  fitView={!isReplicationDemo}
                  deleteKeyCode={null}
                  minZoom={0.2}
                  maxZoom={2}
                  proOptions={proOptions}
                  defaultEdgeOptions={defaultEdgeOptions}
                >
                  <Background gap={200} size={0} color="transparent" />
                </ReactFlow>
                {canvasTool === "section" && !spacePanActive && (
                  <div className="canvas-section-draw-overlay" onPointerDown={onSectionDrawPointerDown} aria-label={t("canvas.sectionToolHelp")}>
                    {sectionDraft && (
                      <div
                        className="canvas-section-draft-layer"
                        style={{ transform: `translate(${canvasViewport.x}px, ${canvasViewport.y}px) scale(${canvasViewport.zoom})` }}
                      >
                        <div
                          className="canvas-section-draft"
                          style={{
                            left: sectionDraft.x,
                            top: sectionDraft.y,
                            width: sectionDraft.width,
                            height: sectionDraft.height,
                            borderWidth: 1 / Math.max(canvasViewport.zoom, 0.01),
                            borderRadius: 16 / Math.max(canvasViewport.zoom, 0.01)
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="canvas-actions" aria-label={t("canvas.actions")}>
                  <TooltipAnchor label={t("canvas.fit")} shortcut={shortcuts.fitCanvas} side="right">
                    <IconButton className="canvas-tool-button" filled={false} icon="map-pin" size="lg" aria-label={t("canvas.fit")} onClick={fitCanvas} />
                  </TooltipAnchor>
                  <TooltipAnchor label={t("canvas.undo")} shortcut={shortcuts.undo} side="right">
                    <IconButton className="canvas-tool-button" filled={false} icon="undo" size="lg" aria-label={t("canvas.undo")} disabled={!canUndo} onClick={undo} />
                  </TooltipAnchor>
                  <TooltipAnchor label={t("canvas.redo")} shortcut={shortcuts.redo} side="right">
                    <IconButton className="canvas-tool-button" filled={false} icon="redo" size="lg" aria-label={t("canvas.redo")} disabled={!canRedo} onClick={redo} />
                  </TooltipAnchor>
                </div>
                <div className="canvas-toolbar" aria-label={t("canvas.tools")}>
                  <RadixDropdownMenu.Root>
                    <TooltipAnchor label="添加工作流节点" shortcut={shortcuts.addNode}>
                      <RadixDropdownMenu.Trigger asChild>
                        <IconButton className="canvas-toolbar-button" filled={false} icon="plus-lg" size="lg" aria-label="添加工作流节点" />
                      </RadixDropdownMenu.Trigger>
                    </TooltipAnchor>
                    <RadixDropdownMenu.Portal>
                      <RadixDropdownMenu.Content className="dropdown-content workflow-node-menu" sideOffset={10} align="start">
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addReplicationAnalysis("photo")}>{t("workflow.replicationAnalysisPhoto")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addReplicationAnalysis("video")}>{t("workflow.replicationAnalysisVideo")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addReplicationScope("photo")}>{t("workflow.replicationPhotoScope")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addReplicationScope("video")}>{t("workflow.replicationVideoScope")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addReplicationScope("role")}>{t("workflow.replicationRoleScope")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addReplicationScope("segment")}>{t("workflow.replicationSegmentScope")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" onSelect={() => addNode("replication-comparison")}>{t("workflow.replicationComparisonNode")}</RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Separator className="dropdown-separator" />
                        {([
                          ["task", "任务节点"],
                          ["generic-prompt", t("workflow.genericPromptNode")],
                          ["seedance-generation", t("workflow.seedanceGenerationNode")],
                          ["image-reference", t("workflow.imageNode")],
                          ["video-reference", t("workflow.videoNode")],
                          ["role-binding", t("workflow.roleBindingNode")],
                          ["reference-binding", t("workflow.referenceBindingNode")],
                          ["depth-conversion", t("workflow.depthNode")],
                          ["pixverse-generation", t("workflow.pixverseGenerationNode")]
                        ] as Array<[WorkflowNodeKind, string]>).map(([kind, label]) => (
                          <RadixDropdownMenu.Item key={kind} className="workflow-node-menu-item" onSelect={() => addNode(kind)}>{label}</RadixDropdownMenu.Item>
                        ))}
                      </RadixDropdownMenu.Content>
                    </RadixDropdownMenu.Portal>
                  </RadixDropdownMenu.Root>
                  <RadixDropdownMenu.Root>
                    <TooltipAnchor label={t("canvas.arrange")} shortcut={shortcuts.group}>
                      <RadixDropdownMenu.Trigger asChild>
                        <IconButton className="canvas-toolbar-button" filled={false} icon="stack" size="lg" aria-label={t("canvas.arrange")} />
                      </RadixDropdownMenu.Trigger>
                    </TooltipAnchor>
                    <RadixDropdownMenu.Portal>
                      <RadixDropdownMenu.Content className="dropdown-content workflow-node-menu" sideOffset={10} align="start">
                        <RadixDropdownMenu.Item
                          className="workflow-node-menu-item"
                          disabled={selectedCanvasNodes.length < 1}
                          onSelect={groupSelection}
                        >
                          {t("canvas.group")} · {shortcuts.group}
                        </RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item
                          className="workflow-node-menu-item"
                          onSelect={() => setCanvasTool("section")}
                        >
                          {t("canvas.sectionTool")} · {shortcuts.sectionTool}
                        </RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item
                          className="workflow-node-menu-item"
                          disabled={!selectedGroupId && selectedCanvasNodes.length < 1}
                          onSelect={ungroupSelection}
                        >
                          {t("canvas.ungroup")} · {shortcuts.ungroup}
                        </RadixDropdownMenu.Item>
                        <div className="workflow-node-menu-separator" />
                        <RadixDropdownMenu.Item
                          className="workflow-node-menu-item"
                          disabled={selectedCanvasNodes.length < 3 || selectionHasLayoutGroupNode}
                          onSelect={() => distributeSelection("horizontal")}
                        >
                          {selectionHasLayoutGroupNode ? "选区含自动布局节点，请调整组间距" : t("canvas.distributeHorizontal")}
                        </RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item
                          className="workflow-node-menu-item"
                          disabled={selectedCanvasNodes.length < 3 || selectionHasLayoutGroupNode}
                          onSelect={() => distributeSelection("vertical")}
                        >
                          {selectionHasLayoutGroupNode ? "选区含自动布局节点，请调整组间距" : t("canvas.distributeVertical")}
                        </RadixDropdownMenu.Item>
                        <div className="workflow-node-menu-separator" />
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" disabled={selectedCanvasNodes.length < 2} onSelect={tidySelection}>
                          {t("canvas.tidyUp")}
                        </RadixDropdownMenu.Item>
                        <RadixDropdownMenu.Item className="workflow-node-menu-item" disabled={selectedCanvasNodes.length < 1} onSelect={toggleAutoLayout}>
                          {t("canvas.autoLayout")} · {shortcuts.autoLayout}
                        </RadixDropdownMenu.Item>
                      </RadixDropdownMenu.Content>
                    </RadixDropdownMenu.Portal>
                  </RadixDropdownMenu.Root>
                  <span className="canvas-toolbar-divider" />
                  <TooltipAnchor label={t("canvas.selectTool")} shortcut={shortcuts.selectTool}>
                    <IconButton
                      className={`canvas-toolbar-button ${canvasTool === "select" && !spacePanActive ? "is-selected" : ""}`}
                      filled={false}
                      icon="work-with-apps"
                      size="lg"
                      aria-label={t("canvas.selectTool")}
                      aria-pressed={canvasTool === "select" && !spacePanActive}
                      onClick={() => setCanvasTool("select")}
                    />
                  </TooltipAnchor>
                  <TooltipAnchor label={t("canvas.panTool")} shortcut={shortcuts.panTool}>
                    <IconButton
                      className={`canvas-toolbar-button ${panModeActive ? "is-selected" : ""}`}
                      filled={false}
                      icon="hand-raised"
                      size="lg"
                      aria-label={t("canvas.panTool")}
                      aria-pressed={panModeActive}
                      onClick={() => setCanvasTool("pan")}
                    />
                  </TooltipAnchor>
                  <TooltipAnchor label={t("canvas.sectionTool")} shortcut={shortcuts.sectionTool}>
                    <IconButton
                      className={`canvas-toolbar-button ${canvasTool === "section" ? "is-selected" : ""}`}
                      filled={false}
                      icon="group"
                      size="lg"
                      aria-label={t("canvas.sectionTool")}
                      aria-pressed={canvasTool === "section"}
                      onClick={() => setCanvasTool("section")}
                    />
                  </TooltipAnchor>
                  <span className="canvas-toolbar-divider" />
                  <TooltipAnchor label={t("canvas.zoom")}>
                    <RadixDropdownMenu.Root>
                      <RadixDropdownMenu.Trigger asChild>
                        <button className="canvas-zoom-trigger" type="button" aria-label={t("canvas.zoom")}>
                          <span>{zoomPercent}%</span>
                          <Icon name="chevron-down" size={16} />
                        </button>
                      </RadixDropdownMenu.Trigger>
                      <RadixDropdownMenu.Portal>
                        <RadixDropdownMenu.Content className="canvas-zoom-popover" side="top" sideOffset={8} align="end">
                          <DropdownMenu className="canvas-zoom-menu" role="menu">
                            {zoomOptions.map((option) => (
                              <RadixDropdownMenu.Item key={option.value} asChild>
                                <DropdownMenuItem
                                  label={option.label}
                                  selected={Math.abs(viewportZoom - option.value) < 0.01}
                                  role="menuitemradio"
                                  aria-checked={Math.abs(viewportZoom - option.value) < 0.01}
                                  onClick={() => {
                                    setViewportZoom(option.value);
                                    void flowInstanceRef.current?.zoomTo(option.value);
                                  }}
                                />
                              </RadixDropdownMenu.Item>
                            ))}
                          </DropdownMenu>
                        </RadixDropdownMenu.Content>
                      </RadixDropdownMenu.Portal>
                    </RadixDropdownMenu.Root>
                  </TooltipAnchor>
                </div>
              </div>
              <button
                className={`workspace-resize-handle ${drawer === "markdown" ? "is-active" : ""}`}
                type="button"
                aria-hidden={drawer !== "markdown"}
                aria-label={t("canvas.resizeMarkdown")}
                disabled={drawer !== "markdown"}
                tabIndex={drawer === "markdown" ? 0 : -1}
                onPointerDown={startMarkdownResize}
              />
              <RightDrawer
                drawer={drawer}
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                markdown={markdownResult.markdown}
                currentRunMode={selectedRunMode}
                onSelectNode={focusCanvasNode}
                onRunNode={runNode}
              />
            </>
          ) : (
            <div className="empty-workspace" aria-label={t("canvas.emptyWorkspace")}>
              <Icon name="folder-stuffed" size={32} />
              <p>{t("canvas.emptyWorkspace")}</p>
            </div>
          )}
        </div>
      </section>
      <SettingsDialog
        open={settingsOpen}
        themePreference={themePreference}
        language={language}
        translucentBackground={translucentBackground}
        assistantProvider={assistantProvider}
        assistantProviderOnboardingCompleted={assistantProviderOnboardingCompleted}
        pixverseImageDefaultModel={pixverseImageDefaultModel}
        showTranslucentBackground={!isWindows}
        onOpenChange={handleSettingsOpenChange}
        onPreview={previewSettingsValues}
        onSave={handleSaveSettings}
      />
      <AssistantProviderPreferenceDialog
        assistantProvider={assistantProvider}
        open={assistantProviderPreferenceOpen}
        onDismiss={dismissAssistantProviderPreference}
        onSave={saveAssistantProviderPreference}
      />
      <AccessibilityPermissionDialog
        open={supportsMacAutomation && accessibilityPermissionOpen && accessibilityTrusted !== true}
        onDismiss={dismissAccessibilityPermission}
        onOpenGuide={openAccessibilityGuide}
      />
      <SearchDialog
        open={searchOpen}
        projects={recentProjects}
        onOpenChange={setSearchOpen}
        onOpenProject={(projectPath) => void openRecentProject(projectPath)}
      />
      {achievementToastQueue[0] ? (
        <AchievementToast achievement={achievementToastQueue[0]} onClose={closeAchievementToast} onView={viewAchievementToast} />
      ) : null}
      </main>
    </I18nProvider>
  );
}

export default App;
