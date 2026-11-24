import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { useShallow } from "zustand/react/shallow";
import type { EffortLevel, ScatterNode, ScatterNodeData, TaskReferenceAssignment } from "../../../shared/types";
import { useI18n } from "../lib/i18n";
import { shortcuts } from "../lib/shortcuts";
import { effortLabelKey } from "../lib/translations";
import { formatBytes } from "../lib/utils";
import { useScatterStore } from "../store/scatterStore";
import { ActionMenuItem } from "./ui/action-menu-item";
import { DropdownMenu, DropdownMenuItem } from "./ui/dropdown-menu";
import { DropdownTrigger } from "./ui/dropdown-trigger";
import { IconButton } from "./ui/icon-button";
import { Icon } from "./ui/icon";
import { Switch } from "./ui/switch";
import { TooltipAnchor } from "./ui/tooltip";
import { UploadChip } from "./ui/upload-chip";
import { AutoResizeTextarea } from "./ui/auto-resize-textarea";
import { TaskSkillPicker } from "./TaskSkillPicker";
import { taskNodeActions, setTaskNodeActions, type ConnectedNodeSide } from "./nodeRuntimeActions";
import { WorkflowNode } from "./WorkflowNode";

type TaskNodeProps = NodeProps<Node<ScatterNodeData, "task">>;
type EditableField = "title" | "body";

const effortOptions: EffortLevel[] = ["low", "medium", "high", "xhigh"];

interface ReferenceMaterialRowProps {
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

function ReferenceMaterialRow({
  mediaNode,
  assignment,
  canMoveUp,
  canMoveDown,
  onAliasChange,
  onPurposeChange,
  onRoleChange,
  onMove,
  onUnlink,
  onInsert
}: ReferenceMaterialRowProps): ReactElement {
  const { t } = useI18n();
  const attachment = mediaNode.data.attachments[0];
  const [aliasDraft, setAliasDraft] = useState(assignment.alias);
  const [purposeDraft, setPurposeDraft] = useState(assignment.purpose);

  useEffect(() => setAliasDraft(assignment.alias), [assignment.alias]);
  useEffect(() => setPurposeDraft(assignment.purpose), [assignment.purpose]);

  const commitAlias = (): void => {
    if (aliasDraft.trim() !== assignment.alias) onAliasChange(aliasDraft);
    // Always snap back to the persisted alias: if the value was invalid or a
    // duplicate the parent rejected it and assignment.alias is unchanged, so
    // the controlled effect alone would not reset the visible draft.
    setAliasDraft(assignment.alias);
  };
  const commitPurpose = (): void => {
    if (purposeDraft !== assignment.purpose) onPurposeChange(purposeDraft);
    setPurposeDraft(assignment.purpose);
  };

  return (
    <div className="reference-row nodrag">
      <div className="reference-row-media">
        {attachment && attachment.kind === "image" ? (
          <img className="reference-thumb" src={attachment.fileUrl} alt={attachment.originalName} />
        ) : (
          <span className="reference-type-icon">
            <Icon name={assignment.kind === "video" ? "video" : "image-square, picture, library.svg"} size={14} />
          </span>
        )}
      </div>
      <div className="reference-row-body">
        <div className="reference-row-line">
          {assignment.kind === "image" || assignment.kind === "video" ? (
            <select
              className="reference-role"
              value={assignment.analysisOnly ? "analysis" : "reference"}
              onChange={(event) => onRoleChange(event.target.value === "analysis")}
              aria-label={t("task.referenceRoleLabel")}
            >
              <option value="reference">{t("task.referenceRoleNumbered")}</option>
              <option value="analysis">{t("task.referenceRoleAnalysisOnly")}</option>
            </select>
          ) : null}
          {assignment.analysisOnly ? (
            <span className="reference-alias-badge">{t("task.referenceAnalysisOnlyBadge")}</span>
          ) : (
            <input
              className="reference-alias"
              value={aliasDraft}
              aria-label={t("task.referenceAlias")}
              spellCheck={false}
              onChange={(event) => setAliasDraft(event.target.value)}
              onBlur={commitAlias}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
              }}
            />
          )}
          <span className="reference-row-name" title={attachment?.originalName || mediaNode.data.title}>
            {attachment?.originalName || mediaNode.data.title}
          </span>
        </div>
        <input
          className="reference-purpose"
          value={purposeDraft}
          placeholder={t("task.referencePurposePlaceholder")}
          onChange={(event) => setPurposeDraft(event.target.value)}
          onBlur={commitPurpose}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="reference-row-actions">
        <TooltipAnchor label={t("task.referenceMoveUp")}>
          <IconButton className="nodrag" filled={false} icon="chevron-up" size="sm" aria-label={t("task.referenceMoveUp")} disabled={!canMoveUp} onClick={() => onMove(-1)} />
        </TooltipAnchor>
        <TooltipAnchor label={t("task.referenceMoveDown")}>
          <IconButton className="nodrag" filled={false} icon="chevron-down" size="sm" aria-label={t("task.referenceMoveDown")} disabled={!canMoveDown} onClick={() => onMove(1)} />
        </TooltipAnchor>
        <TooltipAnchor label={t("task.referenceInsert")}>
          <IconButton className="nodrag" filled={false} icon="plus-lg" size="sm" aria-label={t("task.referenceInsert")} disabled={assignment.analysisOnly || !assignment.alias} onClick={() => onInsert(assignment.alias)} />
        </TooltipAnchor>
        <TooltipAnchor label={t("task.referenceUnlink")}>
          <IconButton className="nodrag" filled={false} icon="x" size="sm" aria-label={t("task.referenceUnlink")} onClick={onUnlink} />
        </TooltipAnchor>
      </div>
    </div>
  );
}

