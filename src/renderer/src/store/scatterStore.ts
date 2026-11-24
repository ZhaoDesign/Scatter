import { create } from "zustand";
import { defaultAppSettings } from "../../../shared/types";
import type {
  Attachment,
  CanvasGroup,
  RunMode,
  ScatterDocument,
  ScatterEdge,
  ScatterNode,
  ScatterProjectInfo
} from "../../../shared/types";

const MAX_HISTORY_LENGTH = 100;

interface CanvasSnapshot {
  nodes: ScatterNode[];
  edges: ScatterEdge[];
  groups: CanvasGroup[];
}

interface CanvasHistory {
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
  transactionStart: CanvasSnapshot | null;
}

interface CanvasChange {
  nodes?: ScatterNode[];
  edges?: ScatterEdge[];
  groups?: CanvasGroup[];
}

interface ScatterState {
  project: ScatterProjectInfo | null;
  document: ScatterDocument | null;
  nodes: ScatterNode[];
  edges: ScatterEdge[];
  groups: CanvasGroup[];
  selectedNodeId: string | null;
  drawer: "tasks" | "markdown" | null;
  theme: "light" | "dark";
  status: string;
  pixverseImageDefaultModel: string;
  pixverseImageDefaultModelReady: boolean;
  pixverseImageCliDefaultModel: string | null;
  runningNodeId: string | null;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  history: CanvasHistory;
  setProjectDocument: (project: ScatterProjectInfo, document: ScatterDocument) => void;
  clearProject: () => void;
  setNodes: (nodes: ScatterNode[]) => void;
  setEdges: (edges: ScatterEdge[]) => void;
  replaceCanvasLive: (change: CanvasChange) => void;
  commitCanvasChange: (change: CanvasChange) => void;
  beginHistoryTransaction: () => void;
  commitHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
  undo: () => void;
  redo: () => void;
  updateNodeData: (nodeId: string, patch: Partial<ScatterNode["data"]>) => void;
  appendAttachments: (nodeId: string, attachments: Attachment[]) => void;
  removeAttachment: (nodeId: string, attachmentId: string) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setDrawer: (drawer: "tasks" | "markdown" | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  setStatus: (status: string) => void;
  setPixverseImageDefaultModel: (model: string) => void;
  setPixverseImageCliDefaultModel: (model: string) => void;
  setRunningNodeId: (nodeId: string | null) => void;
  setSaving: (isSaving: boolean) => void;
  markNodeRun: (nodeId: string, runMode: RunMode) => void;
}

function cloneEdgeForHistory(edge: ScatterEdge): ScatterEdge {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    label: edge.label
  };
}

function cloneNodeForHistory(node: ScatterNode): ScatterNode {
  const { selected: _selected, data, ...nodeRest } = node;
  const { lastRunAt: _lastRunAt, attachments, ...dataRest } = data;

  return {
    ...nodeRest,
    type: "task",
    position: { ...node.position },
    data: {
      ...dataRest,
      attachments: attachments.map((attachment) => ({ ...attachment }))
    }
  } as ScatterNode;
}

function createSnapshot(nodes: ScatterNode[], edges: ScatterEdge[], groups: CanvasGroup[]): CanvasSnapshot {
  return {
    nodes: nodes.map(cloneNodeForHistory),
    edges: edges.map(cloneEdgeForHistory),
    groups: groups.map(cloneGroupForHistory)
  };
}

function cloneGroupForHistory(group: CanvasGroup): CanvasGroup {
  const cloned: CanvasGroup = {
    id: group.id,
    name: group.name,
    nodeIds: [...group.nodeIds],
    childGroupIds: [...group.childGroupIds]
  };
  if (group.bounds) cloned.bounds = { ...group.bounds };
  if (group.parentGroupId) cloned.parentGroupId = group.parentGroupId;
  if (group.layout) {
    cloned.layout = { ...group.layout, padding: { ...group.layout.padding }, childOrder: [...group.layout.childOrder] };
  }
  return cloned;
}

