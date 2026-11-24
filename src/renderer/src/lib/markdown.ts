import type { Attachment, LanguagePreference, RunMode, ScatterEdge, ScatterNode } from "../../../shared/types";
import { depthOutputVideoIds, isMediaNode, targetAnalysisVideoIds } from "../domain/referenceAssignments";
import { replicationScopeSectionSpecs } from "../domain/replicationSections";

export interface MarkdownResult {
  markdown: string;
  nodes: ScatterNode[];
  attachments: Attachment[];
  imagePaths: string[];
  planMode: boolean;
  hasCycle: boolean;
}

interface TaskReferenceItem {
  node: ScatterNode;
  alias: string;
  purpose: string;
  isAnalysisSource: boolean;
  /** Use the task-local label for images and manually chosen video analysis sources. */
  manualAnalysisOnly: boolean;
  attachment: Attachment | null;
}

function downstreamNodeIds(startId: string, edges: ScatterEdge[]): { ids: Set<string>; hasCycle: boolean } {
  const ids = new Set<string>([startId]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;

  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      hasCycle = true;
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);

    for (const edge of edges.filter((item) => item.source === nodeId)) {
      ids.add(edge.target);
      visit(edge.target);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  visit(startId);
  return { ids, hasCycle };
}

function sortFlow(nodes: ScatterNode[], edges: ScatterEdge[], startId: string): ScatterNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const included = new Set(nodes.map((node) => node.id));
  const ordered: ScatterNode[] = [];
  const visited = new Set<string>();

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (node) ordered.push(node);
    const children = edges
      .filter((edge) => edge.source === nodeId && included.has(edge.target))
      .sort((a, b) => {
        const left = nodeById.get(a.target);
        const right = nodeById.get(b.target);
        return (left?.position.y ?? 0) - (right?.position.y ?? 0) || (left?.position.x ?? 0) - (right?.position.x ?? 0);
      });
    for (const edge of children) visit(edge.target);
  };

  visit(startId);
  const remaining = nodes
    .filter((node) => !visited.has(node.id))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return [...ordered, ...remaining];
}

interface MarkdownText {
  absolutePath: string;
  allAttachments: string;
  attachmentFile: string;
  attachmentImage: string;
  attachmentVideo: string;
  attachments: string;
  connectionMap: string;
  executionRequest: string;
  executionRequestBody: string;
  includedNodes: string;
  noConnections: string;
  noPrompt: string;
  none: string;
  nodeId: string;
  planMode: string;
  planModeDisabled: string;
  planModeEnabled: string;
  planModeRequested: string;
  planModeRequestedNo: string;
  planModeRequestedYes: string;
  project: string;
  projectPath: string;
  prompt: string;
  relativePath: string;
  runMode: string;
  runModeFlow: string;
  runModeNode: string;
  source: string;
  targetVideoAnalysisSource: string;
  manualAnalysisSource: string;
  taskTitle: string;
  workflowType: string;
  referenceFields: string;
  depthSettings: string;
  genericPromptOutput: string;
  genericPromptWriteInstruction: (filePath: string, mode?: "photo" | "video") => string;
  replicationAnalysisWriteInstruction: (filePath: string, mode: "photo" | "video") => string;
  replicationCategoryLabel: (kind: "photo" | "video" | "role" | "segment", sectionId: string, fallback: { title: string; focus: string }) => { title: string; focus: string };
  replicationComparisonWriteInstruction: (filePath: string) => string;
  promptOutputPreview: string;
  seedancePromptInput: string;
  seedancePromptMissing: string;
  skills: string;
  nodeSkills: string;
  skillScopeNotice: string;
  noSkills: string;
  referenceMaterials: string;
  referenceAliasLabel: string;
  referencePurposeLabel: string;
  referenceNoPurpose: string;
  untitledTask: (index: number) => string;
  warningCycle: string;
}

