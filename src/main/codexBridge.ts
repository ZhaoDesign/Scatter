import { app } from "electron";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CodexRunInput, CodexRunResult } from "../shared/types";
import { tMain } from "./i18n";
import { getSettings } from "./settingsStore";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface TurnCompletionWaiter {
  resolve: (notification: any) => void;
  reject: (error: Error) => void;
}

const CODEX_APP_BUNDLE_ID = "com.openai.codex";
const CODEX_CLI_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/Codex.app/Contents/Resources/codex"
];

async function codexExecutable(): Promise<string> {
  for (const candidate of CODEX_CLI_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to another known installation path.
    }
  }
  return "codex";
}

function defaultControlSocket(): string {
  return path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "app-server-control", "app-server-control.sock");
}

async function canUseDesktopProxy(): Promise<boolean> {
  try {
    await access(defaultControlSocket());
    return true;
  } catch {
    return false;
  }
}

async function spawnCodex(args: string[], waitMs = 1000): Promise<void> {
  const command = await codexExecutable();
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  await delay(waitMs);
}

async function focusCodex(): Promise<void> {
  const child = spawn("open", ["-b", CODEX_APP_BUNDLE_ID], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  await delay(250);
}

class CodexProxy {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly child;
  private closed = false;
  private initialized = false;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly completedTurns = new Map<string, any>();
  private readonly turnWaiters = new Map<string, Set<TurnCompletionWaiter>>();

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.readStdoutLines();
    });

    this.child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
      if (this.stderrBuffer.length > 20000) {
        this.stderrBuffer = this.stderrBuffer.slice(-20000);
      }
    });

    this.child.on("error", (error) => {
      this.closed = true;
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    });

    this.child.on("exit", () => {
      this.closed = true;
      this.failPending(new Error(this.stderrBuffer.trim() || "Codex app-server exited."));
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  markInitialized(): void {
    this.initialized = true;
  }

  async request<T>(method: string, params: unknown, timeoutMs = 30000): Promise<T> {
    if (this.closed) {
      throw new Error(this.stderrBuffer.trim() || "Codex app-server is not running.");
    }
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex response to ${method}.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timer
      });
    });

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  dispose(): void {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
    }
    this.pending.clear();
    this.failTurnWaiters(new Error("Codex app-server connection closed before the turn completed."));
    this.child.kill();
  }

  waitForTurn(threadId: string, turnId: string): Promise<any> {
    const key = `${threadId}:${turnId}`;
    const completed = this.completedTurns.get(key);
    if (completed) return Promise.resolve(completed);
    if (this.closed) {
      return Promise.reject(new Error(this.stderrBuffer.trim() || "Codex app-server is not running."));
    }

    return new Promise((resolve, reject) => {
      const waiters = this.turnWaiters.get(key) || new Set<TurnCompletionWaiter>();
      waiters.add({ resolve, reject });
      this.turnWaiters.set(key, waiters);
    });
  }

  private readStdoutLines(): void {
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id !== "number") {
      if (message.method === "turn/completed" && message.params) {
        this.finishTurn(message.params);
      }
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message || JSON.stringify(message.error)));
      return;
    }

    request.resolve(message.result);
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.failTurnWaiters(error);
  }

  private finishTurn(notification: any): void {
    const threadId = notification.threadId;
    const turnId = notification.turn?.id;
    if (typeof threadId !== "string" || typeof turnId !== "string") return;

    const key = `${threadId}:${turnId}`;
    this.completedTurns.set(key, notification);
    if (this.completedTurns.size > 100) {
      const oldestKey = this.completedTurns.keys().next().value;
      if (oldestKey) this.completedTurns.delete(oldestKey);
    }
    const waiters = this.turnWaiters.get(key);
    if (!waiters) return;
    this.turnWaiters.delete(key);
    for (const waiter of waiters) waiter.resolve(notification);
  }

  private failTurnWaiters(error: Error): void {
    for (const waiters of this.turnWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    this.turnWaiters.clear();
  }
}

