import { FeatureContextError } from "./errors.js";
import { runCliProcess } from "./cli-process.js";
import { parseInvestigation } from "./investigation.js";
import type { CliExecutor } from "./cli-process.js";
import type {
  CliInfo,
  InvestigationRunRequest,
  InvestigationRunner,
  Investigation
} from "./types.js";

export class GeminiCliRunner implements InvestigationRunner {
  readonly provider = "gemini" as const;
  private info?: CliInfo;

  constructor(
    private readonly executable = process.env.GEMINI_CLI_PATH || "gemini",
    private readonly execute: CliExecutor = runCliProcess
  ) {}

  async inspect(signal?: AbortSignal): Promise<CliInfo> {
    if (this.info) return this.info;
    const version = await this.execute({
      executable: this.executable,
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 10_000,
      signal,
      providerName: "Gemini"
    });
    const help = await this.execute({
      executable: this.executable,
      args: ["--help"],
      cwd: process.cwd(),
      timeoutMs: 10_000,
      signal,
      providerName: "Gemini"
    });
    this.info = {
      provider: this.provider,
      version: version.stdout.trim() || version.stderr.trim(),
      help: `${help.stdout}\n${help.stderr}`
    };
    return this.info;
  }

  async investigate(request: InvestigationRunRequest): Promise<Investigation> {
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
    const trustArgs = /--skip-trust/.test(info.help) ? ["--skip-trust"] : [];
    const result = await this.execute({
      executable: this.executable,
      args: [...trustArgs, ...safetyArgs, promptFlag, request.prompt, "--output-format", "json"],
      cwd: request.projectRoot,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      providerName: "Gemini"
    });
    return parseInvestigation(result.stdout);
  }
}
