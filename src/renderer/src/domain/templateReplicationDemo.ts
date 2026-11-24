import type {
  ScatterDocument,
  ScatterEdge,
  ScatterNode,
  ScatterNodeData,
  TaskReferenceAssignment,
  WorkflowNodeKind
} from "../../../shared/types";
import { createWorkflowNode, defaultNodeData } from "./seedanceWorkflow";
import { replicationScopeSectionSpecs, type ReplicationScopeKind } from "./replicationSections";

function makeNode(
  kind: WorkflowNodeKind,
  x: number,
  y: number,
  title: string,
  body: string,
  extra: Partial<ScatterNodeData> = {}
): ScatterNode {
  const node = createWorkflowNode(kind, { x, y }, title);
  node.data = { ...defaultNodeData(kind, title), ...node.data, ...extra, title, body };
  return node;
}

function edge(source: string, target: string, label?: string): ScatterEdge {
  return { id: `edge-${source}-${target}`, source, target, ...(label ? { label } : {}) };
}

function assignment(
  kind: TaskReferenceAssignment["kind"],
  alias: string,
  purpose: string,
  order: number,
  analysisOnly = false
): TaskReferenceAssignment {
  return { kind, alias: analysisOnly ? "" : alias, purpose, order, ...(analysisOnly ? { analysisOnly: true, analysisOnlyManual: true } : {}) };
}

function makeScope(
  analysisNode: ScatterNode,
  kind: ReplicationScopeKind,
  key: string,
  name: string,
  timeRange: string,
  mode: "photo" | "video",
  x: number,
  y: number
): { scope: ScatterNode; sections: ScatterNode[] } {
  const scopeId = `scope-${key}`;
  const scopeBody = mode === "photo"
    ? kind === "photo"
      ? "演示写真整体分类组：只保存全局画面布局、构图镜头、场景光线、全局道具与成像风格；姿态表情手势写在本组姿态分类，人物五官、发型、服装与体态写在角色分类组。"
      : "演示角色分类组：只保存该角色稳定的身份连续性、五官发型妆容、服装鞋履与配饰（含眼镜）、体型比例轮廓，以及疤痣纹身等未归入其他分类的特征；姿态、表情、手势写在写真整体组的姿态分类，本组不复述。"
    : "演示分类组；正式分析时会按素材自动识别角色/时间段并逐项回填。";
  const scope = makeNode("replication-scope", x, y, name, scopeBody, {
    replicationMode: mode,
    replicationAnalysisNodeId: analysisNode.id,
    replicationScopeId: scopeId,
    replicationScopeKind: kind,
    replicationScopeKey: key,
    replicationScopeName: name,
    replicationTimeRange: timeRange
  });
  const sections = replicationScopeSectionSpecs[kind].map((spec, index) => makeNode(
    "replication-section",
    x + 500 + (index % 3) * 360,
    y + Math.floor(index / 3) * 225,
    `${name} · ${spec.title}`,
    `分析重点：${spec.focus}\n\n演示节点；运行真实分析后会回填可编辑内容。`,
    {
      replicationMode: mode,
      replicationSectionId: `${scopeId}:${spec.id}`,
      replicationSectionEdited: false,
      replicationAnalysisNodeId: analysisNode.id,
      replicationScopeId: scopeId,
      replicationScopeKind: kind,
      replicationScopeName: name,
      replicationTimeRange: timeRange
    }
  ));
  return { scope, sections };
}

