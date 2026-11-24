export type AttachmentKind = "image" | "video" | "file";
export type AttachmentSource = "upload" | "drop" | "paste" | "clipboard" | "generated";
export type RunMode = "flow" | "node";
export type EffortLevel = "low" | "medium" | "high" | "xhigh";
export type LanguagePreference = "zh" | "en";
export type ThemePreference = "system" | "light" | "dark";
export type AssistantProvider = "codex" | "claude-cli";
export type PixverseAuthAvailability = "available" | "missing" | "error";

export interface PixverseAuthStatus {
  availability: PixverseAuthAvailability;
  authenticated: boolean;
  /** Nickname only; tokens, email, and billing details are never exposed to the renderer. */
  accountLabel?: string;
}

export type PixverseAccountSwitchError =
  | "cli-not-found"
  | "status-failed"
  | "logout-failed"
  | "login-failed"
  | "login-incomplete";

export interface PixverseAccountSwitchResult {
  ok: boolean;
  status: PixverseAuthStatus;
  error?: PixverseAccountSwitchError;
}

export type PixverseCreateMode = "image" | "video" | "reference";
export type PixverseCapabilityValue = string | number | boolean;

export interface PixverseParameterCapability {
  supported?: boolean;
  flag?: string;
  type?: "boolean" | "integer" | "string" | "text" | "media" | "media_list";
  required?: boolean;
  enum?: PixverseCapabilityValue[];
  default?: PixverseCapabilityValue;
  min?: number;
  max?: number;
  max_count?: number;
  unit?: string;
  description?: string;
}

export interface PixverseModelCapability {
  id: string;
  displayName: string;
  default?: boolean;
  parameters: Record<string, PixverseParameterCapability>;
}

export interface PixverseCreateCapabilities {
  mode: PixverseCreateMode;
  defaultModel: string;
  parameters: Record<string, PixverseParameterCapability>;
  models: PixverseModelCapability[];
}

export interface PixverseCapabilitiesResult {
  capabilities?: PixverseCreateCapabilities;
  error?: "cli-not-found" | "capabilities-failed";
}

export type PixverseGenerationParameter = PixverseCapabilityValue;

export interface PixverseGenerationRequest {
  projectPath: string;
  mode: PixverseCreateMode;
  model: string;
  prompt: string;
  imagePaths: string[];
  videoPaths: string[];
  parameters: Record<string, PixverseGenerationParameter>;
}

export type PixverseGenerationError =
  | "cli-not-found"
  | "capabilities-failed"
  | "not-authenticated"
  | "insufficient-credits"
  | "timeout"
  | "invalid-request"
  | "prompt-required"
  | "reference-required"
  | "generation-failed"
  | "download-failed";

export interface PixverseGenerationResult {
  ok: boolean;
  attachments: Attachment[];
  error?: PixverseGenerationError;
}

/**
 * Gemini API surface. The API key is encrypted with Electron `safeStorage`
 * before it is persisted, and is never part of `AppSettings` / `settings.json`
 * or log output. The settings form holds the pasted value only transiently and
 * sends it once over the dedicated key-save IPC call; status and analysis
 * responses never expose it. The types below describe the renderer's controlled
 * view: key-presence metadata plus a one-shot image-understanding request/response.
 */
export type GeminiSupportedImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/heic"
  | "image/heif";

export const geminiSupportedImageMimes: readonly GeminiSupportedImageMime[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif"
];

/**
 * Default model for image understanding. Gemini model names churn quickly and
 * get deprecated on a published schedule, so this stays a shared constant rather
 * than a persisted setting; each request may still override it.
 */
export const geminiDefaultVisionModel = "gemini-3.5-flash-lite";

/**
 * Inline requests are capped at 20 MB in total (prompt + media). Base64 inflates
 * bytes by roughly a third, so raw image bytes are limited below that ceiling.
 */
export const geminiMaxInlineImageBytes = 14 * 1024 * 1024;

/** Guard against accidental multi-megabyte prompts. */
export const geminiMaxPromptChars = 32_000;

/** Presence metadata only. The key itself is never exposed to the renderer. */
export interface GeminiApiKeyStatus {
  configured: boolean;
  /** False when the OS keystore is unavailable; storing a key then is refused. */
  encryptionAvailable: boolean;
  /** mtime of the encrypted file in ISO 8601. Absent when nothing is configured. */
  updatedAt?: string;
}

export type GeminiApiKeyErrorCode =
  | "encryption-unavailable"
  | "invalid-key"
  | "storage-failed"
  | "removal-failed";

