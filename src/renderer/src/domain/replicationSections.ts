import type { ReplicationMode } from "../../../shared/types";

export interface ReplicationSectionSpec {
  id: string;
  title: string;
  focus: string;
}

export type ReplicationScopeKind = "photo" | "video" | "role" | "segment";

export interface ReplicationScopeAnalysis {
  key: string;
  kind: ReplicationScopeKind;
  name: string;
  timeRange: string;
  categories: Map<string, string>;
}

const VIDEO_TIME_RANGE_PATTERN = /^(\d+):([0-5]\d)\.(\d{3})\s*[–—-]\s*(\d+):([0-5]\d)\.(\d{3})$/;

export function parseReplicationTimeRange(value: string): { startMs: number; endMs: number } | null {
  const match = VIDEO_TIME_RANGE_PATTERN.exec(value.trim());
  if (!match) return null;
  const toMs = (minutes: string, seconds: string, milliseconds: string) =>
    Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(milliseconds);
  const startMs = toMs(match[1], match[2], match[3]);
  const endMs = toMs(match[4], match[5], match[6]);
  return endMs > startMs ? { startMs, endMs } : null;
}

/** Video segments must cover continuously from 00:00.000 without overlap or missing timecodes. */
export function hasContinuousVideoSegmentCoverage(scopes: ReplicationScopeAnalysis[], durationMs?: number): boolean {
  if (!Number.isFinite(durationMs) || Number(durationMs) <= 0) return false;
  const segments = scopes.filter((scope) => scope.kind === "segment");
  if (!segments.length) return false;
  const ranges = segments.map((segment) => parseReplicationTimeRange(segment.timeRange));
  if (ranges.some((range) => !range)) return false;
  const ordered = ranges
    .filter((range): range is NonNullable<typeof range> => Boolean(range))
    .sort((a, b) => a.startMs - b.startMs);
  if (ordered[0].startMs > 1) return false;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.startMs < previous.endMs - 1 || current.startMs > previous.endMs + 1) return false;
  }
  if (Math.abs(ordered.at(-1)!.endMs - Number(durationMs)) > 2) return false;
  return true;
}

function mergeScopeCategories(target: ReplicationScopeAnalysis, source: ReplicationScopeAnalysis): void {
  for (const [categoryId, content] of source.categories) {
    const previous = target.categories.get(categoryId)?.trim();
    const next = content.trim();
    if (!next || previous === next) continue;
    target.categories.set(categoryId, previous ? `${previous}\n${next}` : next);
  }
}

/** Keep only scopes for one recreation mode, enforce a single video-global group, and make keys unique. */
export function normalizeReplicationScopes(scopes: ReplicationScopeAnalysis[], mode: ReplicationMode): ReplicationScopeAnalysis[] {
  const accepted = scopes.filter((scope) => mode === "photo"
    ? scope.kind === "photo" || scope.kind === "role"
    : scope.kind === "video" || scope.kind === "role" || scope.kind === "segment");
  const result: ReplicationScopeAnalysis[] = [];
  const keyCounts = new Map<string, number>();
  for (const scope of accepted) {
    if (scope.kind === "video") {
      const existingGlobal = result.find((candidate) => candidate.kind === "video");
      if (existingGlobal) {
        mergeScopeCategories(existingGlobal, scope);
        continue;
      }
    }
    // Photo mode only: repeated overall photo groups collapse into the first
    // one, and role groups merge only when the stable key matches. Distinct
    // characters keep separate keys, so similar names never merge.
    if (mode === "photo" && scope.kind === "photo") {
      const existingPhoto = result.find((candidate) => candidate.kind === "photo");
      if (existingPhoto) {
        mergeScopeCategories(existingPhoto, scope);
        continue;
      }
    }
    if (mode === "photo" && scope.kind === "role") {
      const baseKey = scope.key.trim();
      if (baseKey) {
        const existingRole = result.find((candidate) => candidate.kind === "role" && candidate.key === baseKey);
        if (existingRole) {
          mergeScopeCategories(existingRole, scope);
          continue;
        }
      }
    }
    const baseKey = scope.key.trim() || `${scope.kind}-${result.length + 1}`;
    const occurrence = (keyCounts.get(baseKey) || 0) + 1;
    keyCounts.set(baseKey, occurrence);
    result.push({ ...scope, key: occurrence === 1 ? baseKey : `${baseKey}-${occurrence}` });
  }
  return result;
}

