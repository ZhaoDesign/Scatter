import type { ScatterEdge, ScatterNode, TaskReferenceAssignment } from "../../../shared/types";

/** Alias must be `@图<digits>` for images or `@视频<digits>` for videos. */
const ALIAS_PATTERN = /^@(图|视频)\d+$/;

export function isValidAlias(alias: string, kind: "image" | "video"): boolean {
  if (!ALIAS_PATTERN.test(alias)) return false;
  return kind === "image" ? alias.startsWith("@图") : alias.startsWith("@视频");
}

export function aliasKind(alias: string): "image" | "video" | null {
  if (!ALIAS_PATTERN.test(alias)) return null;
  return alias.startsWith("@图") ? "image" : "video";
}

export function aliasNumber(alias: string): number {
  const match = /^@(?:图|视频)(\d+)$/.exec(alias);
  return match ? Number(match[1]) : 0;
}

/** The depth-conversion output video nodes across the whole graph. */
export function depthOutputVideoIds(nodes: ScatterNode[], edges: ScatterEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.data.nodeKind !== "depth-conversion") continue;
    if (node.data.depthOutputNodeId) ids.add(node.data.depthOutputNodeId);
  }
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (source?.data.nodeKind === "depth-conversion" && target?.data.nodeKind === "video-reference") {
      ids.add(edge.target);
    }
  }
  return ids;
}

/** Video-reference nodes that feed a depth conversion (analysis source, never numbered). */
export function analysisSourceVideoIds(nodes: ScatterNode[], edges: ScatterEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    const target = nodes.find((node) => node.id === edge.target);
    const source = nodes.find((node) => node.id === edge.source);
    if (target?.data.nodeKind === "depth-conversion" && source?.data.nodeKind === "video-reference") {
      ids.add(edge.source);
    }
  }
  return ids;
}

/** Target videos that are wired to an analysis or comparison stage are never generation references. */
export function targetAnalysisVideoIds(nodes: ScatterNode[], edges: ScatterEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.targetHandle) continue;
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (source?.data.nodeKind === "video-reference"
      && (target?.data.nodeKind === "replication-analysis" || target?.data.nodeKind === "replication-comparison")) {
      ids.add(source.id);
    }
  }
  return ids;
}

export function isMediaNode(node: ScatterNode | undefined): boolean {
  return Boolean(node && (node.data.nodeKind === "image-reference" || node.data.nodeKind === "video-reference"));
}

export function mediaKindOf(node: ScatterNode): "image" | "video" {
  return node.data.nodeKind === "image-reference" ? "image" : "video";
}

/**
 * Keep media connected to reverse-analysis/comparison nodes out of generation
 * inputs. This covers target photos as well as target videos; only an explicitly
 * connected depth-video output may pass through as a generation reference.
 */
export function canUseGenerationMedia(
  assignment: TaskReferenceAssignment | undefined,
  isVideo: boolean,
  isAnalysisSource: boolean,
  isDepthOutput: boolean,
  requireDepthVideo = false
): boolean {
  if (assignment?.analysisOnly) return false;
  if (isAnalysisSource && !isDepthOutput) return false;
  if (isVideo && requireDepthVideo && !isDepthOutput) return false;
  return true;
}

export function isReplicationPipelineCompatible(
  sourceMode: "photo" | "video" | undefined,
  targetMode: "photo" | "video" | undefined,
  sourceAnalysisId?: string,
  targetAnalysisId?: string
): boolean {
  if (sourceMode && targetMode && sourceMode !== targetMode) return false;
  return !(sourceAnalysisId && targetAnalysisId && sourceAnalysisId !== targetAnalysisId);
}

/** A scoped generator must consume the exact editable prompt from its analysis loop. */
export function isReplicationPromptCompatible(
  sourceMode: "photo" | "video" | undefined,
  targetMode: "photo" | "video" | undefined,
  sourceAnalysisId?: string,
  targetAnalysisId?: string
): boolean {
  if (!isReplicationPipelineCompatible(sourceMode, targetMode, sourceAnalysisId, targetAnalysisId)) return false;
  return !targetAnalysisId || sourceAnalysisId === targetAnalysisId;
}

