import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AttachmentInput,
  PixverseCapabilityValue,
  PixverseCreateCapabilities,
  PixverseCreateMode,
  PixverseGenerationError,
  PixverseGenerationParameter,
  PixverseGenerationRequest,
  PixverseGenerationResult,
  PixverseModelCapability,
  PixverseParameterCapability
} from "../shared/types";
import { assertProjectExecutionAllowed, saveAttachments } from "./projectStore";
import { findPixverseCli, getPixverseAuthStatus } from "./pixverseAuth";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 11 * 60 * 1000;
const CAPABILITIES_TIMEOUT_MS = 20_000;
const GENERATION_TIMEOUT_SECONDS = 600;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function parseJsonOutput(stdout: string): JsonRecord {
  const firstBrace = stdout.indexOf("{");
  const lastBrace = stdout.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("invalid-json-output");
  const parsed = asRecord(JSON.parse(stdout.slice(firstBrace, lastBrace + 1)));
  if (!parsed) throw new Error("invalid-json-output");
  return parsed;
}

function capabilityValue(value: unknown): PixverseCapabilityValue | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function normalizeParameterCapability(value: unknown): PixverseParameterCapability {
  const input = asRecord(value) || {};
  const enumValues = Array.isArray(input.enum)
    ? input.enum.map(capabilityValue).filter((item): item is PixverseCapabilityValue => item !== undefined)
    : undefined;
  const type = ["boolean", "integer", "string", "text", "media", "media_list"].includes(String(input.type))
    ? input.type as PixverseParameterCapability["type"]
    : undefined;
  return {
    ...(typeof input.supported === "boolean" ? { supported: input.supported } : {}),
    ...(typeof input.flag === "string" ? { flag: input.flag } : {}),
    ...(type ? { type } : {}),
    ...(typeof input.required === "boolean" ? { required: input.required } : {}),
    ...(enumValues ? { enum: enumValues } : {}),
    ...(capabilityValue(input.default) !== undefined ? { default: capabilityValue(input.default) } : {}),
    ...(typeof input.min === "number" ? { min: input.min } : {}),
    ...(typeof input.max === "number" ? { max: input.max } : {}),
    ...(typeof input.max_count === "number" ? { max_count: input.max_count } : {}),
    ...(typeof input.unit === "string" ? { unit: input.unit } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {})
  };
}

function normalizeParameterMap(value: unknown): Record<string, PixverseParameterCapability> {
  const input = asRecord(value) || {};
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, normalizeParameterCapability(item)]));
}

function normalizeCapabilities(mode: PixverseCreateMode, value: unknown): PixverseCreateCapabilities {
  const envelope = asRecord(value);
  const raw = asRecord(envelope?.capability) || envelope;
  if (!raw || typeof raw.default_model !== "string") throw new Error("invalid-capabilities");

  const modelsRaw = Array.isArray(raw.models)
    ? raw.models
    : Object.values(asRecord(raw.models) || {});
  const models: PixverseModelCapability[] = modelsRaw.flatMap((item) => {
    const model = asRecord(item);
    if (!model || typeof model.id !== "string") return [];
    return [{
      id: model.id,
      displayName: typeof model.display_name === "string" ? model.display_name : model.id,
      ...(typeof model.default === "boolean" ? { default: model.default } : {}),
      parameters: normalizeParameterMap(model.parameters)
    }];
  });
  if (!models.length) throw new Error("empty-model-list");

  return {
    mode,
    defaultModel: raw.default_model,
    parameters: normalizeParameterMap(raw.parameters),
    models
  };
}

export async function getPixverseCreateCapabilities(mode: PixverseCreateMode): Promise<PixverseCreateCapabilities | null> {
  const cliPath = findPixverseCli();
  if (!cliPath) return null;
  const { stdout } = await execFileAsync(cliPath, ["capabilities", "create", mode, "--json"], {
    timeout: CAPABILITIES_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true
  });
  return normalizeCapabilities(mode, parseJsonOutput(stdout));
}

function effectiveParameters(capabilities: PixverseCreateCapabilities, modelId: string): Record<string, PixverseParameterCapability> {
  const model = capabilities.models.find((item) => item.id === modelId);
  const globalParameters = capabilities.parameters;
  const modelParameters = model?.parameters || {};
  return Object.fromEntries(
    Object.entries({ ...globalParameters, ...modelParameters }).map(([name, parameter]) => [
      name,
      { ...(globalParameters[name] || {}), ...parameter }
    ])
  );
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function validateAssetPaths(projectPath: string, paths: string[]): Promise<string[]> {
  const assetRoot = await realpath(path.join(projectPath, ".scatter", "assets"));
  const resolved: string[] = [];
  for (const inputPath of paths) {
    if (typeof inputPath !== "string" || !inputPath.trim()) throw new Error("invalid-request");
    const absolutePath = await realpath(inputPath);
    if (!isInside(assetRoot, absolutePath)) throw new Error("invalid-request");
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) throw new Error("invalid-request");
    resolved.push(absolutePath);
  }
  return resolved;
}