export interface GeminiApiKeyResult {
  ok: boolean;
  status: GeminiApiKeyStatus;
  error?: GeminiApiKeyErrorCode;
}

/**
 * The renderer only ever names an attachment. Raw image bytes are read inside
 * the main process and are never sent to or returned from the renderer.
 */
export interface GeminiImageUnderstandingRequest {
  projectPath: string;
  /** The `image-reference` node that owns the attachment. */
  nodeId: string;
  /** Identifies the image within that node; the main process resolves the file. */
  attachmentId: string;
  prompt: string;
  /** Optional override; defaults to `geminiDefaultVisionModel`. */
  model?: string;
}

/** Error codes only: the main process never forwards response bodies or the key. */
export type GeminiImageUnderstandingErrorCode =
  | "key-not-configured"
  | "encryption-unavailable"
  | "invalid-request"
  | "model-unavailable"
  | "auth-failed"
  | "rate-limited"
  | "service-error"
  | "timeout"
  | "empty-response"
  | "request-failed";

export interface GeminiImageUnderstandingResult {
  ok: boolean;
  text?: string;
  modelUsed?: string;
  error?: GeminiImageUnderstandingErrorCode;
}

export type WorkflowNodeKind =
  | "task"
  | "generic-prompt"
  | "replication-analysis"
  | "replication-section"
  | "replication-scope"
  | "replication-comparison"
  | "seedance-generation"
  | "image-reference"
  | "video-reference"
  | "reference-binding"
  | "role-binding"
  | "depth-conversion"
  | "pixverse-generation";

export type ReplicationMode = "photo" | "video";

export type ReferenceFieldId =
  | "appearance"
  | "outfit"
  | "scene"
  | "lighting"
  | "props"
  | "target-video"
  | "depth-video";

export type DepthProcessingMode = "quality" | "speed";
export type DepthResolution = "original" | "480p" | "720p" | "1080p";
export type DepthModel = "small" | "base" | "large";
export type DepthModelPrecision = "fp16" | "q8";
export type DepthConversionStatus = "idle" | "preparing" | "converting" | "cpu-fallback" | "completed" | "error";

/**
 * Per-task allocation of a connected image/video material node. Keyed by the
 * connected material node id inside the owning task node's
 * `referenceAssignments`. Two tasks may reference the same material node with
 * different aliases; values here are stable and never renumbered automatically.
 */
export interface TaskReferenceAssignment {
  /** The media kind this assignment points to (`image` / `video`). */
  kind: "image" | "video";
  /** Stable alias token, e.g. `@图1` or `@视频2`. Empty when analysisOnly. */
  alias: string;
  /** User-editable purpose / usage note shown in the runner context. */
  purpose: string;
  /** Sort order within this task; lower numbers render first. */
  order: number;
  /**
   * Task-local role for connected media: when true this material is only an
   * analysis source for this task and gets no @图N/@视频N alias. This is a
   * manual role for images and videos, separate from topology-derived video
   * analysis roles.
   */
  analysisOnly?: boolean;
  /**
   * True when the user explicitly chose this role via the per-task selector.
   * Undefined means the role follows graph topology (depth-conversion input).
   * Manual choice always wins over topology; clearing topology later does not
   * flip a manually chosen role back.
   */
  analysisOnlyManual?: boolean;
}
export type AppUpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "not-available" | "error";
export type AppUpdateErrorCode = "development-mode" | "check-failed" | "install-failed";
export const achievementIds = [
  "oneshot",
  "gunslinger",
  "three-musketeers",
  "codex-rookie",
  "double-take",
  "idea-overlord",
  "master-builder",
  "gone-in-a-flash"
] as const;
export type AchievementId = (typeof achievementIds)[number];

export interface AppSettings {
  themePreference: ThemePreference;
  language: LanguagePreference;
  translucentBackground: boolean;
  assistantProvider: AssistantProvider;
  assistantProviderOnboardingCompleted: boolean;
  pixverseImageDefaultModel: string;
}

export const defaultAppSettings = {
  themePreference: "system",
  language: "zh",
  translucentBackground: true,
  assistantProvider: "codex",
  assistantProviderOnboardingCompleted: false,
  pixverseImageDefaultModel: "gemini-nano-banana-2.1"
} satisfies AppSettings;

export interface AchievementState {
  unlockedAt: Partial<Record<AchievementId, string>>;
  projectPaths: string[];
  usageDates: string[];
}

export const defaultAchievementState = {
  unlockedAt: {},
  projectPaths: [],
  usageDates: []
} satisfies AchievementState;

