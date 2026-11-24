import { app, clipboard, dialog, nativeImage } from "electron";
import { mkdir, readFile, writeFile, copyFile, stat, lstat, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Attachment,
  AttachmentInput,
  GeminiSupportedImageMime,
  OpenProjectResult,
  PromptOutputFile,
  ScatterDocument,
  ScatterNode,
  ScatterProjectInfo
} from "../shared/types";
import { geminiMaxInlineImageBytes, geminiSupportedImageMimes } from "../shared/types";
import { recordProjectOpened, unlockAchievement } from "./achievementStore";
import { tMain } from "./i18n";
import { getSettings } from "./settingsStore";

const scatterDirName = ".scatter";
const documentFileName = "scatter.json";
const assetsDirName = "assets";
const assetProtocol = "scatter-asset";
const maxRecentProjects = 24;
const execFileAsync = promisify(execFile);

function isLegacyAnalysisNode(node: ScatterNode): boolean {
  const kind = String(node.data.nodeKind || "");
  const title = String(node.data.title || "");
  const hasAnalysisData = Object.keys(node.data).some((key) => key.startsWith("videoAnalysis") || key === "promptOutput");
  return kind === "analysis-review"
    || kind === "prompt-synthesis"
    || kind === "video-analysis"
    || ["Seedance 视频反推", "逐帧分析目标视频", "Seedance reverse prompt", "Frame-by-frame video analysis"].includes(title)
    || hasAnalysisData;
}

function now(): string {
  return new Date().toISOString();
}

function appDataPath(fileName: string): string {
  return path.join(app.getPath("userData"), fileName);
}

function scatterPath(projectPath: string): string {
  return path.join(projectPath, scatterDirName);
}

function documentPath(projectPath: string): string {
  return path.join(scatterPath(projectPath), documentFileName);
}

function assetsPath(projectPath: string): string {
  return path.join(scatterPath(projectPath), assetsDirName);
}

function promptOutputDirectory(projectPath: string): string {
  return path.join(scatterPath(projectPath), "prompt-runs");
}

function promptOutputFilePath(projectPath: string, nodeId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(nodeId)) throw new Error("Invalid prompt node id.");
  const directory = promptOutputDirectory(projectPath);
  const filePath = path.resolve(directory, `${nodeId}.md`);
  if (!filePath.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error("Invalid prompt output path.");
  return filePath;
}

function isProjectRootAvailable(projectPath: string): boolean {
  try {
    return statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

export function attachmentFileUrl(storedPath: string): string {
  return `${assetProtocol}://asset/${Buffer.from(storedPath, "utf8").toString("base64url")}`;
}

function normalizeAttachment(attachment: Attachment): Attachment {
  const normalizedKind = attachment.kind === "file" && attachment.mime?.startsWith("video/")
    ? "video"
    : attachment.kind === "file" && attachment.mime?.startsWith("image/")
      ? "image"
      : attachment.kind;
  return {
    ...attachment,
    kind: normalizedKind,
    fileUrl: attachmentFileUrl(attachment.storedPath)
  };
}

async function findExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], { maxBuffer: 1024 * 1024 });
      return candidate;
    } catch {
      // Try the next platform-specific location.
    }
  }
  return null;
}

async function prepareBrowserPlayableVideo(projectPath: string, attachment: Attachment): Promise<Attachment> {
  if (attachment.kind !== "video" || !existsSync(attachment.storedPath)) return attachment;

  const ffprobe = await findExecutable(["ffprobe", "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"]);
  const ffmpeg = await findExecutable(["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]);
  if (!ffprobe || !ffmpeg) return attachment;

  let codec = "";
  try {
    const probe = await execFileAsync(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1",
      attachment.storedPath
    ], { maxBuffer: 1024 * 1024 });
    codec = probe.stdout.trim().toLowerCase();
  } catch {
    return attachment;
  }

  if (!new Set(["hevc", "h265"]).has(codec)) return attachment;

  const baseName = path.basename(attachment.storedPath, path.extname(attachment.storedPath));
  const playableName = `${baseName}-playable.mp4`;
  const playablePath = path.join(path.dirname(attachment.storedPath), playableName);
  if (!existsSync(playablePath)) {
    try {
      await execFileAsync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", attachment.storedPath,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        playablePath
      ], { maxBuffer: 4 * 1024 * 1024 });
    } catch {
      return attachment;
    }
  }

  const fileStat = await stat(playablePath);
  const relativePath = path.relative(projectPath, playablePath).split(path.sep).join("/");
  return {
    ...attachment,
    storedPath: playablePath,
    relativePath,
    fileUrl: attachmentFileUrl(playablePath),
    mime: "video/mp4",
    size: fileStat.size
  };
}