/** Directly connected media nodes targeting this task (no field handle). */
export function connectedMediaForTask(nodes: ScatterNode[], edges: ScatterEdge[], taskId: string): ScatterNode[] {
  return edges
    .filter((edge) => edge.target === taskId && !edge.targetHandle)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is ScatterNode => Boolean(node && isMediaNode(node)));
}

/**
 * For a given task, return the set of video-reference node ids that are
 * topology-derived analysis sources: they feed a depth-conversion node whose
 * OUTPUT video is directly consumed by this task. Other tasks are unaffected.
 */
export function autoAnalysisSourceIdsForTask(
  nodes: ScatterNode[],
  edges: ScatterEdge[],
  taskId: string
): Set<string> {
  const result = new Set<string>();
  const depthOutputIds = depthOutputVideoIds(nodes, edges);

  const taskKind = nodes.find((node) => node.id === taskId)?.data.nodeKind;

  // Generic prompt nodes use connected videos to analyze the source clip. They
  // are not generation-time @视频 references; the depth result is attached
  // later to the generation node and receives @视频1 there.
  if (taskKind === "generic-prompt") {
    for (const edge of edges) {
      if (edge.target !== taskId || edge.targetHandle) continue;
      const source = nodes.find((node) => node.id === edge.source);
      if (source?.data.nodeKind === "video-reference" && !depthOutputIds.has(source.id)) result.add(source.id);
    }
    return result;
  }

  // In a PixVerse generation node, a source video that is also wired into the
  // replication-analysis/comparison branch remains analysis-only by default.
  // The user may explicitly promote it to a generation reference in that
  // PixVerse node; depth outputs remain eligible as generation inputs.
  if (taskKind === "pixverse-generation") {
    const analysisVideoIds = new Set(edges
      .filter((edge) => {
        if (edge.targetHandle) return false;
        const target = nodes.find((node) => node.id === edge.target);
        return target?.data.nodeKind === "replication-analysis" || target?.data.nodeKind === "replication-comparison";
      })
      .map((edge) => edge.source));
    for (const edge of edges) {
      if (edge.target !== taskId || edge.targetHandle) continue;
      const source = nodes.find((node) => node.id === edge.source);
      if (source?.data.nodeKind === "video-reference" && analysisVideoIds.has(source.id) && !depthOutputIds.has(source.id)) {
        result.add(source.id);
      }
    }
    return result;
  }

  // Depth output videos directly connected into this task.
  const consumedOutputIds = new Set(
    edges
      .filter((edge) => edge.target === taskId && !edge.targetHandle)
      .map((edge) => edge.source)
      .filter((id) => depthOutputVideoIds(nodes, edges).has(id))
  );
  if (!consumedOutputIds.size) return result;

  // Map each depth output id back to the depth-conversion node that produced it.
  const depthNodeByOutputId = new Map<string, string>();
  for (const node of nodes) {
    if (node.data.nodeKind !== "depth-conversion") continue;
    if (node.data.depthOutputNodeId) depthNodeByOutputId.set(node.data.depthOutputNodeId, node.id);
  }
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (source?.data.nodeKind === "depth-conversion" && target?.data.nodeKind === "video-reference") {
      if (!depthNodeByOutputId.has(edge.target)) depthNodeByOutputId.set(edge.target, edge.source);
    }
  }

  const depthIds = new Set<string>();
  for (const outputId of consumedOutputIds) {
    const depthId = depthNodeByOutputId.get(outputId);
    if (depthId) depthIds.add(depthId);
  }
  if (!depthIds.size) return result;

  // Input videos to those depth-conversion nodes.
  for (const edge of edges) {
    if (!depthIds.has(edge.target)) continue;
    const source = nodes.find((node) => node.id === edge.source);
    if (source?.data.nodeKind === "video-reference") result.add(edge.source);
  }
  return result;
}

