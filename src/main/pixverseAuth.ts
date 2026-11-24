import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PixverseAccountSwitchError, PixverseAccountSwitchResult, PixverseAuthStatus } from "../shared/types";

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 15_000;
const LOGOUT_TIMEOUT_MS = 20_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

export function findPixverseCli(): string | null {
  const home = homedir();
  const executableNames = process.platform === "win32" ? ["pixverse.exe", "pixverse"] : ["pixverse"];
  const directories = [
    ...((process.env.PATH ?? "").split(path.delimiter).filter(Boolean)),
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin"
  ];

  for (const directory of [...new Set(directories)]) {
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (!existsSync(candidate)) continue;
      try {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Ignore non-executable matches and keep searching PATH candidates.
      }
    }
  }

  return null;
}

function parseJsonOutput(stdout: string): Record<string, unknown> {
  const firstBrace = stdout.indexOf("{");
  const lastBrace = stdout.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("invalid-status-output");
  const parsed: unknown = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid-status-output");
  return parsed as Record<string, unknown>;
}

async function readStatus(cliPath: string): Promise<PixverseAuthStatus> {
  const { stdout } = await execFileAsync(cliPath, ["auth", "status", "--json"], {
    timeout: STATUS_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const result = parseJsonOutput(stdout);
  if (typeof result.authenticated !== "boolean") throw new Error("invalid-status-output");

  const nickname = typeof result.nickname === "string" ? result.nickname.trim().slice(0, 48) : "";
  return {
    availability: "available",
    authenticated: result.authenticated,
    ...(result.authenticated && nickname ? { accountLabel: nickname } : {})
  };
}

export async function getPixverseAuthStatus(): Promise<PixverseAuthStatus> {
  const cliPath = findPixverseCli();
  if (!cliPath) return { availability: "missing", authenticated: false };

  try {
    return await readStatus(cliPath);
  } catch {
    return { availability: "error", authenticated: false };
  }
}

async function switchFailure(error: PixverseAccountSwitchError, cliPath?: string): Promise<PixverseAccountSwitchResult> {
  const status = cliPath ? await readStatus(cliPath).catch(() => ({ availability: "error" as const, authenticated: false })) : { availability: "missing" as const, authenticated: false };
  return { ok: false, status, error };
}

export async function switchPixverseAccount(): Promise<PixverseAccountSwitchResult> {
  const cliPath = findPixverseCli();
  if (!cliPath) return switchFailure("cli-not-found");

  const currentStatus = await readStatus(cliPath).catch(() => null);
  if (!currentStatus) return switchFailure("status-failed", cliPath);

  if (currentStatus.authenticated) {
    try {
      await execFileAsync(cliPath, ["auth", "logout", "--json"], {
        timeout: LOGOUT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      });
    } catch {
      return switchFailure("logout-failed", cliPath);
    }
  }

  try {
    // The CLI opens its OAuth authorization flow in the user's default browser.
    // Keep output private because login diagnostics may contain authorization data.
    await execFileAsync(cliPath, ["auth", "login"], {
      timeout: LOGIN_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
  } catch {
    return switchFailure("login-failed", cliPath);
  }

  const status = await readStatus(cliPath).catch(() => null);
  if (!status) return switchFailure("status-failed", cliPath);
  if (!status.authenticated) return { ok: false, status, error: "login-incomplete" };
  return { ok: true, status };
}
