import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CommandOptions {
  encoding: "utf8";
  windowsHide: boolean;
  timeout: number;
  maxBuffer: number;
}

export type TailscaleCommandExecutor = (
  executable: string,
  args: string[],
  options: CommandOptions
) => Promise<{ stdout: string; stderr: string }>;

export interface TailscaleServiceOptions {
  executable?: string;
  execute?: TailscaleCommandExecutor;
}

export interface TailscaleInfo {
  installed: boolean;
  connected: boolean;
  dnsName?: string;
  message?: string;
}

export class TailscaleService {
  constructor(private readonly options: TailscaleServiceOptions = {}) {}

  async inspect(): Promise<TailscaleInfo> {
    let executable: string;
    try {
      executable = this.options.executable ?? resolveTailscaleExecutable();
    } catch (error) {
      return {
        installed: false,
        connected: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
    try {
      const { stdout } = await this.execute(executable, ["status", "--json"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 2 * 1_024 * 1_024
      });
      const value = JSON.parse(stdout) as {
        BackendState?: string;
        Self?: { DNSName?: string; Online?: boolean };
      };
      const dnsName = value.Self?.DNSName?.replace(/\.$/, "");
      const connected =
        value.Self?.Online === true ||
        value.BackendState === "Running";
      return {
        installed: true,
        connected,
        ...(dnsName ? { dnsName } : {}),
        ...(!connected ? { message: "Tailscaleへログインして接続してください。" } : {})
      };
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      return {
        installed: !missing,
        connected: false,
        message: missing
          ? "Tailscale CLIが見つかりません。Tailscaleをインストールしてください。"
          : error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  async configureServe(port: number): Promise<{ publicUrl: string; output: string }> {
    const executable = this.options.executable ?? resolveTailscaleExecutable();
    const info = await this.inspect();
    if (!info.connected || !info.dnsName) {
      throw new Error(info.message || "Tailscaleへ接続できません。");
    }
    try {
      const { stdout, stderr } = await this.execute(
        executable,
        ["serve", "--yes", "--bg", String(port)],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 2 * 1_024 * 1_024
        }
      );
      return {
        publicUrl: `https://${info.dnsName}`,
        output: `${stdout}\n${stderr}`.trim()
      };
    } catch (error) {
      throw toServeError(error);
    }
  }

  private async execute(
    executable: string,
    args: string[],
    options: CommandOptions
  ): Promise<{ stdout: string; stderr: string }> {
    if (this.options.execute) return this.options.execute(executable, args, options);
    const { stdout, stderr } = await execFileAsync(executable, args, {
      ...options,
      encoding: "utf8"
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  }
}

function toServeError(error: unknown): Error & { details?: string; code?: string } {
  const failure = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
  const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
  const original = typeof failure.message === "string" ? failure.message : String(error);
  const combined = `${stderr}\n${stdout}\n${original}`.toLowerCase();
  const timedOut = failure.killed === true || combined.includes("timed out");
  const permissionDenied =
    combined.includes("access is denied") ||
    combined.includes("permission denied") ||
    combined.includes("アクセスが拒否");
  const message = timedOut
    ? "Tailscale Serveの設定が時間内に完了しませんでした。もう一度実行してください。"
    : permissionDenied
      ? "Tailscale Serveを変更する権限がありません。管理者としてPowerShellを開き、同じ設定を一度実行してください。"
      : "Tailscale Serveの設定に失敗しました。詳細を確認してください。";
  const result = new Error(message) as Error & { details?: string; code?: string };
  result.name = "TailscaleServeError";
  result.code = permissionDenied ? "TAILSCALE_PERMISSION_DENIED" : "TAILSCALE_SERVE_FAILED";
  result.details = [
    stderr ? `stderr:\n${stderr}` : undefined,
    stdout ? `stdout:\n${stdout}` : undefined,
    `message=${original}`,
    `command=tailscale serve --yes --bg <port>`
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  return result;
}

function resolveTailscaleExecutable(): string {
  if (process.env.TAILSCALE_CLI_PATH) {
    const configured = path.resolve(process.env.TAILSCALE_CLI_PATH);
    if (!existsSync(configured)) {
      throw new Error(`TAILSCALE_CLI_PATHのファイルが見つかりません: ${configured}`);
    }
    return configured;
  }
  if (process.platform !== "win32") return "tailscale";
  try {
    const candidates = execFileSync("where.exe", ["tailscale.exe"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000
    })
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const executable = candidates.find((item) => path.extname(item).toLowerCase() === ".exe");
    if (executable) return executable;
  } catch {
    // Fall through to the standard installation paths.
  }
  const programFiles = process.env.ProgramFiles;
  if (programFiles) {
    const standard = path.join(programFiles, "Tailscale", "tailscale.exe");
    if (existsSync(standard)) return standard;
  }
  throw new Error("Tailscale CLIが見つかりません。Tailscaleをインストールしてください。");
}
