import { memo, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode, type SyntheticEvent } from "react";
import { Handle, Position } from "@xyflow/react";
import type { PixverseCapabilityValue, PixverseCreateCapabilities, PixverseCreateMode, PixverseGenerationError, PixverseParameterCapability, ScatterNode, ScatterNodeData, TaskReferenceAssignment, WorkflowNodeKind } from "../../../shared/types";
import { seedanceReferenceFields } from "../domain/seedanceWorkflow";
import { canUseGenerationMedia, depthOutputVideoIds } from "../domain/referenceAssignments";
import { replicationScopeSectionSpecs } from "../domain/replicationSections";
import { useI18n } from "../lib/i18n";
import { useScatterStore } from "../store/scatterStore";
import { shortcuts } from "../lib/shortcuts";
import { taskNodeActions, filterMediaFiles, mediaAcceptMime, firstMediaAttachment, type ConnectedNodeSide } from "./nodeRuntimeActions";
import { ActionMenuItem } from "./ui/action-menu-item";
import { DropdownMenu, DropdownMenuItem } from "./ui/dropdown-menu";
import { DropdownTrigger } from "./ui/dropdown-trigger";
import { Icon } from "./ui/icon";
import { IconButton } from "./ui/icon-button";
import { Switch } from "./ui/switch";
import { Toast, ToastViewport } from "./ui/toast";
import { TooltipAnchor } from "./ui/tooltip";
import { AutoResizeTextarea } from "./ui/auto-resize-textarea";
import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";

type Props = { id: string; data: ScatterNodeData; selected?: boolean };

const kindLabel: Record<WorkflowNodeKind, string> = {
  task: "任务节点",
  "generic-prompt": "通用提示词",
  "replication-analysis": "复刻分析",
  "replication-section": "复刻分类",
  "replication-scope": "复刻范围组",
  "replication-comparison": "结果对比",
  "seedance-generation": "Seedance 生成",
  "image-reference": "图片节点",
  "video-reference": "视频节点",
  "reference-binding": "参考绑定",
  "role-binding": "角色绑定",
  "depth-conversion": "深度视频转换",
  "pixverse-generation": "PixVerse CLI 生成"
};

function ReplicationWorkflowNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  const isComparison = data.nodeKind === "replication-comparison";
  const isPhoto = data.replicationMode === "photo";
  const canvasNodes = useScatterStore((state) => state.nodes);
  const canvasEdges = useScatterStore((state) => state.edges);
  const categoryFields = data.replicationCategoryFields || [];
  const categoryGroups = Array.from(categoryFields.reduce((groups, field) => {
    const group = groups.get(field.groupId) || { title: field.groupTitle, fields: [] as typeof categoryFields };
    group.fields.push(field);
    groups.set(field.groupId, group);
    return groups;
  }, new Map<string, { title: string; fields: typeof categoryFields }>()));
  const status = data.replicationStatus === "running" ? "处理中"
    : data.replicationStatus === "ready" ? "已完成"
      : data.replicationStatus === "error" ? "需要重试" : undefined;
  const differences = data.replicationDifferences || [];
  const comparisonInputs = isComparison
    ? canvasEdges
      .filter((edge) => edge.target === id && !edge.targetHandle)
      .map((edge) => canvasNodes.find((node) => node.id === edge.source))
      .filter((node): node is ScatterNode => Boolean(node
        && (node.data.nodeKind === "image-reference" || node.data.nodeKind === "video-reference")
        && node.data.attachments.some((attachment) => attachment.kind === "image" || attachment.kind === "video")))
    : [];
  const analysisSourceIds = new Set(canvasEdges
    .filter((edge) => edge.target === data.replicationAnalysisNodeId && !edge.targetHandle)
    .map((edge) => edge.source));
  const assignedTargetIds = Object.entries(data.referenceAssignments || {})
    .filter(([, assignment]) => /target|目标/i.test(assignment.purpose))
    .map(([sourceId]) => sourceId);
  const targetSourceIds = new Set([...analysisSourceIds, ...assignedTargetIds]);
  const comparisonTargets = comparisonInputs.filter((node) => targetSourceIds.has(node.id));
  const comparisonCandidates = comparisonInputs.filter((node) => !targetSourceIds.has(node.id));
  const renderComparisonMedia = (mediaNode: ScatterNode): ReactElement | null => {
    const attachment = mediaNode.data.attachments.find((item) => item.kind === "image" || item.kind === "video");
    if (!attachment) return null;
    const label = typeof mediaNode.data.pixverseRunNumber === "number"
      ? t("workflow.pixverseRoundLabel", { round: mediaNode.data.pixverseRunNumber }) + " · " + (mediaNode.data.pixverseResultIndex || 1)
      : mediaNode.data.title;
    return (
      <div className="replication-media-card" key={mediaNode.id + ":" + attachment.id}>
        <div className="replication-media-preview">
          {attachment.kind === "image"
            ? <img src={attachment.fileUrl} alt={attachment.originalName} draggable={false} />
            : <video className="nodrag nopan" controls muted preload="metadata" playsInline><source src={attachment.fileUrl} type={attachment.mime} /></video>}
        </div>
        <span className="replication-media-card-title" title={label}>{label}</span>
      </div>
    );
  };
  const updateDifference = (differenceId: string, patch: Partial<NonNullable<ScatterNodeData["replicationDifferences"]>[number]>): void => {
    taskNodeActions?.updateNodeData(id, {
      replicationDifferences: differences.map((difference) => difference.id === differenceId ? { ...difference, ...patch } : difference)
    });
  };

  return (
    <NodeShell
      id={id}
      data={data}
      selected={selected}
      icon={isPhoto ? (isComparison ? "image-square" : "camera") : "tasks"}
      status={status}
      onRun={() => void taskNodeActions?.runReplicationNode?.(id)}
      runDisabled={data.replicationStatus === "running"}
      runLabel={isComparison ? "分析差异" : "开始分析"}
    >
      <div className="replication-node-content nodrag">
        {isPhoto
          ? <ReplicationInstructionsDisclosure body={data.body} className="replication-photo-instructions" />
          : <p className="workflow-node-intro">{data.body}</p>}
        {data.replicationError ? <p className="replication-node-error">{data.replicationError}</p> : null}
        {isComparison ? (
          <>
            {comparisonTargets.length || comparisonCandidates.length ? (
              <div className="replication-comparison-gallery">
                {comparisonTargets.length ? (
                  <section className="replication-media-section">
                    <strong>{t("workflow.replicationTargetMedia")}</strong>
                    <div className="replication-media-grid">{comparisonTargets.map(renderComparisonMedia)}</div>
                  </section>
                ) : null}
                {comparisonCandidates.length ? (
                  <section className="replication-media-section">
                    <strong>{t("workflow.replicationCandidateMedia", { count: comparisonCandidates.length })}</strong>
                    <div className="replication-media-grid">{comparisonCandidates.map(renderComparisonMedia)}</div>
                  </section>
                ) : null}
              </div>
            ) : null}
            <div className="replication-difference-list">
              {differences.map((difference, index) => (
                <section className="replication-difference-card" key={difference.id}>
                  <div className="replication-difference-heading">
                    <strong>{difference.timeRange || `差异 ${index + 1}`}{difference.category ? ` · ${difference.category}` : ""}</strong>
                    <IconButton className="nodrag" filled={false} icon="trash" size="sm" aria-label={`删除差异 ${index + 1}`} onClick={() => {
                      taskNodeActions?.beginNodeEdit();
                      taskNodeActions?.updateNodeData(id, { replicationDifferences: differences.filter((item) => item.id !== difference.id) });
                      taskNodeActions?.commitNodeEdit();
                    }} />
                  </div>
                  {difference.target ? <p><b>目标：</b>{difference.target}</p> : null}
                  {difference.generated ? <p><b>生成：</b>{difference.generated}</p> : null}
                  <AutoResizeTextarea
                    nodeId={id}
                    className="replication-correction-input nodrag nowheel"
                    aria-label={`差异 ${index + 1} 的修改要求`}
                    value={difference.correction}
                    placeholder="写明这一项希望怎么改"
                    onFocus={() => taskNodeActions?.beginNodeEdit()}
                    onChange={(event) => updateDifference(difference.id, { correction: event.currentTarget.value })}
                    onBlur={() => taskNodeActions?.commitNodeEdit()}
                  />
                </section>
              ))}
            </div>
            <button className="replication-add-difference nodrag" type="button" onClick={() => {
              taskNodeActions?.beginNodeEdit();
              taskNodeActions?.updateNodeData(id, {
                replicationDifferences: [...differences, { id: globalThis.crypto?.randomUUID?.() || `diff-${Date.now()}`, timeRange: "", category: "", target: "", generated: "", correction: "", manual: true }]
              });
              taskNodeActions?.commitNodeEdit();
            }}>＋ 添加一项差异</button>
            <label className="replication-supplement-label">
              总体补充
              <AutoResizeTextarea
                nodeId={id}
                className="replication-correction-input nodrag nowheel"
                value={data.replicationSupplement || ""}
                placeholder="补充差异清单之外的整体修改要求"
                onFocus={() => taskNodeActions?.beginNodeEdit()}
                onChange={(event) => taskNodeActions?.updateNodeData(id, { replicationSupplement: event.currentTarget.value })}
                onBlur={() => taskNodeActions?.commitNodeEdit()}
              />
            </label>
            {data.replicationOutputText ? <details className="replication-raw-output"><summary>查看本轮对比报告</summary><pre>{data.replicationOutputText}</pre></details> : null}
          </>
        ) : isPhoto && categoryFields.length ? (
          <section className="replication-analysis-output replication-photo-category-board" aria-label="写真反推分类">
            <header className="replication-photo-category-summary">
              <strong>写真分析</strong>
              <span>{categoryFields.length} 个分类 · 展开后可编辑并单独连线</span>
            </header>
            {data.replicationOutputText ? <p className="replication-photo-summary">{data.replicationOutputText}</p> : null}
            <div className="replication-category-groups">
              {categoryGroups.map(([groupId, group]) => (
                <details className="replication-category-group" key={groupId} open>
                  <summary className="replication-category-group-summary">
                    <strong>{group.title}</strong>
                    <span>{group.fields.length} 项</span>
                  </summary>
                  <div className="replication-category-list">
                    {group.fields.map((field) => (
                      <details className="replication-category-item" key={field.id}>
                        <summary className="replication-category-item-summary">
                          <span className="replication-category-item-copy">
                            <strong>{field.title}</strong>
                            <span>{field.body?.trim() ? "已填写 · 点击展开修改" : "待补充 · 点击展开填写"}</span>
                          </span>
                          <Handle
                            type="source"
                            position={Position.Right}
                            id={`category:${field.id}`}
                            className="workflow-field-handle workflow-field-handle-right replication-category-handle"
                            title={`单独连接：${field.title}`}
                          />
                        </summary>
                        <AutoResizeTextarea
                          nodeId={id}
                          className="replication-category-editor nodrag nowheel"
                          aria-label={`${group.title}：${field.title}`}
                          value={field.body}
                          placeholder="填写或修订这一分类的观察结果"
                          onFocus={() => taskNodeActions?.beginNodeEdit()}
                          onChange={(event) => taskNodeActions?.updateNodeData(id, {
                            replicationCategoryFields: categoryFields.map((item) => item.id === field.id
                              ? { ...item, body: event.currentTarget.value, edited: true }
                              : item)
                          })}
                          onBlur={() => taskNodeActions?.commitNodeEdit()}
                        />
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ) : (
          <section className="replication-analysis-output" aria-label="反推分析结果">
            <strong>反推分析结果</strong>
            <div>{data.replicationOutputText || "尚未分析。运行后，结构化结果会显示在这里并传给下游提示词节点。"}</div>
          </section>
        )}
      </div>
    </NodeShell>
  );
}

function ReplicationScopeNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  const kind = data.replicationScopeKind === "photo" ? "photo" : data.replicationScopeKind === "video" ? "video" : data.replicationScopeKind === "segment" ? "segment" : "role";
  const sectionCount = replicationScopeSectionSpecs[kind].length;
  const label = kind === "photo" ? t("workflow.replicationScopePhoto") : kind === "video" ? t("workflow.replicationScopeVideo") : kind === "segment" ? t("workflow.replicationScopeSegment") : t("workflow.replicationScopeRole");
  const help = kind === "photo" ? t("workflow.replicationScopePhotoHelp") : kind === "video" ? t("workflow.replicationScopeVideoHelp") : kind === "segment" ? t("workflow.replicationScopeSegmentHelp") : data.replicationMode === "photo" ? t("workflow.replicationScopeRolePhotoHelp") : t("workflow.replicationScopeRoleVideoHelp");
  const isPhoto = data.replicationMode === "photo";
  const scopeInstructions = data.body?.trim() || help;

  return (
    <NodeShell id={id} data={data} selected={selected} icon={isPhoto ? (kind === "role" ? "user" : "image-square") : "tasks"} status={data.replicationScopeStale ? t("workflow.replicationScopeStale") : kind === "segment" && data.replicationTimeRangeValid === false ? t("workflow.replicationTimelineNeedsCorrection") : label}>
      <div className="replication-scope-content nodrag">
        <label className="replication-scope-field">
          <span>{t("workflow.replicationScopeName")}</span>
          <input
            className="nodrag"
            value={data.replicationScopeName || data.title}
            aria-label={t("workflow.replicationScopeName")}
            onFocus={() => taskNodeActions?.beginNodeEdit()}
            onChange={(event) => taskNodeActions?.updateReplicationScope?.(id, { replicationScopeName: event.currentTarget.value, title: event.currentTarget.value })}
            onBlur={() => taskNodeActions?.commitNodeEdit()}
          />
        </label>
        {kind === "segment" ? (
          <label className="replication-scope-field">
            <span>{t("workflow.replicationTimeRange")}</span>
            <input
              className="nodrag"
              value={data.replicationTimeRange || ""}
              placeholder="00:00.000–00:02.000"
              aria-label={t("workflow.replicationTimeRange")}
              onFocus={() => taskNodeActions?.beginNodeEdit()}
              onChange={(event) => taskNodeActions?.updateReplicationScope?.(id, { replicationTimeRange: event.currentTarget.value })}
              onBlur={() => taskNodeActions?.commitNodeEdit()}
            />
          </label>
        ) : null}
        {kind === "segment" && data.replicationTimeRangeValid === false ? <p className="workflow-error" role="alert">{t("workflow.replicationTimelineNeedsCorrection")}</p> : null}
        {data.replicationScopeStale ? <p className="workflow-node-intro">{t("workflow.replicationScopeStaleHelp")}</p> : null}
        {isPhoto
          ? <ReplicationInstructionsDisclosure body={scopeInstructions} className="replication-photo-instructions" />
          : <p className="workflow-node-intro">{help}</p>}
        <span className="replication-scope-count">{t("workflow.replicationScopeCategories", { count: sectionCount })}</span>
      </div>
    </NodeShell>
  );
}

function ReplicationSectionNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  const isPhoto = data.replicationMode === "photo";
  const sectionTitle = isPhoto ? photoSectionHeader(data) : null;
  return (
    <NodeShell
      id={id}
      data={data}
      selected={selected}
      icon={isPhoto ? "image-square" : "tasks"}
      displayTitle={sectionTitle?.title}
      titleSubtitle={sectionTitle?.subtitle}
      status={data.replicationScopeStale ? t("workflow.replicationScopeStale") : data.replicationSectionEdited ? t("workflow.replicationSectionEdited") : t("workflow.replicationSectionReview")}
    >
      <div className="replication-section-content nodrag">
        {data.replicationScopeStale
          ? <p className="workflow-node-intro" role="status">{t("workflow.replicationSectionStaleHelp")}</p>
          : !isPhoto
            ? <p className="workflow-node-intro">{data.body ? t("workflow.replicationSectionReadyHelp") : t("workflow.replicationSectionEmptyHelp")}</p>
            : null}
        <AutoResizeTextarea
          nodeId={id}
          className="replication-section-editor nodrag nowheel"
          aria-label={t("workflow.replicationSectionContentLabel", { title: data.title })}
          value={data.body || ""}
          placeholder={t("workflow.replicationSectionPlaceholder")}
          onFocus={() => taskNodeActions?.beginNodeEdit()}
          onChange={(event) => taskNodeActions?.updateNodeData(id, { body: event.currentTarget.value, replicationSectionEdited: true })}
          onBlur={() => taskNodeActions?.commitNodeEdit()}
        />
      </div>
    </NodeShell>
  );
}

function photoSectionHeader(data: ScatterNodeData): { title: string; subtitle: string } | null {
  const scopeName = data.replicationScopeName?.trim();
  if (!scopeName) return null;
  const prefix = `${scopeName} · `;
  if (!data.title.startsWith(prefix)) return null;
  const title = data.title.slice(prefix.length).trim();
  return title ? { title, subtitle: scopeName } : null;
}

function ReplicationInstructionsDisclosure({ body, className }: { body: string; className?: string }): ReactElement | null {
  const { language } = useI18n();
  const text = body.trim();
  if (!text) return null;
  const summary = summarizePhotoInstructions(text);
  const expandLabel = language === "zh" ? "展开说明" : "Show details";
  const collapseLabel = language === "zh" ? "收起说明" : "Hide details";
  return (
    <details className={`replication-instructions ${className || ""}`}>
      <summary>
        <span className="replication-instructions-summary">{summary}</span>
        <span className="replication-instructions-action replication-instructions-action-closed">{expandLabel}</span>
        <span className="replication-instructions-action replication-instructions-action-open">{collapseLabel}</span>
      </summary>
      <div className="replication-instructions-full">{text}</div>
    </details>
  );
}

function summarizePhotoInstructions(text: string): string {
  const firstParagraph = text.split(/\n\s*\n/, 1)[0].trim() || text;
  const firstSentence = firstParagraph.split(/[。！？!?]/, 1)[0].trim();
  const candidate = Array.from(firstSentence).length >= 12 ? firstSentence : firstParagraph;
  const characters = Array.from(candidate);
  const maxLength = 72;
  if (characters.length <= maxLength) return candidate;

  const head = characters.slice(0, maxLength);
  const clauseBoundary = Math.max(head.lastIndexOf("，"), head.lastIndexOf(","), head.lastIndexOf("；"), head.lastIndexOf(";"));
  const end = clauseBoundary >= 48 ? clauseBoundary + 1 : maxLength;
  return `${head.slice(0, end).join("").trimEnd()}…`;
}

function isMediaKind(kind: WorkflowNodeKind): kind is "image-reference" | "video-reference" {
  return kind === "image-reference" || kind === "video-reference";
}

function mediaAccept(kind: WorkflowNodeKind): "image" | "video" {
  return kind === "image-reference" ? "image" : "video";
}

function NodeShell({ id, data, selected, children, icon = "tasks", status, onRun, runDisabled = false, runLabel, onOpenModelDirectory, displayTitle, titleSubtitle }: Props & { children: ReactNode; icon?: string; status?: string; onRun?: () => void; runDisabled?: boolean; runLabel?: string; onOpenModelDirectory?: () => void | Promise<void>; displayTitle?: string; titleSubtitle?: string }): ReactElement {
  const { t } = useI18n();
  const previewOnly = useScatterStore((state) => state.document?.executionMode === "preview-only");
  const suppressConnectButtonClickRef = useRef(false);
  const hasParent = useScatterStore((state) => state.edges.some((edge) => edge.target === id));
  const hasChild = useScatterStore((state) => state.edges.some((edge) => edge.source === id));
  const acceptsMultipleInputs = data.nodeKind === "pixverse-generation" || data.nodeKind === "replication-comparison";
  const handleConnectButtonMouseDown = (side: ConnectedNodeSide) => (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;

    const removeListeners = (): void => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (deltaX * deltaX + deltaY * deltaY > 16) dragged = true;
    };
    const handleMouseUp = (upEvent: MouseEvent): void => {
      removeListeners();
      suppressConnectButtonClickRef.current = true;
      if (dragged) return;
      upEvent.preventDefault();
      taskNodeActions?.createConnectedNode(id, side);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };
  const handleConnectButtonClick = (side: ConnectedNodeSide) => (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (suppressConnectButtonClickRef.current) {
      suppressConnectButtonClickRef.current = false;
      event.preventDefault();
      return;
    }
    taskNodeActions?.createConnectedNode(id, side);
  };
  return (
    <div className={`task-node workflow-node workflow-node-${data.nodeKind || "task"} ${data.replicationMode === "photo" ? "is-replication-photo" : ""} ${selected ? "is-selected" : ""}`} data-node-id={id}>
      <Handle type="target" position={Position.Left} className="node-handle" isConnectableStart={!hasParent} isConnectableEnd={!hasParent || acceptsMultipleInputs}>
        {hasParent ? <span className="node-edge-cap" aria-hidden="true" /> : <button className="node-connect-button" type="button" aria-label={t("task.connectLeft")} onMouseDown={handleConnectButtonMouseDown("left")} onClick={handleConnectButtonClick("left")}><Icon name="plus-lg" size={16} /></button>}
      </Handle>
      <div className="task-node-header workflow-node-header">
        <div className={`workflow-node-title ${titleSubtitle ? "workflow-node-title-stacked" : ""}`}>
          <Icon name={icon} size={17} />
          <span className="workflow-node-title-copy">
            <strong>{displayTitle || data.title || kindLabel[data.nodeKind || "task"]}</strong>
            {titleSubtitle ? <small className="workflow-node-subtitle">{titleSubtitle}</small> : null}
          </span>
        </div>
        {status ? <span className="workflow-node-status">{status}</span> : null}
        {onRun ? <TooltipAnchor className="nodrag" label={previewOnly ? t("status.previewOnly") : runLabel || t("workflow.runDepth")} shortcut={shortcuts.runCurrentTask}><IconButton className="nodrag" filled={false} icon="play-1" size="lg" aria-label={previewOnly ? t("status.previewOnly") : runLabel || t("workflow.runDepth")} disabled={previewOnly || runDisabled} onClick={onRun} /></TooltipAnchor> : null}
        <RadixDropdownMenu.Root>
          <RadixDropdownMenu.Trigger asChild>
            <IconButton className="nodrag" filled={false} icon="dots-horizontal" size="lg" aria-label={t("workflow.nodeMenu")} />
          </RadixDropdownMenu.Trigger>
          <RadixDropdownMenu.Portal>
            <RadixDropdownMenu.Content className="dropdown-content node-action-menu" sideOffset={8} align="end">
              {onOpenModelDirectory ? <RadixDropdownMenu.Item asChild onSelect={() => void onOpenModelDirectory()}><ActionMenuItem icon="folder-open" label={t("workflow.openModelDirectory")} /></RadixDropdownMenu.Item> : null}
              <RadixDropdownMenu.Item asChild><ActionMenuItem icon="copy" label={t("workflow.copyNode")} onClick={() => taskNodeActions?.duplicateNode(id)} /></RadixDropdownMenu.Item>
              <RadixDropdownMenu.Item asChild onSelect={() => taskNodeActions?.deleteNode(id)}><ActionMenuItem icon="trash" label={t("workflow.deleteNode")} /></RadixDropdownMenu.Item>
            </RadixDropdownMenu.Content>
          </RadixDropdownMenu.Portal>
        </RadixDropdownMenu.Root>
      </div>
      <div className="task-node-card workflow-node-card">{children}</div>
      <Handle type="source" position={Position.Right} className="node-handle">
        {hasChild ? <span className="node-edge-cap" aria-hidden="true" /> : null}
        <button className="node-connect-button" type="button" aria-label={t("task.connectRight")} onMouseDown={handleConnectButtonMouseDown("right")} onClick={handleConnectButtonClick("right")}><Icon name="plus-lg" size={16} /></button>
      </Handle>
    </div>
  );
}

function MediaPreview({ data, accept, onVideoMetadata }: { data: ScatterNodeData; accept: "image" | "video"; onVideoMetadata?: (durationMs: number) => void }): ReactElement {
  const { t } = useI18n();
  const attachment = firstMediaAttachment(data, accept);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  useEffect(() => setAspectRatio(null), [attachment?.id]);
  if (!attachment) return <div className="workflow-upload-empty"><Icon name="plus-lg" size={22} /><strong>{t(accept === "image" ? "workflow.uploadImage" : "workflow.uploadVideo")}</strong><span>{t("workflow.dropMedia")}</span><small>{t(accept === "image" ? "workflow.onlyImage" : "workflow.onlyVideo")}</small></div>;
  const frameStyle = aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined;
  const setImageRatio = (event: SyntheticEvent<HTMLImageElement>): void => {
    const image = event.currentTarget;
    if (image.naturalWidth && image.naturalHeight) setAspectRatio(image.naturalWidth / image.naturalHeight);
  };
  const setVideoRatio = (event: SyntheticEvent<HTMLVideoElement>): void => {
    const video = event.currentTarget;
    if (video.videoWidth && video.videoHeight) setAspectRatio(video.videoWidth / video.videoHeight);
    if (Number.isFinite(video.duration) && video.duration > 0) onVideoMetadata?.(Math.round(video.duration * 1_000));
  };
  return (
    <div className="workflow-media-preview">
      <div className={`workflow-media-frame ${aspectRatio ? "has-ratio" : "is-loading"}`} style={frameStyle}>
        {accept === "video" ? <video key={attachment.id} className="nodrag nopan" controls preload="metadata" playsInline onLoadedMetadata={setVideoRatio}><source src={attachment.fileUrl} type={attachment.mime} /></video> : <img key={attachment.id} src={attachment.fileUrl} alt={attachment.originalName} onLoad={setImageRatio} />}
      </div>
      <div className="workflow-media-meta"><span>{attachment.originalName}</span></div>
    </div>
  );
}

function MediaNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceOnNextPickRef = useRef(false);
  const kind = mediaAccept(data.nodeKind || "video-reference");
  const attachment = firstMediaAttachment(data, kind);
  const rememberVideoDuration = (durationMs: number): void => {
    const currentAttachment = data.attachments.find((item) => item.id === attachment?.id);
    if (!currentAttachment || currentAttachment.kind !== "video" || currentAttachment.durationMs === durationMs) return;
    taskNodeActions?.updateNodeData(id, {
      attachments: data.attachments.map((item) => item.id === currentAttachment.id ? { ...item, durationMs } : item)
    });
  };
  const handleFiles = (files: FileList | File[], source: "upload" | "drop", replace = false): void => {
    const filtered = filterMediaFiles(files, kind);
    if (!filtered.length) return;
    void (replace ? taskNodeActions?.replaceFilesForNode(id, filtered, source, kind) : taskNodeActions?.addFilesToNode(id, filtered, source, kind));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    handleFiles(event.dataTransfer.files, "drop", Boolean(attachment));
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (event.currentTarget.files) handleFiles(event.currentTarget.files, "upload", replaceOnNextPickRef.current);
    replaceOnNextPickRef.current = false;
    event.currentTarget.value = "";
  };
  const openPicker = (replace: boolean): void => {
    replaceOnNextPickRef.current = replace;
    inputRef.current?.click();
  };
  return (
    <NodeShell id={id} data={data} selected={selected} icon={kind === "image" ? "image-square, picture, library.svg" : "video"}>
      <input ref={inputRef} className="workflow-file-input" type="file" accept={mediaAcceptMime(kind)} onChange={onChange} />
      <div className="workflow-upload-zone nodrag" onClick={() => { if (!attachment) openPicker(false); }} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <MediaPreview data={data} accept={kind} onVideoMetadata={kind === "video" ? rememberVideoDuration : undefined} />
      </div>
      {attachment ? <button className="workflow-replace-button nodrag" type="button" onClick={() => openPicker(true)}>{t("workflow.replaceMedia")}</button> : null}
    </NodeShell>
  );
}

function ReferenceBindingNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  return (
    <NodeShell id={id} data={data} selected={selected} icon="connectors, connected-apps.svg" status={t("workflow.bindingStatus")}>
      <p className="workflow-node-intro">{t("workflow.bindingIntro")}</p>
      <div className="workflow-reference-fields">
        {seedanceReferenceFields.map((field) => (
          <div className="workflow-reference-row" key={field.id}>
            <Handle type="target" position={Position.Left} id={`field:${field.id}`} className="workflow-field-handle workflow-field-handle-left" />
            <span>{field.label}</span>
            <input className="nodrag" value={data.referenceFields?.[field.id] || t("workflow.followTarget")} onChange={(event) => taskNodeActions?.updateNodeData(id, { referenceFields: { ...(data.referenceFields || {}), [field.id]: event.currentTarget.value } })} />
            <Handle type="source" position={Position.Right} id={`field:${field.id}`} className="workflow-field-handle workflow-field-handle-right" />
          </div>
        ))}
      </div>
    </NodeShell>
  );
}

type DepthSettingOption = { value: string; label: string; disabled?: boolean };

function DepthSettingSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: DepthSettingOption[] }): ReactElement {
  const selectedOption = options.find((option) => option.value === value) || options[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="workflow-depth-select-row" role="group" aria-label={label}>
      <span className="workflow-depth-select-label">{label}</span>
      <div ref={pickerRef} className="workflow-depth-select-picker">
        <DropdownTrigger
          className="workflow-depth-select-control nodrag"
          label={selectedOption?.label || value}
          aria-label={`${label}: ${selectedOption?.label || value}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        />
        {menuOpen ? (
          <DropdownMenu className="workflow-depth-select-menu nodrag nopan nowheel" role="menu" aria-label={label}>
            {options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                label={option.label}
                selected={option.value === value}
                disabled={option.disabled}
                className="workflow-depth-select-option nodrag nopan nowheel"
                role="menuitemradio"
                aria-checked={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setMenuOpen(false);
                }}
              />
            ))}
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

function DepthConversionNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  const project = useScatterStore((state) => state.project);
  const [modelNoticeVisible, setModelNoticeVisible] = useState(false);
  const modelNoticeTimerRef = useRef<number | null>(null);
  const status = data.depthStatus === "completed" ? t("workflow.depthReady") : data.depthStatus === "preparing" ? t("workflow.depthPreparingModel", { progress: data.depthProgress || 0 }) : data.depthStatus === "cpu-fallback" ? t("workflow.depthCpuFallback") : data.depthStatus === "converting" ? t("workflow.depthConverting", { progress: data.depthProgress || 0 }) : data.depthStatus === "error" ? t("workflow.depthFailed") : undefined;
  const dismissModelNotice = (): void => {
    if (modelNoticeTimerRef.current !== null) {
      window.clearTimeout(modelNoticeTimerRef.current);
      modelNoticeTimerRef.current = null;
    }
    setModelNoticeVisible(false);
  };
  const handleModelChange = (value: string): void => {
    if ((data.depthModel || "small") === value) return;
    taskNodeActions?.updateNodeData(id, { depthModel: value as "small" | "base" | "large" });
    if (modelNoticeTimerRef.current !== null) window.clearTimeout(modelNoticeTimerRef.current);
    setModelNoticeVisible(true);
    modelNoticeTimerRef.current = window.setTimeout(() => {
      modelNoticeTimerRef.current = null;
      setModelNoticeVisible(false);
    }, 7000);
  };
  useEffect(() => () => {
    if (modelNoticeTimerRef.current !== null) window.clearTimeout(modelNoticeTimerRef.current);
  }, []);
  const openModelDirectory = async (): Promise<void> => {
    if (!project) return;
    const modelStatus = await window.scatter.getDepthModelStatus(project.path, data.depthModel || "small");
    await window.scatter.showInFolder(modelStatus.directory);
  };
  return (
    <>
    <NodeShell id={id} data={data} selected={selected} icon="video" status={status} onRun={() => void taskNodeActions?.runDepthConversion?.(id)} runDisabled={data.depthStatus === "converting"} onOpenModelDirectory={openModelDirectory}>
      <div className="workflow-depth-settings nodrag">
        <div className="workflow-depth-control-list">
          <DepthSettingSelect label={t("workflow.processingMode")} value={data.depthProcessingMode || "quality"} onChange={(value) => taskNodeActions?.updateNodeData(id, { depthProcessingMode: value as "quality" | "speed" })} options={[
            { value: "quality", label: t("workflow.qualityFirst") },
            { value: "speed", label: t("workflow.speedFirst") }
          ]} />
          <DepthSettingSelect label={t("workflow.model")} value={data.depthModel || "small"} onChange={handleModelChange} options={[
            { value: "small", label: t("workflow.modelSmallShort") },
            { value: "base", label: t("workflow.modelBaseShort") },
            { value: "large", label: t("workflow.modelLargeShort") }
          ]} />
          <DepthSettingSelect label={t("workflow.resolution")} value={data.depthResolution || "original"} onChange={(value) => taskNodeActions?.updateNodeData(id, { depthResolution: value as "original" | "480p" | "720p" | "1080p" })} options={[
            { value: "original", label: t("workflow.followInput") },
            { value: "480p", label: "480p" },
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" }
          ]} />
          <label className="workflow-depth-smoothing">
            <span>{t("workflow.temporalSmoothing")}</span>
            <input type="range" min="0" max="100" aria-label={t("workflow.temporalSmoothing")} value={data.temporalSmoothing ?? 60} style={{ background: `linear-gradient(to right, var(--color-primary) ${data.temporalSmoothing ?? 60}%, var(--color-primary-subtle) ${data.temporalSmoothing ?? 60}%)` }} onChange={(event) => taskNodeActions?.updateNodeData(id, { temporalSmoothing: Number(event.currentTarget.value) })} />
            <span className="workflow-depth-smoothing-value">{data.temporalSmoothing ?? 60}%</span>
          </label>
          <small className="workflow-node-intro">{t("workflow.smoothingParityNote")}</small>
        </div>
        <div className="workflow-depth-divider" />
        <div className="workflow-depth-toggle-list">
          <Switch label={t("workflow.invert")} checked={Boolean(data.invertDepth)} onCheckedChange={(checked) => taskNodeActions?.updateNodeData(id, { invertDepth: checked })} />
          <Switch label={t("workflow.preserveAudio")} checked={Boolean(data.preserveAudio)} onCheckedChange={(checked) => taskNodeActions?.updateNodeData(id, { preserveAudio: checked })} />
        </div>
      </div>
      {data.depthError ? <p className="workflow-error" role="alert">{data.depthError}</p> : null}
    </NodeShell>
    {modelNoticeVisible ? <ToastViewport><Toast className="workflow-depth-model-toast" message={t("workflow.modelDownloadOnDemand")} onClose={dismissModelNotice} /></ToastViewport> : null}
    </>
  );
}

const pixverseParameterLabelKeys = {
  quality: "workflow.pixverseQuality",
  aspect_ratio: "workflow.pixverseAspectRatio",
  duration: "workflow.pixverseDuration",
  audio: "workflow.pixverseAudio",
  multi_shot: "workflow.pixverseMultiShot",
  off_peak: "workflow.pixverseOffPeak",
  detail_level: "workflow.pixverseDetailLevel",
  task_type: "workflow.pixverseTaskType",
  count: "workflow.pixverseCount",
  seed: "workflow.pixverseSeed"
} as const;

function parameterValueFromString(value: string, options: PixverseCapabilityValue[]): PixverseCapabilityValue {
  return options.find((option) => String(option) === value) ?? value;
}

function defaultPixverseSettings(capabilities: PixverseCreateCapabilities | null, modelId: string): Record<string, PixverseCapabilityValue> {
  if (!capabilities) return {};
  const model = capabilities.models.find((item) => item.id === modelId);
  const merged = { ...capabilities.parameters, ...(model?.parameters || {}) };
  return Object.fromEntries(Object.entries(merged)
    .filter(([key, spec]) => spec.supported !== false && !["prompt", "model", "image", "images", "videos", "audios", "wait", "timeout", "json", "idempotency_key"].includes(key) && spec.default !== undefined)
    .map(([key, spec]) => [key, spec.default!]));
}

interface PixverseReferenceRowProps {
  mediaNode: ScatterNode;
  assignment: TaskReferenceAssignment;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAliasChange: (alias: string) => void;
  onPurposeChange: (purpose: string) => void;
  onRoleChange: (analysisOnly: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onUnlink: () => void;
  onInsert: (alias: string) => void;
}

function PixverseReferenceRow({ mediaNode, assignment, canMoveUp, canMoveDown, onAliasChange, onPurposeChange, onRoleChange, onMove, onUnlink, onInsert }: PixverseReferenceRowProps): ReactElement {
  const { t } = useI18n();
  const [aliasDraft, setAliasDraft] = useState(assignment.alias);
  const [purposeDraft, setPurposeDraft] = useState(assignment.purpose);
  const attachmentNames = mediaNode.data.attachments.map((attachment) => attachment.originalName).filter(Boolean);
  const title = attachmentNames.length ? attachmentNames.join(" · ") : mediaNode.data.title;

  useEffect(() => setAliasDraft(assignment.alias), [assignment.alias]);
  useEffect(() => setPurposeDraft(assignment.purpose), [assignment.purpose]);

  return (
    <div className="workflow-pixverse-reference-item">
      <div className="workflow-pixverse-reference-heading">
        <Icon name={assignment.kind === "image" ? "image-square, picture, library.svg" : "video"} size={14} />
        <span className="workflow-pixverse-reference-name" title={title}>{title}</span>
        {assignment.analysisOnly ? <span className="reference-alias-badge">{t("task.referenceAnalysisOnlyBadge")}</span> : null}
      </div>
      {assignment.kind === "image" || assignment.kind === "video" ? (
        <select
          className="workflow-pixverse-reference-role"
          value={assignment.analysisOnly ? "analysis" : "reference"}
          onChange={(event) => onRoleChange(event.currentTarget.value === "analysis")}
          aria-label={t("task.referenceRoleLabel")}
        >
          <option value="reference">{t("task.referenceRoleNumbered")}</option>
          <option value="analysis">{t("task.referenceRoleAnalysisOnly")}</option>
        </select>
      ) : null}
      <div className="workflow-pixverse-reference-edit-row">
        {assignment.analysisOnly ? null : (
          <input
            className="workflow-pixverse-reference-alias"
            value={aliasDraft}
            aria-label={t("task.referenceAlias")}
            spellCheck={false}
            onChange={(event) => setAliasDraft(event.currentTarget.value)}
            onBlur={() => {
              if (aliasDraft.trim() !== assignment.alias) onAliasChange(aliasDraft);
              setAliasDraft(assignment.alias);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
            }}
          />
        )}
        <input
          className="workflow-pixverse-reference-purpose"
          value={purposeDraft}
          placeholder={t("task.referencePurposePlaceholder")}
          aria-label={t("task.referencePurposePlaceholder")}
          onChange={(event) => setPurposeDraft(event.currentTarget.value)}
          onBlur={() => {
            if (purposeDraft !== assignment.purpose) onPurposeChange(purposeDraft);
            setPurposeDraft(assignment.purpose);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
          }}
        />
        <div className="workflow-pixverse-reference-actions">
          {!assignment.analysisOnly && assignment.alias ? <TooltipAnchor label={t("task.referenceInsert")}>
            <IconButton className="nodrag" filled={false} icon="plus-lg" size="sm" aria-label={t("task.referenceInsert")} onClick={() => onInsert(assignment.alias)} />
          </TooltipAnchor> : null}
          <TooltipAnchor label={t("task.referenceMoveUp")}>
            <IconButton className="nodrag" filled={false} icon="chevron-up" size="sm" aria-label={t("task.referenceMoveUp")} disabled={!canMoveUp} onClick={() => onMove(-1)} />
          </TooltipAnchor>
          <TooltipAnchor label={t("task.referenceMoveDown")}>
            <IconButton className="nodrag" filled={false} icon="chevron-down" size="sm" aria-label={t("task.referenceMoveDown")} disabled={!canMoveDown} onClick={() => onMove(1)} />
          </TooltipAnchor>
          <TooltipAnchor label={t("task.referenceUnlink")}>
            <IconButton className="nodrag" filled={false} icon="x" size="sm" aria-label={t("task.referenceUnlink")} onClick={onUnlink} />
          </TooltipAnchor>
        </div>
      </div>
    </div>
  );
}

function PixverseGenerationNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  const nodes = useScatterStore((state) => state.nodes);
  const edges = useScatterStore((state) => state.edges);
  const pixverseImageDefaultModel = useScatterStore((state) => state.pixverseImageDefaultModel);
  const pixverseImageDefaultModelReady = useScatterStore((state) => state.pixverseImageDefaultModelReady);
  const setPixverseImageCliDefaultModel = useScatterStore((state) => state.setPixverseImageCliDefaultModel);
  const photoOnly = data.replicationMode === "photo";
  const mode = photoOnly ? "image" : data.pixverseMode || "video";
  const videoMethod = data.pixverseVideoMethod || "create";
  const createMode: PixverseCreateMode = mode === "image" ? "image" : videoMethod === "reference" ? "reference" : "video";
  const [capabilities, setCapabilities] = useState<PixverseCreateCapabilities | null>(null);
  const [capabilitiesMode, setCapabilitiesMode] = useState<PixverseCreateMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [capabilityFailed, setCapabilityFailed] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setCapabilityFailed(false);
    setCapabilities(null);
    setCapabilitiesMode(null);
    void window.scatter.getPixverseCapabilities(createMode).then((result) => {
      if (!current) return;
      if (!result.capabilities) {
        setCapabilityFailed(true);
        return;
      }
      setCapabilities(result.capabilities);
      setCapabilitiesMode(createMode);
      if (createMode === "image") setPixverseImageCliDefaultModel(result.capabilities.defaultModel);
    }).catch(() => {
      if (current) setCapabilityFailed(true);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [createMode, setPixverseImageCliDefaultModel]);

  useEffect(() => {
    if (!capabilities || capabilitiesMode !== createMode) return;
    if (createMode === "image" && !pixverseImageDefaultModelReady) return;

    const state = useScatterStore.getState();
    const currentNode = state.nodes.find((item) => item.id === id);
    if (!currentNode) return;

    const currentModel = currentNode.data.pixverseModel;
    const currentSource = currentNode.data.pixverseModelSource;
    const followsDefault = currentSource === "default"
      || (currentSource !== "custom" && (!currentModel || currentModel === capabilities.defaultModel));
    if (!followsDefault) return;

    const preferredImageModelExists = capabilities.models.some((item) => item.id === pixverseImageDefaultModel);
    const defaultModel = createMode === "image" && preferredImageModelExists
      ? pixverseImageDefaultModel
      : capabilities.defaultModel;
    if (currentModel === defaultModel) return;

    state.replaceCanvasLive({
      nodes: state.nodes.map((item) => item.id === id
        ? {
            ...item,
            data: {
              ...item.data,
              pixverseModel: defaultModel,
              pixverseModelSource: "default",
              ...(currentModel !== defaultModel ? { pixverseSettings: {} } : {})
            }
          }
        : item)
    });
  }, [capabilities, capabilitiesMode, createMode, id, pixverseImageDefaultModel, pixverseImageDefaultModelReady]);

  const connectedSources = edges
    .filter((edge) => edge.target === id && !edge.targetHandle)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is ScatterNode => Boolean(node));
  const referenceAssignments = data.referenceAssignments || {};
  const connectedMediaNodes = connectedSources.filter((node) => node.data.nodeKind === "image-reference" || node.data.nodeKind === "video-reference")
    .map((node, index) => ({ node, order: referenceAssignments[node.id]?.order ?? index }))
    .sort((a, b) => a.order - b.order)
    .map(({ node }) => node);
  const promptCandidates = connectedSources.filter((node) => node.data.nodeKind === "generic-prompt" && node.data.genericPromptText?.trim());
  const connectedPrompt = promptCandidates.find((node) => node.data.replicationAnalysisNodeId === data.replicationAnalysisNodeId)
    || (data.replicationAnalysisNodeId ? undefined : promptCandidates[0])
    || (data.replicationAnalysisNodeId ? undefined : connectedSources.find((node) => (node.data.nodeKind === "task" || !node.data.nodeKind) && node.data.body?.trim()));
  const requiresDepthVideo = data.replicationMode === "video"
    || connectedPrompt?.data.replicationMode === "video";
  const depthOutputIds = depthOutputVideoIds(nodes, edges);
  const videoAnalysisSourceIds = new Set(edges
    .filter((edge) => {
      if (edge.targetHandle) return false;
      const target = nodes.find((node) => node.id === edge.target);
      return target?.data.nodeKind === "replication-analysis" || target?.data.nodeKind === "replication-comparison";
    })
    .map((edge) => edge.source));
  const generationMediaNodes = connectedMediaNodes.filter((node) => canUseGenerationMedia(
    referenceAssignments[node.id],
    node.data.nodeKind === "video-reference",
    videoAnalysisSourceIds.has(node.id),
    depthOutputIds.has(node.id),
    requiresDepthVideo
  ));
  const hasMissingAssignedImage = connectedMediaNodes.some((node) => {
    const assignment = referenceAssignments[node.id];
    return assignment?.kind === "image"
      && !assignment.analysisOnly
      && Boolean(assignment.alias?.trim())
      && !node.data.attachments.some((attachment) => attachment.kind === "image");
  });
  const promptFromConnection = connectedPrompt?.data.genericPromptText?.trim() || connectedPrompt?.data.body?.trim() || "";
  const prompt = data.body || promptFromConnection;
  const isFollowingDefault = data.pixverseModelSource === "default"
    || (data.pixverseModelSource !== "custom" && (!data.pixverseModel || data.pixverseModel === capabilities?.defaultModel));
  const preferredImageModelExists = Boolean(capabilities?.models.some((item) => item.id === pixverseImageDefaultModel));
  const effectiveDefaultModel = mode === "image" && pixverseImageDefaultModelReady && preferredImageModelExists
    ? pixverseImageDefaultModel
    : capabilities?.defaultModel || "";
  const modelId = mode === "image" && isFollowingDefault
    ? effectiveDefaultModel
    : data.pixverseModel || capabilities?.defaultModel || "";
  const selectedModel = capabilities?.models.find((model) => model.id === modelId);
  const globalParameterSpecs = capabilities?.parameters || {};
  const modelParameterSpecs = selectedModel?.parameters || {};
  const parameterSpecs: Record<string, PixverseParameterCapability> = Object.fromEntries(
    Object.entries({ ...globalParameterSpecs, ...modelParameterSpecs }).map(([name, spec]) => [
      name,
      { ...(globalParameterSpecs[name] || {}), ...spec }
    ])
  );
  const currentSettings = {
    ...defaultPixverseSettings(capabilities, modelId),
    ...(data.pixverseSettings || {})
  };
  const parameterEntries = Object.entries(parameterSpecs).filter(([key, spec]) =>
    spec.supported !== false
    && Boolean(spec.flag)
    && !["prompt", "model", "image", "images", "videos", "audios", "wait", "timeout", "json", "idempotency_key"].includes(key)
  );
  const status = data.pixverseStatus === "running" ? t("workflow.pixverseRunning")
    : data.pixverseStatus === "completed" ? t("workflow.depthReady")
      : data.pixverseStatus === "error" ? t("workflow.pixverseFailed") : undefined;
  const errorText = (() => {
    switch (data.pixverseError as PixverseGenerationError | undefined) {
      case "cli-not-found": return t("workflow.pixverseError.cli-not-found");
      case "capabilities-failed": return t("workflow.pixverseError.capabilities-failed");
      case "not-authenticated": return t("workflow.pixverseError.not-authenticated");
      case "insufficient-credits": return t("workflow.pixverseError.insufficient-credits");
      case "timeout": return t("workflow.pixverseError.timeout");
      case "invalid-request": return t("workflow.pixverseError.invalid-request");
      case "prompt-required": return t("workflow.pixverseError.prompt-required");
      case "reference-required": return t("workflow.pixverseError.reference-required");
      case "generation-failed": return t("workflow.pixverseError.generation-failed");
      case "download-failed": return t("workflow.pixverseError.download-failed");
      default: return "";
    }
  })();

  const updateSetting = (name: string, value: PixverseCapabilityValue): void => {
    taskNodeActions?.updateNodeData(id, {
      pixverseSettings: { ...(data.pixverseSettings || {}), [name]: value },
      pixverseStatus: "idle",
      pixverseError: undefined
    });
  };
  const changeMode = (nextMode: "image" | "video"): void => {
    if (photoOnly && nextMode !== "image") return;
    taskNodeActions?.updateNodeData(id, { pixverseMode: nextMode, pixverseSettings: {}, pixverseStatus: "idle", pixverseError: undefined });
  };
  const changeVideoMethod = (nextMethod: "create" | "reference"): void => {
    taskNodeActions?.updateNodeData(id, { pixverseVideoMethod: nextMethod, pixverseSettings: {}, pixverseStatus: "idle", pixverseError: undefined });
  };
  const insertReference = (alias: string): void => {
    const textarea = promptRef.current;
    const current = data.body || promptFromConnection;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : "";
    const next = `${before}${prefix}${alias}${suffix}${after}`;
    const cursor = before.length + prefix.length + alias.length + suffix.length;
    taskNodeActions?.updateNodeData(id, { body: next, pixverseStatus: "idle", pixverseError: undefined });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };
  const changeModel = (nextModel: string): void => {
    taskNodeActions?.updateNodeData(id, { pixverseModel: nextModel, pixverseModelSource: "custom", pixverseSettings: {}, pixverseStatus: "idle", pixverseError: undefined });
  };
  const canRun = Boolean(capabilities && modelId && prompt.trim())
    && data.pixverseStatus !== "running"
    && !hasMissingAssignedImage
    && !(createMode === "reference" && generationMediaNodes.length === 0);

  return (
    <NodeShell id={id} data={data} selected={selected} icon={mode === "image" ? "image-square, picture, library.svg" : "video"} status={status} runLabel={t("workflow.pixverseRun")} onRun={() => void taskNodeActions?.runPixverseGeneration?.(id)} runDisabled={!canRun}>
      <div className="workflow-pixverse-settings nodrag">
        {photoOnly ? (
          <div className="workflow-pixverse-mode-row is-photo-only" role="group" aria-label={t("workflow.pixverseMode")}>
            <span className="workflow-pixverse-mode is-active">{t("workflow.pixverseImageMode")}</span>
          </div>
        ) : (
          <div className="workflow-pixverse-mode-row" role="group" aria-label={t("workflow.pixverseMode")}>
            <button type="button" className={`workflow-pixverse-mode ${mode === "image" ? "is-active" : ""}`} onClick={() => changeMode("image")}>{t("workflow.pixverseImageMode")}</button>
            <button type="button" className={`workflow-pixverse-mode ${mode === "video" ? "is-active" : ""}`} onClick={() => changeMode("video")}>{t("workflow.pixverseVideoMode")}</button>
          </div>
        )}
        {mode === "video" ? (
          <div className="workflow-pixverse-method-row" role="group" aria-label={t("workflow.pixverseVideoMode")}>
            <button type="button" className={`workflow-pixverse-method ${videoMethod === "create" ? "is-active" : ""}`} onClick={() => changeVideoMethod("create")}>{t("workflow.pixverseVideoCreate")}</button>
            <button type="button" className={`workflow-pixverse-method ${videoMethod === "reference" ? "is-active" : ""}`} onClick={() => changeVideoMethod("reference")}>{t("workflow.pixverseVideoReference")}</button>
          </div>
        ) : null}
        <label className="workflow-pixverse-prompt-label" htmlFor={`pixverse-prompt-${id}`}>{t("workflow.pixversePrompt")}</label>
        <AutoResizeTextarea
          nodeId={id}
          ref={promptRef}
          id={`pixverse-prompt-${id}`}
          className="workflow-pixverse-prompt nodrag nowheel"
          value={data.body || promptFromConnection}
          placeholder={t("workflow.pixversePromptPlaceholder")}
          onChange={(event) => taskNodeActions?.updateNodeData(id, { body: event.currentTarget.value, pixverseStatus: "idle", pixverseError: undefined })}
        />
        <section className="workflow-pixverse-inputs" aria-label={t("workflow.pixverseInputs")}>
          <strong>{t("workflow.pixverseInputs")}</strong>
          {connectedMediaNodes.length ? connectedMediaNodes.map((node, index) => {
            const assignment = referenceAssignments[node.id] || {
              kind: node.data.nodeKind === "image-reference" ? "image" as const : "video" as const,
              alias: node.data.nodeKind === "image-reference" ? `@图${index + 1}` : `@视频${index + 1}`,
              purpose: "",
              order: index
            };
            return <PixverseReferenceRow
              key={node.id}
              mediaNode={node}
              assignment={assignment}
              canMoveUp={index > 0}
              canMoveDown={index < connectedMediaNodes.length - 1}
              onAliasChange={(alias) => taskNodeActions?.updateReferenceAlias(id, node.id, alias)}
              onPurposeChange={(purpose) => taskNodeActions?.updateReferencePurpose(id, node.id, purpose)}
              onRoleChange={(analysisOnly) => taskNodeActions?.updateReferenceRole(id, node.id, analysisOnly)}
              onMove={(direction) => taskNodeActions?.moveReference(id, node.id, direction)}
              onUnlink={() => taskNodeActions?.unlinkReference(id, node.id)}
              onInsert={insertReference}
            />;
          }) : <small>{t("workflow.pixverseNoInputs")}</small>}
        </section>
        {hasMissingAssignedImage ? <p className="workflow-error" role="alert">{t("workflow.pixverseError.reference-required")}</p> : null}
        {loading ? <p className="workflow-node-intro">{t("workflow.pixverseModelLoading")}</p> : capabilityFailed ? <p className="workflow-error" role="alert">{t("workflow.pixverseModelUnavailable")}</p> : capabilities ? (
          <div className="workflow-pixverse-controls">
            <DepthSettingSelect
              label={t("workflow.model")}
              value={modelId}
              onChange={changeModel}
              options={capabilities.models.map((model) => ({ value: model.id, label: model.displayName }))}
            />
            {parameterEntries.map(([name, spec]) => {
              const labelKey = pixverseParameterLabelKeys[name as keyof typeof pixverseParameterLabelKeys];
              const label = labelKey ? t(labelKey) : name.replaceAll("_", " ");
              const value = currentSettings[name];
              if (spec.type === "boolean" || typeof spec.default === "boolean") {
                return <Switch key={name} label={label} checked={typeof value === "boolean" ? value : Boolean(spec.default)} onCheckedChange={(checked) => updateSetting(name, checked)} />;
              }
              if (spec.enum?.length) {
                const defaultValue = spec.default ?? spec.enum[0];
                const selectedValue = value ?? defaultValue;
                return <DepthSettingSelect
                  key={name}
                  label={label}
                  value={String(selectedValue)}
                  onChange={(next) => updateSetting(name, parameterValueFromString(next, spec.enum || []))}
                  options={spec.enum.map((option) => ({ value: String(option), label: name === "duration" && option === 0 ? t("workflow.pixverseAuto") : String(option) }))}
                />;
              }
              if (spec.type === "integer" || name === "count" || name === "seed") {
                return <label className="workflow-pixverse-number-row" key={name}>
                  <span>{label}</span>
                  <input
                    className="workflow-pixverse-number nodrag"
                    type="number"
                    min={spec.min}
                    max={spec.max}
                    value={typeof value === "number" ? value : ""}
                    onChange={(event) => {
                      if (event.currentTarget.value === "") return;
                      updateSetting(name, Number(event.currentTarget.value));
                    }}
                  />
                </label>;
              }
              return null;
            })}
          </div>
        ) : null}
        {data.pixverseError ? <p className="workflow-error" role="alert">{errorText}</p> : null}
      </div>
    </NodeShell>
  );
}

function RoleBindingNode({ id, data, selected }: Props): ReactElement {
  const { t } = useI18n();
  return <NodeShell id={id} data={data} selected={selected} icon="members"><p className="workflow-node-intro">{t("workflow.roleIntro")}</p><div className="workflow-role-fields"><label>{t("workflow.roleName")}<input className="nodrag" value={data.title} onChange={(event) => taskNodeActions?.updateNodeData(id, { title: event.currentTarget.value })} /></label><label className="workflow-field-row"><Handle type="target" position={Position.Left} id="field:appearance" className="workflow-field-handle workflow-field-handle-left" />{t("workflow.appearance")}<input className="nodrag" value={data.referenceFields?.appearance || t("workflow.followTarget")} onChange={(event) => taskNodeActions?.updateNodeData(id, { referenceFields: { ...(data.referenceFields || {}), appearance: event.currentTarget.value } })} /><Handle type="source" position={Position.Right} id="field:appearance" className="workflow-field-handle workflow-field-handle-right" /></label><label className="workflow-field-row"><Handle type="target" position={Position.Left} id="field:outfit" className="workflow-field-handle workflow-field-handle-left" />{t("workflow.outfit")}<input className="nodrag" value={data.referenceFields?.outfit || t("workflow.followTarget")} onChange={(event) => taskNodeActions?.updateNodeData(id, { referenceFields: { ...(data.referenceFields || {}), outfit: event.currentTarget.value } })} /><Handle type="source" position={Position.Right} id="field:outfit" className="workflow-field-handle workflow-field-handle-right" /></label></div></NodeShell>;
}

function WorkflowNodeComponent(props: Props): ReactElement {
  const kind = props.data.nodeKind || "task";
  if (isMediaKind(kind)) return <MediaNode {...props} />;
  if (kind === "replication-analysis" || kind === "replication-comparison") return <ReplicationWorkflowNode {...props} />;
  if (kind === "replication-section") return <ReplicationSectionNode {...props} />;
  if (kind === "replication-scope") return <ReplicationScopeNode {...props} />;
  if (kind === "reference-binding") return <ReferenceBindingNode {...props} />;
  if (kind === "role-binding") return <RoleBindingNode {...props} />;
  if (kind === "depth-conversion") return <DepthConversionNode {...props} />;
  if (kind === "pixverse-generation") return <PixverseGenerationNode {...props} />;
  return <MediaNode {...props} />;
}

export const WorkflowNode = memo(WorkflowNodeComponent);
