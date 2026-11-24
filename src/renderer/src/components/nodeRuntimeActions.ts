import type { Attachment, ScatterNodeData, RunMode } from "../../../shared/types";

export type ConnectedNodeSide = "left" | "right";
export type MediaAccept = "image" | "video" | "any";

export interface NodeRuntimeActions {
  updateNodeData: (nodeId: string, patch: Partial<ScatterNodeData>) => void;
  updateReplicationScope?: (nodeId: string, patch: Partial<ScatterNodeData>) => void;
  beginNodeEdit: () => void;
  commitNodeEdit: () => void;
  chooseFilesForNode: (nodeId: string) => Promise<void>;
  addFilesToNode: (nodeId: string, files: FileList | File[], source: "upload" | "drop" | "paste", accept?: MediaAccept) => Promise<void>;
  replaceFilesForNode: (nodeId: string, files: FileList | File[], source: "upload" | "drop" | "paste", accept?: MediaAccept) => Promise<void>;
  removeAttachment: (nodeId: string, attachmentId: string) => void;
  createConnectedNode: (nodeId: string, side: ConnectedNodeSide) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  runNode: (nodeId: string, mode: RunMode, promptOutputPath?: string) => Promise<boolean>;
  runPromptNode?: (nodeId: string) => Promise<void>;
  runReplicationNode?: (nodeId: string) => Promise<void>;
  runDepthConversion?: (nodeId: string) => Promise<void>;
  runPixverseGeneration?: (nodeId: string) => Promise<void>;
  /** Update the alias for a connected material within this task; syncs body tokens. */
  updateReferenceAlias: (nodeId: string, mediaNodeId: string, alias: string) => void;
  /** Update the purpose/usage note for a connected material within this task. */
  updateReferencePurpose: (nodeId: string, mediaNodeId: string, purpose: string) => void;
  /** Toggle a media node's task-local role: numbered reference vs analysis-only (no alias). */
  updateReferenceRole: (nodeId: string, mediaNodeId: string, analysisOnly: boolean) => void;
  /** Move a connected material up/down in this task's reference order. */
  moveReference: (nodeId: string, mediaNodeId: string, direction: -1 | 1) => void;
  /** Remove the edge connecting a material node into this task. */
  unlinkReference: (nodeId: string, mediaNodeId: string) => void;
}

export let taskNodeActions: NodeRuntimeActions | null = null;

export function setTaskNodeActions(actions: NodeRuntimeActions): void {
  taskNodeActions = actions;
}

export function mediaAcceptMime(accept: MediaAccept): string {
  if (accept === "image") return "image/*";
  if (accept === "video") return "video/*";
  return "image/*,video/*";
}

export function filterMediaFiles(files: FileList | File[], accept: MediaAccept): File[] {
  const list = Array.from(files);
  if (accept === "any") return list;
  return list.filter((file) => file.type.startsWith(`${accept}/`) || (accept === "video" && /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)) || (accept === "image" && /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name)));
}

export function firstMediaAttachment(data: ScatterNodeData, accept: "image" | "video"): Attachment | null {
  return data.attachments.find((attachment) => attachment.kind === accept) || null;
}
