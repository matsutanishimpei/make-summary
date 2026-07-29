/**
 * @feature-context
 * @feature bundle rebuild, automatic source inclusion, capacity adjustment
 * @role 保存済み調査結果を再検証し、AIを再実行せず現在の容量条件で全関連候補を再梱包する
 * @entry RebuildFeatureBundle.execute
 * @flow manifest -> automatic candidate validation -> collection -> capacity-aware package
 * @related build-context.ts, ports.ts, ../core/bundle/package-bundle.ts
 * @caution file選択を受けず、安全な全関連候補を再検証して容量条件だけを変更する
 */

import path from "node:path";
import { FeatureContextError, asFeatureContextError } from "../core/errors.js";
import type {
  BuildResult,
  ProgressReporter,
  RebuildOptions
} from "../core/types.js";
import type { FeatureContextDependencies } from "./ports.js";

export class RebuildFeatureBundle {
  constructor(private readonly dependencies: FeatureContextDependencies) {}

  async execute(
    options: RebuildOptions,
    report: ProgressReporter = () => {},
    signal?: AbortSignal
  ): Promise<BuildResult> {
    try {
      report({ stage: "validating", message: "関連ファイルを再検証中" });
      const manifest = await this.dependencies.workspace.readManifest(options.manifestPath);
      const projectRoot = await this.dependencies.workspace.resolveProjectRoot(manifest.projectRoot);
      const outputDir = path.dirname(path.resolve(options.manifestPath));
      this.dependencies.workspace.assertOutputInside(projectRoot, outputDir);
      const validation = await this.dependencies.workspace.validateRelatedFiles(
        projectRoot,
        manifest.investigation.files
      );
      if (!validation.records.some((record) => record.valid)) {
        throw new FeatureContextError("NO_VALID_FILES");
      }
      report({ stage: "collecting", message: "選択したコードを収集中" });
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
      report({ stage: "packing", message: "AIを再実行せずbundleを再構築中" });
      const rebuilt = await this.dependencies.packageBundle({
        projectRoot,
        outputDir,
        investigation: manifest.investigation,
        records: validation.records,
        collected: collection.files,
        summary: manifest.options.summary,
        concat: manifest.options.concat,
        maxOutputFiles: options.maxOutputFiles ?? manifest.options.maxOutputFiles,
        maxTotalChars: options.maxTotalChars ?? manifest.options.maxTotalChars,
        maxFileChars: manifest.options.maxFileChars,
        geminiApiModel: manifest.options.geminiApiModel,
        provider: manifest.provider.id,
        cliVersion: manifest.provider.cliVersion,
        gitCommitId: await this.dependencies.workspace.getGitCommitId(projectRoot),
        warnings: [...validation.warnings, ...collection.warnings],
        dryRun: false,
        force: options.force ?? false
      });
      report({ stage: "completed", message: "再構築が完了しました" });
      return { outputDir, manifestPath: path.join(outputDir, "manifest.json"), manifest: rebuilt };
    } catch (error) {
      const normalized = asFeatureContextError(error);
      report({ stage: "error", message: normalized.message });
      throw normalized;
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new FeatureContextError("CANCELLED");
}