const markdownTexts: Record<LanguagePreference, MarkdownText> = {
  zh: {
    absolutePath: "绝对路径",
    allAttachments: "所有附件",
    attachmentFile: "文件",
    attachmentImage: "图片",
    attachmentVideo: "视频",
    attachments: "附件",
    connectionMap: "连接关系",
    executionRequest: "执行请求",
    executionRequestBody: "请把以下 Scatter 画布上下文作为事实来源。需要时检查引用文件，并在这个项目中执行请求的工作。",
    includedNodes: "包含的节点",
    noConnections: "- 当前范围内没有下游连接。",
    noPrompt: "_未提供提示词正文。_",
    none: "- 无",
    nodeId: "节点 ID",
    planMode: "计划模式",
    planModeDisabled: "关闭",
    planModeEnabled: "开启",
    planModeRequested: "请求计划模式",
    planModeRequestedNo: "否",
    planModeRequestedYes: "是",
    project: "项目",
    projectPath: "项目路径",
    prompt: "提示词",
    relativePath: "相对路径",
    runMode: "运行模式",
    runModeFlow: "当前节点及下游流程",
    runModeNode: "仅当前节点",
    source: "来源",
    targetVideoAnalysisSource: "目标视频分析源（不作为 @视频 编号）",
    manualAnalysisSource: "任务指定分析源（不编号，不作为生成参考）",
    taskTitle: "Scatter 任务",
    workflowType: "工作流节点类型",
    referenceFields: "参考绑定字段",
    depthSettings: "深度转换配置",
    genericPromptOutput: "本节点生成并审阅的通用提示词",
    genericPromptWriteInstruction: (filePath, mode) => `本次运行是“通用提示词”节点。请把最终完整、可直接使用的提示词写入以下文件，文件中只保留提示词正文，不要附加标题、解释或代码围栏：\n\n\`${filePath}\`\n\n同时在 Codex 回复中展示相同的完整提示词。${mode === "video" ? "目标视频只作分析和对比依据，不要标成 @视频1；只有用户明确选择的深度视频才作为生成视频参考。" : mode === "photo" ? "区分目标写真与用户身份素材；不要臆测用户年龄、性别或身份。" : "严格按每个生成任务的素材分配表使用参考编号；分析素材不得自动成为生成参考。"}`,
    replicationCategoryLabel: (_kind, _sectionId, fallback) => fallback,
    replicationAnalysisWriteInstruction: (filePath, mode) => {
      const scopeKinds = mode === "photo" ? ["photo", "role"] as const : ["video", "role", "segment"] as const;
      const scopeDefinitions = scopeKinds.map((kind) => {
        const specs = replicationScopeSectionSpecs[kind];
        return `${kind} 分类组必须包含这些独立分类：\n${specs.map((section) => `- ${section.id} | ${section.title}：${section.focus}`).join("\n")}`;
      }).join("\n\n");
      return `本次运行是${mode === "photo" ? "写真" : "视频"}复刻分析节点。只记录素材中可以观察到的事实；无法确认的细节标记“待确认”，不要猜测。\n\n请按检测到的对象自动拆分多个分类组，每个组都要带有组名、稳定 key 和多个独立分类。输出必须严格为一个 JSON 对象，不能使用代码围栏或额外说明，结构如下：\n{\n  "summary": "简短总览",\n  "scopes": [\n    {"key": "stable-key", "kind": "${scopeKinds[0]}", "name": "组名称", "timeRange": "${mode === "video" ? "00:00.000–00:02.300" : ""}", "categories": [\n      {"id": "${replicationScopeSectionSpecs[scopeKinds[0]][0].id}", "content": "该分类的详细观察结果"}\n    ]}\n  ]\n}\n\n${scopeDefinitions}\n\n规则：每个 scope 都必须包含其类型的全部分类，不得把不同角色或不同时段合并到同一组。${mode === "video" ? "必须创建且只创建一个 kind=video 的视频整体组，记录技术规格和全片连续性；每个可确认角色各建一个 kind=role 组；按动作/镜头变化把全片拆成起止时间准确、互不重叠的 kind=segment 时间段，时间格式使用 MM:SS.mmm，不得漏段或重叠；若附件提供本地视频时长元数据，最后一段的结束时间必须精确等于该时长。角色组只记稳定身份、外观和服装基线；动作、姿势、表情、位置、关系、互动及持有道具写入具体时间段，避免重复。全片持续场景与声音结构写入视频整体组，局部变化写入对应时间段。目标视频只用于分析，不得标成 @视频1；只把明确连接的深度视频作为生成参考。" : "必须创建且只创建一个 kind=photo 的整体画面组，只写全局画面布局、构图镜头、场景背景、光线色彩、全局道具和成像风格；若出现多个可区分人物，再为每个人创建独立的 kind=role 组，只写该角色稳定的身份、五官发型、服装配饰、体态与区分特征。同一个人物事实只能写进一个分类：姿态、表情、手势只写入 photo 整体组的 pose 分类（多人按人分行各写一次），角色组不得复述；五官发型、服装鞋履与随身配饰、体态只写入角色组，整体组不得复述；场景内道具写入整体组，人物随身物品写入角色组。角色组内部五个分类互斥：identity 只写稳定身份连续性锚点，不含身形；face-hair 只写五官、发型与妆容；wardrobe 只写服装、鞋履与配饰，眼镜归 wardrobe；body 只写体型比例与轮廓；distinguishing-cues 只保留疤、痣、纹身等未归入其他分类的稳定特征，不重复眼镜、发型和服装。合并后的提示词不得出现同一人物属性或同一姿态的两次描述。区分目标模板与用户身份素材，不预设用户年龄、性别或身份。"}若上下文中已有分类组，优先沿用其 key、名称和时间范围；用户已修改的名称/时间范围以画布数据为准。key 应简短、稳定且不重复。\n\n请把最终 JSON 写入以下文件：\n\`${filePath}\``;
    },
    replicationComparisonWriteInstruction: (filePath) => `本次运行是生成结果对比节点。请将每个标注轮次的生成候选分别与目标素材比较，不要把多轮结果混在一起；在 category 字段前缀写明对应轮次。仅输出合法 JSON（不要代码围栏或其他文字）并写入以下文件，格式为：{"summary":"简短总结","differences":[{"timeRange":"时间段；写真留空","category":"差异类别","target":"目标中的可见事实","generated":"生成结果中的可见事实"}]}。每项差异要具体、可操作；未发现差异时 differences 为空数组。无法确认的细节不要猜测。\n\n\`${filePath}\``,
    promptOutputPreview: "当前提示词草稿",
    seedancePromptInput: "上游已确认的通用提示词",
    seedancePromptMissing: "尚未连接通用提示词节点，或提示词节点还没有生成内容。",
    skills: "本次运行调用的 Skill",
    nodeSkills: "本节点 Skill",
    skillScopeNotice: "每个 Skill 只应用于其关联节点；不要把某个节点的 Skill 规则扩散到其他节点。",
    noSkills: "无",
    referenceMaterials: "本任务参考素材",
    referenceAliasLabel: "别名",
    referencePurposeLabel: "用途",
    referenceNoPurpose: "未说明",
    untitledTask: (index) => `未命名任务 ${index + 1}`,
    warningCycle: "> 警告：这个流程包含环。节点已按遍历顺序和画布位置排序。\n"
  },
  en: {
    absolutePath: "Absolute path",
    allAttachments: "All Attachments",
    attachmentFile: "File",
    attachmentImage: "Image",
    attachmentVideo: "Video",
    attachments: "Attachments",
    connectionMap: "Connection Map",
    executionRequest: "Execution Request",
    executionRequestBody: "Use the following Scatter canvas context as the source of truth. Analyze the task structure, inspect referenced files when needed, and execute the requested work in this project.",
    includedNodes: "Included Nodes",
    noConnections: "- No downstream connections included.",
    noPrompt: "_No prompt text provided._",
    none: "- None",
    nodeId: "Node ID",
    planMode: "Plan mode",
    planModeDisabled: "disabled",
    planModeEnabled: "enabled",
    planModeRequested: "Plan mode requested",
    planModeRequestedNo: "no",
    planModeRequestedYes: "yes",
    project: "Project",
    projectPath: "Project path",
    prompt: "Prompt",
    relativePath: "Relative path",
    runMode: "Run mode",
    runModeFlow: "Current node and downstream flow",
    runModeNode: "Current node only",
    source: "Source",
    targetVideoAnalysisSource: "Target video analysis source (not numbered as @video)",
    manualAnalysisSource: "Task-specified analysis source (no alias, not a generation reference)",
    taskTitle: "Scatter Task",
    workflowType: "Workflow node type",
    referenceFields: "Reference binding fields",
    depthSettings: "Depth conversion settings",
    genericPromptOutput: "Reusable prompt generated and reviewed in this node",
    genericPromptWriteInstruction: (filePath, mode) => `This is a Generic Prompt node run. Write the final complete, ready-to-use prompt to the file below. The file must contain only the prompt text, without a heading, explanation, or code fence:\n\n\`${filePath}\`\n\nAlso show the same complete prompt in your Codex reply. ${mode === "video" ? "The target video is for analysis and comparison only; do not label it @video1. Only a depth video explicitly selected by the user may be a generation video reference." : mode === "photo" ? "Separate the target photo from the user's identity image; do not infer the user's age, gender, or identity." : "Use reference aliases exactly as allocated for this generation task; analysis-only media must not become a generation reference."}`,
    replicationCategoryLabel: (kind, sectionId, fallback) => {
      const labels: Record<string, { title: string; focus: string }> = {
        "photo.subject": { title: "Subject count and frame position", focus: "Record only how many subjects there are, each subject's frame position and relative size, plus cropping and front-to-back occlusion. Do not record facial features, hair, wardrobe, physique, or identity; frame ratio, shot size, camera position, and depth of field belong to the composition category." },
        "photo.pose": { title: "Pose, expression, and gesture", focus: "The single place to record each person's pose, weight distribution, hand and foot placement, gestures, eye line, expression, and facing direction. When several people appear, give each person one line; role scopes do not repeat this." },
        "photo.composition": { title: "Frame ratio, shot size, and camera position", focus: "Record only frame aspect ratio, shot size, camera height and direction, negative space, focus, and depth of field; subject count, position and size, cropping, and occlusion belong to the subject category." },
        "photo.scene": { title: "Scene and background", focus: "Location, foreground/midground/background, spatial depth, and background layout." },
        "photo.lighting": { title: "Lighting and color", focus: "Light direction, contrast, shadows, color temperature, dominant and accent colors, and overall tonality." },
        "photo.props": { title: "Global props and on-image text", focus: "Prop count, position, material, state, and contact relationships inside the scene, plus readable text or logos. Character wardrobe, footwear, and personal accessories belong to role scopes." },
        "photo.style": { title: "Style and imaging quality", focus: "Photographic style, realism, texture, grain, sharpness, and post-processing." },
        "role.identity": { title: "Stable identity continuity", focus: "Record only identity anchors that stay verifiable across frames and are not covered by facial features, hair, wardrobe, or physique, such as apparent age, gender presentation, skin tone, and habitual visible state; do not restate body proportions, facial features, hair, wardrobe, accessories, pose, expression, gesture, or standing position." },
        "role.face-hair": { title: "Facial features, hair, and makeup", focus: "Record only visible facial features, hairstyle, hair color, and makeup; do not infer identity, do not describe expression, and keep glasses in the wardrobe and accessories category." },
        "role.wardrobe": { title: "Wardrobe, footwear, and accessories", focus: "Record only the clothing silhouette, cut, color, material, and footwear this character wears, plus worn accessories such as glasses and jewelry; do not restate how props are held or the pose." },
        "role.body": { title: "Body proportions and silhouette", focus: "Record only relatively stable body proportions, height ratio, and silhouette volume; do not restate the current pose, action, or gesture, and do not repeat facial features, hair, or wardrobe." },
        "role.distinguishing-cues": { title: "Other distinguishing marks", focus: "Keep only stable visible marks not covered by other categories, such as scars, moles, and tattoos; do not repeat glasses, hairstyle, wardrobe, physique, or identity continuity traits here." },
        "video.basic": { title: "Basic info and frame format", focus: "Record total duration, aspect ratio, resolution, frame rate, color/monochrome/tinted treatment, and single or multiple shots; mark metadata that cannot be confirmed from the footage as unknown." },
        "video.global-continuity": { title: "Whole-video scene and spatial continuity", focus: "Record the location, time and weather, foreground/midground/background, spatial depth, and scene changes that persist across the video; state the spatial axis that stays fixed across segments." },
        "video.soundtrack": { title: "Whole-video sound structure", focus: "Record whether there is audio, the overall structure of dialogue, ambience, and music, the sound that runs through the video, and its rough rhythm; per-segment sync points belong to segment categories." },
        "segment.state": { title: "Start and end state", focus: "Character and prop positions, frame coverage, front-to-back relationships, and poses at the start and end of this segment; stable character appearance follows the role scopes." },
        "segment.action": { title: "Action phases and trajectory", focus: "Preparation, exertion, movement, contact or completion, and hold, with direction and causality." },
        "segment.interaction": { title: "Character and object interaction", focus: "Participating characters, props, contact points, force direction, and interaction outcome." },
        "segment.camera": { title: "Camera and composition", focus: "Shot size, camera position, angle, subject composition, and camera movement." },
        "segment.environment": { title: "Scene and spatial relationships", focus: "Foreground/midground/background, relative positions, spatial depth, and persistent dynamic elements." },
        "segment.props-effects": { title: "Props and effects", focus: "State changes, appearance timing, movement direction, collision and occlusion, and final resting state." },
        "segment.lighting-color": { title: "Lighting and color", focus: "Light sources, shadows, color, exposure, and how they change in this segment." },
        "segment.sound-edit": { title: "Sound, editing, and transitions", focus: "Dialogue, ambience, and music sync points, cut timing, transitions, and action continuity." }
      };
      return labels[`${kind}.${sectionId}`] ?? fallback;
    },
    replicationAnalysisWriteInstruction: (filePath, mode) => {
      const scopeKinds = mode === "photo" ? ["photo", "role"] as const : ["video", "role", "segment"] as const;
      const scopeDefinitions = scopeKinds.map((kind) => `${kind} scope must contain every category below:\n${replicationScopeSectionSpecs[kind].map((section) => {
        const label = markdownTexts.en.replicationCategoryLabel(kind, section.id, section);
        return `- ${section.id} | ${label.title}: ${label.focus}`;
      }).join("\n")}`).join("\n\n");
      return `This is a ${mode} replication analysis node. Record only observable facts and mark uncertain details instead of guessing.\n\nAutomatically split the media into as many independently editable scopes as needed. Each scope needs a stable unique key, name, kind, and its own category content. Return exactly one JSON object, with no code fences or extra text:\n{\n  "summary": "brief overview",\n  "scopes": [\n    {"key": "stable-key", "kind": "${scopeKinds[0]}", "name": "scope name", "timeRange": "${mode === "video" ? "00:00.000–00:02.300" : ""}", "categories": [\n      {"id": "${replicationScopeSectionSpecs[scopeKinds[0]][0].id}", "content": "detailed observations"}\n    ]}\n  ]\n}\n\n${scopeDefinitions}\n\nEvery scope must include all categories for its kind. Do not merge different people or time segments into one scope. ${mode === "video" ? "Create exactly one kind=video global scope for technical properties and whole-video continuity; create a separate kind=role scope for every distinct person, merging only identities confirmed to be the same; split the entire duration into non-overlapping kind=segment scopes based on action/camera changes and provide exact MM:SS.mmm start/end timecodes. If local video duration metadata is provided, the last segment must end at that exact duration. Do not omit the global video scope. Keep role scopes to stable identity, appearance, and wardrobe baselines; put actions, poses, expressions, positions, relationships, interactions, and carried props in the relevant time segments to prevent duplication. Put persistent scene and soundtrack details in the global scope and local changes in segments. The target video is analysis-only and must not be labeled @video1; only explicitly connected depth video may be a generation reference." : "Create exactly one overall photo scope (kind=photo) that records only global frame layout, composition and lens, scene and background, lighting and color, global props, and imaging style. Add a separate kind=role scope for each distinguishable person, recording only that person's stable identity, facial features and hair, wardrobe and accessories, physique, and distinguishing cues. Write each person fact in exactly one category: poses, expressions, and gestures belong only to the overall scope's pose category (one line per person when multiple people are present) and must not be repeated in role scopes; facial features, hair, wardrobe, footwear, personal accessories, and physique belong only to role scopes and must not be repeated in the overall scope; scene props belong to the overall scope while carried items belong to role scopes. The five role categories are mutually exclusive: identity records only stable identity continuity anchors and never physique; face-hair records only facial features, hair, and makeup; wardrobe records only clothing, footwear, and accessories, with glasses counted as accessories; body records only body proportions and silhouette; distinguishing-cues keeps only stable marks such as scars, moles, and tattoos that fit no other category and never repeats glasses, hairstyle, or wardrobe. The merged prompt must never describe the same person attribute or the same pose twice. Separate the template photo from the user's identity material; do not assume age, gender, or identity."}Reuse keys, names, and time ranges from existing scopes in the canvas context when possible; manually edited names/time ranges remain authoritative. Keep keys short, stable, and unique.\n\nWrite the JSON to:\n\`${filePath}\``;
    },
    replicationComparisonWriteInstruction: (filePath) => `This is a generation comparison node. Compare each round-labeled generated candidate with the target independently; do not blend observations across rounds, and prefix each difference category with its round. Write only valid JSON (no code fence or extra text) using this schema: {"summary":"brief summary","differences":[{"timeRange":"time range; empty for photos","category":"difference category","target":"observable target fact","generated":"observable generated fact"}]}. Make each difference actionable. Use an empty differences array when none are found, and do not guess uncertain details.\n\n\`${filePath}\``,
    promptOutputPreview: "Current prompt draft",
    seedancePromptInput: "Confirmed generic prompt from upstream",
    seedancePromptMissing: "No Generic Prompt node is connected, or it has not generated a prompt yet.",
    skills: "Skills invoked for this run",
    nodeSkills: "Skills for this node",
    skillScopeNotice: "Apply each Skill only to its assigned node; do not carry its rules into other nodes.",
    noSkills: "None",
    referenceMaterials: "References for this task",
    referenceAliasLabel: "Alias",
    referencePurposeLabel: "Purpose",
    referenceNoPurpose: "No note",
    untitledTask: (index) => `Untitled task ${index + 1}`,
    warningCycle: "> Warning: This flow contains a cycle. Nodes were ordered by traversal and canvas position.\n"
  }
};

