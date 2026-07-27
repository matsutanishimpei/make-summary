import { spawn } from "node:child_process";
import { FeatureContextError } from "./errors.js";
import type {
  GeminiFile,
  GeminiInfo,
  GeminiRunRequest,
  GeminiRunner,
  Investigation,
  Priority
} from "./types.js";

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class GeminiCliRunner implements GeminiRunner {
  private info?: GeminiInfo;

  constructor(private readonly executable = process.env.GEMINI_CLI_PATH || "gemini") {}

  async inspect(signal?: AbortSignal): Promise<GeminiInfo> {
    if (this.info) return this.info;
    const version = await this.run(["--version"], process.cwd(), 10_000, signal);
    const help = await this.run(["--help"], process.cwd(), 10_000, signal);
    this.info = {
      version: version.stdout.trim() || version.stderr.trim(),
      help: `${help.stdout}\n${help.stderr}`
    };
    return this.info;
  }

  async investigate(request: GeminiRunRequest): Promise<Investigation> {
    const info = await this.inspect(request.signal);
    const promptFlag = /(?:^|\s)--prompt(?:\s|,|$)/m.test(info.help) ? "--prompt" : "-p";
    if (!/--output-format/.test(info.help)) {
      throw new FeatureContextError(
        "CLI_FAILED",
        "このGemini CLIは機械可読な --output-format を提供していません。Gemini CLIを更新してください。",
        info.help
      );
    }
    const safetyArgs =
      /--approval-mode/.test(info.help) && /\bplan\b/.test(info.help)
        ? ["--approval-mode", "plan"]
        : [];
    const result = await this.run(
      [...safetyArgs, promptFlag, request.prompt, "--output-format", "json"],
      request.projectRoot,
      request.timeoutMs,
      request.signal
    );
    return parseInvestigation(result.stdout);
  }

  private run(
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const child = spawn(this.executable, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const stop = () => {
        if (!child.killed) child.kill();
      };
      const onAbort = () => {
        cancelled = true;
        stop();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error.code === "ENOENT") {
          reject(new FeatureContextError("CLI_NOT_FOUND", undefined, error.message));
        } else {
          reject(new FeatureContextError("CLI_FAILED", undefined, error.stack));
        }
      });

      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (cancelled || signal?.aborted) {
          reject(new FeatureContextError("CANCELLED", undefined, stderr));
          return;
        }
        if (timedOut) {
          reject(new FeatureContextError("TIMEOUT", undefined, stderr));
          return;
        }
        if (exitCode !== 0) {
          const details = `exit=${exitCode}\n${stderr}\n${stdout}`;
          if (/auth|login|credential|api.?key|認証|ログイン/i.test(details)) {
            reject(new FeatureContextError("CLI_UNAUTHENTICATED", undefined, details));
          } else {
            reject(new FeatureContextError("CLI_FAILED", undefined, details));
          }
          return;
        }
        resolve({ stdout, stderr, exitCode });
      });
    });
  }
}

export function parseInvestigation(raw: string): Investigation {
  try {
    let value: unknown = JSON.parse(raw.trim());
    if (
      value &&
      typeof value === "object" &&
      "response" in value &&
      typeof (value as { response: unknown }).response === "string"
    ) {
      value = JSON.parse((value as { response: string }).response.trim());
    }
    return validateInvestigation(value);
  } catch (error) {
    if (error instanceof FeatureContextError) throw error;
    throw new FeatureContextError(
      "INVALID_JSON",
      undefined,
      error instanceof Error ? `${error.message}\n${raw.slice(0, 4000)}` : raw.slice(0, 4000)
    );
  }
}

function validateInvestigation(value: unknown): Investigation {
  if (!value || typeof value !== "object") {
    throw new FeatureContextError("INVALID_JSON", undefined, "JSON root must be an object");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.feature !== "string" || !Array.isArray(input.files)) {
    throw new FeatureContextError("INVALID_JSON", undefined, "feature/files are missing");
  }
  const files: GeminiFile[] = input.files.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new FeatureContextError("INVALID_JSON", undefined, `files[${index}] is invalid`);
    }
    const file = item as Record<string, unknown>;
    const priority = file.priority;
    if (!["core", "supporting", "test"].includes(String(priority))) {
      throw new FeatureContextError("INVALID_JSON", undefined, `files[${index}].priority is invalid`);
    }
    for (const field of ["path", "role", "reason", "group"]) {
      if (typeof file[field] !== "string") {
        throw new FeatureContextError("INVALID_JSON", undefined, `files[${index}].${field} is invalid`);
      }
    }
    return {
      path: file.path as string,
      role: file.role as string,
      reason: file.reason as string,
      priority: priority as Priority,
      group: file.group as string,
      recommended: file.recommended !== false,
      ...(typeof file.summary === "string" ? { summary: file.summary } : {})
    };
  });
  return {
    feature: input.feature,
    overview: typeof input.overview === "string" ? input.overview : undefined,
    flow: Array.isArray(input.flow) ? input.flow.filter((x): x is string => typeof x === "string") : [],
    files,
    uncertainties: Array.isArray(input.uncertainties)
      ? input.uncertainties.filter((x): x is string => typeof x === "string")
      : []
  };
}