export const replicationScopeSectionSpecs: Record<ReplicationScopeKind, ReplicationSectionSpec[]> = {
  // Photo overall scope owns frame-level facts only. Person attributes (face,
  // hair, wardrobe, physique, identity) live in role scopes so the same fact is
  // never written twice into the merged prompt.
  photo: [
    { id: "subject", title: "主体数量与画面位置", focus: "只记主体数量、各自画面位置与比例、裁切与前后遮挡关系；不写五官、发型、服装、体态或身份特征，画幅景别机位与景深归构图分类" },
    { id: "pose", title: "姿态、表情与手势编排", focus: "本图人物姿态、重心、手脚位置、手势、视线、表情和朝向的唯一记录处；多人时逐人分行各写一次，角色分类组不再复述" },
    { id: "composition", title: "画幅、景别与机位", focus: "只记画幅比例、景别、机位高度与方向、留白、焦点和景深；主体数量、位置比例、裁切与遮挡归主体分类" },
    { id: "scene", title: "场景与背景", focus: "地点、前中后景、空间纵深和背景布局" },
    { id: "lighting", title: "光线与色彩", focus: "光源方向、明暗、阴影、色温、主辅色和整体色调" },
    { id: "props", title: "全局道具与画面文字", focus: "场景内道具的数量、位置、材质、状态、接触关系及可读文字/标志；人物服装、鞋履与随身配饰归角色分类组" },
    { id: "style", title: "风格与成像质感", focus: "摄影风格、真实度、纹理、颗粒、锐度和后期处理" }
  ],
  video: [
    { id: "basic", title: "基础信息与画面制式", focus: "记录总时长、画幅比例、分辨率、帧率、彩色/黑白/单色调、单镜头或多镜头；无法从画面确认的元数据标待确认" },
    { id: "global-continuity", title: "全片场景与空间连续性", focus: "记录全片持续的地点、时间天气、前中后景、空间纵深和场景切换；标清跨时间段保持不变的空间轴线" },
    { id: "soundtrack", title: "全片声音结构", focus: "记录是否有声音、对白/环境声/音乐的整体结构、贯穿全片的声音及其大致节奏；逐段同步点放在时间段分类中" }
  ],
  // Role scopes own per-character stable facts only. Pose, expression and
  // gesture are written once: photo mode in the overall scope's pose category,
  // video mode in the matching segment scope.
  role: [
    { id: "identity", title: "稳定身份连续性", focus: "只记录可跨画面核验、且不属于五官发型服装体型的身份连续性锚点（如年龄感、性别表现、肤色与可见的惯常状态）；不复述身形比例、五官发型、服装配饰、姿态、表情、手势和站位" },
    { id: "face-hair", title: "五官、发型与妆容", focus: "只记录可见五官、发型发色和妆容；不臆测身份，不写表情，眼镜归服装配饰分类" },
    { id: "wardrobe", title: "服装、鞋履与配饰", focus: "只记录该角色穿着的服装款式、版型、颜色、材质、鞋履，以及眼镜、首饰等佩戴配饰；不复述道具持握和姿势" },
    { id: "body", title: "体型比例与轮廓", focus: "只记录相对稳定的体型、身高比例和轮廓量感；不复述当前姿态、动作、手势，也不重复五官发型与服装" },
    { id: "distinguishing-cues", title: "其他区分特征", focus: "只保留疤、痣、纹身等尚未归入其他分类的稳定可见特征；眼镜、发型、服装、体型和身份连续性特征不要在此重复" }
  ],
  segment: [
    { id: "state", title: "起始与结束状态", focus: "本段开头/结尾的人物和道具位置、画面占比、前后关系与姿态；角色稳定外观以角色组为准" },
    { id: "action", title: "动作阶段与轨迹", focus: "准备→发力→运动→接触/完成→停留，写清方向和因果" },
    { id: "interaction", title: "人物与物体互动", focus: "参与角色、道具、接触点、施力方向和互动结果" },
    { id: "camera", title: "镜头与构图", focus: "景别、机位、视角、主体构图及镜头运动" },
    { id: "environment", title: "场景与空间关系", focus: "前中后景、相对位置、空间纵深及持续动态元素" },
    { id: "props-effects", title: "道具与特效", focus: "状态变化、出现时刻、运动方向、碰撞遮挡与最终停留" },
    { id: "lighting-color", title: "光线与色彩", focus: "光源、阴影、色彩、曝光及本段变化" },
    { id: "sound-edit", title: "声音、剪辑与转场", focus: "对白/环境声/音乐同步点、切镜时间、转场及动作连续性" }
  ]
};

