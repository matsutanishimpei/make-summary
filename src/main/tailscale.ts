import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TailscaleInfo {
  installed: boolean;
  connected: boolean;
  dnsName?: string;
  message?: string;
}

export class TailscaleService {
  async inspect(): Promise<TailscaleInfo> {
    let executable: string;
    try {
      executable = resolveTailscaleExecutable();
    } catch (error) {
      return {
        installed: false,
        connected: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
    try {
      const { stdout } = await execFileAsync(executable, ["status", "--json"], {
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
    const executable = resolveTailscaleExecutable();
    const info = await this.inspect();
    if (!info.connected || !info.dnsName) {
      throw new Error(info.message || "Tailscaleへ接続できません。");
    }
    const { stdout, stderr } = await execFileAsync(
      executable,
      ["serve", "--bg", String(port)],
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
  }
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