export interface ScatterProjectInfo {
  missing?: boolean;
  name: string;
  path: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  source: AttachmentSource;
  originalName: string;
  storedPath: string;
  relativePath: string;
  fileUrl: string;
  mime: string;
  size: number;
  /** Duration read from the local video metadata after the preview loads. */
  durationMs?: number;
  createdAt: string;
}

export interface AttachmentInput {
  name: string;
  mime?: string;
  source: AttachmentSource;
  path?: string;
  bookmark?: string;
  bytes?: ArrayBuffer;
}

export interface DepthConversionRequest {
  requestId?: string;
  projectPath: string;
  inputPath: string;
  model: DepthModel;
  modelPrecision?: DepthModelPrecision;
  processingMode: DepthProcessingMode;
  resolution: DepthResolution;
  temporalSmoothing: number;
  invert: boolean;
  preserveAudio: boolean;
}

export interface DepthConversionProgress {
  requestId?: string;
  phase?: "model-download" | "conversion" | "cpu-fallback";
  frameIndex: number;
  totalFrames: number;
  progress: number;
}

export interface DepthModelStatus {
  model: DepthModel;
  directory: string;
  ready: boolean;
}

export interface DepthConversionResult {
  attachment: Attachment;
  sourceFps: number;
  outputFps: number;
  analysisFps: number;
  backend: "coreml" | "cpu";
}

export interface ScatterNodeData extends Record<string, unknown> {
  /** `task` keeps the original Scatter node schema; other values are workflow cards. */
  nodeKind?: WorkflowNodeKind;
  title: string;
  body: string;
  attachments: Attachment[];
  effort: EffortLevel;
  planMode: boolean;
  runMode: RunMode;
  lastRunAt?: string;
  /** Codex Skill names applied to this task node. */
  skills?: string[];
  /** Editable reusable Seedance prompt generated by a generic-prompt node. */
  genericPromptText?: string;
  genericPromptStatus?: "idle" | "generating" | "ready" | "error";
  genericPromptError?: string;
  /** Reusable photo/video replication analysis or comparison output. */
  replicationStatus?: "idle" | "running" | "ready" | "error";
  replicationOutputText?: string;
  /** Editable photo-analysis categories displayed within one node frame. */
  replicationCategoryFields?: ReplicationCategoryField[];
  replicationError?: string;
  replicationMode?: ReplicationMode;
  replicationSectionId?: string;
  replicationSectionEdited?: boolean;
  replicationAnalysisNodeId?: string;
  replicationScopeId?: string;
  replicationScopeKind?: "photo" | "video" | "role" | "segment";
  replicationScopeName?: string;
  replicationScopeKey?: string;
  replicationScopeNameEdited?: boolean;
  replicationTimeRangeEdited?: boolean;
  replicationTimeRange?: string;
  replicationTimeRangeValid?: boolean;
  /** A scope/section was not present in the latest analysis and is excluded from prompt assembly. */
  replicationScopeStale?: boolean;
  replicationDifferences?: ReplicationDifference[];
  replicationSupplement?: string;
  /** Media nodes accept only the declared media kind. */
  mediaKind?: "image" | "video";
  referenceFields?: Partial<Record<ReferenceFieldId, string>>;
  referenceFieldSources?: Partial<Record<ReferenceFieldId, string[]>>;
  depthProcessingMode?: DepthProcessingMode;
  depthModel?: DepthModel;
  depthResolution?: DepthResolution;
  temporalSmoothing?: number;
  invertDepth?: boolean;
  preserveAudio?: boolean;
  depthStatus?: DepthConversionStatus;
  depthProgress?: number;
  depthError?: string;
  depthOutputNodeId?: string;
  pixverseMode?: "image" | "video";
  pixverseVideoMethod?: "create" | "reference";
  pixverseModel?: string;
  pixverseModelSource?: "default" | "custom";
  pixverseSettings?: Record<string, PixverseGenerationParameter>;
  pixverseStatus?: "idle" | "running" | "completed" | "error";
  pixverseError?: PixverseGenerationError;
  pixverseOutputNodeId?: string;
  /** Number of successful PixVerse runs retained by this generation node. */
  pixverseRunCount?: number;
  /** Result media nodes keep their originating generation and iteration for comparison history. */
  pixverseGenerationNodeId?: string;
  pixverseRunNumber?: number;
  pixverseResultIndex?: number;
  /**
   * Task-node-only: reference material allocations keyed by the connected
   * image/video node id. Each task owns its own aliases, order and purpose.
   */
  referenceAssignments?: Record<string, TaskReferenceAssignment>;
}

