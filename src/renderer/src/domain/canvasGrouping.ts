/**
 * Figma-style canvas grouping / alignment / distribution / tidy-up / auto
 * layout. PURE DOMAIN: no React, no store, no edges. Group relations live in
 * `CanvasGroup[]` which is a third parallel structure alongside `nodes` and
 * `edges` — they never become workflow nodes, never create workflow edges and
 * never enter AI Markdown or the @图N/@视频N reference numbering.
 *
 * Section geometry is persisted in canvas coordinates. Legacy group records
 * without bounds still derive a temporary rectangle from member positions.
 */
import type { CanvasGroup, CanvasGroupLayout, CanvasGroupPadding, ScatterNode } from "../../../shared/types";

export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Returns rendered size of a node (React Flow measures nodes at runtime). */
export type BoundsOf = (node: ScatterNode) => { width: number; height: number };

export const GROUP_PADDING = 16;
export const GROUP_LAYOUT_GAP = 24;

export const defaultGroupPadding = (): CanvasGroupPadding => ({
  top: GROUP_PADDING,
  right: GROUP_PADDING,
  bottom: GROUP_PADDING,
  left: GROUP_PADDING
});

export const defaultGroupLayout = (axis: "horizontal" | "vertical" = "horizontal", childOrder: string[] = []): CanvasGroupLayout => ({
  axis,
  gap: GROUP_LAYOUT_GAP,
  padding: defaultGroupPadding(),
  alignment: "start",
  childOrder: [...childOrder]
});

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

export function nodeBox(node: ScatterNode, boundsOf: BoundsOf): CanvasBox {
  const { width, height } = boundsOf(node);
  return { x: node.position.x, y: node.position.y, width, height };
}

export function unionBox(boxes: CanvasBox[]): CanvasBox | null {
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function paddingFor(group: CanvasGroup): CanvasGroupPadding {
  return group.layout?.padding ?? defaultGroupPadding();
}

/** Box of one group, recursively including nested child groups, plus padding. */
export function groupFrameBox(
  group: CanvasGroup,
  nodes: ScatterNode[],
  groups: CanvasGroup[],
  boundsOf: BoundsOf
): CanvasBox | null {
  if (group.bounds
    && Number.isFinite(group.bounds.x)
    && Number.isFinite(group.bounds.y)
    && Number.isFinite(group.bounds.width)
    && Number.isFinite(group.bounds.height)) {
    return { ...group.bounds };
  }
  const boxes: CanvasBox[] = [];
  for (const nodeId of group.nodeIds) {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) boxes.push(nodeBox(node, boundsOf));
  }
  for (const childId of group.childGroupIds) {
    const child = groups.find((g) => g.id === childId);
    if (child) {
      const childBox = groupFrameBox(child, nodes, groups, boundsOf);
      if (childBox) boxes.push(childBox);
    }
  }
  const inner = unionBox(boxes);
  if (!inner) return null;
  const pad = paddingFor(group);
  return {
    x: inner.x - pad.left,
    y: inner.y - pad.top,
    width: inner.width + pad.left + pad.right,
    height: inner.height + pad.top + pad.bottom
  };
}

/** All node ids belonging to a group, including nodes of nested child groups. */
export function collectGroupMemberIds(groupId: string, groups: CanvasGroup[]): string[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return [];
  const out = [...group.nodeIds];
  for (const childId of group.childGroupIds) {
    out.push(...collectGroupMemberIds(childId, groups));
  }
  return out;
}

export function collectGroupTreeIds(groupId: string, groups: CanvasGroup[]): string[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return [];
  return [group.id, ...group.childGroupIds.flatMap((childId) => collectGroupTreeIds(childId, groups))];
}