function mergeParameters(request: PixverseGenerationRequest, capabilities: PixverseCreateCapabilities): Record<string, PixverseParameterCapability> {
  const merged = effectiveParameters(capabilities, request.model);
  for (const [name, value] of Object.entries(request.parameters || {})) {
    const spec = merged[name];
    if (!spec || spec.supported === false) continue;
    if (spec.enum && !spec.enum.some((item) => String(item) === String(value))) throw new Error("invalid-request");
    if (typeof value === "number" && ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max))) throw new Error("invalid-request");
  }
  return merged;
}

function appendParameter(args: string[], flagSpec: string, type: PixverseParameterCapability["type"], value: PixverseGenerationParameter): void {
  const flags = flagSpec.split("/").map((flag) => flag.trim()).filter(Boolean);
  if (type === "boolean" || typeof value === "boolean") {
    if (typeof value !== "boolean") throw new Error("invalid-request");
    if (flags.length > 1) {
      const selected = value ? flags[0] : flags[1];
      args.push(...selected.split(/\s+/));
    } else if (value) {
      args.push(...flags[0].split(/\s+/));
    }
    return;
  }
  const flag = flags[0];
  if (!flag) return;
  args.push(...flag.split(/\s+/), String(value));
}

function buildCreateArgs(
  request: PixverseGenerationRequest,
  capabilities: PixverseCreateCapabilities,
  imagePaths: string[],
  videoPaths: string[]
): string[] {
  const merged = mergeParameters(request, capabilities);
  const model = capabilities.models.find((item) => item.id === request.model);
  if (!model) throw new Error("invalid-request");

  const args = ["create", request.mode, "--prompt", request.prompt, "--model", request.model];
  if (request.mode === "image") {
    const imageSpec = merged.images;
    if (imagePaths.length && imageSpec?.supported === false) throw new Error("invalid-request");
    if (imageSpec?.max_count !== undefined && imagePaths.length > imageSpec.max_count) throw new Error("invalid-request");
    if (imagePaths.length) args.push("--images", ...imagePaths);
    if (videoPaths.length) throw new Error("invalid-request");
  } else if (request.mode === "video") {
    if (videoPaths.length || imagePaths.length > 1) throw new Error("invalid-request");
    if (imagePaths.length) {
      if (merged.image?.supported === false) throw new Error("invalid-request");
      args.push("--image", imagePaths[0]);
    }
  } else {
    if (!imagePaths.length && !videoPaths.length) throw new Error("reference-required");
    if (imagePaths.length && merged.images?.supported === false) throw new Error("invalid-request");
    if (videoPaths.length && merged.videos?.supported === false) throw new Error("invalid-request");
    if (merged.images?.max_count !== undefined && imagePaths.length > merged.images.max_count) throw new Error("invalid-request");
    if (merged.videos?.max_count !== undefined && videoPaths.length > merged.videos.max_count) throw new Error("invalid-request");
    if (imagePaths.length) args.push("--images", ...imagePaths);
    if (videoPaths.length) args.push("--videos", ...videoPaths);
  }

  const reserved = new Set(["prompt", "model", "image", "images", "videos", "audios", "wait", "timeout", "json", "idempotency_key"]);
  for (const [name, value] of Object.entries(request.parameters || {})) {
    if (reserved.has(name)) continue;
    const spec = merged[name];
    if (!spec || spec.supported === false || !spec.flag) continue;
    appendParameter(args, spec.flag, spec.type, value);
  }
  args.push("--idempotency-key", randomUUID(), "--no-wait", "--timeout", String(GENERATION_TIMEOUT_SECONDS), "--json");
  return args;
}

function collectAssetIds(value: unknown, mode: "image" | "video"): string[] {
  const preferred = new Set([`${mode}_id`, `${mode}_ids`, "task_id"]);
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (item: unknown, parentKey = ""): void => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      if (preferred.has(parentKey)) {
        for (const entry of item) if (typeof entry === "string" || typeof entry === "number") found.push(String(entry));
      }
      for (const entry of item) visit(entry, parentKey);
      return;
    }
    for (const [key, nested] of Object.entries(item as JsonRecord)) {
      if (preferred.has(key)) {
        if (typeof nested === "string" || typeof nested === "number") found.push(String(nested));
        else if (Array.isArray(nested)) for (const entry of nested) if (typeof entry === "string" || typeof entry === "number") found.push(String(entry));
      }
      visit(nested, key);
    }
  };
  visit(value);
  return [...new Set(found.filter(Boolean))];
}

