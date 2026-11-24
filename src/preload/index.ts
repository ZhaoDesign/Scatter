import { contextBridge, ipcRenderer } from "electron";
import type {
  AccessibilityPermissionStatus,
  AchievementState,
  AppSettings,
  AppUpdateState,
  AssistantRunInput,
  AssistantRunResult,
  Attachment,
  AttachmentInput,
  DepthConversionResult,
  DepthConversionProgress,
  DepthConversionRequest,
  DepthModel,
  DepthModelStatus,
  GeminiApiKeyResult,
  GeminiApiKeyStatus,
  GeminiImageUnderstandingRequest,
  GeminiImageUnderstandingResult,
  OpenProjectResult,
  PromptOutputFile,
  PixverseAccountSwitchResult,
  PixverseAuthStatus,
  PixverseCapabilitiesResult,
  PixverseCreateMode,
  PixverseGenerationRequest,
  PixverseGenerationResult,
  ScatterDocument,
  ScatterProjectInfo,
  SkillCatalogItem
} from "../shared/types";

const api = {
  getAchievements: (): Promise<AchievementState> => ipcRenderer.invoke("scatter:get-achievements"),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("scatter:get-settings"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("scatter:save-settings", settings),
  getPixverseAuthStatus: (): Promise<PixverseAuthStatus> => ipcRenderer.invoke("scatter:pixverse-auth-status"),
  getGeminiApiKeyStatus: (): Promise<GeminiApiKeyStatus> => ipcRenderer.invoke("scatter:gemini-key-status"),
  setGeminiApiKey: (key: string): Promise<GeminiApiKeyResult> =>
    ipcRenderer.invoke("scatter:gemini-key-set", key),
  clearGeminiApiKey: (): Promise<GeminiApiKeyResult> => ipcRenderer.invoke("scatter:gemini-key-clear"),
  analyzeGeminiImage: (request: GeminiImageUnderstandingRequest): Promise<GeminiImageUnderstandingResult> =>
    ipcRenderer.invoke("scatter:gemini-analyze-image", request),
  switchPixverseAccount: (): Promise<PixverseAccountSwitchResult> => ipcRenderer.invoke("scatter:pixverse-switch-account"),
  getPixverseCapabilities: (mode: PixverseCreateMode): Promise<PixverseCapabilitiesResult> => ipcRenderer.invoke("scatter:pixverse-capabilities", mode),
  runPixverseGeneration: (request: PixverseGenerationRequest): Promise<PixverseGenerationResult> => ipcRenderer.invoke("scatter:pixverse-generate", request),
  updates: {
    getState: (): Promise<AppUpdateState> => ipcRenderer.invoke("scatter:updates:get-state"),
    check: (): Promise<AppUpdateState> => ipcRenderer.invoke("scatter:updates:check"),
    download: (): Promise<AppUpdateState> => ipcRenderer.invoke("scatter:updates:download"),
    install: (): Promise<AppUpdateState> => ipcRenderer.invoke("scatter:updates:install"),
    onStateChange: (listener: (state: AppUpdateState) => void): (() => void) => {
      const channel = "scatter:updates:state-changed";
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: AppUpdateState): void => listener(state);
      ipcRenderer.on(channel, wrappedListener);
      return () => ipcRenderer.removeListener(channel, wrappedListener);
    }
  },
  accessibility: {
    getStatus: (): Promise<AccessibilityPermissionStatus> => ipcRenderer.invoke("scatter:accessibility:get-status"),
    request: (): Promise<AccessibilityPermissionStatus> => ipcRenderer.invoke("scatter:accessibility:request"),
    openSettings: (): Promise<void> => ipcRenderer.invoke("scatter:accessibility:open-settings"),
    openGuide: (): Promise<AccessibilityPermissionStatus> => ipcRenderer.invoke("scatter:accessibility:open-guide"),
    closeGuide: (): Promise<void> => ipcRenderer.invoke("scatter:accessibility:close-guide"),
    resetPermission: (): Promise<AccessibilityPermissionStatus> => ipcRenderer.invoke("scatter:accessibility:reset-permission")
  },
  getRecentProjects: (): Promise<ScatterProjectInfo[]> => ipcRenderer.invoke("scatter:get-recent-projects"),
  removeRecentProject: (projectPath: string): Promise<ScatterProjectInfo[]> =>
    ipcRenderer.invoke("scatter:remove-recent-project", projectPath),
  reorderRecentProjects: (projectPaths: string[]): Promise<ScatterProjectInfo[]> =>
    ipcRenderer.invoke("scatter:reorder-recent-projects", projectPaths),
  createProject: (): Promise<OpenProjectResult | null> => ipcRenderer.invoke("scatter:create-project"),
  openProject: (): Promise<OpenProjectResult | null> => ipcRenderer.invoke("scatter:open-project"),
  openKnownProject: (projectPath: string): Promise<OpenProjectResult> =>
    ipcRenderer.invoke("scatter:open-known-project", projectPath),
  chooseAttachments: (projectPath: string): Promise<Attachment[]> => ipcRenderer.invoke("scatter:choose-attachments", projectPath),
  saveDocument: (projectPath: string, document: ScatterDocument): Promise<ScatterDocument> =>
    ipcRenderer.invoke("scatter:save-document", projectPath, document),
  preparePromptOutput: (projectPath: string, nodeId: string): Promise<string> =>
    ipcRenderer.invoke("scatter:prepare-prompt-output", projectPath, nodeId),
  readPromptOutput: (projectPath: string, nodeId: string): Promise<PromptOutputFile | null> =>
    ipcRenderer.invoke("scatter:read-prompt-output", projectPath, nodeId),
  saveAttachments: (projectPath: string, inputs: AttachmentInput[]): Promise<Attachment[]> =>
    ipcRenderer.invoke("scatter:save-attachments", projectPath, inputs),
  saveClipboardImage: (projectPath: string): Promise<Attachment | null> =>
    ipcRenderer.invoke("scatter:save-clipboard-image", projectPath),
  saveClipboardFiles: (projectPath: string): Promise<Attachment[]> =>
    ipcRenderer.invoke("scatter:save-clipboard-files", projectPath),
  showInFolder: (targetPath: string): Promise<void> => ipcRenderer.invoke("scatter:show-in-folder", targetPath),
  runAssistant: (input: AssistantRunInput): Promise<AssistantRunResult> => ipcRenderer.invoke("scatter:run-assistant", input),
  listSkills: (projectPath: string, forceRefresh = false): Promise<SkillCatalogItem[]> => ipcRenderer.invoke("scatter:list-skills", projectPath, forceRefresh),
  getDepthModelStatus: (projectPath: string, model?: DepthModel): Promise<DepthModelStatus> => ipcRenderer.invoke("scatter:get-depth-model-status", projectPath, model),
  runDepthConversion: (input: DepthConversionRequest): Promise<DepthConversionResult> => ipcRenderer.invoke("scatter:run-depth-conversion", input),
  onDepthProgress: (listener: (progress: DepthConversionProgress) => void): (() => void) => {
    const channel = "scatter:depth-progress";
    const wrappedListener = (_event: Electron.IpcRendererEvent, progress: DepthConversionProgress): void => listener(progress);
    ipcRenderer.on(channel, wrappedListener);
    return () => ipcRenderer.removeListener(channel, wrappedListener);
  }
};

contextBridge.exposeInMainWorld("scatter", api);

export type ScatterApi = typeof api;
