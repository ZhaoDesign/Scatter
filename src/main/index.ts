import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, protocol, shell, type BrowserWindowConstructorOptions } from "electron";
import { createReadStream, existsSync } from "node:fs";
import { stat as statFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  chooseAttachments,
  chooseProject,
  assertProjectExecutionAllowed,
  getRecentProjects,
  openKnownProject,
  reorderRecentProjects,
  removeRecentProject,
  preparePromptOutputFile,
  readGeminiImageAttachment,
  readPromptOutputFile,
  saveAttachments,
  saveClipboardFiles,
  saveClipboardImage,
  saveDocument
} from "./projectStore";
import { getAchievements, recordUsageToday, unlockAchievement } from "./achievementStore";
import {
  closeAccessibilityPermissionGuide,
  type AccessibilityGuideAppearance,
  getAccessibilityPermissionStatus,
  openAccessibilityPermissionGuide,
  openAccessibilitySettings,
  requestAccessibilityPermission,
  resetAccessibilityPermission
} from "./accessibilityPermission";
import { runAssistant } from "./assistantBridge";
import { getDepthModelStatus, runDepthConversion } from "./depthConversion";
import {
  clearGeminiApiKey,
  getGeminiApiKeyStatus,
  getSettings,
  readGeminiApiKey,
  saveSettings,
  setGeminiApiKey
} from "./settingsStore";
import {
  geminiDefaultVisionModel,
  geminiMaxPromptChars,
  type GeminiImageUnderstandingErrorCode,
  type GeminiImageUnderstandingRequest,
  type GeminiImageUnderstandingResult,
  type GeminiSupportedImageMime
} from "../shared/types";
import { getPixverseAuthStatus, switchPixverseAccount } from "./pixverseAuth";
import { getPixverseCreateCapabilities, runPixverseGeneration } from "./pixverseGeneration";
import { listSkills } from "./skillCatalog";
import { registerUpdateIpc, startAutomaticUpdateCheck } from "./updateService";
import type { AppSettings, AssistantRunInput, AttachmentInput, DepthConversionRequest, LanguagePreference, PixverseCreateMode, PixverseGenerationRequest, ScatterDocument } from "../shared/types";

const SPLASH_MIN_DURATION_MS = 5000;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "scatter-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

if (process.env.SCATTER_USER_DATA_DIR) {
  app.setPath("userData", process.env.SCATTER_USER_DATA_DIR);
} else if (!app.isPackaged) {
  // Keep the development client isolated from the installed Scatter client.
  // Both otherwise resolve to the same userData directory and can appear as duplicate windows.
  app.setPath("userData", path.join(app.getPath("userData"), "dev"));
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.scatter.desktop");
}

function isScatterAssetPath(filePath: string): boolean {
  return filePath.includes(`${path.sep}.scatter${path.sep}assets${path.sep}`);
}

