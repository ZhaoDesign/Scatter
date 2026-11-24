import { nanoid } from "nanoid";
import type {
  ReferenceFieldId,
  ScatterNode,
  ScatterNodeData,
  WorkflowNodeKind
} from "../../../shared/types";

export const seedanceReferenceFields: Array<{ id: ReferenceFieldId; label: string }> = [
  { id: "appearance", label: "五官 / 身份" },
  { id: "outfit", label: "发型与穿搭" },
  { id: "scene", label: "场景" },
  { id: "lighting", label: "光影与色彩" },
  { id: "props", label: "道具" },
  { id: "target-video", label: "目标视频" },
  { id: "depth-video", label: "深度视频" }
];

export function defaultNodeData(kind: WorkflowNodeKind, title: string, body = ""): ScatterNodeData {
  return {
    nodeKind: kind,
    title,
    body: kind === "generic-prompt" && !body
      ? "请根据连接的分析分类节点、本节点 Skill 与明确指定的参考素材，生成完整、可编辑、可直接使用的提示词。只写可观察或已确认的信息；未确定内容标记为待确认。参考编号按当前生成任务的素材分配使用，分析素材不自动成为生成参考。"
      : body,
    attachments: [],
    effort: "xhigh",
    planMode: false,
    runMode: "flow",
    ...(kind === "generic-prompt" ? {
      skills: ["video-prompt-expert"],
      genericPromptText: "",
      genericPromptStatus: "idle" as const
    } : {}),
    ...((kind === "replication-analysis" || kind === "replication-comparison") ? {
      replicationStatus: "idle" as const,
      replicationOutputText: "",
      replicationDifferences: [],
      replicationSupplement: ""
    } : {}),
    ...(kind === "replication-section" ? {
      replicationSectionEdited: false
    } : {}),
    ...(kind === "replication-scope" ? {
      replicationScopeId: globalThis.crypto?.randomUUID?.() || `scope-${Date.now()}`,
      replicationScopeKind: "role" as const,
      replicationScopeName: title,
      replicationTimeRange: ""
    } : {}),
    ...(kind === "pixverse-generation" ? {
      pixverseMode: "video" as const,
      pixverseVideoMethod: "create" as const,
      pixverseSettings: {},
      pixverseStatus: "idle" as const
    } : {}),
    mediaKind: kind === "image-reference" ? "image" : kind === "video-reference" ? "video" : undefined,
    depthProcessingMode: "quality",
    depthModel: "small",
    depthResolution: "original",
    temporalSmoothing: 60,
    invertDepth: false,
    preserveAudio: false,
    depthStatus: "idle"
  };
}

export function createWorkflowNode(kind: WorkflowNodeKind, position: { x: number; y: number }, title: string): ScatterNode {
  return {
    id: nanoid(),
    type: "task",
    position,
    data: defaultNodeData(kind, title)
  };
}