export const replicationSectionSpecs: Record<ReplicationMode, ReplicationSectionSpec[]> = {
  photo: [
    { id: "subject", title: "主体数量与画面位置", focus: "只记主体数量、各自画面位置与比例、裁切和遮挡关系；模板人物与用户身份参考在此区分；人物五官、发型、服装与配饰写入外观分类，画幅景别机位与景深归构图分类" },
    { id: "appearance", title: "角色五官发型与服装配饰", focus: "按人物逐人分两段写：先写五官、发型发色与妆容（眼镜归服装配饰），再写服装鞋履与眼镜首饰等佩戴配饰；不写姿态、表情和体型，明确哪些需要由用户自拍替换" },
    { id: "pose", title: "姿态、动作与表情", focus: "身体姿态、手脚位置、重心、手势、视线、表情和人物朝向的唯一记录处；多人时逐人分行，角色分类不再复述" },
    { id: "composition", title: "构图、景别与镜头", focus: "只记画幅比例、景别、机位高度与方向、留白、焦点和景深；主体数量、位置比例、裁切与遮挡归主体分类" },
    { id: "scene", title: "场景与背景", focus: "地点、前中后景、空间纵深、建筑/自然元素、背景布局和持续存在的细节" },
    { id: "lighting", title: "光线与色彩", focus: "主光方向、软硬、明暗、阴影、色温、主辅色和整体色调" },
    { id: "props", title: "道具、文字与细节", focus: "只记场景内道具的数量、位置、材质、状态、接触关系，以及可读文字/标志及其位置；人物服装鞋履与随身配饰写入外观分类，不在此重复" },
    { id: "style", title: "风格、材质与成像质感", focus: "摄影/渲染风格、真实度、纹理、颗粒、锐度、后期处理与禁止出现的界面元素" },
    { id: "references", title: "参考素材职责与约束", focus: "判断需要用户补充哪些参考图；逐项说明每张图负责主体布局、外观、服装配饰、构图场景、光线或道具中的哪些属性，以及明确排除项" }
  ],
  video: [
    { id: "basic", title: "基础信息", focus: "视频时长、画幅、分辨率、帧率、色彩、镜头数、声音/对白/音乐" },
    { id: "characters", title: "人物与连续性", focus: "人物数量、位置/大小/距离、身份一致性、五官发型、服装、姿态、表情视线、关系、遮挡与接触" },
    { id: "environment", title: "环境与场景", focus: "地点、时间天气、前中后景、空间纵深、持续动态元素和场景变化" },
    { id: "props", title: "道具与物体", focus: "名称数量、持有人、材质颜色大小、初始状态、运动/变化、接触点、最终位置、文字标志/UI" },
    { id: "actions", title: "人物动作", focus: "起始姿势、准备、发力方向、手脚细节、重心轨迹、头部视线表情、互动、完成后状态" },
    { id: "camera", title: "镜头与构图", focus: "景别、机位高度与方向、摄像机距离、固定/运动、推拉摇移跟拍环绕、手持感、主体位置、出框与焦点" },
    { id: "lighting", title: "光线与色彩", focus: "主光方向、光质色温、明暗变化、阴影、主辅色、特殊光源、曝光/光晕/颗粒" },
    { id: "effects", title: "特效与物理效果", focus: "特效种类、出现时间、来源、运动方向、影响范围、接触关系、残留状态、重力惯性碰撞和遮挡" },
    { id: "timeline", title: "时间轴与节奏", focus: "按准确时间段记录初始、准备、关键动作、结果反应和末帧；动作按准备→发力→运动→接触/完成→停留" },
    { id: "editing", title: "剪辑与转场", focus: "镜头切换时间、转场方式、转场前后主体/道具位置和动作方向连续性" },
    { id: "sound", title: "声音", focus: "环境声、对白、动作声、特效声、音乐节奏、画面同步点及声音保留策略" },
    { id: "references", title: "参考素材职责与约束", focus: "目标视频只作分析/对比；说明角色图、文字设定、可选深度视频各负责什么，禁止身份漂移/道具变形/乱切等" }
  ]
};

export function parseReplicationSections(content: string): { summary: string; sections: Map<string, string>; scopes: ReplicationScopeAnalysis[] } | null {
  const normalized = content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const value = JSON.parse(normalized) as { summary?: unknown; sections?: unknown; scopes?: unknown };
    if (!value || typeof value !== "object") return null;
    const sections = new Map<string, string>();
    if (Array.isArray(value.sections)) {
      for (const item of value.sections) {
        if (!item || typeof item !== "object") continue;
        const section = item as Record<string, unknown>;
        if (typeof section.id === "string" && typeof section.content === "string") sections.set(section.id, section.content.trim());
      }
    }
    const scopes: ReplicationScopeAnalysis[] = [];
    if (Array.isArray(value.scopes)) {
      for (const item of value.scopes) {
        if (!item || typeof item !== "object") continue;
        const scope = item as Record<string, unknown>;
        if (scope.kind !== "photo" && scope.kind !== "video" && scope.kind !== "role" && scope.kind !== "segment") continue;
        const categories = new Map<string, string>();
        if (Array.isArray(scope.categories)) {
          for (const categoryValue of scope.categories) {
            if (!categoryValue || typeof categoryValue !== "object") continue;
            const category = categoryValue as Record<string, unknown>;
            if (typeof category.id === "string" && typeof category.content === "string") categories.set(category.id, category.content.trim());
          }
        }
        scopes.push({
          key: typeof scope.key === "string" && scope.key.trim() ? scope.key.trim() : `${scope.kind}-${scopes.length + 1}`,
          kind: scope.kind,
          name: typeof scope.name === "string" && scope.name.trim() ? scope.name.trim() : `${scope.kind} ${scopes.length + 1}`,
          timeRange: typeof scope.timeRange === "string" ? scope.timeRange.trim() : "",
          categories
        });
      }
    }
    if (!sections.size && !scopes.length) return null;
    return {
      summary: typeof value.summary === "string" ? value.summary.trim() : "",
      sections,
      scopes
    };
  } catch {
    return null;
  }
}