function registerAssetProtocol(): void {
  protocol.handle("scatter-asset", async (request) => {
    const url = new URL(request.url);
    const token = url.pathname.slice(1);
    const filePath = Buffer.from(token, "base64url").toString("utf8");

    if (!isScatterAssetPath(filePath)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const fileStat = await statFile(filePath);
      const range = request.headers.get("range");
      let start = 0;
      let end = fileStat.size - 1;
      let status = 200;
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileStat.size),
        "Content-Type": mimeTypeForPath(filePath)
      });

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
        if (match) {
          if (match[1]) start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
          if (!match[1] && match[2]) {
            const suffixLength = Number(match[2]);
            start = Math.max(0, fileStat.size - suffixLength);
          }
          if (start <= end && start >= 0 && end < fileStat.size) {
            status = 206;
            headers.set("Content-Length", String(end - start + 1));
            headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
          } else {
            return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileStat.size}` } });
          }
        }
      }

      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml"
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function rendererUrl(query?: Record<string, string>): string | null {
  if (!process.env.ELECTRON_RENDERER_URL) return null;

  const url = new URL(process.env.ELECTRON_RENDERER_URL);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function loadRenderer(window: BrowserWindow, query?: Record<string, string>): void {
  const rendererQuery = { platform: process.platform, ...(query ?? {}) };
  const devUrl = rendererUrl(rendererQuery);
  if (devUrl) {
    void window.loadURL(devUrl);
    return;
  }

  void window.loadFile(path.join(__dirname, "../renderer/index.html"), { query: rendererQuery });
}

function appIconPath(): string {
  const candidates = [
    path.join(process.cwd(), "resources", "app-icon.png"),
    path.join(app.getAppPath(), "resources", "app-icon.png"),
    path.join(process.resourcesPath, "app-icon.png"),
    path.join(process.resourcesPath, "resources", "app-icon.png")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function setAppIcon(iconPath: string): void {
  if (process.platform !== "darwin" || !existsSync(iconPath)) return;
  app.dock?.setIcon(nativeImage.createFromPath(iconPath));
}

async function accessibilityGuideOptions(): Promise<{
  appearance: AccessibilityGuideAppearance;
  language: LanguagePreference;
}> {
  const settings = await getSettings();
  return {
    appearance: settings.themePreference,
    language: settings.language
  };
}

function preloadScriptPath(): string {
  const candidates = [
    path.join(__dirname, "../preload/index.mjs"),
    path.join(__dirname, "../preload/index.js")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function solidWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#151515" : "#FFFFFF";
}

function windowVisualOptions(): Pick<
  BrowserWindowConstructorOptions,
  "backgroundColor" | "transparent" | "vibrancy" | "visualEffectState"
> {
  if (process.platform === "win32") {
    return {
      transparent: false,
      backgroundColor: solidWindowBackgroundColor()
    };
  }

  return {
    transparent: true,
    backgroundColor: "#00000000",
    vibrancy: "fullscreen-ui",
    visualEffectState: "active"
  };
}

function createSplashWindow(iconPath: string): BrowserWindow {
  const splashWindow = new BrowserWindow({
    width: 936,
    height: 528,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    ...windowVisualOptions(),
    icon: iconPath,
    title: "Scatter",
    webPreferences: {
      preload: preloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  splashWindow.once("ready-to-show", () => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });

  loadRenderer(splashWindow, { window: "splash", version: app.getVersion() });
  return splashWindow;
}

function createWindow(showWhenReady = false, iconPath = appIconPath()): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    minWidth: 1040,
    minHeight: 720,
    title: "Scatter",
    ...windowVisualOptions(),
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 16 },
    webPreferences: {
      preload: preloadScriptPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (showWhenReady) {
    mainWindow.once("ready-to-show", () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });
  }

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const isMacDevtoolsShortcut = process.platform === "darwin" && input.meta && input.alt && input.key.toLowerCase() === "i";
    const isWindowsDevtoolsShortcut =
      process.platform !== "darwin" && input.control && input.shift && input.key.toLowerCase() === "i";
    const isF12 = input.key === "F12";

    if (!isMacDevtoolsShortcut && !isWindowsDevtoolsShortcut && !isF12) return;

    event.preventDefault();
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  loadRenderer(mainWindow);
  return mainWindow;
}

const geminiApiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
const geminiRequestTimeoutMs = 60_000;
/**
 * The model name is interpolated into the request path, so it is restricted to
 * the documented Gemini shape instead of accepting an arbitrary string.
 */
const geminiModelNamePattern = /^gemini-[a-zA-Z0-9._-]{1,64}$/;

function geminiFailure(error: GeminiImageUnderstandingErrorCode): GeminiImageUnderstandingResult {
  return { ok: false, error };
}

function geminiErrorFromStatus(status: number): GeminiImageUnderstandingErrorCode {
  if (status === 401 || status === 403) return "auth-failed";
  if (status === 404) return "model-unavailable";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "service-error";
  return "request-failed";
}

const geminiRefIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Single-shot image understanding: a project attachment reference + prompt in,
 * text out.
 *
 * The renderer never sends or receives image bytes. `readGeminiImageAttachment`
 * resolves the file inside `.scatter/assets` in this process — validating the
 * owning node, the MIME type, the size ceiling and the path containment — and
 * the returned buffer is encoded to base64 here and handed straight to Gemini.
 * The API key is decrypted here and travels only in a request header, so it
 * cannot leak through a URL, an error message or a log line. Response bodies are
 * not read on failure because they can echo fragments of the request.
 */
async function analyzeImageWithGemini(
  request: GeminiImageUnderstandingRequest
): Promise<GeminiImageUnderstandingResult> {
  if (!request || typeof request !== "object") return geminiFailure("invalid-request");

  const projectPath = typeof request.projectPath === "string" ? request.projectPath.trim() : "";
  const nodeId = typeof request.nodeId === "string" ? request.nodeId.trim() : "";
  const attachmentId = typeof request.attachmentId === "string" ? request.attachmentId.trim() : "";
  if (!projectPath || !geminiRefIdPattern.test(nodeId) || !geminiRefIdPattern.test(attachmentId)) {
    return geminiFailure("invalid-request");
  }

  const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
  if (!prompt || prompt.length > geminiMaxPromptChars) return geminiFailure("invalid-request");

  const model =
    typeof request.model === "string" && request.model.trim()
      ? request.model.trim()
      : geminiDefaultVisionModel;
  if (!geminiModelNamePattern.test(model)) return geminiFailure("invalid-request");

  // Preview-only projects cannot dispatch any execution, same gate as runs.
  await assertProjectExecutionAllowed(projectPath);

  let image: { bytes: Buffer; mimeType: GeminiSupportedImageMime };
  try {
    image = await readGeminiImageAttachment(projectPath, nodeId, attachmentId);
  } catch {
    return geminiFailure("invalid-request");
  }

  let apiKey: string | null;
  try {
    apiKey = await readGeminiApiKey();
  } catch {
    return geminiFailure("encryption-unavailable");
  }
  if (!apiKey) return geminiFailure("key-not-configured");

  let base64Image = image.bytes.toString("base64");
  try {
    const response = await fetch(`${geminiApiBaseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            // The official guidance is to place text before image parts.
            parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: base64Image } }]
          }
        ]
      }),
      signal: AbortSignal.timeout(geminiRequestTimeoutMs)
    });

    if (!response.ok) return geminiFailure(geminiErrorFromStatus(response.status));

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      modelVersion?: string;
    };

    const textParts: string[] = [];
    for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
      // Reasoning traces are not part of the answer the caller asked for.
      if (typeof part.text === "string" && part.thought !== true) textParts.push(part.text);
    }

    const text = textParts.join("");
    if (!text.trim()) return geminiFailure("empty-response");
    return { ok: true, text, modelUsed: payload.modelVersion ?? model };
  } catch (error) {
    const errorName = (error as { name?: unknown } | null | undefined)?.name;
    if (errorName === "TimeoutError" || errorName === "AbortError") return geminiFailure("timeout");
    return geminiFailure("request-failed");
  } finally {
    // Drops the only in-memory copy of the encoded image; the underlying buffers
    // become garbage-collectable once this frame returns. Nothing is written to
    // disk and nothing is sent back to the renderer.
    base64Image = "";
  }
}

