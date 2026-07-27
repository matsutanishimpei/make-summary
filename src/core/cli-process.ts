import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FeatureContextError } from "./errors.js";

export interface CliProcessRequest {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  stdin?: string;
  providerName: string;
}

export interface CliProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type CliExecutor = (request: CliProcessRequest) => Promise<CliProcessResult>;

export function runCliProcess(request: CliProcessRequest): Promise<CliProcessResult> {
  let launch: CliLaunch;
  try {
    launch = resolveCliLaunch(request.executable);
  } catch (error) {
    return Promise.reject(
      new FeatureContextError(
        "CLI_NOT_FOUND",
        `${request.providerName} CLIが見つかりません。インストール後、ターミナルでバージョンを確認してください。`,
        error instanceof Error ? error.message : String(error)
      )
    );
  }
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const child = spawn(launch.executable, [...launch.argsPrefix, ...request.args], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      stdio: [request.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: launch.electronAsNode
        ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        : process.env
    });

    const stop = () => {
      if (child.killed || child.pid === undefined) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore"
        });
        killer.on("error", () => child.kill());
        killer.on("close", (exitCode) => {
          if (exitCode !== 0 && !child.killed) child.kill();
        });
        setTimeout(() => {
          if (!child.killed) child.kill();
        }, 500).unref();
      } else {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 1_000).unref();
      }
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    };
    const rejectStopped = (error: FeatureContextError) => {
      if (settled) return;
      settled = true;
      cleanup();
      stop();
      reject(error);
    };
    const onAbort = () => {
      cancelled = true;
      rejectStopped(new FeatureContextError("CANCELLED", undefined, stderr));
    };

    timer = setTimeout(() => {
      timedOut = true;
      rejectStopped(
        new FeatureContextError(
          "TIMEOUT",
          `${request.providerName} CLIの処理がタイムアウトしました。対象を絞るか、タイムアウト設定を見直してください。`,
          stderr
        )
      );
    }, request.timeoutMs);
    if (request.signal?.aborted) {
      onAbort();
    } else {
      request.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => (stdout += chunk));
    child.stderr!.on("data", (chunk: string) => (stderr += chunk));
    if (request.stdin !== undefined) {
      child.stdin!.setDefaultEncoding("utf8");
      child.stdin!.on("error", () => {
        // The process error/close handlers provide the actionable failure.
      });
      child.stdin!.end(request.stdin);
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error.code === "ENOENT") {
        reject(
          new FeatureContextError(
            "CLI_NOT_FOUND",
            `${request.providerName} CLIが見つかりません。インストール後、ターミナルでバージョンを確認してください。`,
            error.message
          )
        );
      } else {
        reject(
          new FeatureContextError(
            "CLI_FAILED",
            `${request.providerName} CLIを起動できませんでした。`,
            error.stack
          )
        );
      }
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancelled || request.signal?.aborted) {
        reject(new FeatureContextError("CANCELLED", undefined, stderr));
        return;
      }
      if (timedOut) {
        reject(
          new FeatureContextError(
            "TIMEOUT",
            `${request.providerName} CLIの処理がタイムアウトしました。対象を絞るか、タイムアウト設定を見直してください。`,
            stderr
          )
        );
        return;
      }
      if (exitCode !== 0) {
        const details = `exit=${exitCode}\n${stderr}\n${stdout}`;
        if (
          /auth|unauthori[sz]ed|login|credential|api.?key|not logged in|認証|ログイン/i.test(details)
        ) {
          reject(
            new FeatureContextError(
              "CLI_UNAUTHENTICATED",
              `${request.providerName} CLIが認証されていません。ターミナルで認証を完了してください。`,
              details
            )
          );
        } else {
          reject(
            new FeatureContextError(
              "CLI_FAILED",
              `${request.providerName} CLIの実行に失敗しました。詳細ログを確認して再実行してください。`,
              details
            )
          );
        }
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export interface CliLaunch {
  executable: string;
  argsPrefix: string[];
  electronAsNode: boolean;
}

function resolveCliLaunch(executable: string): CliLaunch {
  const direct = { executable, argsPrefix: [], electronAsNode: false };
  if (process.platform !== "win32") return direct;

  const explicitExtension = path.extname(executable).toLowerCase();
  if (explicitExtension === ".cmd" || explicitExtension === ".bat") {
    return resolveWindowsNpmShim(executable) ?? direct;
  }
  if (explicitExtension === ".exe" || explicitExtension === ".com") return direct;

  let candidates: string[] = [];
  try {
    candidates = execFileSync("where.exe", [executable], {
      encoding: "utf8",
      cwd: process.env.SystemRoot,
      windowsHide: true,
      timeout: 5_000
    })
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  } catch {
    throw new Error(`Command was not found on PATH: ${executable}`);
  }

  for (const candidate of candidates.filter((item) => /\.(?:cmd|bat)$/i.test(item))) {
    const resolved = resolveWindowsNpmShim(candidate);
    if (resolved) return resolved;
  }
  const native = candidates.find((item) => /\.(?:exe|com)$/i.test(item));
  if (native) return { executable: native, argsPrefix: [], electronAsNode: false };
  throw new Error(`No safely executable Windows command was found: ${executable}`);
}

export function resolveWindowsNpmShim(shimPath: string): CliLaunch | null {
  try {
    const absoluteShim = path.resolve(shimPath);
    const shimDir = path.dirname(absoluteShim);
    const content = readFileSync(absoluteShim, "utf8");
    const scriptMatches = [
      ...content.matchAll(/%(?:~dp0|dp0%)\\([^"\r\n%]+?\.js)/gi)
    ];
    const script = scriptMatches
      .map((match) => path.resolve(shimDir, match[1]))
      .filter((candidate) => isInside(shimDir, candidate) && existsSync(candidate))
      .at(-1);
    if (!script) return null;
    return {
      executable: process.execPath,
      argsPrefix: [script],
      electronAsNode: Boolean(process.versions.electron)
    };
  } catch {
    return null;
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