function usedNumbers(assignments: Record<string, TaskReferenceAssignment>, kind: "image" | "video"): Set<number> {
  const used = new Set<number>();
  for (const assignment of Object.values(assignments)) {
    if (assignment.kind !== kind) continue;
    if (assignment.analysisOnly) continue;
    if (!ALIAS_PATTERN.test(assignment.alias)) continue;
    used.add(aliasNumber(assignment.alias));
  }
  return used;
}

function nextFreeNumber(used: Set<number>): number {
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/**
 * Build the default alias for a newly connected material within a task.
 * Depth-output videos prefer `@视频1` when no video slot is taken yet.
 * Analysis-only images and videos get no alias.
 */
export function defaultAliasFor(
  assignments: Record<string, TaskReferenceAssignment>,
  kind: "image" | "video",
  isDepthOutput: boolean,
  analysisOnly = false
): string {
  if (analysisOnly) return "";
  const used = usedNumbers(assignments, kind);
  if (kind === "video" && isDepthOutput && !used.has(1)) {
    return "@视频1";
  }
  const number = nextFreeNumber(used);
  return kind === "image" ? `@图${number}` : `@视频${number}`;
}

export interface NormalizedTaskResult {
  assignments: Record<string, TaskReferenceAssignment> | undefined;
  /** Updated task body with cleared alias tokens removed; unchanged body otherwise. */
  body: string | undefined;
}

/**
 * Apply a manual role choice within one task. Clearing a role also clears its
 * exact body tokens; restoring it allocates a free slot without renumbering
 * other records or inserting tokens. Selecting the current auto role pins it.
 */
export function updateTaskReferenceRole(
  assignments: Record<string, TaskReferenceAssignment>,
  body: string,
  mediaNodeId: string,
  analysisOnly: boolean,
  isDepthOutput = false
): NormalizedTaskResult {
  const record = assignments[mediaNodeId];
  if (!record) return { assignments, body: undefined };

  const otherAssignments = Object.fromEntries(Object.entries(assignments).filter(([id]) => id !== mediaNodeId));
  const alias = analysisOnly
    ? ""
    : !record.analysisOnly && isValidAlias(record.alias, record.kind)
      ? record.alias
      : defaultAliasFor(otherAssignments, record.kind, isDepthOutput);
  if (record.analysisOnly === analysisOnly && record.analysisOnlyManual === true && record.alias === alias) {
    return { assignments, body: undefined };
  }
  const nextBody = analysisOnly && record.alias ? replaceAliasInBody(body, record.alias, "") : body;
  return {
    assignments: {
      ...assignments,
      [mediaNodeId]: { ...record, alias, analysisOnly, analysisOnlyManual: true }
    },
    body: nextBody === body ? undefined : nextBody
  };
}

/**
 * Normalize a task's reference assignments against its currently connected media:
 *  - prune records whose material node is gone or no longer connected;
 *  - seed a stable default record for connected media that lacks one;
 *  - derive the auto analysis-only role from topology (this task consumes the
 *    depth output this video feeds), but never overwrite an explicit user choice
 *    (`analysisOnlyManual`). Auto role may flip when topology changes; manual
 *    choice sticks.
 *
 * When a previously numbered video is flipped to analysis-only by topology, its
 * old alias token is removed from the task body in the same pass so the token
 * cannot collide with a depth output that later takes that number. Flipping
 * back to numbered never inserts tokens into the body.
 */
export function normalizeTaskAssignments(
  taskNode: ScatterNode,
  nodes: ScatterNode[],
  edges: ScatterEdge[],
  depthOutputIds: Set<string>
): NormalizedTaskResult {
  const existing = taskNode.data.referenceAssignments;
  const connected = connectedMediaForTask(nodes, edges, taskNode.id);
  const connectedIds = new Set(connected.map((node) => node.id));
  const autoAnalysisIds = autoAnalysisSourceIdsForTask(nodes, edges, taskNode.id);
  const originalBody = taskNode.data.body ?? "";

  let changed = false;
  const next: Record<string, TaskReferenceAssignment> = {};
  const clearedAliases: string[] = [];

  // Video numbers already held by records that remain CONNECTED after this
  // normalization. Built only from connected records so a video being restored
  // in the same pass never waits for a number that a simultaneously-disconnected
  // record is about to free (order-independence). A pruned record no longer
  // holds its number at all.
  const preservedUsed = new Set<number>();
  if (existing) {
    for (const [id, assignment] of Object.entries(existing)) {
      if (!connectedIds.has(id)) continue;
      if (assignment.kind !== "video" || assignment.analysisOnly) continue;
      if (!ALIAS_PATTERN.test(assignment.alias)) continue;
      preservedUsed.add(aliasNumber(assignment.alias));
    }
  }

  const pickRestoredAlias = (mediaId: string): string => {
    const isDepthOutput = depthOutputIds.has(mediaId);
    if (isDepthOutput && !preservedUsed.has(1)) return "@视频1";
    return `@视频${nextFreeNumber(preservedUsed)}`;
  };

  const syncRole = (mediaId: string, assignment: TaskReferenceAssignment): TaskReferenceAssignment => {
    // Images have no topology-derived role. Persisted image choices and manual
    // video choices survive normalization, but an analysis source has no alias.
    if (assignment.kind === "image" || assignment.analysisOnlyManual !== undefined) {
      if (assignment.analysisOnly && assignment.alias) {
        changed = true;
        clearedAliases.push(assignment.alias);
        return { ...assignment, alias: "" };
      }
      return assignment;
    }
    const auto = autoAnalysisIds.has(mediaId);
    if (auto && !assignment.analysisOnly) {
      changed = true;
      if (assignment.alias) {
        clearedAliases.push(assignment.alias);
        preservedUsed.delete(aliasNumber(assignment.alias));
      }
      return { ...assignment, analysisOnly: true, alias: "" };
    }
    if (!auto && assignment.analysisOnly) {
      changed = true;
      const alias = pickRestoredAlias(mediaId);
      preservedUsed.add(aliasNumber(alias));
      return { ...assignment, analysisOnly: false, alias };
    }
    return assignment;
  };

  if (existing) {
    for (const [mediaId, assignment] of Object.entries(existing)) {
      if (!connectedIds.has(mediaId)) {
        changed = true;
        // Drop the disconnected material's old alias token from the body so an
        // orphaned @图N/@视频N cannot later be mistaken for a newly connected
        // material reusing that number.
        if (assignment.alias) clearedAliases.push(assignment.alias);
        continue;
      }
      next[mediaId] = syncRole(mediaId, assignment);
    }
  }

  let maxOrder = Object.values(next).reduce((max, assignment) => Math.max(max, assignment.order ?? 0), 0);

  for (const mediaNode of connected) {
    if (next[mediaNode.id]) continue;
    const kind = mediaKindOf(mediaNode);
    const auto = kind === "video" && autoAnalysisIds.has(mediaNode.id);
    const alias = kind === "video" && auto
      ? ""
      : defaultAliasFor(next, kind, depthOutputIds.has(mediaNode.id));
    maxOrder += 1;
    next[mediaNode.id] = {
      kind,
      alias,
      purpose: "",
      order: maxOrder,
      ...(kind === "video" && auto ? { analysisOnly: true } : {})
    };
    changed = true;
  }

  if (!changed) return { assignments: existing ?? undefined, body: undefined };

  let body = originalBody;
  for (const alias of clearedAliases) {
    body = replaceAliasInBody(body, alias, "");
  }
  return {
    assignments: next,
    body: body === originalBody ? undefined : body
  };
}

/** Replace an exact alias token in body text without hitting `@图1` inside `@图10`. */
export function replaceAliasInBody(body: string, oldAlias: string, newAlias: string): string {
  if (!oldAlias || oldAlias === newAlias) return body;
  const escaped = oldAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The token must not be followed by another digit (prevents @图1 -> @图10 collision).
  const pattern = new RegExp(escaped + "(?!\\d)", "g");
  return body.replace(pattern, newAlias);
}