function markdownText(language: LanguagePreference): MarkdownText {
  return markdownTexts[language] ?? markdownTexts.zh;
}

function isTaskNode(node: ScatterNode | undefined): boolean {
  return Boolean(node && (!node.data.nodeKind || node.data.nodeKind === "task" || node.data.nodeKind === "generic-prompt" || node.data.nodeKind === "replication-analysis" || node.data.nodeKind === "replication-section" || node.data.nodeKind === "replication-comparison" || node.data.nodeKind === "seedance-generation"));
}

function isMediaReferenceNode(node: ScatterNode | undefined): boolean {
  return Boolean(node && (node.data.nodeKind === "image-reference" || node.data.nodeKind === "video-reference"));
}

function attachmentLine(attachment: Attachment, text: MarkdownText): string {
  const kindLabel = attachment.kind === "image" ? text.attachmentImage : attachment.kind === "video" ? text.attachmentVideo : text.attachmentFile;
  const videoDuration = attachment.kind === "video" && Number.isFinite(attachment.durationMs) && Number(attachment.durationMs) > 0
    ? `\n  - Video duration metadata: ${(Number(attachment.durationMs) / 1_000).toFixed(3)} seconds`
    : "";
  return `- ${kindLabel}: ${attachment.originalName}
  - ${text.relativePath}: \`${attachment.relativePath}\`
  - ${text.absolutePath}: \`${attachment.storedPath}\`
  - ${text.source}: ${attachment.source}${videoDuration}`;
}

