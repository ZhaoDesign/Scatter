import { app, safeStorage } from "electron";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultAppSettings,
  type AppSettings,
  type AssistantProvider,
  type GeminiApiKeyResult,
  type GeminiApiKeyStatus,
  type LanguagePreference,
  type ThemePreference
} from "../shared/types";

const settingsFileName = "settings.json";

function settingsPath(): string {
  return path.join(app.getPath("userData"), settingsFileName);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "zh" || value === "en";
}

function isAssistantProvider(value: unknown): value is AssistantProvider {
  return value === "codex" || value === "claude-cli";
}

function normalizeAssistantProvider(value: unknown): AssistantProvider {
  if (value === "claude-code") return "claude-cli";
  return isAssistantProvider(value) ? value : defaultAppSettings.assistantProvider;
}

function normalizeSettings(input: unknown, onboardingCompletedDefault: boolean): AppSettings {
  if (!input || typeof input !== "object") return defaultAppSettings;
  const candidate = input as Partial<AppSettings>;

  return {
    themePreference: isThemePreference(candidate.themePreference) ? candidate.themePreference : defaultAppSettings.themePreference,
    language: isLanguagePreference(candidate.language) ? candidate.language : defaultAppSettings.language,
    translucentBackground:
      typeof candidate.translucentBackground === "boolean"
        ? candidate.translucentBackground
        : defaultAppSettings.translucentBackground,
    assistantProvider: normalizeAssistantProvider(candidate.assistantProvider),
    assistantProviderOnboardingCompleted:
      typeof candidate.assistantProviderOnboardingCompleted === "boolean"
        ? candidate.assistantProviderOnboardingCompleted
        : onboardingCompletedDefault,
    pixverseImageDefaultModel:
      typeof candidate.pixverseImageDefaultModel === "string" && candidate.pixverseImageDefaultModel.trim()
        ? candidate.pixverseImageDefaultModel.trim()
        : defaultAppSettings.pixverseImageDefaultModel
  };
}

export async function getSettings(): Promise<AppSettings> {
  const filePath = settingsPath();
  if (!existsSync(filePath)) return defaultAppSettings;

  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeSettings(JSON.parse(raw), true);
  } catch {
    return defaultAppSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const next = normalizeSettings(settings, true);
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * The Gemini API key is deliberately kept out of `settings.json`: that file is
 * written as plain JSON and is read back into the renderer on every launch. The
 * key lives in its own file, encrypted with `safeStorage`, and only the main
 * process can ever decrypt it. No function here logs the key, its plaintext or
 * the encrypted buffer.
 */
const geminiKeyFileName = "gemini-api.key";
const geminiKeyTempFileName = "gemini-api.key.tmp";
const minGeminiKeyLength = 8;
const maxGeminiKeyLength = 512;

function geminiKeyPath(): string {
  return path.join(app.getPath("userData"), geminiKeyFileName);
}

/**
 * `safeStorage.isEncryptionAvailable()` can throw on Linux when no keyring is
 * present, so every call is guarded. A false result means we refuse to store the
 * key rather than falling back to a plaintext file.
 */
export function geminiEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Thrown when the stored key cannot be decrypted (keystore rotated or file corrupt). */
export class GeminiKeyUnavailableError extends Error {
  constructor() {
    super("Gemini API key storage is unavailable.");
    this.name = "GeminiKeyUnavailableError";
  }
}

/** Presence metadata only. Never decrypts and never returns key material. */
export async function getGeminiApiKeyStatus(): Promise<GeminiApiKeyStatus> {
  const encryptionAvailable = geminiEncryptionAvailable();
  const filePath = geminiKeyPath();
  if (!existsSync(filePath)) {
    return { configured: false, encryptionAvailable };
  }

  try {
    const info = await stat(filePath);
    return {
      configured: true,
      encryptionAvailable,
      updatedAt: info.mtime.toISOString()
    };
  } catch {
    return { configured: false, encryptionAvailable };
  }
}

function invalidKeyStatus(): GeminiApiKeyStatus {
  return { configured: false, encryptionAvailable: geminiEncryptionAvailable() };
}

export async function setGeminiApiKey(rawKey: string): Promise<GeminiApiKeyResult> {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (
    !key ||
    key.length < minGeminiKeyLength ||
    key.length > maxGeminiKeyLength ||
    /[\s\u0000-\u001f]/.test(key)
  ) {
    return { ok: false, status: invalidKeyStatus(), error: "invalid-key" };
  }

  if (!geminiEncryptionAvailable()) {
    return { ok: false, status: invalidKeyStatus(), error: "encryption-unavailable" };
  }

  const userDataPath = app.getPath("userData");
  const filePath = geminiKeyPath();
  const tempPath = path.join(userDataPath, geminiKeyTempFileName);

  try {
    await mkdir(userDataPath, { recursive: true });
    const encrypted = safeStorage.encryptString(key);
    // Write-then-rename keeps a crash or power loss from leaving a half-written
    // key file behind that would decrypt to garbage.
    await writeFile(tempPath, encrypted, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
    return { ok: true, status: await getGeminiApiKeyStatus() };
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    return {
      ok: false,
      status: { configured: existsSync(filePath), encryptionAvailable: true },
      error: "storage-failed"
    };
  }
}

export async function clearGeminiApiKey(): Promise<GeminiApiKeyResult> {
  try {
    await rm(geminiKeyPath(), { force: true });
    await rm(path.join(app.getPath("userData"), geminiKeyTempFileName), { force: true }).catch(
      () => undefined
    );
    return { ok: true, status: await getGeminiApiKeyStatus() };
  } catch {
    return {
      ok: false,
      status: { configured: true, encryptionAvailable: geminiEncryptionAvailable() },
      error: "removal-failed"
    };
  }
}

/**
 * Main-process only. Returns null when nothing is configured, and throws
 * `GeminiKeyUnavailableError` when a stored key exists but cannot be decrypted.
 * The decrypted value is handed to the caller and never cached or logged here.
 */
export async function readGeminiApiKey(): Promise<string | null> {
  const filePath = geminiKeyPath();
  if (!existsSync(filePath)) return null;
  if (!geminiEncryptionAvailable()) throw new GeminiKeyUnavailableError();

  try {
    const encrypted = await readFile(filePath);
    return safeStorage.decryptString(encrypted);
  } catch {
    throw new GeminiKeyUnavailableError();
  }
}
