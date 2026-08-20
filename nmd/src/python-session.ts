import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as vscode from "vscode";
import type { NmdPythonOutput } from "./types";

export interface PythonRunResult extends NmdPythonOutput {
  ok: boolean;
}

export interface PythonCompletion {
  label: string;
  kind?: string;
  detail?: string;
}

export class PythonSession {
  private process: ChildProcessWithoutNullStreams | undefined;
  private buffer = "";
  private readonly pending = new Map<string, (result: Record<string, unknown>) => void>();
  private starting: Promise<void> | undefined;
  private writing = Promise.resolve();

  constructor(
    private readonly replScript: string,
    private readonly cwd: string,
  ) {}

  async run(code: string, token: vscode.CancellationToken): Promise<PythonRunResult> {
    const parsed = await this.request({ type: "run", code }, token, true);
    return {
      ok: parsed.ok === true,
      stdout: asOptionalString(parsed.stdout),
      stderr: asOptionalString(parsed.stderr),
      result: asOptionalString(parsed.result),
      error: asOptionalString(parsed.error),
      images: Array.isArray(parsed.images) ? parsed.images.filter((item): item is string => typeof item === "string") : undefined,
    };
  }

  async complete(code: string, line: number, column: number, token: vscode.CancellationToken): Promise<PythonCompletion[]> {
    const parsed = await this.request({ type: "complete", code, line, column }, token, false);
    const items = parsed.completions;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const value = item as Record<string, unknown>;
      if (typeof value.label !== "string" || value.label.length === 0) {
        return [];
      }
      return [
        {
          label: value.label,
          kind: asOptionalString(value.kind),
          detail: asOptionalString(value.detail),
        },
      ];
    });
  }

  dispose(): void {
    this.kill();
  }

  private async request(
    payload: Record<string, unknown>,
    token: vscode.CancellationToken,
    killOnCancel: boolean,
  ): Promise<Record<string, unknown>> {
    await this.ensureStarted();
    const child = this.process;
    if (!child) {
      throw new Error("Python kernel failed to start.");
    }

    const id = crypto.randomUUID();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const cancel = token.onCancellationRequested(() => {
        this.pending.delete(id);
        cancel.dispose();
        if (killOnCancel) {
          this.kill();
          reject(new Error("Python cell cancelled."));
          return;
        }
        resolve({});
      });
      this.pending.set(id, (value) => {
        cancel.dispose();
        resolve(value);
      });
      this.writeLine(`${JSON.stringify({ id, ...payload })}\n`).catch((error) => {
        this.pending.delete(id);
        cancel.dispose();
        reject(error);
      });
    });
  }

  private writeLine(line: string): Promise<void> {
    const child = this.process;
    if (!child) {
      return Promise.reject(new Error("Python kernel failed to start."));
    }
    this.writing = this.writing
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            child.stdin.write(line, (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      );
    return this.writing;
  }

  private kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.starting = undefined;
    this.buffer = "";
    this.writing = Promise.resolve();
    for (const resolve of this.pending.values()) {
      resolve({ ok: false, error: "Python kernel stopped." });
    }
    this.pending.clear();
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && !this.process.killed) {
      return;
    }
    if (!this.starting) {
      this.starting = this.start();
    }
    await this.starting;
  }

  private async start(): Promise<void> {
    const command = await resolvePythonCommand();
    const child = spawn(command.file, [...command.args, "-u", this.replScript], {
      cwd: this.cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        MPLBACKEND: "Agg",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.on("exit", () => {
      if (this.process === child) {
        this.process = undefined;
        this.starting = undefined;
      }
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = typeof parsed.id === "string" ? parsed.id : undefined;
      const resolve = id ? this.pending.get(id) : undefined;
      if (!resolve || !id) {
        continue;
      }
      this.pending.delete(id);
      resolve(parsed);
    }
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function resolvePythonCommand(): Promise<{ file: string; args: string[] }> {
  const configured = vscode.workspace.getConfiguration("nmd").get<string>("pythonPath")?.trim();
  if (configured) {
    return { file: configured, args: [] };
  }

  const fromExtension = await pythonExtensionPath();
  if (fromExtension) {
    return { file: fromExtension, args: [] };
  }

  if (process.platform === "win32") {
    return { file: "py", args: ["-3"] };
  }
  return { file: "python3", args: [] };
}

async function pythonExtensionPath(): Promise<string | undefined> {
  const extension = vscode.extensions.getExtension("ms-python.python");
  if (!extension) {
    return undefined;
  }
  try {
    const api = extension.isActive ? extension.exports : await extension.activate();
    const env = await api?.environments?.getActiveEnvironmentPath?.();
    if (typeof env === "string") {
      return env;
    }
    if (env && typeof env.path === "string") {
      return env.path;
    }
    const details = api?.settings?.getExecutionDetails?.();
    const command = details?.execCommand;
    if (Array.isArray(command) && typeof command[0] === "string") {
      return command[0];
    }
  } catch {
    return undefined;
  }
  return undefined;
}