app.whenReady().then(async () => {
  const iconPath = appIconPath();
  setAppIcon(iconPath);
  await recordUsageToday().catch(() => undefined);
  registerAssetProtocol();
  ipcMain.handle("scatter:get-achievements", () => getAchievements());
  ipcMain.handle("scatter:get-settings", () => getSettings());
  ipcMain.handle("scatter:save-settings", (_event, settings: AppSettings) => saveSettings(settings));
  ipcMain.handle("scatter:pixverse-auth-status", () => getPixverseAuthStatus());
  ipcMain.handle("scatter:pixverse-switch-account", () => switchPixverseAccount());
  ipcMain.handle("scatter:pixverse-capabilities", async (_event, mode: PixverseCreateMode) => {
    if (mode !== "image" && mode !== "video" && mode !== "reference") return { error: "capabilities-failed" as const };
    try {
      const capabilities = await getPixverseCreateCapabilities(mode);
      return capabilities ? { capabilities } : { error: "cli-not-found" as const };
    } catch {
      return { error: "capabilities-failed" as const };
    }
  });
  ipcMain.handle("scatter:pixverse-generate", (_event, request: PixverseGenerationRequest) => runPixverseGeneration(request));
  registerUpdateIpc();
  ipcMain.handle("scatter:accessibility:get-status", () => getAccessibilityPermissionStatus());
  ipcMain.handle("scatter:accessibility:request", () => requestAccessibilityPermission());
  ipcMain.handle("scatter:accessibility:open-settings", () => openAccessibilitySettings());
  ipcMain.handle("scatter:accessibility:open-guide", async () => {
    const options = await accessibilityGuideOptions();
    return openAccessibilityPermissionGuide(iconPath, options.appearance, options.language);
  });
  ipcMain.handle("scatter:accessibility:close-guide", () => closeAccessibilityPermissionGuide());
  ipcMain.handle("scatter:accessibility:reset-permission", () => resetAccessibilityPermission());
  ipcMain.handle("scatter:get-recent-projects", () => getRecentProjects());
  ipcMain.handle("scatter:remove-recent-project", (_event, projectPath: string) => removeRecentProject(projectPath));
  ipcMain.handle("scatter:reorder-recent-projects", (_event, projectPaths: string[]) => reorderRecentProjects(projectPaths));
  ipcMain.handle("scatter:create-project", () => chooseProject("create"));
  ipcMain.handle("scatter:open-project", () => chooseProject("open"));
  ipcMain.handle("scatter:open-known-project", (_event, projectPath: string) => openKnownProject(projectPath));
  ipcMain.handle("scatter:list-skills", (_event, projectPath: string, forceRefresh?: boolean) => listSkills(projectPath, forceRefresh));
  ipcMain.handle("scatter:choose-attachments", (_event, projectPath: string) => chooseAttachments(projectPath));
  ipcMain.handle("scatter:save-document", (_event, projectPath: string, document: ScatterDocument) =>
    saveDocument(projectPath, document)
  );
  ipcMain.handle("scatter:prepare-prompt-output", (_event, projectPath: string, nodeId: string) =>
    preparePromptOutputFile(projectPath, nodeId)
  );
  ipcMain.handle("scatter:read-prompt-output", (_event, projectPath: string, nodeId: string) =>
    readPromptOutputFile(projectPath, nodeId)
  );
  ipcMain.handle("scatter:save-attachments", (_event, projectPath: string, inputs: AttachmentInput[]) =>
    saveAttachments(projectPath, inputs)
  );
  ipcMain.handle("scatter:save-clipboard-image", (_event, projectPath: string) => saveClipboardImage(projectPath));
  ipcMain.handle("scatter:save-clipboard-files", (_event, projectPath: string) => saveClipboardFiles(projectPath));
  ipcMain.handle("scatter:show-in-folder", (_event, targetPath: string) => shell.showItemInFolder(targetPath));
  ipcMain.handle("scatter:run-assistant", async (_event, input: AssistantRunInput) => {
    await assertProjectExecutionAllowed(input.projectPath);
    const result = await runAssistant(input);
    if (input.provider === "codex") {
      await unlockAchievement("codex-rookie").catch(() => undefined);
    }
    return result;
  });
  ipcMain.handle("scatter:get-depth-model-status", (_event, projectPath: string, model?: "small" | "base" | "large") => getDepthModelStatus(projectPath, model));
  ipcMain.handle("scatter:run-depth-conversion", async (event, input: DepthConversionRequest) => {
    await assertProjectExecutionAllowed(input.projectPath);
    return runDepthConversion(input, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("scatter:depth-progress", progress);
    });
  });
  // The key never travels back down these channels: status carries presence
  // metadata only, and image understanding returns text plus an error code.
  ipcMain.handle("scatter:gemini-key-status", () => getGeminiApiKeyStatus());
  ipcMain.handle("scatter:gemini-key-set", (_event, key: string) => setGeminiApiKey(key));
  ipcMain.handle("scatter:gemini-key-clear", () => clearGeminiApiKey());
  ipcMain.handle("scatter:gemini-analyze-image", (_event, request: GeminiImageUnderstandingRequest) =>
    analyzeImageWithGemini(request)
  );

  const splashWindow = createSplashWindow(iconPath);
  const mainWindow = createWindow(false, iconPath);
  const splashDelay = new Promise((resolve) => {
    setTimeout(resolve, SPLASH_MIN_DURATION_MS);
  });
  const mainWindowReady = new Promise<void>((resolve) => {
    mainWindow.once("ready-to-show", () => resolve());
  });

  Promise.all([splashDelay, mainWindowReady]).then(() => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      startAutomaticUpdateCheck();
    }
    if (!splashWindow.isDestroyed()) {
      splashWindow.close();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true, iconPath);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeAccessibilityPermissionGuide();
});
