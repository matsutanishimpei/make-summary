import path from "node:path";
import { FEATURE_CONTEXT_LIMITS } from "../contracts/defaults.js";
import { FeatureContextError, asFeatureContextError } from "../core/errors.js";
import { isAiProvider, providerLabels } from "../core/provider.js";
import { createInvestigationPrompt } from "../core/prompt.js";
import type {
  BuildOptions,
  BuildResult,
  ProgressReporter
} from "../core/types.js";
import type { FeatureContextDependencies } from "./ports.js";

export class BuildFeatureContext {
  constructor(private readonly dependencies: FeatureContextDependencies) {}

  async execute(
    options: BuildOptions,
    report: ProgressReporter = () => {},
    signal?: AbortSignal
  ): Promise<BuildResult> {
    try {
      validateOptions(options);
      const projectRoot = await this.dependencies.workspace.resolveProjectRoot(options.projectRoot);
      const outputDir = this.dependencies.workspace.resolveOutputDir(
        projectRoot,
        options.outputDir,
        options.name ?? options.feature
      );
      const provider = options.provider ?? "gemini";
      const providerName = providerLabels[provider];
      const runner = this.dependencies.resolveRunner(provider, {
        geminiApiKey: options.geminiApiKey,
        geminiApiModel: options.geminiApiModel
      });
      throwIfAborted(signal);
      if (!options.dryRun && !options.force) {
        await this.dependencies.workspace.assertOutputAvailable(outputDir);
      }

      report({ stage: "checking-cli", message: `${providerName}を確認中` });
      const info = await runner.inspect(signal);
      report({ stage: "investigating", message: "コードベースを調査中" });
      const investigation = await runner.investigate({
        projectRoot,
        prompt: createInvestigationPrompt(options.feature, options.summary),
        timeoutMs: options.timeoutMs ?? 180_000,
        signal
      });
      throwIfAborted(signal);

      report({ stage: "validating", message: "関連ファイルを検証中" });
      const validation = await this.dependencies.workspace.validateRelatedFiles(
        projectRoot,
        investigation.files,
        options.selections
      );
      if (!validation.records.some((record) => record.valid)) {
        throw new FeatureContextError("NO_VALID_FILES", undefined, validation.warnings.join("\n"));
      }
      report({ stage: "collecting", message: "コードを収集中" });
      const collection = await this.dependencies.workspace.collectSelectedFiles(
        projectRoot,
        validation.records
      );
      throwIfAborted(signal);
      if (!validation.records.some((record) => record.valid)) {
        throw new FeatureContextError(
          "NO_VALID_FILES",
          undefined,
          [...validation.warnings, ...collection.warnings].join("\n")
        );
      }

      report({ stage: "packing", message: "添付用ファイルへ整理中" });
      const manifest = await this.dependencies.packageBundle({
        projectRoot,
        outputDir,
        investigation,
        records: validation.records,
        collected: collection.files,
        summary: options.summary,
        concat: options.concat,
        maxOutputFiles: options.maxOutputFiles,
        maxTotalChars: options.maxTotalChars,
        maxFileChars: options.maxFileChars ?? Math.min(60_000, options.maxTotalChars),
        geminiApiModel: provider === "gemini-api" ? info.version : undefined,
        provider,
        cliVersion: info.version,
        gitCommitId: await this.dependencies.workspace.getGitCommitId(projectRoot),
        warnings: [...validation.warnings, ...collection.warnings],
        dryRun: options.dryRun ?? false,
        force: options.force ?? false
      });
      report({ stage: "completed", message: "完了" });
      return {
        outputDir,
        manifestPath: path.join(outputDir, "manifest.json"),
        manifest
      };
    } catch (error) {
      const normalized = asFeatureContextError(error);
      report({ stage: "error", message: normalized.message });
      throw normalized;
    }
  }
}

function validateOptions(options: BuildOptions): void {
  if (
    !options.feature.trim() ||
    (options.provider !== undefined && !isAiProvider(options.provider)) ||
    !Number.isInteger(options.maxOutputFiles) ||
    options.maxOutputFiles < FEATURE_CONTEXT_LIMITS.minOutputFiles ||
    options.maxOutputFiles > FEATURE_CONTEXT_LIMITS.maxOutputFiles ||
    !Number.isInteger(options.maxTotalChars) ||
    options.maxTotalChars < FEATURE_CONTEXT_LIMITS.minTotalChars
  ) {
    throw new FeatureContextError("INVALID_OPTIONS");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new FeatureContextError("CANCELLED");
}