function snapshotsEqual(left: CanvasSnapshot, right: CanvasSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushHistory(past: CanvasSnapshot[], snapshot: CanvasSnapshot): CanvasSnapshot[] {
  return [...past, snapshot].slice(-MAX_HISTORY_LENGTH);
}

function restoreSnapshotNodes(snapshot: CanvasSnapshot, currentNodes: ScatterNode[], selectedNodeId: string | null): ScatterNode[] {
  const lastRunAtByNodeId = new Map(
    currentNodes
      .filter((node) => Boolean(node.data.lastRunAt))
      .map((node) => [node.id, node.data.lastRunAt])
  );

  return snapshot.nodes.map((node) => {
    const restoredNode = cloneNodeForHistory(node);
    const lastRunAt = lastRunAtByNodeId.get(node.id);

    return {
      ...restoredNode,
      selected: selectedNodeId === node.id,
      data: {
        ...restoredNode.data,
        ...(lastRunAt ? { lastRunAt } : {})
      }
    };
  });
}

function historyFlags(history: CanvasHistory): Pick<ScatterState, "canUndo" | "canRedo"> {
  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0
  };
}

export const useScatterStore = create<ScatterState>((set, get) => {
  const setHistory = (history: CanvasHistory): void => {
    set({
      history,
      ...historyFlags(history)
    });
  };

  const applySnapshot = (snapshot: CanvasSnapshot): void => {
    const state = get();
    const selectedNodeId = state.selectedNodeId && snapshot.nodes.some((node) => node.id === state.selectedNodeId) ? state.selectedNodeId : null;

    set({
      nodes: restoreSnapshotNodes(snapshot, state.nodes, selectedNodeId),
      edges: snapshot.edges.map(cloneEdgeForHistory),
      groups: snapshot.groups.map(cloneGroupForHistory),
      selectedNodeId
    });
  };

  const closePendingTransaction = (): void => {
    const state = get();
    const transactionStart = state.history.transactionStart;
    if (!transactionStart) return;

    const currentSnapshot = createSnapshot(state.nodes, state.edges, state.groups);
    const history = snapshotsEqual(transactionStart, currentSnapshot)
      ? {
          ...state.history,
          transactionStart: null
        }
      : {
          past: pushHistory(state.history.past, transactionStart),
          future: [],
          transactionStart: null
        };

    setHistory(history);
  };

  return {
    project: null,
    document: null,
    nodes: [],
    edges: [],
    groups: [],
    selectedNodeId: null,
    drawer: null,
    theme: "light",
    status: "Ready",
    pixverseImageDefaultModel: defaultAppSettings.pixverseImageDefaultModel,
    pixverseImageDefaultModelReady: false,
    pixverseImageCliDefaultModel: null,
    runningNodeId: null,
    isSaving: false,
    canUndo: false,
    canRedo: false,
    history: {
      past: [],
      future: [],
      transactionStart: null
    },
    setProjectDocument: (project, document) =>
      set({
        project,
        document,
        nodes: document.nodes.map((node) => ({ ...node, selected: false })),
        edges: document.edges,
        groups: (document.groups ?? []).map(cloneGroupForHistory),
        selectedNodeId: null,
        runningNodeId: null,
        status: `Opened ${project.name}`,
        canUndo: false,
        canRedo: false,
        history: {
          past: [],
          future: [],
          transactionStart: null
        }
      }),
    clearProject: () =>
      set({
        project: null,
        document: null,
        nodes: [],
        edges: [],
        groups: [],
        selectedNodeId: null,
        drawer: null,
        runningNodeId: null,
        isSaving: false,
        canUndo: false,
        canRedo: false,
        history: {
          past: [],
          future: [],
          transactionStart: null
        }
      }),
    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),
    replaceCanvasLive: (change) => {
      const state = get();
      set({
        nodes: change.nodes ?? state.nodes,
        edges: change.edges ?? state.edges,
        groups: change.groups ?? state.groups
      });
    },
    commitCanvasChange: (change) => {
      const state = get();
      const nextNodes = change.nodes ?? state.nodes;
      const nextEdges = change.edges ?? state.edges;
      const nextGroups = change.groups ?? state.groups;

      if (state.history.transactionStart) {
        set({
          nodes: nextNodes,
          edges: nextEdges,
          groups: nextGroups
        });
        return;
      }

      const currentSnapshot = createSnapshot(state.nodes, state.edges, state.groups);
      const nextSnapshot = createSnapshot(nextNodes, nextEdges, nextGroups);

      if (snapshotsEqual(currentSnapshot, nextSnapshot)) {
        set({
          nodes: nextNodes,
          edges: nextEdges,
          groups: nextGroups
        });
        return;
      }

      const history = {
        past: pushHistory(state.history.past, currentSnapshot),
        future: [],
        transactionStart: null
      };

      set({
        nodes: nextNodes,
        edges: nextEdges,
        groups: nextGroups,
        history,
        ...historyFlags(history)
      });
    },
    beginHistoryTransaction: () => {
      const state = get();
      if (state.history.transactionStart) return;
      setHistory({
        ...state.history,
        transactionStart: createSnapshot(state.nodes, state.edges, state.groups)
      });
    },
    commitHistoryTransaction: closePendingTransaction,
    cancelHistoryTransaction: () => {
      const state = get();
      const transactionStart = state.history.transactionStart;
      if (!transactionStart) return;
      applySnapshot(transactionStart);
      setHistory({
        ...state.history,
        transactionStart: null
      });
    },
    undo: () => {
      closePendingTransaction();

      const state = get();
      const previousSnapshot = state.history.past[state.history.past.length - 1];
      if (!previousSnapshot) return;

      const currentSnapshot = createSnapshot(state.nodes, state.edges, state.groups);
      const history = {
        past: state.history.past.slice(0, -1),
        future: [currentSnapshot, ...state.history.future].slice(0, MAX_HISTORY_LENGTH),
        transactionStart: null
      };

      applySnapshot(previousSnapshot);
      setHistory(history);
    },
    redo: () => {
      closePendingTransaction();

      const state = get();
      const nextSnapshot = state.history.future[0];
      if (!nextSnapshot) return;

      const currentSnapshot = createSnapshot(state.nodes, state.edges, state.groups);
      const history = {
        past: pushHistory(state.history.past, currentSnapshot),
        future: state.history.future.slice(1),
        transactionStart: null
      };

      applySnapshot(nextSnapshot);
      setHistory(history);
    },
    updateNodeData: (nodeId, patch) => {
      const state = get();
      state.commitCanvasChange({
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...patch
                }
              }
            : node
        )
      });
    },
    appendAttachments: (nodeId, attachments) => {
      const state = get();
      state.commitCanvasChange({
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  attachments: [...node.data.attachments, ...attachments]
                }
              }
            : node
        )
      });
    },
    removeAttachment: (nodeId, attachmentId) => {
      const state = get();
      state.commitCanvasChange({
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  attachments: node.data.attachments.filter((attachment) => attachment.id !== attachmentId)
                }
              }
            : node
        )
      });
    },
    setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
    setDrawer: (drawer) => set({ drawer }),
    setTheme: (theme) => set({ theme }),
    setStatus: (status) => set({ status }),
    setPixverseImageDefaultModel: (pixverseImageDefaultModel) => set({ pixverseImageDefaultModel, pixverseImageDefaultModelReady: true }),
    setPixverseImageCliDefaultModel: (pixverseImageCliDefaultModel) => {
      if (get().pixverseImageCliDefaultModel !== pixverseImageCliDefaultModel) set({ pixverseImageCliDefaultModel });
    },
    setRunningNodeId: (runningNodeId) => set({ runningNodeId }),
    setSaving: (isSaving) => set({ isSaving }),
    markNodeRun: (nodeId, runMode) =>
      set({
        nodes: get().nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  runMode,
                  lastRunAt: new Date().toISOString()
                }
              }
            : node
        )
      })
  };
});