async function prepareBrowserPlayableVideos(projectPath: string, document: ScatterDocument): Promise<ScatterDocument> {
  let changed = false;
  const nodes = [];
  for (const node of document.nodes || []) {
    const attachments = [];
    for (const attachment of node.data.attachments || []) {
      const prepared = await prepareBrowserPlayableVideo(projectPath, attachment);
      if (prepared.storedPath !== attachment.storedPath || prepared.kind !== attachment.kind) changed = true;
      attachments.push(prepared);
    }
    nodes.push({ ...node, data: { ...node.data, attachments } });
  }
  return changed ? { ...document, nodes } : document;
}

function normalizeDocument(document: ScatterDocument): ScatterDocument {
  const sourceNodes = document.nodes || [];
  const sourceEdges = document.edges || [];
  const nodesById = new Map(sourceNodes.map((node) => [node.id, node]));
  const legacyOutputNodeIds = new Set(
    sourceNodes
      .filter((node) => node.data.nodeKind === "depth-conversion" && node.data.depthOutputNodeId)
      .map((node) => node.data.depthOutputNodeId as string)
  );
  const migratedOutputIds = new Set<string>();
  const migratedDepthOutputIds = new Map<string, string>();
  const migratedAttachments = new Map<string, Attachment[]>();
  const legacyAnalysisNodeIds = new Set(sourceNodes.filter(isLegacyAnalysisNode).map((node) => node.id));

  for (const depthNode of sourceNodes.filter((node) => node.data.nodeKind === "depth-conversion")) {
    const storedOutputId = depthNode.data.depthOutputNodeId;
    if (!storedOutputId) continue;
    const storedOutput = nodesById.get(storedOutputId);
    if (!storedOutput || storedOutput.data.nodeKind !== "video-reference") continue;
    const manualOutput = sourceEdges
      .filter((edge) => edge.source === depthNode.id)
      .map((edge) => nodesById.get(edge.target))
      .find((node) => node && node.id !== storedOutputId && node.data.nodeKind === "video-reference");
    if (!manualOutput) continue;

    migratedDepthOutputIds.set(depthNode.id, manualOutput.id);
    migratedOutputIds.add(storedOutputId);
    if (!manualOutput.data.attachments?.length && storedOutput.data.attachments?.length) {
      migratedAttachments.set(manualOutput.id, storedOutput.data.attachments);
    }
  }

  // Earlier versions could persist depthOutputNodeId without persisting the
  // corresponding edge. Restore that connection when the referenced output
  // still exists and has not been superseded by a manually connected video.
  const restoredDepthEdges = [];
  for (const depthNode of sourceNodes.filter((node) => node.data.nodeKind === "depth-conversion")) {
    const outputId = depthNode.data.depthOutputNodeId;
    const outputNode = outputId ? nodesById.get(outputId) : undefined;
    if (!outputId || !outputNode || outputNode.data.nodeKind !== "video-reference" || migratedOutputIds.has(outputId)) continue;
    if (sourceEdges.some((edge) => edge.source === depthNode.id && edge.target === outputId)) continue;
    restoredDepthEdges.push({ id: randomUUID(), source: depthNode.id, target: outputId });
  }

  return {
    ...document,
    nodes: sourceNodes
      .filter((node) => !migratedOutputIds.has(node.id) && !legacyAnalysisNodeIds.has(node.id))
      .map((node) => {
        const normalizedData = { ...node.data };
        const wasTargetVideo = String(node.data.nodeKind) === "target-video" || node.data.targetVideo === true;
        if (["image-reference", "video-reference", "target-video"].includes(String(node.data.nodeKind)) || wasTargetVideo) {
          Reflect.deleteProperty(normalizedData, "token");
        }
        if (wasTargetVideo) {
          normalizedData.nodeKind = "video-reference";
          normalizedData.mediaKind = "video";
          Reflect.deleteProperty(normalizedData, "targetVideo");
        }
        const oldTargetTitle = String(node.data.title || "");
        const migratedTitle = wasTargetVideo && oldTargetTitle === "目标视频（复刻源）"
          ? "视频节点"
          : wasTargetVideo && oldTargetTitle === "Target video (recreation source)"
            ? "Video node"
            : oldTargetTitle;
        return {
          ...node,
          data: {
            ...normalizedData,
            body: node.data.body,
            title: wasTargetVideo ? migratedTitle : legacyOutputNodeIds.has(node.id) && node.data.title === "深度视频输出"
              ? "视频节点"
              : node.data.title,
            attachments: (migratedAttachments.get(node.id) || node.data.attachments || []).map(normalizeAttachment),
            effort: node.data.effort || "xhigh",
            nodeKind: node.data.nodeKind || "task",
            ...(migratedDepthOutputIds.has(node.id) ? { depthOutputNodeId: migratedDepthOutputIds.get(node.id) } : {})
          }
        };
      }),
    edges: sourceEdges
      .filter((edge) => !migratedOutputIds.has(edge.source) && !migratedOutputIds.has(edge.target) && !legacyAnalysisNodeIds.has(edge.source) && !legacyAnalysisNodeIds.has(edge.target))
      .concat(restoredDepthEdges)
  };
}