export interface ReplicationDifference {
  id: string;
  timeRange: string;
  category: string;
  target: string;
  generated: string;
  correction: string;
  manual?: boolean;
}

/** One editable category inside a composite photo-analysis node. */
export interface ReplicationCategoryField {
  /** Stable per-scope id used for the category's individual output handle. */
  id: string;
  groupId: string;
  groupTitle: string;
  title: string;
  body: string;
  edited?: boolean;
}

export interface SkillCatalogItem {
  name: string;
  description: string;
  source: "project" | "codex" | "plugin";
}

export interface ScatterNode {
  id: string;
  type: "task";
  position: { x: number; y: number };
  width?: number;
  height?: number;
  selected?: boolean;
  data: ScatterNodeData;
}

export interface ScatterEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  label?: string;
  /** User-placed route points, stored in canvas coordinates. */
  routePoints?: Array<{ x: number; y: number }>;
}

/**
 * Figma-style visual grouping container. PURE CANVAS METADATA: it lives
 * next to `nodes`/`edges` in the document and never becomes a workflow node,
 * never creates a workflow edge, and never enters AI Markdown, the run graph
 * or the @图N/@视频N reference numbering. Sections nest via `childGroupIds`.
 * Their independent canvas-space bounds are persisted so users can draw, resize,
 * and move sections without changing their screen-sized title and handles.
 */
export type CanvasGroupLayoutAxis = "horizontal" | "vertical";
export type CanvasGroupCrossAlignment = "start" | "center" | "end";

/** Four-way padding around the auto-layout content block, in canvas px. */
export interface CanvasGroupPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Real Auto Layout container state. PERSISTED on the group and actually used
 * on every re-flow and on document reload: direction, main-axis gap, four-way
 * padding, cross-axis alignment and a stable child order along the main axis.
 * This is a continuous container property — distinct from the one-shot Align /
 * Distribute / Tidy up commands, which only rewrite positions and never mark
 * the group as a container.
 */
export interface CanvasGroupLayout {
  axis: CanvasGroupLayoutAxis;
  /** Gap between children along the main axis, in canvas px. */
  gap: number;
  /** Four-way padding between the frame edge and the content block. */
  padding: CanvasGroupPadding;
  /** Cross-axis alignment of the content block. */
  alignment: CanvasGroupCrossAlignment;
  /**
   * Stable order of direct member node ids along the main axis. Recomputed
   * predictably on child drag; survives save/reload.
   */
  childOrder: string[];
}

export interface CanvasGroup {
  id: string;
  name: string;
  /** Direct member node ids (top-level members at this section's level). */
  nodeIds: string[];
  /** Nested child sections directly contained by this section. */
  childGroupIds: string[];
  /** Persistent canvas-space section rectangle. */
  bounds?: { x: number; y: number; width: number; height: number };
  parentGroupId?: string;
  /**
   * Auto Layout container state. Undefined means a plain Figma-style group
   * with no live layout. Distinct from one-shot Align / Distribute / Tidy up.
   */
  layout?: CanvasGroupLayout;
}

export interface ScatterDocument {
  version: 1;
  projectName: string;
  updatedAt: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: ScatterNode[];
  edges: ScatterEdge[];
  /** Optional: Figma-style visual groups. Older files simply omit this. */
  groups?: CanvasGroup[];
  /** Optional project-wide execution boundary; preview-only documents cannot dispatch runs. */
  executionMode?: "preview-only" | "enabled";
}

export interface OpenProjectResult {
  project: ScatterProjectInfo;
  document: ScatterDocument;
}

export interface AssistantRunInput {
  provider: AssistantProvider;
  projectPath: string;
  threadName: string;
  markdown: string;
  imagePaths: string[];
  effort: EffortLevel;
  planMode: boolean;
}

export interface AssistantRunResult {
  provider: AssistantProvider;
  threadId: string;
  turnId?: string;
  cwd: string;
}

export interface PromptOutputFile {
  content: string;
  modifiedAt: number;
}

export interface AccessibilityPermissionStatus {
  trusted: boolean;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  downloadedVersion?: string;
  progressPercent?: number;
  errorCode?: AppUpdateErrorCode;
  errorMessage?: string;
  isPackaged: boolean;
  canCheck: boolean;
  canInstall: boolean;
}

export type CodexRunInput = Omit<AssistantRunInput, "provider">;
export type CodexRunResult = Omit<AssistantRunResult, "provider">;