function workflowDetails(node: ScatterNode, text: MarkdownText): string {
  const data = node.data;
  const lines: string[] = [];
  if (data.nodeKind && data.nodeKind !== "task") lines.push(`${text.workflowType}: ${data.nodeKind}`);
  if (data.replicationMode) lines.push(`复刻类型: ${data.replicationMode === "photo" ? "写真" : "视频"}`);
  if (data.replicationSectionId) lines.push(`复刻分类 ID: ${data.replicationSectionId}`);
  if (data.replicationScopeKind) {
    lines.push(`分类范围组: ${data.replicationScopeKind === "photo" ? "写真整体" : data.replicationScopeKind === "video" ? "视频整体" : data.replicationScopeKind === "role" ? "角色" : "时间段"}`);
    if (data.replicationScopeKey) lines.push(`范围组 Key: ${data.replicationScopeKey}`);
    lines.push(`范围名称: ${data.replicationScopeName || data.title}`);
    if (data.replicationScopeKind === "segment") lines.push(`时间范围: ${data.replicationTimeRange || "待填写"}`);
    if (data.replicationScopeStale) lines.push("该范围已过期，当前未被本轮分析识别；不要将其视为当前有效结论。");
  }
  if (data.referenceFields && Object.keys(data.referenceFields).length) {
    lines.push(`${text.referenceFields}:\n${Object.entries(data.referenceFields).map(([key, value]) => `- ${key}: ${value || ""}`).join("\n")}`);
  }
  if (data.depthProcessingMode || data.depthModel || data.depthResolution) {
    lines.push(`${text.depthSettings}: mode=${data.depthProcessingMode || "quality"}; model=${data.depthModel || "small"}; resolution=${data.depthResolution || "original"}; temporalSmoothing=${data.temporalSmoothing ?? 60}%; invert=${Boolean(data.invertDepth)}; preserveAudio=${Boolean(data.preserveAudio)}; status=${data.depthStatus || "idle"}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/**
 * Compute the personal reference list for one task node. Uses the task's own
 * persisted aliases; falls back to a stable per-task numbering only when an
 * older document has no allocation yet. Analysis-source images and videos are
 * listed for inspection but never receive an alias or become generation references.
 */
function taskReferenceList(
  taskNode: ScatterNode,
  nodes: ScatterNode[],
  edges: ScatterEdge[],
  depthOutputIds: Set<string>,
  analysisSourceIds: Set<string>
): TaskReferenceItem[] {
  const assignments = taskNode.data.referenceAssignments ?? {};
  const protectedTargetVideoIds = targetAnalysisVideoIds(nodes, edges);
  const protectedTargetVideo = (node: ScatterNode): boolean => node.data.nodeKind === "video-reference"
    && protectedTargetVideoIds.has(node.id)
    && !depthOutputIds.has(node.id);
  const depthOnlyVideoGeneration = taskNode.data.nodeKind === "pixverse-generation"
    && taskNode.data.replicationMode === "video";
  const connected = edges
    .filter((edge) => edge.target === taskNode.id && !edge.targetHandle)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is ScatterNode => Boolean(node && isMediaNode(node)));

  const items: TaskReferenceItem[] = connected.map((node, index) => {
    const record = assignments[node.id];
    const manual = record?.analysisOnlyManual;
    const protectedTarget = protectedTargetVideo(node);
    const depthOnlyVideo = depthOnlyVideoGeneration
      && node.data.nodeKind === "video-reference"
      && !depthOutputIds.has(node.id);
    const isAnalysis = protectedTarget || depthOnlyVideo || (manual !== undefined
      ? Boolean(record?.analysisOnly)
      : Boolean(record?.analysisOnly)
        || (node.data.nodeKind === "video-reference" && analysisSourceIds.has(node.id)));
    return {
      node,
      alias: isAnalysis ? "" : (record?.alias ?? ""),
      purpose: record?.purpose ?? "",
      isAnalysisSource: isAnalysis,
      manualAnalysisOnly: isAnalysis && !protectedTarget && !depthOnlyVideo && (manual !== undefined || node.data.nodeKind === "image-reference"),
      attachment: node.data.attachments[0] ?? null,
      order: record?.order ?? index
    };
  }).sort((a, b) => a.order - b.order) as (TaskReferenceItem & { order: number })[];

  // Fallback numbering for legacy documents without persisted assignments.
  let imageN = 1;
  let videoN = 1;
  for (const item of items) {
    if (item.isAnalysisSource) continue;
    if (item.alias) continue;
    if (item.node.data.nodeKind === "image-reference") {
      item.alias = `@图${imageN}`;
      imageN += 1;
    } else {
      // Depth-output videos take @视频1 first when still free.
      if (item.node.data.nodeKind === "video-reference" && depthOutputIds.has(item.node.id) && videoN === 1) {
        item.alias = "@视频1";
        videoN += 1;
      } else {
        item.alias = `@视频${videoN}`;
        videoN += 1;
      }
    }
  }
  return items;
}

function referenceSectionText(items: TaskReferenceItem[], text: MarkdownText): string {
  if (!items.length) return "";
  const lines = items.map((item) => {
    const label = item.isAnalysisSource
      ? (item.manualAnalysisOnly ? text.manualAnalysisSource : text.targetVideoAnalysisSource)
      : item.alias;
    const attachment = item.attachment;
    const purpose = item.purpose.trim() || text.referenceNoPurpose;
    const fileName = attachment?.originalName || item.node.data.title || "-";
    if (!attachment) {
      return `- ${label} · ${fileName}\n  - ${text.referencePurposeLabel}: ${purpose}`;
    }
    return `- ${label} · ${fileName}\n  - ${text.relativePath}: \`${attachment.relativePath}\`\n  - ${text.absolutePath}: \`${attachment.storedPath}\`\n  - ${text.referencePurposeLabel}: ${purpose}`;
  });
  return `### ${text.referenceMaterials}\n${lines.join("\n")}\n`;
}