async function collectFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const itemPath = path.join(current, item.name);
      if (item.isDirectory()) await visit(itemPath);
      else if (item.isFile()) files.push(itemPath);
    }
  };
  await visit(directory);
  return files;
}

function mimeForFile(filePath: string, kind: "image" | "video"): string {
  const ext = path.extname(filePath).toLowerCase();
  if (kind === "image") {
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".avif") return "image/avif";
    return "image/png";
  }
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "video/mp4";
}

function mapGenerationError(error: unknown): PixverseGenerationError {
  if (error instanceof Error && error.message === "invalid-request") return "invalid-request";
  if (error instanceof Error && error.message === "reference-required") return "reference-required";
  if (error instanceof Error && error.message === "download-failed") return "download-failed";
  const record = asRecord(error);
  const code = typeof record?.code === "string" ? record.code : "";
  const stderr = typeof record?.stderr === "string" ? record.stderr : "";
  const message = `${error instanceof Error ? error.message : String(error)} ${stderr}`;
  if (code === "ETIMEDOUT" || /timed? ?out|timeout/i.test(message)) return "timeout";
  if (/insufficient.{0,20}credits|not enough credits|credits?.{0,20}insufficient/i.test(message)) return "insufficient-credits";
  if (/not authenticated|unauthorized|please log in|login required/i.test(message)) return "not-authenticated";
  return "generation-failed";
}

export async function runPixverseGeneration(request: PixverseGenerationRequest): Promise<PixverseGenerationResult> {
  const cliPath = findPixverseCli();
  if (!cliPath) return { ok: false, attachments: [], error: "cli-not-found" };
  const auth = await getPixverseAuthStatus();
  if (!auth.authenticated) return { ok: false, attachments: [], error: "not-authenticated" };

  let temporaryDirectory = "";
  try {
    await assertProjectExecutionAllowed(request.projectPath);
    if (!request.prompt.trim()) return { ok: false, attachments: [], error: "prompt-required" };
    const capabilities = await getPixverseCreateCapabilities(request.mode);
    if (!capabilities) return { ok: false, attachments: [], error: "cli-not-found" };
    if (!capabilities.models.some((model) => model.id === request.model)) return { ok: false, attachments: [], error: "invalid-request" };

    const imagePaths = await validateAssetPaths(request.projectPath, request.imagePaths || []);
    const videoPaths = await validateAssetPaths(request.projectPath, request.videoPaths || []);
    const createArgs = buildCreateArgs(request, capabilities, imagePaths, videoPaths);
    const { stdout } = await execFileAsync(cliPath, createArgs, { timeout: CLI_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024, windowsHide: true });
    const createOutput = parseJsonOutput(stdout);
    const outputKind = request.mode === "image" ? "image" : "video";
    const ids = collectAssetIds(createOutput, outputKind);
    if (!ids.length) throw new Error("generation-response-missing-id");

    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "scatter-pixverse-"));
    const attachmentInputs: AttachmentInput[] = [];
    for (const [index, id] of ids.entries()) {
      await execFileAsync(cliPath, ["task", "wait", id, "--type", outputKind, "--timeout", String(GENERATION_TIMEOUT_SECONDS), "--json"], {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true
      });
      const destination = path.join(temporaryDirectory, `result-${index + 1}`);
      await mkdir(destination, { recursive: true });
      try {
        await execFileAsync(cliPath, ["asset", "download", id, "--type", outputKind, "--dest", destination, "--json"], {
          timeout: CLI_TIMEOUT_MS,
          maxBuffer: 5 * 1024 * 1024,
          windowsHide: true
        });
      } catch {
        throw new Error("download-failed");
      }
      const downloadedFiles = (await collectFiles(destination)).filter((item) => outputKind === "image"
        ? /\.(png|jpe?g|webp|avif)$/i.test(item)
        : /\.(mp4|mov|webm|m4v)$/i.test(item));
      const outputFile = downloadedFiles[0];
      if (!outputFile) throw new Error("download-failed");
      attachmentInputs.push({
        name: path.basename(outputFile),
        mime: mimeForFile(outputFile, outputKind),
        source: "generated",
        path: outputFile
      });
    }

    const attachments = await saveAttachments(request.projectPath, attachmentInputs);
    return { ok: true, attachments };
  } catch (error) {
    if (error instanceof Error && error.message === "download-failed") return { ok: false, attachments: [], error: "download-failed" };
    if (error instanceof Error && error.message === "prompt-required") return { ok: false, attachments: [], error: "prompt-required" };
    return { ok: false, attachments: [], error: mapGenerationError(error) };
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