/** Assign moved nodes to the smallest section that fully contains their bounds. */
export function syncNodeGroupsToSections(
  nodeIds: string[],
  nodes: ScatterNode[],
  groups: CanvasGroup[],
  boundsOf: BoundsOf,
  referenceNodes: ScatterNode[] = nodes
): CanvasGroup[] {
  if (!nodeIds.length || !groups.length) return groups;
  const next = groups.map(cloneGroup);
  const rectangles = groups
    .map((group) => ({ group, box: groupFrameBox(group, referenceNodes, groups, boundsOf) }))
    .filter((entry): entry is { group: CanvasGroup; box: CanvasBox } => Boolean(entry.box));

  for (const nodeId of nodeIds) {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) continue;
    const box = nodeBox(node, boundsOf);
    const target = rectangles
      .filter(({ box: section }) => box.x >= section.x && box.y >= section.y
        && box.x + box.width <= section.x + section.width
        && box.y + box.height <= section.y + section.height)
      .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0]?.group;
    for (const group of next) group.nodeIds = group.nodeIds.filter((id) => id !== nodeId);
    if (target) {
      const destination = next.find((group) => group.id === target.id);
      if (destination) destination.nodeIds.push(nodeId);
    }
  }
  return next;
}

export interface RenderedGroup extends CanvasBox {
  id: string;
  name: string;
  depth: number;
  layout?: CanvasGroupLayout;
}