function nodeBlock(node: ScatterNode, index: number, text: MarkdownText, references: TaskReferenceItem[], upstreamPrompt = "", replicationCategoryFieldIds?: Set<string>): string {
  const title = node.data.title?.trim() || text.untitledTask(index);
  const body = node.data.body?.trim() || text.noPrompt;
  const attachments = node.data.attachments.length
    ? node.data.attachments.map((attachment) => attachmentLine(attachment, text)).join("\n")
    : text.none;
  const nodeSkills = (node.data.skills || []).map((name) => `$${name.replace(/^\$+/, "")}`);

  return `## ${index + 1}. ${title}

${text.nodeId}: \`${node.id}\`
${text.planMode}: ${node.data.planMode ? text.planModeEnabled : text.planModeDisabled}
${text.nodeSkills}: ${nodeSkills.length ? nodeSkills.join(", ") : text.noSkills}

${workflowDetails(node, text)}

${node.data.nodeKind === "generic-prompt" && node.data.genericPromptText?.trim()
    ? `### ${text.promptOutputPreview}\n${node.data.genericPromptText.trim()}\n\n`
    : node.data.nodeKind === "seedance-generation"
      ? `### ${text.seedancePromptInput}\n${upstreamPrompt.trim() || text.seedancePromptMissing}\n\n`
      : ""}
