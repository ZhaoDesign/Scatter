import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { utilityProcess, type UtilityProcess } from "electron";
import type { DepthConversionProgress, DepthConversionRequest, DepthConversionResult, DepthModel, DepthModelPrecision, DepthModelStatus } from "../shared/types";
import { saveAttachments } from "./projectStore";

const execFileAsync = promisify(execFile);
const DEPTH_MODEL_RELEASES: Record<DepthModel, { revision: string; fp16Bytes: number; q8Bytes: number }> = {
  small: { revision: "4472b7362082ad9968fee890ca0f1e5aca36b93d", fp16Bytes: 49_642_442, q8Bytes: 27_258_801 },
  base: { revision: "dd4557d492cd7b563738ac8d9ccff9094620983c", fp16Bytes: 194_570_657, q8Bytes: 102_391_398 },
  large: { revision: "1fa1591c7b080e98da9655827c3a33a3972a4a83", fp16Bytes: 668_656_405, q8Bytes: 347_424_978 }
};
const modelDownloads = new Map<string, Promise<string>>();
interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

const MODEL_INPUT_SIZE = 518;
const MODEL_SIZE_DIVISOR = 14;

function parseRate(value: string): number {
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 24;
  return numerator / denominator;
}

async function probeVideo(inputPath: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-show_entries", "format=duration",
    "-of", "json",
    inputPath
  ]);
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>; format?: { duration?: string } };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream.height) throw new Error("无法读取输入视频尺寸。");
  return {
    width: stream.width,
    height: stream.height,
    fps: Math.max(1, parseRate(stream.r_frame_rate || "24/1")),
    duration: Math.max(0, Number(parsed.format?.duration || 0))
  };
}

function modelArtifactName(precision: DepthModelPrecision): string {
  return precision === "fp16" ? "model_fp16.onnx" : "model_quantized.onnx";
}

async function findModel(projectPath: string, model: DepthModel, precision?: DepthModelPrecision): Promise<string> {
  const roots = [
    path.join(os.homedir(), ".canvasight", "models", "depth-anything-v2", model),
    path.join(projectPath, ".scatter", "models", "depth-anything-v2", model)
  ];
  const artifactNames = precision ? [modelArtifactName(precision)] : ["model_fp16.onnx", "model_quantized.onnx", "model.onnx"];
  const candidates = new Map<string, string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const queue = [root];
    while (queue.length) {
      const current = queue.shift()!;
      for (const item of await readdir(current, { withFileTypes: true })) {
        const candidate = path.join(current, item.name);
        if (item.isDirectory()) queue.push(candidate);
        if (item.isFile() && artifactNames.includes(item.name) && !candidates.has(item.name)) candidates.set(item.name, candidate);
      }
    }
  }
  for (const artifactName of artifactNames) {
    const candidate = candidates.get(artifactName);
    if (candidate) return candidate;
  }
  throw new Error(`未找到本地深度模型：Depth Anything V2 · ${model} · ${precision || "任意精度"}。`);
}

async function downloadModelArtifact(model: DepthModel, precision: DepthModelPrecision, onProgress?: DepthProgressHandler): Promise<string> {
  const release = DEPTH_MODEL_RELEASES[model];
  const artifactName = modelArtifactName(precision);
  const expectedBytes = precision === "fp16" ? release.fp16Bytes : release.q8Bytes;
  const destination = path.join(os.homedir(), ".canvasight", "models", "depth-anything-v2", model, release.revision, "onnx", artifactName);
  const cacheKey = `${model}:${precision}:${destination}`;
  const existingDownload = modelDownloads.get(cacheKey);
  if (existingDownload) return existingDownload;

  const download = (async () => {
    if (existsSync(destination)) {
      const existing = await stat(destination).catch(() => null);
      if (existing?.size === expectedBytes) return destination;
      await rm(destination, { force: true });
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const partialPath = `${destination}.partial`;
    await rm(partialPath, { force: true });
    const url = `https://huggingface.co/onnx-community/depth-anything-v2-${model}/resolve/${release.revision}/onnx/${artifactName}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）。`);
    const headerLength = Number(response.headers.get("content-length"));
    const totalBytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : expectedBytes;
    const file = await open(partialPath, "w");
    let downloadedBytes = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
          if (bytesWritten <= 0) throw new Error("模型文件写入失败。");
          offset += bytesWritten;
        }
        downloadedBytes += value.byteLength;
        onProgress?.({ phase: "model-download", frameIndex: downloadedBytes, totalFrames: totalBytes, progress: Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)) });
      }
      await file.sync();
    } finally {
      await file.close();
    }
    if (downloadedBytes !== expectedBytes) {
      await rm(partialPath, { force: true });
      throw new Error(`模型文件不完整（收到 ${downloadedBytes} / ${expectedBytes} 字节），请重试。`);
    }
    await writeFile(path.join(path.dirname(path.dirname(destination)), "manifest.json"), JSON.stringify({
      model,
      precision,
      repository: `onnx-community/depth-anything-v2-${model}`,
      revision: release.revision,
      artifact: `onnx/${artifactName}`,
      downloadedAt: new Date().toISOString()
    }, null, 2));
    await rename(partialPath, destination);
    onProgress?.({ phase: "model-download", frameIndex: expectedBytes, totalFrames: expectedBytes, progress: 100 });
    return destination;
  })().catch(async (error: unknown) => {
    await rm(`${destination}.partial`, { force: true }).catch(() => undefined);
    throw error;
  });
  modelDownloads.set(cacheKey, download);
  try {
    return await download;
  } finally {
    modelDownloads.delete(cacheKey);
  }
}