/** Flat, depth-sorted list of section rectangles and their canvas-space bounds. */
export function renderedGroupFrames(
  nodes: ScatterNode[],
  groups: CanvasGroup[],
  boundsOf: BoundsOf
): RenderedGroup[] {
  const roots = groups.filter((g) => !g.parentGroupId);
  const out: RenderedGroup[] = [];
  const walk = (group: CanvasGroup, depth: number): void => {
    const box = groupFrameBox(group, nodes, groups, boundsOf);
    if (box) out.push({ ...box, id: group.id, name: group.name, depth, layout: group.layout });
    for (const childId of group.childGroupIds) {
      const child = groups.find((g) => g.id === childId);
      if (child) walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  // Draw deeper (nested) frames on top of outer ones; outer frames first.
  return out.sort((a, b) => a.depth - b.depth);
}

// ---------------------------------------------------------------------------
// Group / Ungroup
// ---------------------------------------------------------------------------

function cloneGroup(g: CanvasGroup): CanvasGroup {
  return {
    ...g,
    nodeIds: [...g.nodeIds],
    childGroupIds: [...g.childGroupIds],
    ...(g.bounds ? { bounds: { ...g.bounds } } : {})
  };
}

/**
 * Group the given selected node ids. Returns the NEXT groups array.
 *
 * Reparenting rules (Figma semantics):
 * - No existing owner -> a fresh root group.
 * - Subset of ONE existing group (e.g. G={A,B,C}, select {A,B}): the new
 *   group {A,B} becomes a CHILD of G; C stays a DIRECT member of G; G keeps
 *   its own parent. Never the reverse (G must not become the new group's
 *   child, or the new group would wrongly swallow C).
 * - Selection spanning MULTIPLE owner groups: the new group sits at the
 *   common-parent level; unselected members stay in their ORIGINAL parent
 *   groups (surviving owners are NOT re-parented under the new group); only
 *   fully-selected (emptied) owners are dropped.
 */
export function groupNodes(
  selectedNodeIds: string[],
  groups: CanvasGroup[],
  makeId: () => string
): CanvasGroup[] {
  if (selectedNodeIds.length < 2) return groups;
  const selected = new Set(selectedNodeIds);
  if (selected.size < 2) return groups;

  const ownerOf = new Map<string, string>();
  for (const g of groups) {
    for (const id of g.nodeIds) {
      if (selected.has(id)) ownerOf.set(id, g.id);
    }
  }
  const ownerIds = [...new Set(ownerOf.values())];
  let next = groups.map(cloneGroup);

  if (ownerIds.length === 0) {
    return [...next, { id: makeId(), name: "Group", nodeIds: [...selected], childGroupIds: [] }];
  }

  const owners = ownerIds
    .map((id) => next.find((g) => g.id === id))
    .filter((g): g is CanvasGroup => Boolean(g));
  const commonParent = owners.every((o) => o.parentGroupId === owners[0].parentGroupId)
    ? owners[0].parentGroupId
    : undefined;

  const created: CanvasGroup = {
    id: makeId(),
    name: "Group",
    nodeIds: [...selected],
    childGroupIds: []
  };

  const survivingOwners: CanvasGroup[] = [];
  for (const owner of owners) {
    owner.nodeIds = owner.nodeIds.filter((id) => !selected.has(id));
    const emptied = owner.nodeIds.length === 0 && owner.childGroupIds.length === 0;
    if (emptied) {
      if (owner.parentGroupId) {
        const parent = next.find((g) => g.id === owner!.parentGroupId);
        if (parent) parent.childGroupIds = parent.childGroupIds.filter((c) => c !== owner.id);
      }
      next = next.filter((g) => g.id !== owner.id);
      continue;
    }
    survivingOwners.push(owner);
  }

  if (owners.length === 1 && survivingOwners.length === 1) {
    // Subset-in-one-group: new subgroup lives UNDER the owner; the owner keeps
    // its leftover direct members and its own parent untouched.
    const owner = survivingOwners[0];
    created.parentGroupId = owner.id;
    owner.childGroupIds = [...owner.childGroupIds, created.id];
  } else {
    // Multi-owner: new group attaches at the common-parent level. Surviving
    // owners STAY in their original parents (unselected nodes never move);
    // emptied owners were already removed above.
    if (commonParent) {
      created.parentGroupId = commonParent;
      const parent = next.find((g) => g.id === commonParent);
      if (parent) parent.childGroupIds = [...parent.childGroupIds, created.id];
    }
  }
  return [...next, created];
}

/**
 * Ungroup the given group ids. Member nodes stay where they are; child groups
 * are promoted to the dissolved group's parent level.
 */
export function ungroupGroups(groupIds: string[], groups: CanvasGroup[]): CanvasGroup[] {
  if (!groupIds.length) return groups;
  const remove = new Set(groupIds);
  let next = groups.map(cloneGroup);

  for (const id of groupIds) {
    const group = next.find((g) => g.id === id);
    if (!group) continue;
    const parent = group.parentGroupId ? next.find((g) => g.id === group.parentGroupId) : undefined;
    for (const childId of group.childGroupIds) {
      const child = next.find((g) => g.id === childId);
      if (child) child.parentGroupId = group.parentGroupId;
    }
    if (parent) {
      parent.childGroupIds = [
        ...parent.childGroupIds.filter((c) => c !== id),
        ...group.childGroupIds
      ];
    }
    next = next.filter((g) => g.id !== id);
  }
  // Defensive: drop any group that ended up empty (no nodes, no children).
  return next.filter((g) => !(g.nodeIds.length === 0 && g.childGroupIds.length === 0 && !remove.has(g.id)));
}

/**
 * Called when nodes are deleted: strip their ids from every group and drop
 * groups that became empty (orphaned child-group references are cleaned too).
 */
export function pruneGroupsAfterNodeRemoval(removedNodeIds: string[], groups: CanvasGroup[]): CanvasGroup[] {
  if (!groups.length || !removedNodeIds.length) return groups;
  const removed = new Set(removedNodeIds);
  let next = groups.map(cloneGroup);
  const hasNode = (id: string): boolean => next.some((g) => g.nodeIds.includes(id));
  const hasGroup = (id: string): boolean => next.some((g) => g.id === id);

  for (const g of next) {
    g.nodeIds = g.nodeIds.filter((id) => !removed.has(id) && hasNode(id));
  }
  // Iterate to fixed point: dropping an emptied group may empty its parent.
  for (;;) {
    const emptied = next.filter((g) => !g.bounds && g.nodeIds.length === 0 && g.childGroupIds.length === 0);
    if (!emptied.length) break;
    const emptiedIds = new Set(emptied.map((g) => g.id));
    for (const g of next) {
      g.childGroupIds = g.childGroupIds.filter((c) => !emptiedIds.has(c) && hasGroup(c));
    }
    next = next.filter((g) => !emptiedIds.has(g.id));
  }
  // Clean dangling parent refs.
  for (const g of next) {
    if (g.parentGroupId && !hasGroup(g.parentGroupId)) delete g.parentGroupId;
  }
  return next;
}

/** Directly-owned node ids of the given group (nodes, not nested groups). */
export function directMemberIds(groupId: string, groups: CanvasGroup[]): string[] {
  const group = groups.find((g) => g.id === groupId);
  return group ? [...group.nodeIds] : [];
}

// ---------------------------------------------------------------------------
// Alignment / distribution / tidy up — return a POSITION patch only.
// ---------------------------------------------------------------------------

type PositionPatch = { id: string; x: number; y: number }[];

export function alignSelectedNodes(
  nodes: ScatterNode[],
  selectedIds: string[],
  mode: AlignMode,
  boundsOf: BoundsOf
): PositionPatch {
  if (selectedIds.length < 2) return [];
  const selected = nodes.filter((n) => selectedIds.includes(n.id));
  const boxes = selected.map((n) => nodeBox(n, boundsOf));
  const outer = unionBox(boxes);
  if (!outer) return [];

  const patch: PositionPatch = [];
  for (const node of selected) {
    const box = nodeBox(node, boundsOf);
    let { x, y } = node.position;
    switch (mode) {
      case "left": x = outer.x; break;
      case "right": x = outer.x + outer.width - box.width; break;
      case "centerX": x = outer.x + outer.width / 2 - box.width / 2; break;
      case "top": y = outer.y; break;
      case "bottom": y = outer.y + outer.height - box.height; break;
      case "centerY": y = outer.y + outer.height / 2 - box.height / 2; break;
    }
    patch.push({ id: node.id, x, y });
  }
  return patch;
}

export function distributeSelectedNodes(
  nodes: ScatterNode[],
  selectedIds: string[],
  axis: DistributeAxis,
  boundsOf: BoundsOf
): PositionPatch {
  if (selectedIds.length < 3) return [];
  const selected = [...nodes.filter((n) => selectedIds.includes(n.id))];
  if (axis === "horizontal") {
    selected.sort((a, b) => a.position.x - b.position.x);
    const boxes = selected.map((n) => nodeBox(n, boundsOf));
    const outer = unionBox(boxes)!;
    const totalNodeWidth = boxes.reduce((sum, b) => sum + b.width, 0);
    const gap = (outer.width - totalNodeWidth) / (selected.length - 1);
    let cursor = outer.x;
    return selected.map((node, i) => {
      const w = boxes[i].width;
      const patch = { id: node.id, x: cursor, y: node.position.y };
      cursor += w + gap;
      return patch;
    });
  }
  selected.sort((a, b) => a.position.y - b.position.y);
  const boxes = selected.map((n) => nodeBox(n, boundsOf));
  const outer = unionBox(boxes)!;
  const totalNodeHeight = boxes.reduce((sum, b) => sum + b.height, 0);
  const gap = (outer.height - totalNodeHeight) / (selected.length - 1);
  let cursor = outer.y;
  return selected.map((node, i) => {
    const h = boxes[i].height;
    const patch = { id: node.id, x: node.position.x, y: cursor };
    cursor += h + gap;
    return patch;
  });
}

/**
 * One-shot "Tidy up": sort members into rows by their current y-overlap, then
 * lay rows out with even gaps, preserving relative x-order within rows.
 */
export function tidyUpNodes(
  nodes: ScatterNode[],
  selectedIds: string[],
  boundsOf: BoundsOf
): PositionPatch {
  if (selectedIds.length < 2) return [];
  const selected = [...nodes.filter((n) => selectedIds.includes(n.id))];
  const boxes = new Map(selected.map((n) => [n.id, nodeBox(n, boundsOf)]));
  const outer = unionBox([...boxes.values()]);
  if (!outer) return [];

  const byY = [...selected].sort((a, b) => {
    const ba = boxes.get(a.id)!;
    const bb = boxes.get(b.id)!;
    return ba.y - bb.y || ba.x - bb.x;
  });

  // Cluster into rows: a new row starts when the node's top is below the
  // previous row's bottom (i.e. no y-overlap).
  const rows: ScatterNode[][] = [];
  let rowBottom = -Infinity;
  let current: ScatterNode[] = [];
  for (const node of byY) {
    const box = boxes.get(node.id)!;
    if (current.length && box.y >= rowBottom - 1) {
      rows.push(current);
      current = [];
    }
    current.push(node);
    rowBottom = Math.max(rowBottom, box.y + box.height);
  }
  if (current.length) rows.push(current);

  const GAP = GROUP_LAYOUT_GAP;
  const patch: PositionPatch = [];
  let cursorY = outer.y;
  for (const row of rows) {
    row.sort((a, b) => boxes.get(a.id)!.x - boxes.get(b.id)!.x);
    let cursorX = outer.x;
    const rowHeight = Math.max(...row.map((n) => boxes.get(n.id)!.height));
    for (const node of row) {
      const box = boxes.get(node.id)!;
      patch.push({ id: node.id, x: cursorX, y: cursorY });
      cursorX += box.width + GAP;
    }
    cursorY += rowHeight + GAP;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Real Auto Layout: the group is a PERSISTED container (axis / gap / padding /
// cross-axis alignment / child order). applyGroupLayoutPositions re-flows its
// direct children; planGroupAfterDrag encodes the predictable drop rule used
// when a child is dragged:
//   - child dropped INSIDE the frame  -> re-flow; order follows new main-axis
//     position (like Figma's live reorder);
//   - child dropped OUTSIDE the frame -> it DETACHES from the group (stays on
//     the canvas, leaves nodeIds + childOrder).
// This is a continuous container property, NOT a one-shot tidy.
// ---------------------------------------------------------------------------

/** Order member ids along the main axis by canvas position, tie-break by id. */
export function orderMembersAlongAxis(
  memberNodes: ScatterNode[],
  axis: "horizontal" | "vertical"
): string[] {
  const sorted = [...memberNodes].sort((a, b) => {
    const delta = axis === "horizontal" ? a.position.x - b.position.x : a.position.y - b.position.y;
    if (Math.abs(delta) > Number.EPSILON) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.map((n) => n.id);
}

const finiteNum = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const finiteSize = (value: number, fallback: number): number =>
  Math.max(0, Number.isFinite(value) ? value : fallback);

export function applyGroupLayoutPositions(
  group: CanvasGroup,
  nodes: ScatterNode[],
  groups: CanvasGroup[],
  boundsOf: BoundsOf,
  baselineFrame?: CanvasBox
): PositionPatch {
  if (!group.layout) return [];
  const layout = group.layout;
  const memberNodes = group.nodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is ScatterNode => Boolean(n));
  if (memberNodes.length < 2) return [];

  const byId = new Map(memberNodes.map((n) => [n.id, n]));
  // childOrder: keep known members in persisted order, then append any member
  // missing from childOrder (sorted by axis position, tie-break by id).
  const known = layout.childOrder.filter((id) => byId.has(id));
  const missing = orderMembersAlongAxis(
    memberNodes.filter((n) => !known.includes(n.id)),
    layout.axis
  );
  const orderedIds = known.length ? [...known, ...missing] : orderMembersAlongAxis(memberNodes, layout.axis);
  const ordered = orderedIds.map((id) => byId.get(id)!);
  const boxes = ordered.map((n) => {
    const raw = boundsOf(n);
    return {
      x: finiteNum(n.position.x, 0),
      y: finiteNum(n.position.y, 0),
      width: finiteSize(raw.width, 0),
      height: finiteSize(raw.height, 0)
    };
  });
  const gap = Math.max(0, finiteNum(layout.gap, GROUP_LAYOUT_GAP));
  const pad = {
    top: Math.max(0, finiteNum(layout.padding.top, GROUP_PADDING)),
    right: Math.max(0, finiteNum(layout.padding.right, GROUP_PADDING)),
    bottom: Math.max(0, finiteNum(layout.padding.bottom, GROUP_PADDING)),
    left: Math.max(0, finiteNum(layout.padding.left, GROUP_PADDING))
  };

  // Anchor the content block. When a baseline frame is supplied (the frame as
  // it stood BEFORE this layout change), pin content at baselineFrame.x + new
  // padding.left so the outer frame's top-left stays fixed while changed
  // padding actually moves children instead of cancelling itself. Otherwise
  // derive the frame from current geometry. Guard all coordinates; fall back
  // to finite node-box minima when invalid.
  const finiteMinX = Math.min(...boxes.map((b) => b.x));
  const finiteMinY = Math.min(...boxes.map((b) => b.y));
  const baselineValid =
    baselineFrame &&
    Number.isFinite(baselineFrame.x) &&
    Number.isFinite(baselineFrame.y);
  if (baselineValid) {
    const bf = baselineFrame as CanvasBox;
    const anchorX = finiteNum(bf.x, finiteMinX) + pad.left;
    const anchorY = finiteNum(bf.y, finiteMinY) + pad.top;
    return emitLayoutPatch(ordered, boxes, gap, anchorX, anchorY, layout.axis, layout.alignment);
  }
  const frame = groupFrameBox(group, nodes, groups, boundsOf);
  const frameValid =
    frame &&
    Number.isFinite(frame.x) &&
    Number.isFinite(frame.y) &&
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height);
  const anchorX = frameValid ? (frame as CanvasBox).x + pad.left : finiteMinX;
  const anchorY = frameValid ? (frame as CanvasBox).y + pad.top : finiteMinY;
  return emitLayoutPatch(ordered, boxes, gap, anchorX, anchorY, layout.axis, layout.alignment);
}

function emitLayoutPatch(
  ordered: ScatterNode[],
  boxes: CanvasBox[],
  gap: number,
  anchorX: number,
  anchorY: number,
  axis: CanvasGroupLayout["axis"],
  alignment: CanvasGroupLayout["alignment"]
): PositionPatch {
  if (axis === "horizontal") {
    const crossExtent = Math.max(...boxes.map((b) => b.height));
    let cursor = anchorX;
    return ordered.map((node, i) => {
      const h = boxes[i].height;
      let y = anchorY;
      if (alignment === "center") y = anchorY + (crossExtent - h) / 2;
      else if (alignment === "end") y = anchorY + crossExtent - h;
      const patch = { id: node.id, x: cursor, y };
      cursor += boxes[i].width + gap;
      return patch;
    });
  }
  const crossExtent = Math.max(...boxes.map((b) => b.width));
  let cursor = anchorY;
  return ordered.map((node, i) => {
    const w = boxes[i].width;
    let x = anchorX;
    if (alignment === "center") x = anchorX + (crossExtent - w) / 2;
    else if (alignment === "end") x = anchorX + crossExtent - w;
    const patch = { id: node.id, x, y: cursor };
    cursor += boxes[i].height + gap;
    return patch;
  });
}

export interface GroupDragPlan {
  group: CanvasGroup;
  patch: PositionPatch;
  detachedIds: string[];
}

/**
 * Predictable drop rule for an Auto-Layout group after a child drag settles.
 *
 * Detach boundary = `baselineFrame`, i.e. the padded group frame captured at
 * DRAG START (before any child moved). Using the live post-drag box would grow
 * with the dragged child and make "pull out" impossible to trigger; the
 * baseline frame is a fixed, decidable threshold.
 *
 * Returns the updated group (membership + childOrder pruned/reordered) and the
 * re-flow position patch. Returns null when the group has no layout.
 */
export function planGroupAfterDrag(
  group: CanvasGroup,
  nodes: ScatterNode[],
  groups: CanvasGroup[],
  boundsOf: BoundsOf,
  baselineFrame: CanvasBox
): GroupDragPlan | null {
  if (!group.layout) return null;

  const memberNodes = group.nodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is ScatterNode => Boolean(n));

  const detachedIds: string[] = [];
  for (const node of memberNodes) {
    const raw = boundsOf(node);
    const box = { x: node.position.x, y: node.position.y, width: finiteSize(raw.width, 0), height: finiteSize(raw.height, 0) };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Center outside the frame as it stood when the drag began -> detached.
    if (
      cx < baselineFrame.x ||
      cx > baselineFrame.x + baselineFrame.width ||
      cy < baselineFrame.y ||
      cy > baselineFrame.y + baselineFrame.height
    ) {
      detachedIds.push(node.id);
    }
  }

  const detached = new Set(detachedIds);
  const remaining = memberNodes.filter((n) => !detached.has(n.id));
  const childOrder = orderMembersAlongAxis(remaining, group.layout.axis);

  const nextGroup: CanvasGroup = {
    ...group,
    nodeIds: remaining.map((n) => n.id),
    childGroupIds: [...group.childGroupIds],
    layout: { ...group.layout, childOrder }
  };

  // Re-flow the survivors; the content anchor recomputes from current geometry.
  const patch = applyGroupLayoutPositions(nextGroup, nodes, groups, boundsOf);
  return { group: nextGroup, patch, detachedIds };
}

/** Apply a position patch to nodes (pure). */
export function applyPositionPatch(nodes: ScatterNode[], patch: PositionPatch): ScatterNode[] {
  if (!patch.length) return nodes;
  const byId = new Map(patch.map((p) => [p.id, p]));
  return nodes.map((node) => {
    const p = byId.get(node.id);
    return p ? { ...node, position: { x: p.x, y: p.y } } : node;
  });
}

export type RecommendedLayoutAction = "tidy" | "distribute-horizontal" | "distribute-vertical";

/**
 * Recommend the most useful one-click layout action for the current selection.
 * Pure: no store, no edges, no side effects.
 *
 * Heuristic:
 * - Fewer than 3 selected nodes -> tidy up.
 * - >=3 nodes whose centers sit close to one horizontal row (y spread small,
 *   x spread dominates) -> horizontal distribute; close to one vertical column
 *   (x spread small, y spread dominates) -> vertical distribute.
 * - Otherwise -> tidy up.
 * Input validation happens on the RAW values before any normalization: if a
 * selected node has non-finite position or non-positive/non-finite bounds, or
 * any selected id does not resolve, the recommendation safely returns tidy.
 */
export function recommendSelectionLayoutAction(
  nodes: ScatterNode[],
  selectedIds: string[],
  boundsOf: BoundsOf
): RecommendedLayoutAction {
  const uniqueIds = [...new Set(selectedIds)];
  if (!uniqueIds.length) return "tidy";
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selected = uniqueIds
    .map((id) => byId.get(id))
    .filter((n): n is ScatterNode => Boolean(n));
  if (selected.length < 3 || selected.length !== uniqueIds.length) return "tidy";

  // Validate RAW values before any fallback masking: position and bounds must
  // be finite, and width/height must be positive. Any invalid node -> tidy.
  const boxes: CanvasBox[] = [];
  for (const n of selected) {
    const raw = boundsOf(n);
    const px = n.position?.x;
    const py = n.position?.y;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !raw) return "tidy";
    if (!Number.isFinite(raw.width) || !Number.isFinite(raw.height) || raw.width <= 0 || raw.height <= 0) {
      return "tidy";
    }
    boxes.push({ x: px, y: py, width: raw.width, height: raw.height });
  }

  const centers = boxes.map((b) => ({ cx: b.x + b.width / 2, cy: b.y + b.height / 2 }));
  const avgH = boxes.reduce((sum, b) => sum + b.height, 0) / boxes.length;
  const avgW = boxes.reduce((sum, b) => sum + b.width, 0) / boxes.length;

  const spreadX = Math.max(...centers.map((c) => c.cx)) - Math.min(...centers.map((c) => c.cx));
  const spreadY = Math.max(...centers.map((c) => c.cy)) - Math.min(...centers.map((c) => c.cy));

  const rowTolerance = avgH * 0.5;
  const colTolerance = avgW * 0.5;
  const rowCandidate = spreadY <= rowTolerance && spreadX > Math.max(4, avgW * 0.5);
  const colCandidate = spreadX <= colTolerance && spreadY > Math.max(4, avgH * 0.5);

  // Both or neither candidate -> tidy; a pure horizontal row -> horizontal
  // distribute; a pure vertical column -> vertical distribute.
  if (rowCandidate && !colCandidate) return "distribute-horizontal";
  if (colCandidate && !rowCandidate) return "distribute-vertical";
  return "tidy";
}