export function createTemplateReplicationDemoDocument(): ScatterDocument {
  const inputX = 70;
  const analysisX = 530;
  const promptX = 2440;
  const generationX = 2940;
  const resultX = 3460;
  const comparisonX = 3940;
  const photoY = 70;
  const videoY = 1660;

  const targetPhoto = makeNode(
    "image-reference", inputX, photoY, "目标写真（分析与复刻依据）",
    "上传要复刻的目标写真。进入分析和对比；同时作为 PixVerse 生图的构图、场景与风格参考。它不会替代用户身份自拍。",
    { mediaKind: "image" }
  );
  const selfie = makeNode(
    "image-reference", inputX, photoY + 255, "用户自拍（身份参考）",
    "按需上传最终用户的照片。写真提示词将人物身份交给此素材；适用于不同性别、年龄和角色，不预设外貌。",
    { mediaKind: "image" }
  );
  const extraImage = makeNode(
    "image-reference", inputX, photoY + 440, "可选参考图",
    "按需增加任意数量的图片参考，例如服装、发型、道具或场景。每张图的用途由提示词和生成节点中的任务内编号说明。",
    { mediaKind: "image" }
  );
  const targetVideo = makeNode(
    "video-reference", inputX, videoY, "目标视频（分析与对比依据）",
    "上传要复刻的视频。只进入分析和结果对比；不连接视频生成节点，不自动编号为 @视频1。",
    { mediaKind: "video" }
  );

  const photoAnalysis = makeNode(
    "replication-analysis", analysisX, photoY + 40, "写真反推分析",
    "分析目标写真并拆成不重复的分类组：写真整体组只记录全局画面布局、构图镜头、场景背景、光线色彩、全局道具和成像风格，并统一记录人物姿态、表情与手势；每个可区分人物各建一个角色组，只记录稳定身份连续性、五官发型妆容、服装鞋履与配饰（含眼镜）、体型比例轮廓，以及疤痣纹身等未归入其他分类的特征。同一人物事实只写一处，角色五个子类互斥，不重复。区分目标画面证据与用户身份参考；不确定细节标注“待确认”，不要臆测。输出结构化分析供写真提示词节点使用。",
    { skills: ["nano-prompt-studio", "nano-prompt"], replicationMode: "photo", replicationStatus: "idle" }
  );
  const videoAnalysis = makeNode(
    "replication-analysis", analysisX, videoY + 40, "视频逐帧反推分析",
    "逐帧密集分析目标视频：基础信息、角色与连续性、环境、道具、动作因果、镜头构图、光色、特效、时间轴、剪辑和声音。按时间段记录准备→发力→运动→接触/完成→停留；不确定内容标注“待确认”。判断是否需要用户补充角色图或深度视频，但不把目标视频作为生成参考。",
    { skills: ["video-prompt-expert", "seedance-reverse-workflow"], replicationMode: "video", replicationStatus: "idle" }
  );

  const photoFrame = makeScope(photoAnalysis, "photo", "photo-overall", "写真整体（示例）", "", "photo", analysisX + 460, photoY + 20);
  const photoRole = makeScope(photoAnalysis, "role", "photo-role-a", "角色 A（示例）", "", "photo", analysisX + 460, photoY + 760);
  const videoOverall = makeScope(videoAnalysis, "video", "video-overall", "视频整体（全局信息）", "", "video", analysisX + 460, videoY + 20);
  const videoRole = makeScope(videoAnalysis, "role", "video-role-a", "角色 A（示例）", "", "video", analysisX + 460, videoY + 540);
  const videoRoleB = makeScope(videoAnalysis, "role", "video-role-b", "角色 B（示例）", "", "video", analysisX + 460, videoY + 920);
  const videoSegment1 = makeScope(videoAnalysis, "segment", "video-segment-1", "时间段 1（示例）", "00:00.000–00:04.000", "video", analysisX + 460, videoY + 1300);
  const videoSegment2 = makeScope(videoAnalysis, "segment", "video-segment-2", "时间段 2（示例）", "00:04.000–00:08.000", "video", analysisX + 460, videoY + 2060);
  const photoSections = [...photoFrame.sections, ...photoRole.sections];
  const videoSections = [...videoOverall.sections, ...videoRole.sections, ...videoRoleB.sections, ...videoSegment1.sections, ...videoSegment2.sections];
  const scopeNodes = [photoFrame.scope, photoRole.scope, videoOverall.scope, videoRole.scope, videoRoleB.scope, videoSegment1.scope, videoSegment2.scope];

  const photoPrompt = makeNode(
    "generic-prompt", promptX, photoY + 40, "写真提示词总编（可编辑）",
    "汇总上游每个独立分类节点和差异修订，生成一份完整、可直接用于 PixVerse 生图的通用提示词。每个事实只写一次：画面布局、构图镜头、场景光线、全局道具和风格来自写真整体组，人物稳定身份连续性、五官发型妆容、服装鞋履配饰、体型轮廓和其他稳定特征来自各自角色组的对应分类，姿态表情手势以整体组姿态分类为准、角色组不再复述。写清参考素材职责：@图1 为用户身份，@图2 为目标写真构图/场景/风格，其他 @图N 只承担明确指定用途。身份以用户上传内容为准，不限定性别、年龄或外貌。每轮输出完整新版本供用户审阅；不要自动触发生图。",
    {
      skills: ["nano-prompt-studio", "nano-prompt"],
      replicationMode: "photo",
      replicationAnalysisNodeId: photoAnalysis.id,
      genericPromptText: "",
      genericPromptStatus: "idle"
    }
  );
  const videoPrompt = makeNode(
    "generic-prompt", promptX, videoY + 40, "视频提示词总编（可编辑）",
    "汇总上游每个独立分类节点和差异修订，输出完整可直接用于 Seedance / PixVerse 视频生成的提示词。目标视频只作分析依据，不写成 @视频1。只有用户明确连接的深度视频才作为生成参考，任务内编号从 @视频1 开始。保留角色身份连续性、时间段动作、镜头、道具、光影、声音及已确认内容。每轮生成新完整版本供用户审阅，不自动生成。",
    {
      skills: ["video-prompt-expert", "seedance-reverse-workflow"],
      replicationMode: "video",
      replicationAnalysisNodeId: videoAnalysis.id,
      genericPromptText: "",
      genericPromptStatus: "idle"
    }
  );

  const photoGeneration = makeNode(
    "pixverse-generation", generationX, photoY + 40, "PixVerse 写真生成",
    "选择图片生成模式、模型、画幅与其他 CLI 支持参数。连接的用户自拍负责身份；目标写真负责构图/场景/风格参考。执行前先检查提示词与素材职责。此项目为预览模式，运行被锁定。",
    { pixverseMode: "image", replicationMode: "photo", replicationAnalysisNodeId: photoAnalysis.id, pixverseStatus: "idle" }
  );
  const videoGeneration = makeNode(
    "pixverse-generation", generationX, videoY + 40, "PixVerse 视频生成",
    "选择视频模型、时长、分辨率和 CLI 支持的其他参数。提示词必须先经用户审阅。目标视频不会连接到此处；如需深度控制，请由用户把深度视频节点手动连入本生成节点。此项目为预览模式，运行被锁定。",
    { pixverseMode: "video", replicationMode: "video", replicationAnalysisNodeId: videoAnalysis.id, pixverseVideoMethod: "create", pixverseStatus: "idle" }
  );

  const photoResult = makeNode("image-reference", resultX, photoY + 40, "写真生成结果", "PixVerse 生成结果将在此展示。当前为空。", { mediaKind: "image" });
  const videoResult = makeNode("video-reference", resultX, videoY + 40, "视频生成结果", "PixVerse 生成结果将在此展示并可播放。当前为空。", { mediaKind: "video" });

  const photoComparison = makeNode(
    "replication-comparison", comparisonX, photoY + 40, "写真结果对比与修订",
    "运行后逐项对照目标写真与生成结果，区分身份、姿态、构图、服装、场景、道具、光线与质感差异。每项填写想修改的方向，再用补充框写总体要求。修改会回到同一个写真提示词节点，由 AI 生成新版本供你审阅。",
    { skills: ["nano-prompt-studio"], replicationMode: "photo", replicationAnalysisNodeId: photoAnalysis.id, replicationStatus: "idle", replicationDifferences: [], replicationSupplement: "" }
  );
  const videoComparison = makeNode(
    "replication-comparison", comparisonX, videoY + 40, "视频逐帧对比与修订",
    "运行后按时间段比较目标视频与生成结果，记录没有还原的动作、人物连续性、空间、镜头、剪辑、道具、光影、特效和声音。每个差异有独立修改输入，并可补充总体要求；结果回到同一个视频提示词节点，先审阅新版本再决定是否重新生成。",
    { skills: ["video-prompt-expert", "seedance-reverse-workflow"], replicationMode: "video", replicationAnalysisNodeId: videoAnalysis.id, replicationStatus: "idle", replicationDifferences: [], replicationSupplement: "" }
  );

  const depth = makeNode(
    "depth-conversion", analysisX, videoY + 1600, "深度视频转换（可选）",
    "只有视频分析判断需要空间深度/运动轨迹控制时才使用。输出普通视频节点；默认不接入视频生成，需由用户明确连接后才会成为生成参考。此演示不会执行转换。"
  );
  const depthVideo = makeNode(
    "video-reference", promptX, videoY + 1640, "深度视频（可选生成参考）",
    "承接深度转换结果。仅当你手动把此节点连接到视频生成节点时，才作为该任务的 @视频1。当前未连接生成节点。",
    { mediaKind: "video" }
  );
  depth.data.depthOutputNodeId = depthVideo.id;

  photoGeneration.data.pixverseOutputNodeId = photoResult.id;
  videoGeneration.data.pixverseOutputNodeId = videoResult.id;

  photoAnalysis.data.referenceAssignments = {
    [targetPhoto.id]: assignment("image", "", "目标写真：分析证据，不作为身份", 0, true)
  };
  videoAnalysis.data.referenceAssignments = {
    [targetVideo.id]: assignment("video", "", "目标视频：分析证据，不作生成参考", 0, true)
  };
  photoGeneration.data.referenceAssignments = {
    [selfie.id]: assignment("image", "@图1", "用户身份与外观", 0),
    [targetPhoto.id]: assignment("image", "@图2", "目标写真构图、场景与风格", 1),
    [extraImage.id]: assignment("image", "@图3", "可选补充参考", 2)
  };
  videoGeneration.data.referenceAssignments = {
    [selfie.id]: assignment("image", "@图1", "用户角色身份", 0),
    [extraImage.id]: assignment("image", "@图2", "可选补充参考", 1)
  };
  photoComparison.data.referenceAssignments = {
    [targetPhoto.id]: assignment("image", "", "目标写真：对比依据", 0, true),
    [photoResult.id]: assignment("image", "", "生成写真：对比对象", 1, true)
  };
  videoComparison.data.referenceAssignments = {
    [targetVideo.id]: assignment("video", "", "目标视频：逐帧对比依据", 0, true),
    [videoResult.id]: assignment("video", "", "生成视频：对比对象", 1, true)
  };

  const nodes: ScatterNode[] = [
    targetPhoto, selfie, extraImage, targetVideo,
    photoAnalysis, videoAnalysis, ...scopeNodes, ...photoSections, ...videoSections, photoPrompt, videoPrompt,
    photoGeneration, videoGeneration, photoResult, videoResult,
    photoComparison, videoComparison, depth, depthVideo
  ];

  const edges: ScatterEdge[] = [
    // Independent photo loop: target -> analysis -> prompt -> PixVerse -> result -> compare -> same prompt.
    edge(targetPhoto.id, photoAnalysis.id, "分析依据"),
    edge(photoAnalysis.id, photoFrame.scope.id, "写真整体"),
    edge(photoAnalysis.id, photoRole.scope.id, "人物身份"),
    ...[photoFrame, photoRole].flatMap(({ scope, sections }) => sections.map((section) => edge(scope.id, section.id, "分类内容"))),
    ...photoSections.map((section) => edge(section.id, photoPrompt.id, "分类内容")),
    edge(selfie.id, photoPrompt.id, "身份素材"),
    edge(targetPhoto.id, photoPrompt.id, "@图2 目标写真"),
    edge(extraImage.id, photoPrompt.id, "可选参考"),
    edge(photoPrompt.id, photoGeneration.id, "待审阅提示词"),
    edge(selfie.id, photoGeneration.id, "@图1 身份"),
    edge(targetPhoto.id, photoGeneration.id, "@图2 目标构图参考"),
    edge(extraImage.id, photoGeneration.id, "@图3 可选参考"),
    edge(photoGeneration.id, photoResult.id, "生成结果"),
    edge(targetPhoto.id, photoComparison.id, "目标照片"),
    edge(photoResult.id, photoComparison.id, "生成照片"),
    edge(photoComparison.id, photoPrompt.id, "差异修订回填"),

    // Independent video loop. Target video does not enter the generator.
    edge(targetVideo.id, videoAnalysis.id, "逐帧分析依据"),
    edge(videoAnalysis.id, videoOverall.scope.id, "视频整体信息"),
    edge(videoAnalysis.id, videoRole.scope.id, "识别角色"),
    edge(videoAnalysis.id, videoRoleB.scope.id, "识别角色"),
    edge(videoAnalysis.id, videoSegment1.scope.id, "拆分时段"),
    edge(videoAnalysis.id, videoSegment2.scope.id, "拆分时段"),
    ...[videoOverall, videoRole, videoRoleB, videoSegment1, videoSegment2].flatMap(({ scope, sections }) => sections.map((section) => edge(scope.id, section.id, "分类内容"))),
    ...videoSections.map((section) => edge(section.id, videoPrompt.id, "分类内容")),
    edge(selfie.id, videoPrompt.id, "可选角色身份"),
    edge(extraImage.id, videoPrompt.id, "可选参考"),
    edge(videoPrompt.id, videoGeneration.id, "待审阅提示词"),
    edge(selfie.id, videoGeneration.id, "@图1 可选角色身份"),
    edge(extraImage.id, videoGeneration.id, "@图2 可选参考"),
    edge(videoGeneration.id, videoResult.id, "生成结果"),
    edge(targetVideo.id, videoComparison.id, "目标视频"),
    edge(videoResult.id, videoComparison.id, "生成视频"),
    edge(videoComparison.id, videoPrompt.id, "逐帧差异修订回填"),

    // Optional depth utility is deliberately not connected to video generation.
    edge(targetVideo.id, depth.id, "可选转换输入"),
    edge(depth.id, depthVideo.id, "深度视频输出")
  ];

  return {
    version: 1,
    projectName: "照片与视频模板复刻闭环演示",
    updatedAt: new Date().toISOString(),
    viewport: { x: 36, y: 24, zoom: 0.32 },
    nodes,
    edges,
    executionMode: "preview-only"
  };
}

export default createTemplateReplicationDemoDocument;
