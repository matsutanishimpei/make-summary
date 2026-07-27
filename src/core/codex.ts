import { FeatureContextError } from "./errors.js";
import { parseInvestigation } from "./investigation.js";
import { runCliProcess } from "./cli-process.js";
import type { CliExecutor } from "./cli-process.js";
import type {
  CliInfo,
  Investigation,
  InvestigationRunRequest,
  InvestigationRunner
} from "./types.js";

export class CodexCliRunner implements InvestigationRunner {
  readonly provider = "codex" as const;
  private info?: CliInfo;

  constructor(
    private readonly executable = process.env.CODEX_CLI_PATH || "codex",
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
      providerName: "Codex"
    });
    const help = await this.execute({
      executable: this.executable,
      args: ["exec", "--help"],
      cwd: process.cwd(),
      timeoutMs: 10_000,
      signal,
      providerName: "Codex"
    });
    const helpText = `${help.stdout}\n${help.stderr}`;
    if (!/--json/.test(helpText)) {
      throw new FeatureContextError(
        "CLI_FAILED",
        "このCodex CLIは機械可読な --json 出力に対応していません。Codex CLIを更新してください。",
        helpText
      );
    }
    if (!/--sandbox/.test(helpText)) {
      throw new FeatureContextError(
        "CLI_FAILED",
        "このCodex CLIは読み取り専用sandboxを指定できません。Codex CLIを更新してください。",
        helpText
      );
    }
    this.info = {
      provider: this.provider,
      version: version.stdout.trim() || version.stderr.trim(),
      help: helpText
    };
    return this.info;
  }

  async investigate(request: InvestigationRunRequest): Promise<Investigation> {
    const info = await this.inspect(request.signal);
    const args = ["exec", "--json", "--sandbox", "read-only"];
    if (/--skip-git-repo-check/.test(info.help)) args.push("--skip-git-repo-check");
    args.push("-");
    const result = await this.execute({
      executable: this.executable,
      args,
      cwd: request.projectRoot,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      stdin: request.prompt,
      providerName: "Codex"
    });
    return parseCodexJsonl(result.stdout);
  }
}

export function parseCodexJsonl(raw: string): Investigation {
  const trimmed = raw.trim();
  if (!trimmed) throw new FeatureContextError("INVALID_JSON", undefined, "Codex output was empty");

  // Test doubles and future CLI versions may return the schema object directly.
  try {
    return parseInvestigation(trimmed);
  } catch {
    // Continue with JSONL event parsing.
  }

  const messages: string[] = [];
  const invalidLines: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const item =
        event.item && typeof event.item === "object"
          ? (event.item as Record<string, unknown>)
          : undefined;
      if (item?.type === "agent_message" && typeof item.text === "string") {
        messages.push(item.text);
      } else if (event.type === "agent_message" && typeof event.text === "string") {
        messages.push(event.text);
      } else if (typeof event.output_text === "string") {
        messages.push(event.output_text);
      }
    } catch {
      invalidLines.push(line);
    }
  }

  for (const message of messages.reverse()) {
    try {
      return parseInvestigation(message);
    } catch {
      // The last agent message is normally final, but try earlier messages for compatibility.
    }
  }

  throw new FeatureContextError(
    "INVALID_JSON",
    "Codex CLIから有効な調査JSONを取得できませんでした。もう一度実行してください。",
    [...invalidLines, ...messages].join("\n").slice(0, 8_000)
  );
}