function fitTextareaHeight(textarea: HTMLTextAreaElement | null): boolean {
  if (!textarea) return false;
  const previousHeight = textarea.style.height;
  textarea.style.height = "auto";
  const nextHeight = `${textarea.scrollHeight}px`;
  textarea.style.height = nextHeight;
  return previousHeight !== nextHeight;
}

function GenericPromptOutput({ id, value, status, error }: { id: string; value: string; status?: ScatterNodeData["genericPromptStatus"]; error?: string }): ReactElement {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  const composingRef = useRef(false);
  const initialStatusRef = useRef(status);

  useEffect(() => {
    if (initialStatusRef.current !== "generating") return;
    taskNodeActions?.updateNodeData(id, {
      genericPromptStatus: "error",
      genericPromptError: t("workflow.genericPromptInterrupted")
    });
    initialStatusRef.current = "error";
  }, [id, t]);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  const statusText = status === "generating"
    ? t("workflow.genericPromptRunning")
    : status === "ready"
      ? t("workflow.genericPromptReady")
      : status === "error"
        ? error || t("workflow.genericPromptFailed")
        : "";

  const copyPrompt = async (): Promise<void> => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      taskNodeActions?.updateNodeData(id, { genericPromptStatus: "ready" });
    } catch {
      // Clipboard access is optional; the editable output remains available.
    }
  };

  return (
    <section className="generic-prompt-output nodrag" aria-label={t("workflow.genericPromptOutputLabel")}>
      <div className="generic-prompt-output-header">
        <strong>{t("workflow.genericPromptOutputLabel")}</strong>
        <div className="generic-prompt-output-actions">
          {statusText ? <span className={`generic-prompt-output-status ${status === "error" ? "is-error" : ""}`}>{statusText}</span> : null}
          <TooltipAnchor label={t("workflow.genericPromptCopy")}>
            <IconButton className="nodrag" filled={false} icon="copy" size="sm" aria-label={t("workflow.genericPromptCopy")} disabled={!value.trim()} onClick={() => void copyPrompt()} />
          </TooltipAnchor>
        </div>
      </div>
      <AutoResizeTextarea
        nodeId={id}
        className="generic-prompt-output-editor nodrag nowheel"
        value={draft}
        placeholder={t("workflow.genericPromptOutputPlaceholder")}
        disabled={status === "generating"}
        onFocus={() => {
          editingRef.current = true;
          taskNodeActions?.beginNodeEdit();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          if (!composingRef.current) taskNodeActions?.updateNodeData(id, { genericPromptText: next });
        }}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const next = event.currentTarget.value;
          setDraft(next);
          taskNodeActions?.updateNodeData(id, { genericPromptText: next });
        }}
        onBlur={() => {
          editingRef.current = false;
          if (draft !== value) taskNodeActions?.updateNodeData(id, { genericPromptText: draft });
          taskNodeActions?.commitNodeEdit();
        }}
      />
    </section>
  );
}

