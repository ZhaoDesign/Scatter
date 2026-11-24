import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from "@xyflow/react";
import { useState, type ReactElement } from "react";

type RoutePoint = { x: number; y: number };

type ScatterEdgeData = {
  active?: boolean;
  dimmed?: boolean;
  traceLabel?: string;
  routePointLabel?: string;
  routePointHint?: string;
  routePoints?: RoutePoint[];
  onRoutePointsChange?: (points: RoutePoint[]) => void;
};

function EdgeCap({ className, side, x, y }: { className: string; side: "left" | "right"; x: number; y: number }): ReactElement {
  const top = y - 10;

  if (side === "left") {
    const left = x - 4;
    return (
      <path
        className={className}
        d={`M ${left + 4} ${top} L ${left + 4} ${top + 20} L ${left + 2} ${top + 20} Q ${left} ${top + 20} ${left} ${top + 18} L ${left} ${top + 2} Q ${left} ${top} ${left + 2} ${top} Z`}
      />
    );
  }

  const left = x;
  return (
    <path
      className={className}
      d={`M ${left} ${top} L ${left + 2} ${top} Q ${left + 4} ${top} ${left + 4} ${top + 2} L ${left + 4} ${top + 18} Q ${left + 4} ${top + 20} ${left + 2} ${top + 20} L ${left} ${top + 20} Z`}
    />
  );
}

function capSide(position: unknown): "left" | "right" {
  return String(position).toLowerCase() === "left" ? "left" : "right";
}

function nodeEdgeX(x: number, position: unknown): number {
  return capSide(position) === "left" ? x + 10 : x - 10;
}

function roundedRoutePath(points: RoutePoint[]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
    const radius = Math.min(16, previousLength * 0.3, nextLength * 0.3);
    if (radius < 1) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }
    const before = {
      x: current.x - ((current.x - previous.x) / previousLength) * radius,
      y: current.y - ((current.y - previous.y) / previousLength) * radius
    };
    const after = {
      x: current.x + ((next.x - current.x) / nextLength) * radius,
      y: current.y + ((next.y - current.y) / nextLength) * radius
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }

  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function routeMidpoint(points: RoutePoint[]): RoutePoint {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const halfLength = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (traversed + length >= halfLength) {
      const amount = length ? (halfLength - traversed) / length : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * amount,
        y: points[index].y + (points[index + 1].y - points[index].y) * amount
      };
    }
    traversed += length;
  }
  return points[0];
}

export function ScatterEdge({
  data,
  id,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY
}: EdgeProps): ReactElement {
  const { screenToFlowPosition } = useReactFlow();
  const [dragState, setDragState] = useState<{ index: number; points: RoutePoint[] } | null>(null);
  const sourceEdgeX = nodeEdgeX(sourceX, sourcePosition);
  const targetEdgeX = nodeEdgeX(targetX, targetPosition);
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX: sourceEdgeX,
    sourceY,
    sourcePosition,
    targetX: targetEdgeX,
    targetY,
    targetPosition,
    curvature: 0.45
  });
  const edgeData = data as ScatterEdgeData | undefined;
  const routePoints = dragState?.points ?? edgeData?.routePoints ?? [];
  const pathPoints = [{ x: sourceEdgeX, y: sourceY }, ...routePoints, { x: targetEdgeX, y: targetY }];
  const edgePath = routePoints.length ? roundedRoutePath(pathPoints) : bezierPath;
  const labelPosition = routePoints.length ? routeMidpoint(pathPoints) : { x: bezierLabelX, y: bezierLabelY };
  const stateClass = [
    selected ? "is-selected" : edgeData?.active ? "is-active" : "",
    edgeData?.dimmed ? "is-dimmed" : ""
  ].filter(Boolean).join(" ");
  const edgeClassName = `scatter-edge-path ${stateClass}`.trim();
  const capClassName = `scatter-edge-cap ${stateClass}`.trim();

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className={edgeClassName} interactionWidth={20} />
      <EdgeCap className={capClassName} side={capSide(sourcePosition)} x={sourceEdgeX} y={sourceY} />
      <EdgeCap className={capClassName} side={capSide(targetPosition)} x={targetEdgeX} y={targetY} />
      {edgeData?.traceLabel ? (
        <EdgeLabelRenderer>
          <div
            className="scatter-edge-trace-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }}
            role="tooltip"
          >
            <span>{edgeData.traceLabel}</span>
            {edgeData.routePointHint ? <small>{edgeData.routePointHint}</small> : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {routePoints.length && (selected || edgeData?.active || dragState) ? (
        <EdgeLabelRenderer>
          {routePoints.map((point, index) => (
            <button
              key={`${id}-route-${index}`}
              type="button"
              className="scatter-edge-waypoint nodrag nopan"
              style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
              aria-label={`${edgeData?.routePointLabel || "Bend point"} ${index + 1}`}
              title={edgeData?.routePointHint || "Double-click to remove bend point"}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragState({ index, points: routePoints.map((item) => ({ ...item })) });
              }}
              onPointerMove={(event) => {
                if (dragState?.index !== index) return;
                const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
                setDragState({
                  index,
                  points: dragState.points.map((item, itemIndex) => itemIndex === index ? position : item)
                });
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                if (dragState?.index !== index) return;
                edgeData?.onRoutePointsChange?.(dragState.points);
                setDragState(null);
              }}
              onPointerCancel={() => setDragState(null)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                edgeData?.onRoutePointsChange?.(routePoints.filter((_, itemIndex) => itemIndex !== index));
                setDragState(null);
              }}
            />
          ))}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