function projectNameFromPath(projectPath: string): string {
  return path.basename(projectPath) || "Untitled Scatter Project";
}

function defaultDocument(projectPath: string): ScatterDocument {
  return {
    version: 1,
    projectName: projectNameFromPath(projectPath),
    updatedAt: now(),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: []
  };
}

async function ensureProject(projectPath: string): Promise<ScatterDocument> {
  await mkdir(scatterPath(projectPath), { recursive: true });
  await mkdir(assetsPath(projectPath), { recursive: true });

  const docPath = documentPath(projectPath);
  if (!existsSync(docPath)) {
    const doc = defaultDocument(projectPath);
    await writeFile(docPath, JSON.stringify(doc, null, 2), "utf8");
    return doc;
  }

  const raw = await readFile(docPath, "utf8");
  const parsed = JSON.parse(raw) as ScatterDocument;
  const normalized = normalizeDocument({
    ...defaultDocument(projectPath),
    ...parsed,
    projectName: parsed.projectName || projectNameFromPath(projectPath),
    nodes: parsed.nodes || [],
    edges: parsed.edges || []
  });
  if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
    await writeFile(docPath, JSON.stringify(normalized, null, 2), "utf8");
  }
  return normalized;
}

function persistedRecentProject(project: ScatterProjectInfo): ScatterProjectInfo {
  const { missing: _missing, ...persisted } = project;
  return persisted;
}

function withProjectAvailability(project: ScatterProjectInfo): ScatterProjectInfo {
  const persisted = persistedRecentProject(project);
  return isProjectRootAvailable(project.path) ? persisted : { ...persisted, missing: true };
}

function normalizeRecentProjects(value: unknown): ScatterProjectInfo[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const projects: ScatterProjectInfo[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const project = item as Partial<ScatterProjectInfo>;
    if (typeof project.path !== "string" || !project.path) continue;
    if (seen.has(project.path)) continue;
    seen.add(project.path);
    projects.push({
      name: typeof project.name === "string" && project.name ? project.name : projectNameFromPath(project.path),
      path: project.path,
      updatedAt: typeof project.updatedAt === "string" && project.updatedAt ? project.updatedAt : now()
    });
  }
  return projects.slice(0, maxRecentProjects);
}