async function initializeProxy(proxy: CodexProxy): Promise<void> {
  if (proxy.isInitialized()) return;
  await proxy.request("initialize", {
    clientInfo: {
      name: "Scatter",
      title: "Scatter",
      version: app.getVersion()
    },
    capabilities: {
      experimentalApi: true,
      optOutNotificationMethods: []
    }
  });
  proxy.markInitialized();
}

async function waitForDesktopProxy(timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canUseDesktopProxy()) return true;
    await delay(250);
  }
  return canUseDesktopProxy();
}

async function connectCodexAppServer(command: string): Promise<CodexProxy> {
  if (await waitForDesktopProxy()) {
    const desktopProxy = new CodexProxy(command, ["app-server", "proxy"]);
    try {
      await initializeProxy(desktopProxy);
      return desktopProxy;
    } catch (error) {
      console.warn("Codex Desktop proxy was unavailable; falling back to the local app server.", error);
      desktopProxy.dispose();
    }
  }

  const localProxy = new CodexProxy(command, ["app-server", "--listen", "stdio://"]);
  try {
    await initializeProxy(localProxy);
    return localProxy;
  } catch (error) {
    localProxy.dispose();
    throw error;
  }
}

async function withCodexAppServer<T>(run: (proxy: CodexProxy) => Promise<T>): Promise<T> {
  const command = await codexExecutable();
  const proxy = await connectCodexAppServer(command);
  try {
    return await run(proxy);
  } catch (error) {
    const settings = await getSettings();
    throw new Error(tMain(settings.language, "codexSubmitError", {
      detail: error instanceof Error ? error.message : String(error)
    }));
  } finally {
    proxy.dispose();
  }
}

async function runViaCodexAppServer(input: CodexRunInput): Promise<CodexRunResult> {
  const result = await withCodexAppServer(async (proxy) => {
    const thread = await proxy.request<{ thread: { id: string }; model: string }>("thread/start", {
      cwd: input.projectPath
    }, 30000);
    if (!thread.thread?.id) throw new Error("Codex Desktop did not return a thread ID.");

    if (input.threadName.trim()) {
      await proxy.request("thread/name/set", {
        threadId: thread.thread.id,
        name: input.threadName
      }, 5000).catch((error) => {
        console.warn("Unable to name the new Codex thread.", error);
      });
    }

    const turnInput = [
      ...input.imagePaths.map((imagePath) => ({ type: "localImage" as const, path: imagePath })),
      { type: "text" as const, text: input.markdown, text_elements: [] }
    ];
    const turn = await proxy.request<{ turn: { id: string; status?: string; error?: { message?: string } | null } }>("turn/start", {
      threadId: thread.thread.id,
      input: turnInput,
      cwd: input.projectPath,
      effort: input.effort,
      ...(input.planMode ? {
        collaborationMode: {
          mode: "plan",
          settings: {
            model: thread.model,
            reasoning_effort: input.effort,
            developer_instructions: null
          }
        }
      } : {})
    }, 30000);
    if (!turn.turn?.id) throw new Error("Codex Desktop did not confirm that the turn started.");

    await focusCodex();
    const completion = turn.turn.status && turn.turn.status !== "inProgress"
      ? { threadId: thread.thread.id, turn: turn.turn }
      : await proxy.waitForTurn(thread.thread.id, turn.turn.id);
    const status = completion.turn?.status;
    if (status !== "completed") {
      const detail = completion.turn?.error?.message;
      throw new Error(detail || `Codex turn ended with status: ${status || "unknown"}.`);
    }

    return { threadId: thread.thread.id, turnId: turn.turn.id };
  });

  return { ...result, cwd: input.projectPath };
}

export async function runInCodex(input: CodexRunInput): Promise<CodexRunResult> {
  await spawnCodex(["app", input.projectPath], 1400);
  return runViaCodexAppServer(input);
}
