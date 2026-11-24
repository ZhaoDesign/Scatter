import { spawn, type ChildProcess } from "node:child_process";
import * as ort from "onnxruntime-node";

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

interface DepthWorkerProgress {
  type: "progress";
  frameIndex: number;
  totalFrames: number;
  progress: number;
}

type DepthWorkerMessage =
  | DepthWorkerProgress
  | { type: "done"; backend: "coreml" | "cpu"; frameCount: number };

interface DepthWorkerStartMessage {
  type: "start";
  input: DepthWorkerInput;
  provider: "coreml" | "cpu";
}

function normalizeDepth(source: Float32Array | Uint8Array | Uint8ClampedArray | number[], width: number, height: number, invert: boolean): Uint8Array {
  const count = width * height;
  const sampleStride = Math.max(1, Math.floor(count / 4096));
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < count; index += sampleStride) {
    const value = source[index];
    const number = Number(value);
    if (Number.isFinite(number)) {
      min = Math.min(min, number);
      max = Math.max(max, number);
    }
  }
  const range = max > min ? max - min : 1;
  const isByteData = source instanceof Uint8Array || source instanceof Uint8ClampedArray;
  const output = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const raw = Number(source[index]);
    const normalized = isByteData ? raw : ((raw - min) / range) * 255;
    const gray = Math.max(0, Math.min(255, normalized));
    output[index] = Math.round(invert ? 255 - gray : gray);
  }
  return output;
}

function resizeGrayBilinear(source: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) * sourceHeight / height - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) * sourceWidth / width - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const top = source[y0 * sourceWidth + x0] * (1 - xWeight) + source[y0 * sourceWidth + x1] * xWeight;
      const bottom = source[y1 * sourceWidth + x0] * (1 - xWeight) + source[y1 * sourceWidth + x1] * xWeight;
      output[y * width + x] = Math.max(0, Math.min(255, Math.round(top * (1 - yWeight) + bottom * yWeight)));
    }
  }
  return output;
}

function frameToTensor(frame: Buffer, width: number, height: number): ort.Tensor {
  const data = new Float32Array(1 * 3 * width * height);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const tensorOffset = y * width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const normalized = (frame[offset + channel] / 255 - mean[channel]) / std[channel];
        data[channel * width * height + tensorOffset] = normalized;
      }
    }
  }
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function tensorToDepth(tensor: ort.Tensor): { data: Float32Array | number[]; width: number; height: number } {
  const dims = tensor.dims.map(Number);
  const width = dims[dims.length - 1] || 518;
  const height = dims[dims.length - 2] || 518;
  return { data: tensor.data as Float32Array, width, height };
}

function waitForDrain(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve) => stream.once("drain", resolve));
}

function closeProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${child.exitCode}`));
      return;
    }
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`));
    });
  });
}

async function run(input: DepthWorkerInput, provider: "coreml" | "cpu"): Promise<{ backend: "coreml" | "cpu"; frameCount: number }> {
  const analysisWidth = input.modelInputWidth;
  const analysisHeight = input.modelInputHeight;
  let session: ort.InferenceSession;
  let backend: "coreml" | "cpu" = "cpu";
  if (provider === "coreml") {
    try {
      session = await ort.InferenceSession.create(input.modelPath, { executionProviders: ["coreml", "cpu"] });
      backend = "coreml";
    } catch {
      session = await ort.InferenceSession.create(input.modelPath, { executionProviders: ["cpu"] });
    }
  } else {
    session = await ort.InferenceSession.create(input.modelPath, { executionProviders: ["cpu"] });
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const videoFilters: string[] = [];
  if (input.sourceFps > input.analysisFps + 0.01) videoFilters.push(`fps=${input.analysisFps}`);
  videoFilters.push(`scale=${analysisWidth}:${analysisHeight}:flags=lanczos`);
  const decoder = spawn("ffmpeg", [
    "-v", "error", "-i", input.inputPath,
    "-vf", videoFilters.join(","), "-vsync", "0",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${analysisWidth}x${analysisHeight}`, "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const encoderArgs = [
    "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${input.outputWidth}x${input.outputHeight}`,
    "-r", String(input.outputFps), "-i", "pipe:0"
  ];
  if (input.preserveAudio) encoderArgs.push("-i", input.inputPath, "-map", "0:v:0", "-map", "1:a:0?");
  encoderArgs.push(
    "-c:v", "libx264", "-preset", "veryfast",
    "-pix_fmt", "yuv420p", "-r", String(input.outputFps)
  );
  if (input.preserveAudio) encoderArgs.push("-c:a", "aac", "-b:a", "192k");
  else encoderArgs.push("-an", "-sn", "-dn");
  encoderArgs.push("-shortest", "-movflags", "+faststart");
  encoderArgs.push(input.tempOutput);
  const encoder = spawn("ffmpeg", encoderArgs, { stdio: ["pipe", "ignore", "pipe"] });
  let decoderError = "";
  decoder.stderr.on("data", (chunk) => { decoderError += String(chunk); });
  let encoderError = "";
  encoder.stderr.on("data", (chunk) => { encoderError += String(chunk); });
  let frameIndex = 0;
  let pending = Buffer.alloc(0);
  const frameBytes = analysisWidth * analysisHeight * 3;

  try {
    for await (const chunk of decoder.stdout) {
      pending = Buffer.concat([pending, chunk as Buffer]);
      while (pending.length >= frameBytes) {
        const frame = pending.subarray(0, frameBytes);
        pending = pending.subarray(frameBytes);
        const result = await session.run({ [inputName]: frameToTensor(frame, analysisWidth, analysisHeight) });
        const depth = tensorToDepth(result[outputName]);
        const grayscale = normalizeDepth(depth.data, depth.width, depth.height, input.invert);
        const outputFrame = resizeGrayBilinear(grayscale, depth.width, depth.height, input.outputWidth, input.outputHeight);
        const encodedFrame = Buffer.from(outputFrame);
        for (let duplicate = 0; duplicate < Math.max(1, input.duplicateFrames); duplicate += 1) {
          if (!encoder.stdin.write(encodedFrame)) await waitForDrain(encoder.stdin);
        }
        frameIndex += 1;
        if (frameIndex === 1 || frameIndex % 2 === 0) {
          const progress = input.totalFrames > 0 ? Math.min(99, Math.round((frameIndex / input.totalFrames) * 100)) : 0;
          parentPort?.postMessage({ type: "progress", frameIndex, totalFrames: input.totalFrames, progress } satisfies DepthWorkerProgress);
        }
      }
    }
    if (decoderError && !decoderError.includes("frame=")) throw new Error(decoderError.trim());
    encoder.stdin.end();
    await Promise.all([closeProcess(decoder), closeProcess(encoder)]).catch((error) => {
      throw new Error(`${error instanceof Error ? error.message : "转换失败"}${encoderError ? `：${encoderError.trim()}` : ""}`);
    });
    if (frameIndex === 0) throw new Error("没有解码出任何视频帧。");
    return { backend, frameCount: frameIndex };
  } finally {
    decoder.kill();
    encoder.kill();
  }
}

const parentPort = process.parentPort;
parentPort.once("message", (event) => {
  const message = event.data as DepthWorkerStartMessage;
  void run(message.input, message.provider)
    .then(({ backend, frameCount }) => {
      parentPort.postMessage({ type: "done", backend, frameCount } satisfies DepthWorkerMessage);
      setTimeout(() => process.exit(0), 50);
    })
    .catch((error: unknown) => {
      parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : "深度转换失败" });
      setTimeout(() => process.exit(1), 50);
    });
});