async function resolveModel(projectPath: string, model: DepthModel, precision: DepthModelPrecision, onProgress?: DepthProgressHandler): Promise<string> {
  try {
    return await findModel(projectPath, model, precision);
  } catch {
    try {
      return await downloadModelArtifact(model, precision, onProgress);
    } catch (error) {
      throw new Error(`无法准备 ${model} 模型：${error instanceof Error ? error.message : "模型下载失败"}`);
    }
  }
}

export async function getDepthModelStatus(projectPath: string, model: DepthModel = "small"): Promise<DepthModelStatus> {
  const globalDirectory = path.join(os.homedir(), ".canvasight", "models", "depth-anything-v2", model);
  const projectDirectory = path.join(path.resolve(projectPath), ".scatter", "models", "depth-anything-v2", model);
  try {
    const modelPath = await findModel(projectPath, model);
    const relativeGlobalPath = path.relative(globalDirectory, modelPath);
    const storedGlobally = relativeGlobalPath !== ".." && !relativeGlobalPath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeGlobalPath);
    return { model, directory: storedGlobally ? globalDirectory : projectDirectory, ready: true };
  } catch {
    return { model, directory: existsSync(globalDirectory) ? globalDirectory : projectDirectory, ready: false };
  }
}

function outputSize(info: VideoInfo, resolution: DepthConversionRequest["resolution"]): { width: number; height: number } {
  const requestedHeight = resolution === "original" ? info.height : Number(resolution.replace("p", ""));
  const scale = Math.min(1, requestedHeight / info.height);
  return {
    width: Math.max(2, Math.round((info.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((info.height * scale) / 2) * 2)
  };
}

function modelInputSize(width: number, height: number): { width: number; height: number } {
  const scale = MODEL_INPUT_SIZE / Math.max(width, height);
  const toMultiple = (value: number): number => Math.max(MODEL_SIZE_DIVISOR, Math.round(value / MODEL_SIZE_DIVISOR) * MODEL_SIZE_DIVISOR);
  return { width: toMultiple(width * scale), height: toMultiple(height * scale) };
}

export type DepthProgressHandler = (progress: DepthConversionProgress) => void;

interface DepthWorkerDoneMessage {
  type: "done";
  backend: DepthConversionResult["backend"];
  frameCount: number;
}

interface DepthWorkerErrorMessage {
  type: "error";
  message: string;
}

interface DepthWorkerProgressMessage {
  type: "progress";
  frameIndex: number;
  totalFrames: number;
  progress: number;
}

type DepthWorkerMessage = DepthWorkerDoneMessage | DepthWorkerErrorMessage | DepthWorkerProgressMessage;

interface DepthWorkerInput {
  modelPath: string;
  inputPath: string;
  tempOutput: string;
  sourceFps: number;
  modelInputWidth: number;
  modelInputHeight: number;
  outputFps: number;
  analysisFps: number;
  duplicateFrames: number;
  outputWidth: number;
  outputHeight: number;
  invert: boolean;
  preserveAudio: boolean;
  totalFrames: number;
}

type DepthExecutionProvider = "coreml" | "cpu";

function runDepthUtilityProcess(
  scriptPath: string,
  input: DepthWorkerInput,
  provider: DepthExecutionProvider,
  onProgress?: DepthProgressHandler
): Promise<DepthWorkerDoneMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    let child: UtilityProcess;
    try {
      child = utilityProcess.fork(scriptPath, [provider], {
        stdio: "pipe",
        serviceName: "Scatter Depth Conversion",
        ...(process.platform === "darwin" ? { allowLoadingUnsignedLibraries: true } : {})
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.once("spawn", () => child.postMessage({ type: "start", input, provider }));
    child.on("message", (message: DepthWorkerMessage) => {
      if (message.type === "progress") {
        onProgress?.({ phase: "conversion", ...message });
        return;
      }
      if (settled) return;
      settled = true;
      if (message.type === "done") resolve(message);
      else reject(new Error(message.message));
    });
    child.once("error", (type, location, report) => {
      if (settled) return;
      settled = true;
      reject(new Error(`深度推理子进程发生原生错误（${type}，${location}）。${report.slice(0, 1200)}`));
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      const detail = stderr.trim() ? `：${stderr.trim()}` : "";
      reject(new Error(`深度推理子进程异常退出（${code}）${detail}`));
    });
  });
}

export async function runDepthConversion(request: DepthConversionRequest, onProgress?: DepthProgressHandler): Promise<DepthConversionResult> {
  const projectRoot = path.resolve(request.projectPath);
  const inputPath = path.resolve(request.inputPath);
  const assetsRoot = path.resolve(projectRoot, ".scatter", "assets");
  const relativeInput = path.relative(assetsRoot, inputPath);
  if (!relativeInput || relativeInput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeInput)) {
    throw new Error("输入视频必须是当前 Scatter 项目 .scatter/assets 内的媒体文件。");
  }
  const info = await probeVideo(request.inputPath);
  const modelPrecision = request.modelPrecision || (process.platform === "darwin" ? "fp16" : "q8");
  const reportProgress = (progress: DepthConversionProgress): void => onProgress?.({ ...progress, requestId: request.requestId });
  const modelPath = await resolveModel(request.projectPath, request.model, modelPrecision, reportProgress);
  const processingMode = request.processingMode;
  const analysisFps = processingMode === "speed" ? Math.min(12, info.fps) : Math.min(info.fps, 60);
  const outputFps = processingMode === "speed"
    ? (info.fps > 12 ? 24 : info.fps)
    : Math.min(info.fps, 60);
  const duplicateFrames = processingMode === "speed" && info.fps > 12 ? 2 : 1;
  const outputResolution = processingMode === "speed" ? "720p" : request.resolution;
  const size = outputSize(info, outputResolution);
  const inferenceSize = modelInputSize(info.width, info.height);
  const tempOutput = path.join(os.tmpdir(), `scatter-depth-${randomUUID()}.mp4`);
  const totalFrames = Math.max(1, Math.ceil(info.duration * analysisFps));
  const workerPath = path.join(__dirname, "depthWorker.js");
  onProgress?.({ phase: "conversion", frameIndex: 0, totalFrames, progress: 1 });

  try {
    const workerInput: DepthWorkerInput = {
      modelPath,
      inputPath,
      tempOutput,
      sourceFps: info.fps,
      modelInputWidth: inferenceSize.width,
      modelInputHeight: inferenceSize.height,
      outputFps,
      analysisFps,
      duplicateFrames,
      outputWidth: size.width,
      outputHeight: size.height,
      invert: request.invert,
      preserveAudio: request.preserveAudio,
      totalFrames
    };
    let workerResult: DepthWorkerDoneMessage;
    const preferredProvider: DepthExecutionProvider = process.platform === "darwin" && modelPrecision === "fp16" ? "coreml" : "cpu";
    try {
      workerResult = await runDepthUtilityProcess(workerPath, workerInput, preferredProvider, (progress) => {
        onProgress?.({ ...progress, requestId: request.requestId });
      });
    } catch (error) {
      if (preferredProvider !== "coreml") throw error;
      await rm(tempOutput, { force: true });
      onProgress?.({ requestId: request.requestId, phase: "cpu-fallback", frameIndex: 0, totalFrames, progress: 0 });
      workerResult = await runDepthUtilityProcess(workerPath, workerInput, "cpu", (progress) => {
        onProgress?.({ ...progress, requestId: request.requestId });
      });
    }
    const saved = await saveAttachments(request.projectPath, [{ name: `depth-${path.basename(request.inputPath)}`, mime: "video/mp4", source: "generated", path: tempOutput }]);
    onProgress?.({ requestId: request.requestId, phase: "conversion", frameIndex: workerResult.frameCount, totalFrames, progress: 100 });
    return { attachment: saved[0], sourceFps: info.fps, outputFps, analysisFps, backend: workerResult.backend };
  } finally {
    await rm(tempOutput, { force: true }).catch(() => undefined);
  }
}