function TaskNodeComponent({ id, data, selected }: TaskNodeProps): ReactElement {
  const previewOnly = useScatterStore.getState().document?.executionMode === "preview-only";
  if (data.nodeKind && !["task", "generic-prompt", "seedance-generation"].includes(data.nodeKind)) {
    return <WorkflowNode id={id} data={data} selected={selected} />;
  }
  const { t } = useI18n();
  const updateNodeInternals = useUpdateNodeInternals();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pointerStartedSelectedRef = useRef(false);
  const suppressConnectButtonClickRef = useRef(false);
  const isComposingRef = useRef(false);
  const pendingFinishAfterCompositionRef = useRef(false);
  const pendingNodeInternalsUpdateRef = useRef(false);
  // Keep IME edits local until composition ends so store/autosave updates do not commit raw pinyin.
  const titleDraftRef = useRef(data.title);
  const bodyDraftRef = useRef(data.body);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [titleDraft, setTitleDraft] = useState(data.title);
  const [bodyDraft, setBodyDraft] = useState(data.body);

  const runMode = data.runMode || "flow";
  const isRunning = useScatterStore((state) => state.runningNodeId === id);
  const effort = data.effort || "xhigh";
  const isGenericPrompt = data.nodeKind === "generic-prompt";
  const isSeedanceGeneration = data.nodeKind === "seedance-generation";
  const effortLabel = t(effortLabelKey(effort));
  const hasBody = bodyDraft.trim().length > 0;
  const hasParent = useScatterStore((state) =>
    state.edges.some((edge) => edge.target === id && state.nodes.some((node) => node.id === edge.source))
  );
  const canAcceptMediaReferences = !data.nodeKind || data.nodeKind === "task" || isGenericPrompt || isSeedanceGeneration;
  const hasChild = useScatterStore((state) =>
    state.edges.some((edge) => edge.source === id && state.nodes.some((node) => node.id === edge.target))
  );
  const [referencesExpanded, setReferencesExpanded] = useState(true);
  const pendingInsertAliasRef = useRef<string | null>(null);

  const connectedMediaNodes = useScatterStore(useShallow((state) =>
    state.edges
      .filter((edge) => edge.target === id && !edge.targetHandle)
      .map((edge) => state.nodes.find((node) => node.id === edge.source))
      .filter((node): node is ScatterNode =>
        Boolean(node && (node.data.nodeKind === "image-reference" || node.data.nodeKind === "video-reference"))
      )
  ));
  const referenceAssignments = data.referenceAssignments ?? {};
  const sortedReferenceMedia = [...connectedMediaNodes]
    .map((node, index) => ({ node, order: referenceAssignments[node.id]?.order ?? index }))
    .sort((a, b) => a.order - b.order);
  const hasReferences = sortedReferenceMedia.length > 0;
  const upstreamPrompt = useScatterStore((state) => {
    const edge = state.edges.find((item) => {
      if (item.target !== id || item.targetHandle) return false;
      return state.nodes.some((node) => node.id === item.source && node.data.nodeKind === "generic-prompt");
    });
    return edge ? state.nodes.find((node) => node.id === edge.source) ?? null : null;
  });
  const upstreamPromptText = upstreamPrompt?.data.genericPromptText?.trim() || "";
  const canRunNode = hasBody || hasReferences || Boolean(upstreamPromptText);

  const handleInsertReference = useCallback(
    (alias: string) => {
      pendingInsertAliasRef.current = alias;
      taskNodeActions?.beginNodeEdit();
      setEditingField("body");
    },
    []
  );

  useEffect(() => {
    if (editingField !== "body") return;
    const alias = pendingInsertAliasRef.current;
    if (!alias) return;
    pendingInsertAliasRef.current = null;
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? bodyDraftRef.current.length;
    const end = textarea?.selectionEnd ?? start;
    const current = bodyDraftRef.current;
    const next = `${current.slice(0, start)}${alias}${current.slice(end)}`;
    bodyDraftRef.current = next;
    setBodyDraft(next);
    taskNodeActions?.updateNodeData(id, { body: next });
    const caret = start + alias.length;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(caret, caret);
    });
  }, [editingField, id]);

  const fitBodyTextarea = useCallback((deferNodeInternalsUpdate = false) => {
    if (fitTextareaHeight(bodyRef.current)) {
      if (deferNodeInternalsUpdate) {
        pendingNodeInternalsUpdateRef.current = true;
        return;
      }
      updateNodeInternals(id);
    }
  }, [id, updateNodeInternals]);

  useLayoutEffect(() => {
    fitBodyTextarea(isComposingRef.current);
  }, [bodyDraft, fitBodyTextarea]);

  useEffect(() => {
    if (editingField === "title") return;
    titleDraftRef.current = data.title;
    setTitleDraft(data.title);
  }, [data.title, editingField]);

  useEffect(() => {
    if (editingField === "body") return;
    bodyDraftRef.current = data.body;
    setBodyDraft(data.body);
  }, [data.body, editingField]);

  const isNodeEditableElement = useCallback(
    (target: EventTarget | null) => target === titleRef.current || target === bodyRef.current,
    []
  );

  const isNodeEditableFocused = useCallback(() => isNodeEditableElement(document.activeElement), [isNodeEditableElement]);

  const flushDraftToStore = useCallback(
    (field?: EditableField) => {
      const patch: Partial<ScatterNodeData> = {};

      if ((!field || field === "title") && titleDraftRef.current !== data.title) {
        patch.title = titleDraftRef.current;
      }

      if ((!field || field === "body") && bodyDraftRef.current !== data.body) {
        patch.body = bodyDraftRef.current;
      }

      if (Object.keys(patch).length > 0) {
        taskNodeActions?.updateNodeData(id, patch);
      }
    },
    [data.body, data.title, id]
  );

  const finishEditing = useCallback(
    (field?: EditableField) => {
      if (field && editingField !== field) return;
      pendingFinishAfterCompositionRef.current = false;
      flushDraftToStore(field ?? editingField ?? undefined);
      taskNodeActions?.commitNodeEdit();
      setEditingField(null);
    },
    [editingField, flushDraftToStore]
  );

  useEffect(() => {
    if (selected || !editingField) return;
    if (isNodeEditableFocused()) return;
    if (isComposingRef.current) {
      pendingFinishAfterCompositionRef.current = true;
      return;
    }
    finishEditing(editingField);
  }, [editingField, finishEditing, isNodeEditableFocused, selected]);

  useEffect(() => {
    if (editingField === "title") {
      titleRef.current?.focus();
      const valueLength = titleRef.current?.value.length ?? 0;
      titleRef.current?.setSelectionRange(valueLength, valueLength);
      return;
    }

    if (editingField === "body") {
      bodyRef.current?.focus();
      const valueLength = bodyRef.current?.value.length ?? 0;
      bodyRef.current?.setSelectionRange(valueLength, valueLength);
    }
  }, [editingField]);

  useEffect(() => {
    if (!effortMenuOpen) return;

    function handlePointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setEffortMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [effortMenuOpen]);

  const handleEditablePointerDown = useCallback(() => {
    pointerStartedSelectedRef.current = selected;
  }, [selected]);

  const startEditing = useCallback(
    (field: EditableField) => {
      if (!pointerStartedSelectedRef.current) return;
      taskNodeActions?.beginNodeEdit();
      setEditingField(field);
    },
    []
  );

  const handleEditableFocus = useCallback((event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>, field: EditableField) => {
    if (editingField !== field) {
      event.currentTarget.blur();
    }
  }, [editingField]);

  const handleEditableBlur = useCallback(
    (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>, field: EditableField) => {
      if (editingField !== field) return;
      if (isNodeEditableElement(event.relatedTarget)) return;
      if (isComposingRef.current) {
        pendingFinishAfterCompositionRef.current = true;
        return;
      }
      finishEditing(field);
    },
    [editingField, finishEditing, isNodeEditableElement]
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    pendingFinishAfterCompositionRef.current = false;
  }, []);

  const handleCompositionEnd = useCallback((event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = event.currentTarget === titleRef.current ? "title" : "body";
    const value = event.currentTarget.value;

    if (field === "title") {
      titleDraftRef.current = value;
      setTitleDraft(value);
    } else {
      bodyDraftRef.current = value;
      setBodyDraft(value);
      if (fitTextareaHeight(event.currentTarget as HTMLTextAreaElement)) {
        pendingNodeInternalsUpdateRef.current = true;
      }
    }

    isComposingRef.current = false;
    flushDraftToStore(field);
    if (pendingNodeInternalsUpdateRef.current) {
      pendingNodeInternalsUpdateRef.current = false;
      updateNodeInternals(id);
    }
    if (!pendingFinishAfterCompositionRef.current) return;
    window.setTimeout(() => {
      if (!isNodeEditableFocused()) {
        finishEditing();
        return;
      }
      pendingFinishAfterCompositionRef.current = false;
    }, 0);
  }, [finishEditing, flushDraftToStore, id, isNodeEditableFocused, updateNodeInternals]);

  const isChangeDuringComposition = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      isComposingRef.current || Boolean((event.nativeEvent as InputEvent).isComposing),
    []
  );

  const handleEditableKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }, []);

  const handleTitleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      titleDraftRef.current = value;
      setTitleDraft(value);

      if (!isChangeDuringComposition(event) && value !== data.title) {
        taskNodeActions?.updateNodeData(id, { title: value });
      }
    },
    [data.title, id, isChangeDuringComposition]
  );

  const handleBodyChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      const isComposing = isChangeDuringComposition(event);
      bodyDraftRef.current = value;
      setBodyDraft(value);

      if (fitTextareaHeight(event.currentTarget)) {
        if (isComposing) {
          pendingNodeInternalsUpdateRef.current = true;
        } else {
          updateNodeInternals(id);
        }
      }

      if (!isComposing && value !== data.body) {
        taskNodeActions?.updateNodeData(id, { body: value });
      }
    },
    [data.body, id, isChangeDuringComposition, updateNodeInternals]
  );

  const handleConnectButtonMouseDown = useCallback(
    (side: ConnectedNodeSide) => (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragged = false;

      function removeListeners(): void {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      }

      function handleMouseMove(moveEvent: MouseEvent): void {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (deltaX * deltaX + deltaY * deltaY > 16) {
          dragged = true;
        }
      }

      function handleMouseUp(upEvent: MouseEvent): void {
        removeListeners();
        suppressConnectButtonClickRef.current = true;
        if (dragged) return;
        upEvent.preventDefault();
        taskNodeActions?.createConnectedNode(id, side);
      }

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [id]
  );

  const handleConnectButtonClick = useCallback(
    (side: ConnectedNodeSide) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (suppressConnectButtonClickRef.current) {
        suppressConnectButtonClickRef.current = false;
        event.preventDefault();
        return;
      }

      taskNodeActions?.createConnectedNode(id, side);
    },
    [id]
  );

  return (
    <div ref={rootRef} className={`task-node ${data.nodeKind ? `task-node-${data.nodeKind}` : ""} ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="node-handle" isConnectableStart={!hasParent || canAcceptMediaReferences} isConnectableEnd={!hasParent || canAcceptMediaReferences}>
        {hasParent ? (
          <span className="node-edge-cap" aria-hidden="true" />
        ) : (
          <button
            className="node-connect-button"
            type="button"
            aria-label={t("task.connectLeft")}
            onMouseDown={handleConnectButtonMouseDown("left")}
            onClick={handleConnectButtonClick("left")}
          >
            <Icon name="plus-lg" size={16} />
          </button>
        )}
      </Handle>
      <div className="task-node-header">
        <input
          ref={titleRef}
          className={`task-title ${editingField === "title" ? "nodrag is-editing" : "is-readonly"}`}
          value={titleDraft}
          placeholder={t("task.titlePlaceholder")}
          readOnly={editingField !== "title"}
          tabIndex={editingField === "title" ? 0 : -1}
          onPointerDown={handleEditablePointerDown}
          onClick={() => {
            if (editingField !== "title") startEditing("title");
          }}
          onFocus={(event) => handleEditableFocus(event, "title")}
          onBlur={(event) => handleEditableBlur(event, "title")}
          onKeyDown={handleEditableKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onChange={handleTitleChange}
        />
        <TooltipAnchor className="nodrag" label={isRunning ? t("status.runningAssistant") : previewOnly ? t("status.previewOnly") : isSeedanceGeneration ? t("workflow.seedanceIntegrationPending") : isGenericPrompt ? t("workflow.genericPromptRun") : canRunNode ? t("task.run") : t("task.runEmpty")} shortcut={shortcuts.runCurrentTask}>
          <IconButton
            className="nodrag task-run-button"
            filled={false}
            icon="play-1"
            loading={isRunning}
            size="lg"
            aria-label={isRunning ? t("status.runningAssistant") : previewOnly ? t("status.previewOnly") : isSeedanceGeneration ? t("workflow.seedanceIntegrationPending") : isGenericPrompt ? t("workflow.genericPromptRun") : canRunNode ? t("task.run") : t("task.runEmpty")}
            disabled={previewOnly || isRunning || isSeedanceGeneration || (isGenericPrompt ? data.genericPromptStatus === "generating" : !canRunNode)}
            onClick={() => isGenericPrompt ? void taskNodeActions?.runPromptNode?.(id) : void taskNodeActions?.runNode(id, runMode)}
          />
        </TooltipAnchor>
        <TooltipAnchor className="nodrag" label={t("task.more")}>
          <RadixDropdownMenu.Root>
            <RadixDropdownMenu.Trigger asChild>
              <IconButton className="nodrag" filled={false} icon="dots-horizontal" size="lg" aria-label={t("task.more")} />
            </RadixDropdownMenu.Trigger>
            <RadixDropdownMenu.Portal>
              <RadixDropdownMenu.Content className="dropdown-content node-action-menu" sideOffset={8} align="end">
                {!isSeedanceGeneration ? <RadixDropdownMenu.Item disabled={previewOnly} asChild>
                  <ActionMenuItem disabled={previewOnly} icon="play" label={previewOnly ? t("status.previewOnly") : isGenericPrompt ? t("workflow.genericPromptRun") : t("task.runNodeOnly")} onClick={() => isGenericPrompt ? void taskNodeActions?.runPromptNode?.(id) : void taskNodeActions?.runNode(id, "node")} />
                </RadixDropdownMenu.Item> : null}
                <RadixDropdownMenu.Item asChild>
                  <ActionMenuItem icon="copy" label={t("task.copy")} onClick={() => taskNodeActions?.duplicateNode(id)} />
                </RadixDropdownMenu.Item>
                <RadixDropdownMenu.Item asChild>
                  <ActionMenuItem icon="trash" label={t("task.delete")} onClick={() => taskNodeActions?.deleteNode(id)} />
                </RadixDropdownMenu.Item>
              </RadixDropdownMenu.Content>
            </RadixDropdownMenu.Portal>
          </RadixDropdownMenu.Root>
        </TooltipAnchor>
      </div>

      <div className="task-node-card">
        <textarea
          ref={bodyRef}
          className={`task-body ${hasBody ? "has-content" : ""} ${editingField === "body" ? "nodrag nowheel is-editing" : "is-readonly"}`}
          value={bodyDraft}
          placeholder={t("task.bodyPlaceholder")}
          readOnly={editingField !== "body"}
          tabIndex={editingField === "body" ? 0 : -1}
          onPointerDown={handleEditablePointerDown}
          onClick={() => {
            if (editingField !== "body") startEditing("body");
          }}
          onFocus={(event) => handleEditableFocus(event, "body")}
          onBlur={(event) => handleEditableBlur(event, "body")}
          onKeyDown={handleEditableKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onChange={handleBodyChange}
        />

        {isGenericPrompt ? <GenericPromptOutput id={id} value={data.genericPromptText || ""} status={data.genericPromptStatus} error={data.genericPromptError} /> : null}

        {isSeedanceGeneration ? (
          <section className="seedance-prompt-preview nodrag">
            <strong>{t("workflow.seedancePromptPreview")}</strong>
            <div className="seedance-prompt-preview-text">{upstreamPromptText || t("workflow.seedancePromptMissing")}</div>
            <p>{t("workflow.seedanceIntegrationPending")}</p>
          </section>
        ) : null}

        {data.attachments.length ? (
          <div className="attachment-grid">
            {data.attachments.map((attachment) => (
              <UploadChip
                key={attachment.id}
                className="nodrag"
                fileName={attachment.originalName}
                imageAlt={attachment.originalName}
                imageSrc={attachment.kind === "image" ? attachment.fileUrl : undefined}
                kind={attachment.kind === "image" ? "image" : "file"}
                title={`${attachment.storedPath} · ${formatBytes(attachment.size)}`}
                onDoubleClick={() => window.scatter.showInFolder(attachment.storedPath)}
                onRemove={() => {
                  taskNodeActions?.removeAttachment(id, attachment.id);
                }}
              />
            ))}
          </div>
        ) : null}

        {hasReferences ? (
          <div className="reference-section nodrag">
            <button
              type="button"
              className="reference-section-header"
              onClick={() => setReferencesExpanded((open) => !open)}
              aria-expanded={referencesExpanded}
            >
              <Icon name="chevron-down" size={13} className={referencesExpanded ? "" : "reference-chevron-collapsed"} />
              <span>{t("task.referenceSection")}</span>
              <span className="reference-section-count">{sortedReferenceMedia.length}</span>
            </button>
            {referencesExpanded ? (
              <div className="reference-list">
                <div className="reference-list-hint">{t("task.referenceAliasHint")}</div>
                {sortedReferenceMedia.map(({ node }, index) => {
                  const assignment = referenceAssignments[node.id] ?? {
                    kind: node.data.nodeKind === "image-reference" ? ("image" as const) : ("video" as const),
                    alias: node.data.nodeKind === "image-reference" ? "@图?" : "@视频?",
                    purpose: "",
                    order: index
                  };
                  return (
                    <ReferenceMaterialRow
                      key={node.id}
                      mediaNode={node}
                      assignment={assignment}
                      canMoveUp={index > 0}
                      canMoveDown={index < sortedReferenceMedia.length - 1}
                      onAliasChange={(alias) => taskNodeActions?.updateReferenceAlias(id, node.id, alias)}
                      onPurposeChange={(purpose) => taskNodeActions?.updateReferencePurpose(id, node.id, purpose)}
                      onRoleChange={(analysisOnly) => taskNodeActions?.updateReferenceRole(id, node.id, analysisOnly)}
                      onMove={(direction) => taskNodeActions?.moveReference(id, node.id, direction)}
                      onUnlink={() => taskNodeActions?.unlinkReference(id, node.id)}
                      onInsert={handleInsertReference}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="task-node-footer">
          <div className="task-node-footer-actions">
            <TooltipAnchor className="nodrag" label={t("task.addAttachment")}>
              <IconButton className="nodrag" filled={false} icon="plus-lg" size="lg" aria-label={t("task.addAttachment")} onClick={() => taskNodeActions?.chooseFilesForNode(id)} />
            </TooltipAnchor>
            <TaskSkillPicker nodeId={id} selectedSkills={data.skills || []} />
          </div>
          <div className="task-node-settings">
            <div className="task-node-effort-picker">
              <DropdownTrigger
                className="nodrag"
                label={effortLabel}
                size="lg"
                aria-haspopup="menu"
                aria-expanded={effortMenuOpen}
                onClick={() => setEffortMenuOpen((open) => !open)}
              />
              {effortMenuOpen ? (
                <DropdownMenu className="task-node-effort-menu" role="menu">
                  {effortOptions.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      label={t(effortLabelKey(option))}
                      selected={option === effort}
                      role="menuitemradio"
                      aria-checked={option === effort}
                      onClick={() => {
                        taskNodeActions?.updateNodeData(id, { effort: option });
                        setEffortMenuOpen(false);
                      }}
                    />
                  ))}
                </DropdownMenu>
              ) : null}
            </div>
            <Switch
              checked={data.planMode}
              label={t("task.planMode")}
              onCheckedChange={(checked) => taskNodeActions?.updateNodeData(id, { planMode: checked })}
            />
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="node-handle">
        {hasChild ? <span className="node-edge-cap" aria-hidden="true" /> : null}
        <button
          className="node-connect-button"
          type="button"
          aria-label={t("task.connectRight")}
          onMouseDown={handleConnectButtonMouseDown("right")}
          onClick={handleConnectButtonClick("right")}
        >
          <Icon name="plus-lg" size={16} />
        </button>
      </Handle>
    </div>
  );
}

export const TaskNode = memo(TaskNodeComponent);

export { taskNodeActions, setTaskNodeActions } from "./nodeRuntimeActions";