async function readRecentProjects(): Promise<ScatterProjectInfo[]> {
  const filePath = appDataPath("recent-projects.json");
  if (!existsSync(filePath)) return [];
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeRecentProjects(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeRecentProjects(projects: ScatterProjectInfo[]): Promise<ScatterProjectInfo[]> {
  const next = normalizeRecentProjects(projects.map(persistedRecentProject)).slice(0, maxRecentProjects);
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(appDataPath("recent-projects.json"), JSON.stringify(next, null, 2), "utf8");
  return next.map(withProjectAvailability);
}

async function upsertRecentProject(project: ScatterProjectInfo): Promise<void> {
  const current = await readRecentProjects();
  const existingIndex = current.findIndex((item) => item.path === project.path);
  const next =
    existingIndex >= 0
      ? current.map((item, index) => (index === existingIndex ? persistedRecentProject(project) : item))
      : [persistedRecentProject(project), ...current];
  await writeRecentProjects(next);
}

export async function removeRecentProject(projectPath: string): Promise<ScatterProjectInfo[]> {
  const current = await readRecentProjects();
  const removed = current.some((item) => item.path === projectPath);
  const next = current.filter((item) => item.path !== projectPath);
  const projects = await writeRecentProjects(next);
  if (removed) {
    await unlockAchievement("gone-in-a-flash").catch(() => undefined);
  }
  return projects;
}

export async function getRecentProjects(): Promise<ScatterProjectInfo[]> {
  const projects = await readRecentProjects();
  return projects.map(withProjectAvailability);
}

export async function reorderRecentProjects(projectPaths: string[]): Promise<ScatterProjectInfo[]> {
  const current = await readRecentProjects();
  const byPath = new Map(current.map((project) => [project.path, project]));
  const used = new Set<string>();
  const reordered: ScatterProjectInfo[] = [];

  for (const projectPath of projectPaths) {
    const project = byPath.get(projectPath);
    if (!project || used.has(project.path)) continue;
    used.add(project.path);
    reordered.push(project);
  }

  const next = [...reordered, ...current.filter((project) => !used.has(project.path))];
  return writeRecentProjects(next);
}

export async function chooseProject(kind: "create" | "open"): Promise<OpenProjectResult | null> {
  const settings = await getSettings();
  const result = await dialog.showOpenDialog({
    title:
      kind === "create"
        ? tMain(settings.language, "chooseProjectCreateTitle")
        : tMain(settings.language, "chooseProjectOpenTitle"),
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return openKnownProject(result.filePaths[0]);
}

export async function chooseAttachments(projectPath: string): Promise<Attachment[]> {
  const settings = await getSettings();
  const result = await dialog.showOpenDialog({
    title: tMain(settings.language, "chooseAttachmentsTitle"),
    properties: ["openFile", "multiSelections"],
    securityScopedBookmarks: true
  });

  if (result.canceled || result.filePaths.length === 0) return [];
  return saveAttachments(
    projectPath,
    result.filePaths.map((filePath, index) => ({
      name: path.basename(filePath),
      path: filePath,
      bookmark: result.bookmarks?.[index],
      source: "upload"
    }))
  );
}

export async function openKnownProject(projectPath: string): Promise<OpenProjectResult> {
  if (!isProjectRootAvailable(projectPath)) {
    const settings = await getSettings();
    throw new Error(tMain(settings.language, "projectMissingError"));
  }

  const loadedDocument = await ensureProject(projectPath);
  const document = await prepareBrowserPlayableVideos(projectPath, loadedDocument);
  if (document !== loadedDocument) {
    await writeFile(documentPath(projectPath), JSON.stringify(document, null, 2), "utf8");
  }
  const project: ScatterProjectInfo = {
    name: document.projectName || projectNameFromPath(projectPath),
    path: projectPath,
    updatedAt: now()
  };
  await upsertRecentProject(project);
  await recordProjectOpened(projectPath).catch(() => undefined);
  return { project, document };
}

export async function saveDocument(projectPath: string, document: ScatterDocument): Promise<ScatterDocument> {
  if (!isProjectRootAvailable(projectPath)) {
    const settings = await getSettings();
    throw new Error(tMain(settings.language, "projectMissingError"));
  }

  const next: ScatterDocument = {
    ...document,
    updatedAt: now(),
    projectName: document.projectName || projectNameFromPath(projectPath)
  };
  await mkdir(scatterPath(projectPath), { recursive: true });
  await writeFile(documentPath(projectPath), JSON.stringify(next, null, 2), "utf8");
  await upsertRecentProject({
    name: next.projectName,
    path: projectPath,
    updatedAt: next.updatedAt
  });
  return next;
}

/** Enforce the persisted project-level execution boundary at the main-process IPC edge. */
export async function assertProjectExecutionAllowed(projectPath: string): Promise<void> {
  if (!isProjectRootAvailable(projectPath)) throw new Error("The Scatter project folder is unavailable.");
  const raw = await readFile(documentPath(projectPath), "utf8");
  const document = JSON.parse(raw) as Partial<ScatterDocument>;
  if (document.executionMode === "preview-only") {
    throw new Error("This Scatter project is preview-only. Running, generation, and conversion are disabled.");
  }
}

/**
 * Resolve a Gemini image input from the persisted project graph in the main
 * process. Renderer supplied paths and image bytes are deliberately ignored:
 * only an image attachment already owned by the requested node can be read.
 */
export async function readGeminiImageAttachment(
  projectPath: string,
  nodeId: string,
  attachmentId: string
): Promise<{ bytes: Buffer; mimeType: GeminiSupportedImageMime }> {
  if (!isProjectRootAvailable(projectPath)) throw new Error("The Scatter project folder is unavailable.");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(nodeId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(attachmentId)) {
    throw new Error("Invalid image attachment reference.");
  }

  const document = JSON.parse(await readFile(documentPath(projectPath), "utf8")) as Partial<ScatterDocument>;
  const node = document.nodes?.find((candidate) => candidate.id === nodeId && candidate.data.nodeKind === "image-reference");
  const attachment = node?.data.attachments?.find((candidate) => candidate.id === attachmentId && candidate.kind === "image");
  if (!attachment) throw new Error("The selected image is not attached to this project node.");

  const mimeType = attachment.mime as GeminiSupportedImageMime;
  if (!geminiSupportedImageMimes.includes(mimeType)) throw new Error("The selected image format is not supported by Gemini.");

  const projectRoot = path.resolve(projectPath);
  const scatterRoot = path.resolve(scatterPath(projectRoot));
  const assetsRoot = path.resolve(assetsPath(projectRoot));
  const expectedAssetsRoot = path.join(scatterRoot, assetsDirName);
  if (assetsRoot !== expectedAssetsRoot) throw new Error("Invalid project asset directory.");

  // `.scatter/assets` is intentionally flat. Requiring a direct child blocks
  // traversal and avoids following an intermediate symlink supplied by a
  // hand-edited project document.
  const imagePath = path.resolve(projectRoot, attachment.relativePath);
  if (path.dirname(imagePath) !== assetsRoot || !imagePath.startsWith(`${assetsRoot}${path.sep}`)) {
    throw new Error("The selected image path is outside project assets.");
  }

  const scatterMetadata = await lstat(scatterRoot);
  const assetsMetadata = await lstat(assetsRoot);
  const imageMetadata = await lstat(imagePath);
  if (scatterMetadata.isSymbolicLink() || !scatterMetadata.isDirectory()
    || assetsMetadata.isSymbolicLink() || !assetsMetadata.isDirectory()
    || imageMetadata.isSymbolicLink() || !imageMetadata.isFile()) {
    throw new Error("The selected image must be a regular file in project assets.");
  }
  if (imageMetadata.size <= 0 || imageMetadata.size > geminiMaxInlineImageBytes) {
    throw new Error("The selected image exceeds the Gemini size limit.");
  }

  return { bytes: await readFile(imagePath), mimeType };
}

export async function preparePromptOutputFile(projectPath: string, nodeId: string): Promise<string> {
  if (!isProjectRootAvailable(projectPath)) throw new Error("The Scatter project folder is unavailable.");
  const directory = promptOutputDirectory(projectPath);
  const filePath = promptOutputFilePath(projectPath, nodeId);
  await mkdir(directory, { recursive: true });
  await rm(filePath, { force: true });
  return filePath;
}

export async function readPromptOutputFile(projectPath: string, nodeId: string): Promise<PromptOutputFile | null> {
  if (!isProjectRootAvailable(projectPath)) throw new Error("The Scatter project folder is unavailable.");
  const filePath = promptOutputFilePath(projectPath, nodeId);
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Prompt output must be a regular file.");
    if (metadata.size > 1024 * 1024) throw new Error("Prompt output is larger than the 1 MB limit.");
    return {
      content: await readFile(filePath, "utf8"),
      modifiedAt: metadata.mtimeMs
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sanitizeBaseName(name: string): string {
  return name
    .replace(/[^\w.\- ()\u4e00-\u9fa5]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "attachment";
}

function extensionFor(input: AttachmentInput): string {
  const fromName = path.extname(input.name);
  if (fromName) return fromName;
  if (input.mime?.includes("png")) return ".png";
  if (input.mime?.includes("jpeg") || input.mime?.includes("jpg")) return ".jpg";
  if (input.mime?.includes("webp")) return ".webp";
  if (input.mime?.includes("gif")) return ".gif";
  if (input.mime?.includes("pdf")) return ".pdf";
  if (input.mime?.includes("markdown")) return ".md";
  if (input.mime?.includes("text")) return ".txt";
  return ".bin";
}

function kindFor(input: AttachmentInput): "image" | "video" | "file" {
  if (input.mime?.startsWith("image/")) return "image";
  const ext = extensionFor(input).toLowerCase();
  if (input.mime?.startsWith("video/") || [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"].includes(ext)) return "video";
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"].includes(ext) ? "image" : "file";
}

async function withSecurityScopedAccess<T>(bookmark: string | undefined, action: () => Promise<T>): Promise<T> {
  let stopAccessing: (() => void) | undefined;
  if (bookmark && process.platform === "darwin" && process.mas) {
    const releaseSecurityScopedAccess = app.startAccessingSecurityScopedResource(bookmark);
    stopAccessing = () => releaseSecurityScopedAccess();
  }

  try {
    return await action();
  } finally {
    stopAccessing?.();
  }
}

async function saveAttachment(projectPath: string, input: AttachmentInput): Promise<Attachment> {
  await mkdir(assetsPath(projectPath), { recursive: true });
  const id = randomUUID();
  const ext = extensionFor(input);
  const base = sanitizeBaseName(path.basename(input.name, path.extname(input.name)));
  const fileName = `${id}-${base}${ext}`;
  const storedPath = path.join(assetsPath(projectPath), fileName);

  if (input.path) {
    const sourcePath = input.path;
    await withSecurityScopedAccess(input.bookmark, () => copyFile(sourcePath, storedPath));
  } else if (input.bytes) {
    await writeFile(storedPath, Buffer.from(input.bytes));
  } else {
    throw new Error("Attachment input must include a file path or bytes.");
  }

  const fileStat = await stat(storedPath);
  const relativePath = path.join(scatterDirName, assetsDirName, fileName);

  const attachment: Attachment = {
    id,
    kind: kindFor(input),
    source: input.source,
    originalName: input.name,
    storedPath,
    relativePath,
    fileUrl: attachmentFileUrl(storedPath),
    mime: input.mime || "application/octet-stream",
    size: fileStat.size,
    createdAt: now()
  };
  return prepareBrowserPlayableVideo(projectPath, attachment);
}

export async function saveAttachments(projectPath: string, inputs: AttachmentInput[]): Promise<Attachment[]> {
  const saved: Attachment[] = [];
  for (const input of inputs) {
    saved.push(await saveAttachment(projectPath, input));
  }
  return saved;
}

export async function saveClipboardImage(projectPath: string): Promise<Attachment | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  if (png.length === 0) return null;
  const bytes = new ArrayBuffer(png.byteLength);
  new Uint8Array(bytes).set(png);
  return saveAttachment(projectPath, {
    name: `clipboard-image-${Date.now()}.png`,
    mime: "image/png",
    source: "clipboard",
    bytes
  });
}

export async function getClipboardFilePaths(): Promise<string[]> {
  const candidates = new Set<string>();
  const formats = clipboard.availableFormats();

  for (const format of ["public.file-url", "text/uri-list"]) {
    if (!formats.includes(format)) continue;
    const raw = clipboard.read(format);
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("file://")) {
        try {
          candidates.add(decodeURIComponent(new URL(trimmed).pathname));
        } catch {
          // Ignore malformed clipboard URL entries.
        }
      }
    }
  }

  return [...candidates].filter((filePath) => existsSync(filePath));
}

export async function saveClipboardFiles(projectPath: string): Promise<Attachment[]> {
  const paths = await getClipboardFilePaths();
  return saveAttachments(
    projectPath,
    paths.map((filePath) => ({
      name: path.basename(filePath),
      path: filePath,
      source: "paste"
    }))
  );
}

export function createEmptyNativeImage(): Electron.NativeImage {
  return nativeImage.createEmpty();
}
