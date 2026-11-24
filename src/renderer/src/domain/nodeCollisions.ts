import type { ScatterNode } from "../../../shared/types";
import type { BoundsOf } from "./canvasGrouping";

type Box = { x: number; y: number; width: number; height: number };
type PositionPatch = { id: string; x: number; y: number }[];

interface CollisionUnit {
  members: ScatterNode[];
  box: Box;
  firstIndex: number;
  preferred: boolean;
}

function boxFor(node: ScatterNode, position: { x: number; y: number }, boundsOf: BoundsOf): Box {
  const bounds = boundsOf(node);
  return {
    x: position.x,
    y: position.y,
    width: Math.max(1, Number.isFinite(bounds.width) ? bounds.width : 1),
    height: Math.max(1, Number.isFinite(bounds.height) ? bounds.height : 1)
  };
}

function overlapsWithGap(left: Box, right: Box, gap: number): boolean {
  const separatedHorizontally = left.x + left.width + gap <= right.x
    || right.x + right.width + gap <= left.x;
  const separatedVertically = left.y + left.height + gap <= right.y
    || right.y + right.height + gap <= left.y;
  return !separatedHorizontally && !separatedVertically;
}

function nearestFreePosition(origin: Box, placed: Box[], gap: number, searchLimit: number): { x: number; y: number } {
  const candidates = new Map<string, { x: number; y: number }>();
  const add = (x: number, y: number): void => {
    const candidate = { x: Math.round(x), y: Math.round(y) };
    candidates.set(candidate.x + ":" + candidate.y, candidate);
  };

  add(origin.x, origin.y);
  for (const obstacle of placed) {
    const left = obstacle.x - origin.width - gap;
    const right = obstacle.x + obstacle.width + gap;
    const top = obstacle.y - origin.height - gap;
    const bottom = obstacle.y + obstacle.height + gap;
    add(left, origin.y);
    add(right, origin.y);
    add(origin.x, top);
    add(origin.x, bottom);
    add(left, top);
    add(left, bottom);
    add(right, top);
    add(right, bottom);
  }

  const isFree = (candidate: { x: number; y: number }): boolean => {
    const candidateBox = { ...origin, ...candidate };
    return placed.every((obstacle) => !overlapsWithGap(candidateBox, obstacle, gap));
  };
  const distance = (candidate: { x: number; y: number }): number => {
    const dx = candidate.x - origin.x;
    const dy = candidate.y - origin.y;
    return dx * dx + dy * dy;
  };

  const nearby = [...candidates.values()].sort((a, b) =>
    distance(a) - distance(b)
    || Math.abs(a.x - origin.x) - Math.abs(b.x - origin.x)
    || a.y - b.y
    || a.x - b.x
  );
  const nearbyFree = nearby.find(isFree);
  if (nearbyFree) return nearbyFree;

  const step = Math.max(64, Math.min(192, Math.round(Math.min(origin.width, origin.height) / 2)));
  for (let radius = 1; radius <= searchLimit; radius += 1) {
    const ring: { x: number; y: number }[] = [];
    for (let offset = -radius; offset <= radius; offset += 1) {
      ring.push(
        { x: origin.x + offset * step, y: origin.y - radius * step },
        { x: origin.x + offset * step, y: origin.y + radius * step },
        { x: origin.x - radius * step, y: origin.y + offset * step },
        { x: origin.x + radius * step, y: origin.y + offset * step }
      );
    }
    ring.sort((a, b) =>
      distance(a) - distance(b)
      || Math.abs(a.x - origin.x) - Math.abs(b.x - origin.x)
      || a.y - b.y
      || a.x - b.x
    );
    const free = ring.find(isFree);
    if (free) return { x: Math.round(free.x), y: Math.round(free.y) };
  }

  // Finite fallback: a box placed beyond every existing right edge cannot overlap.
  const x = placed.reduce((rightmost, obstacle) => Math.max(rightmost, obstacle.x + obstacle.width + gap), origin.x);
  return { x: Math.round(x), y: Math.round(origin.y) };
}

/**
 * Moves the smallest number of canvas units needed to separate overlapping
 * node containers. Preferred nodes stay in place where possible. Group members
 * are packed as rigid units after their internal overlaps are resolved.
 */
export function preventNodeOverlaps(
  nodes: ScatterNode[],
  preferredIds: string[],
  boundsOf: BoundsOf,
  rigidGroups: string[][] = [],
  gap = 28
): PositionPatch {
  if (nodes.length < 2) return [];

  const preferred = new Set(preferredIds);
  const originalIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const positions = new Map(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]));
  const assigned = new Set<string>();

  // First repair overlaps inside a group. This is normally a no-op, except
  // when older saved canvases already contain overlapping group members.
  for (const groupIds of rigidGroups) {
    const members = nodes
      .filter((node) => groupIds.includes(node.id) && !assigned.has(node.id))
      .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id))
        || (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0));
    if (!members.length) continue;
    members.forEach((node) => assigned.add(node.id));
    const groupPlaced: Box[] = [];
    for (const member of members) {
      const origin = boxFor(member, positions.get(member.id)!, boundsOf);
      const target = groupPlaced.some((box) => overlapsWithGap(origin, box, gap))
        ? nearestFreePosition(origin, groupPlaced, gap, members.length * 2 + 8)
        : { x: origin.x, y: origin.y };
      positions.set(member.id, target);
      groupPlaced.push({ ...origin, ...target });
    }
  }

  const positionedNodes = nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position
  }));
  const units: CollisionUnit[] = [];
  const unitNodeIds = new Set<string>();

  for (const groupIds of rigidGroups) {
    const members = positionedNodes.filter((node) => groupIds.includes(node.id) && !unitNodeIds.has(node.id));
    if (!members.length) continue;
    members.forEach((node) => unitNodeIds.add(node.id));
    const boxes = members.map((node) => boxFor(node, node.position, boundsOf));
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    units.push({
      members,
      box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      firstIndex: Math.min(...members.map((node) => originalIndex.get(node.id) ?? 0)),
      preferred: members.some((node) => preferred.has(node.id))
    });
  }

  for (const node of positionedNodes) {
    if (unitNodeIds.has(node.id)) continue;
    units.push({
      members: [node],
      box: boxFor(node, node.position, boundsOf),
      firstIndex: originalIndex.get(node.id) ?? 0,
      preferred: preferred.has(node.id)
    });
  }

  units.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.firstIndex - b.firstIndex);

  const placed: Box[] = [];
  const result = new Map<string, { x: number; y: number }>();
  for (const unit of units) {
    const origin = unit.box;
    const target = placed.some((box) => overlapsWithGap(origin, box, gap))
      ? nearestFreePosition(origin, placed, gap, units.length * 2 + 8)
      : { x: origin.x, y: origin.y };
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    for (const member of unit.members) {
      result.set(member.id, {
        x: Math.round(member.position.x + dx),
        y: Math.round(member.position.y + dy)
      });
    }
    placed.push({ ...origin, ...target });
  }

  return nodes.flatMap((node) => {
    const position = result.get(node.id);
    if (!position || (position.x === node.position.x && position.y === node.position.y)) return [];
    return [{ id: node.id, x: position.x, y: position.y }];
  });
}