${node.data.nodeKind === "replication-analysis" && (node.data.replicationOutputText?.trim() || node.data.replicationCategoryFields?.length)
    ? `### 反推分析结果\n${node.data.replicationOutputText?.trim() || "尚无整体摘要。"}\n\n${(node.data.replicationCategoryFields || [])
      .filter((field) => !replicationCategoryFieldIds || replicationCategoryFieldIds.has(field.id))
      .map((field) => `#### ${field.groupTitle} · ${field.title}\n${field.body?.trim() || "（待补充）"}`)
      .join("\n\n")}\n\n`
    : node.data.nodeKind === "replication-comparison"
      ? `### 对比报告与人工修订\n${node.data.replicationOutputText?.trim() || "尚无对比报告。"}\n\n${(node.data.replicationDifferences || []).map((difference, index) => `- ${difference.timeRange || `差异 ${index + 1}`} / ${difference.category || "未分类"}\n  - 目标：${difference.target || "未填写"}\n  - 生成：${difference.generated || "未填写"}\n  - 用户修改要求：${difference.correction || "（尚未填写）"}`).join("\n")}\n总体补充：${node.data.replicationSupplement?.trim() || "（无）"}\n\n`
      : ""}

### ${text.prompt}
${body}

${references.length ? referenceSectionText(references, text) : ""}### ${text.attachments}
${attachments}`;
}

export function buildMarkdown(
  allNodes: ScatterNode[],
  allEdges: ScatterEdge[],
  startNodeId: string | null,
  runMode: RunMode,
  projectName: string,
  projectPath: string,
  language: LanguagePreference = "zh",
  promptOutputPath?: string
): MarkdownResult {
  const text = markdownText(language);
  const startNode = startNodeId ? allNodes.find((node) => node.id === startNodeId) : null;
  const nodeIds =
    startNode && runMode === "flow"
      ? downstreamNodeIds(startNode.id, allEdges)
      : { ids: new Set(startNode ? [startNode.id] : allNodes.map((node) => node.id)), hasCycle: false };

  const workflowContextIds = new Set<string>();
  if (startNode?.data.nodeKind === "generic-prompt") {
    const pending = allEdges
      .filter((edge) => edge.target === startNode.id && !edge.targetHandle)
      .map((edge) => edge.source);
    while (pending.length) {
      const sourceId = pending.pop();
      if (!sourceId || sourceId === startNode.id || workflowContextIds.has(sourceId)) continue;
      const source = allNodes.find((node) => node.id === sourceId);
      if (!source || source.data.replicationScopeStale) continue;
      if (source.data.replicationMode && startNode.data.replicationMode
        && source.data.replicationMode !== startNode.data.replicationMode) continue;
      if (source.data.replicationAnalysisNodeId && startNode.data.replicationAnalysisNodeId
        && source.data.replicationAnalysisNodeId !== startNode.data.replicationAnalysisNodeId) continue;
      workflowContextIds.add(source.id);
      for (const edge of allEdges) {
        if (edge.target === source.id && !edge.targetHandle && edge.source !== startNode.id) pending.push(edge.source);
      }
    }
  }
  if (startNode?.data.nodeKind === "replication-analysis") {
    for (const node of allNodes) {
      if (node.data.replicationAnalysisNodeId === startNode.id
        && !node.data.replicationScopeStale
        && (node.data.nodeKind === "replication-scope" || node.data.nodeKind === "replication-section")) {
        workflowContextIds.add(node.id);
      }
    }
  }
  const selectedNodes = allNodes.filter((node) => !node.data.replicationScopeStale
    && (nodeIds.ids.has(node.id) || workflowContextIds.has(node.id)));
  const includedTaskIds = new Set(selectedNodes.filter(isTaskNode).map((node) => node.id));
  const depthOutputIds = depthOutputVideoIds(allNodes, allEdges);

  // Media directly connected (no field handle) to any selected task.
  const linkedReferenceIds = new Set(allEdges
    .filter((edge) => includedTaskIds.has(edge.target) && !edge.targetHandle)
    .map((edge) => edge.source)
    .filter((sourceId) => {
      const source = allNodes.find((node) => node.id === sourceId);
      if (!isMediaReferenceNode(source)) return false;
      if (source?.data.nodeKind !== "video-reference" || depthOutputIds.has(sourceId)) return true;
      const isConnectedToScopedVideoGenerator = allEdges.some((edge) => {
        if (edge.source !== sourceId || edge.targetHandle || !includedTaskIds.has(edge.target)) return false;
        const target = allNodes.find((node) => node.id === edge.target);
        return target?.data.nodeKind === "pixverse-generation" && target.data.replicationMode === "video";
      });
      return !isConnectedToScopedVideoGenerator;
    }));

  // Only depth-conversion nodes whose output video is actually connected to a
  // selected task. Unrelated depth nodes (and their target videos) stay out
  // of this run's context entirely.
  const linkedDepthOutputIds = new Set([...linkedReferenceIds].filter((nodeId) => depthOutputIds.has(nodeId)));
  const depthNodeByOutputId = new Map<string, string>();
  for (const node of allNodes) {
    if (node.data.nodeKind !== "depth-conversion") continue;
    if (node.data.depthOutputNodeId) depthNodeByOutputId.set(node.data.depthOutputNodeId, node.id);
  }
  for (const edge of allEdges) {
    const source = allNodes.find((node) => node.id === edge.source);
    const target = allNodes.find((node) => node.id === edge.target);
    if (source?.data.nodeKind === "depth-conversion" && target?.data.nodeKind === "video-reference") {
      if (!depthNodeByOutputId.has(edge.target)) depthNodeByOutputId.set(edge.target, edge.source);
    }
  }
  const relevantDepthConversionIds = new Set<string>();
  for (const outputId of linkedDepthOutputIds) {
    const depthId = depthNodeByOutputId.get(outputId);
    if (depthId) relevantDepthConversionIds.add(depthId);
  }

  // Analysis-source videos are scoped to analysis/comparison tasks and never
  // acquire generation aliases merely because they flow into a prompt review.
  const analysisSourceIdsByTask = new Map<string, Set<string>>();
  const scopedAnalysisSourceIds = new Set<string>();
  for (const edge of allEdges) {
    if (!relevantDepthConversionIds.has(edge.target)) continue;
    const source = allNodes.find((node) => node.id === edge.source);
    if (source?.data.nodeKind !== "video-reference") continue;
    scopedAnalysisSourceIds.add(edge.source);
    // Which selected tasks consume this depth node's output?
    const outputIds = [...linkedDepthOutputIds].filter((outputId) => depthNodeByOutputId.get(outputId) === edge.target);
    for (const taskEdge of allEdges) {
      if (!includedTaskIds.has(taskEdge.target) || taskEdge.targetHandle) continue;
      if (outputIds.includes(taskEdge.source)) {
        let set = analysisSourceIdsByTask.get(taskEdge.target);
        if (!set) {
          set = new Set<string>();
          analysisSourceIdsByTask.set(taskEdge.target, set);
        }
        set.add(edge.source);
      }
    }
  }

  for (const taskId of includedTaskIds) {
    const task = allNodes.find((node) => node.id === taskId);
    if (task?.data.nodeKind !== "replication-analysis" && task?.data.nodeKind !== "replication-comparison") continue;
    for (const edge of allEdges) {
      if (edge.target !== taskId || edge.targetHandle) continue;
      const source = allNodes.find((node) => node.id === edge.source);
      if (source?.data.nodeKind !== "video-reference") continue;
      let set = analysisSourceIdsByTask.get(taskId);
      if (!set) {
        set = new Set<string>();
        analysisSourceIdsByTask.set(taskId, set);
      }
      set.add(source.id);
    }
  }

  // A Seedance node receives confirmed prompt text inline below. Its upstream
  // prompt-analysis video is intentionally not added as a generation reference.
  for (const taskId of includedTaskIds) {
    const task = allNodes.find((node) => node.id === taskId);
    if (task?.data.nodeKind !== "generic-prompt") continue;
    for (const edge of allEdges) {
      if (edge.target !== taskId || edge.targetHandle) continue;
      const source = allNodes.find((node) => node.id === edge.source);
      if (source?.data.nodeKind === "video-reference" && !depthOutputIds.has(source.id)) {
        let set = analysisSourceIdsByTask.get(taskId);
        if (!set) {
          set = new Set<string>();
          analysisSourceIdsByTask.set(taskId, set);
        }
        set.add(source.id);
      }
    }
  }

  const protectedTargetVideoIds = targetAnalysisVideoIds(allNodes, allEdges);
  for (const taskId of includedTaskIds) {
    const task = allNodes.find((node) => node.id === taskId);
    if (task?.data.nodeKind !== "pixverse-generation") continue;
    for (const edge of allEdges) {
      if (edge.target !== taskId || edge.targetHandle || !protectedTargetVideoIds.has(edge.source)) continue;
      let set = analysisSourceIdsByTask.get(taskId);
      if (!set) {
        set = new Set<string>();
        analysisSourceIdsByTask.set(taskId, set);
      }
      set.add(edge.source);
    }
  }

  const referenceContextIds = new Set([...linkedReferenceIds, ...relevantDepthConversionIds, ...scopedAnalysisSourceIds]);
  const selectedWithReferences = allNodes.filter((node) => nodeIds.ids.has(node.id) || workflowContextIds.has(node.id) || referenceContextIds.has(node.id));
  const flowOrder = startNode ? sortFlow(selectedWithReferences, allEdges, startNode.id) : selectedWithReferences;
  const referenceContextNodes = allNodes.filter((node) => referenceContextIds.has(node.id) && !nodeIds.ids.has(node.id));
  const referenceContextNodeIds = new Set(referenceContextNodes.map((node) => node.id));
  const orderedNodes = startNode
    ? [...referenceContextNodes, ...flowOrder.filter((node) => !referenceContextNodeIds.has(node.id))]
    : selectedWithReferences;
  const selectedIds = new Set(orderedNodes.map((node) => node.id));
  const selectedEdges = allEdges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const aggregateAnalysisOutputIds = new Set<string>();
  const categoryAnalysisOutputIds = new Map<string, Set<string>>();
  for (const edge of selectedEdges) {
    if (allNodes.find((node) => node.id === edge.source)?.data.nodeKind !== "replication-analysis") continue;
    if (!edge.sourceHandle?.startsWith("category:")) {
      aggregateAnalysisOutputIds.add(edge.source);
      continue;
    }
    let categoryIds = categoryAnalysisOutputIds.get(edge.source);
    if (!categoryIds) {
      categoryIds = new Set<string>();
      categoryAnalysisOutputIds.set(edge.source, categoryIds);
    }
    categoryIds.add(edge.sourceHandle.slice("category:".length));
  }

  // Per-task reference maps: each task owns its own aliases, order, purpose
  // and its own analysis-source set.
  const taskReferencesByNodeId = new Map<string, TaskReferenceItem[]>();
  for (const node of orderedNodes) {
    if (!isTaskNode(node)) continue;
    const taskAnalysisIds = analysisSourceIdsByTask.get(node.id) ?? new Set<string>();
    taskReferencesByNodeId.set(node.id, taskReferenceList(node, allNodes, allEdges, depthOutputIds, taskAnalysisIds));
  }

  const aliasForEdge = (edge: ScatterEdge): string | null => {
    const target = allNodes.find((node) => node.id === edge.target);
    if (!target || !isTaskNode(target)) return null;
    const items = taskReferencesByNodeId.get(target.id);
    if (!items) return null;
    const item = items.find((entry) => entry.node.id === edge.source);
    if (!item || item.isAnalysisSource) return null;
    return item.alias || null;
  };

  const attachments = orderedNodes.flatMap((node) => node.data.attachments);
  const imagePaths = attachments.filter((attachment) => attachment.kind === "image").map((attachment) => attachment.storedPath);
  const planMode = startNode?.data.planMode || false;
  const title = startNode?.data.title?.trim() || projectName || "Scatter Flow";
  const modeLabel = runMode === "flow" ? text.runModeFlow : text.runModeNode;
  const selectedSkills = [...new Set(orderedNodes.flatMap((node) => (node.data.skills || []).map((name) => name.replace(/^\$+/, "").trim()).filter(Boolean)))];
  const skillPreamble = selectedSkills.length
    ? `## ${text.skills}\n${selectedSkills.map((name) => `$${name}`).join("\n")}\n\n${text.skillScopeNotice}\n\n`
    : "";

  const connectionMap = selectedEdges.length
    ? selectedEdges
        .map((edge) => {
          const source = allNodes.find((node) => node.id === edge.source);
          const target = allNodes.find((node) => node.id === edge.target);
          const handle = edge.targetHandle || edge.sourceHandle;
          const alias = aliasForEdge(edge);
          const targetItems = target ? taskReferencesByNodeId.get(target.id) : undefined;
          const item = targetItems?.find((entry) => entry.node.id === edge.source);
          const analysisLabel = item?.isAnalysisSource
            ? (item.manualAnalysisOnly ? text.manualAnalysisSource : text.targetVideoAnalysisSource)
            : null;
          const connectionLabel = alias
            ? ` [参考素材 ${alias}]`
            : analysisLabel
              ? ` [${analysisLabel}]`
              : handle ? ` [${handle}]` : "";
          return `- ${source?.data.title || edge.source} -> ${target?.data.title || edge.target}${connectionLabel}`;
        })
        .join("\n")
    : text.noConnections;

  const upstreamPromptByNodeId = new Map<string, string>();
  for (const edge of allEdges) {
    if (!includedTaskIds.has(edge.target) || edge.targetHandle) continue;
    const target = allNodes.find((node) => node.id === edge.target);
    const source = allNodes.find((node) => node.id === edge.source);
    if (target?.data.nodeKind === "seedance-generation" && source?.data.nodeKind === "generic-prompt") {
      upstreamPromptByNodeId.set(target.id, source.data.genericPromptText || "");
    }
  }

  const analysisMediaKinds = allEdges
    .filter((edge) => edge.target === startNode?.id && !edge.targetHandle)
    .map((edge) => allNodes.find((node) => node.id === edge.source)?.data.nodeKind);
  const replicationMode = startNode?.data.replicationMode
    || (analysisMediaKinds.includes("image-reference") ? "photo" : "video");
  const markdown = `# ${text.taskTitle}: ${title}

${text.project}: ${projectName}
${text.projectPath}: \`${projectPath}\`
${text.runMode}: ${modeLabel}
${text.planModeRequested}: ${planMode ? text.planModeRequestedYes : text.planModeRequestedNo}

${skillPreamble}
${nodeIds.hasCycle ? text.warningCycle : ""}## ${text.executionRequest}
${text.executionRequestBody}

## ${text.includedNodes}
${orderedNodes.map((node, index) => {
  const categoryIds = node.data.nodeKind === "replication-analysis"
    && node.id !== startNode?.id
    && !aggregateAnalysisOutputIds.has(node.id)
    ? categoryAnalysisOutputIds.get(node.id)
    : undefined;
  return nodeBlock(node, index, text, taskReferencesByNodeId.get(node.id) ?? [], upstreamPromptByNodeId.get(node.id) || "", categoryIds);
}).join("\n\n")}

## ${text.connectionMap}
${connectionMap}

## ${text.allAttachments}
${attachments.length ? attachments.map((attachment) => attachmentLine(attachment, text)).join("\n") : text.none}
${promptOutputPath ? `\n## ${text.genericPromptOutput}\n${startNode?.data.nodeKind === "replication-analysis"
    ? text.replicationAnalysisWriteInstruction(promptOutputPath, replicationMode)
    : startNode?.data.nodeKind === "replication-comparison"
      ? text.replicationComparisonWriteInstruction(promptOutputPath)
      : text.genericPromptWriteInstruction(promptOutputPath, startNode?.data.replicationMode)}\n` : ""}
`;

  return {
    markdown,
    nodes: orderedNodes,
    attachments,
    imagePaths,
    planMode,
    hasCycle: nodeIds.hasCycle
  };
}

export function childCount(nodeId: string, edges: ScatterEdge[]): number {
  return downstreamNodeIds(nodeId, edges).ids.size - 1;
}
