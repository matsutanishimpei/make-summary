import path from "node:path";
import { FeatureContextError } from "../errors.js";
import type {
  BundleArtifact,
  BundledSource,
  Manifest,
  OmittedSource,
  ValidationRecord
} from "../types.js";
import { packCode } from "./code-packer.js";
import type { ArtifactContent, PackageInput } from "./model.js";
import { priorityRank } from "./model.js";
import { renderOverview } from "./overview-renderer.js";
import { writeBundleAtomically } from "./output-repository.js";

export async function packageBundle(input: PackageInput): Promise<Manifest> {
  const sorted = [...input.collected].sort((a, b) => {
    const manualA = a.record.userSelected === true ? 0 : 1;
    const manualB = b.record.userSelected === true ? 0 : 1;
    return (
      manualA - manualB ||
      priorityRank[a.record.priority] - priorityRank[b.record.priority] ||
      a.record.normalizedPath!.localeCompare(b.record.normalizedPath!)
    );
  });

  let sourceArtifacts: ArtifactContent[] = [];
  let bundledSources: BundledSource[] = [];
  let omittedSources = initialOmissions(input.records, input.concat, input.maxOutputFiles);

  const preliminaryOverview = renderOverview({
    ...input,
    bundledSources,
    omittedSources,
    generatedAt: new Date().toISOString()
  });
  if (preliminaryOverview.length > input.maxFileChars || preliminaryOverview.length > input.maxTotalChars) {
    throw new FeatureContextError("OUTPUT_LIMIT", undefined, "01-overview.md alone exceeds the configured limit");
  }

  if (input.concat && input.maxOutputFiles > 1) {
    const codeBudget = Math.max(
      0,
      input.maxTotalChars - preliminaryOverview.length - Math.min(4000, Math.floor(input.maxTotalChars * 0.04))
    );
    const packed = packCode(
      sorted,
      input.maxOutputFiles - 1,
      input.maxFileChars,
      codeBudget
    );
    sourceArtifacts = packed.artifacts;
    bundledSources = packed.bundled;
    const bundledPaths = new Set(bundledSources.map((item) => item.path));
    omittedSources = input.records
      .filter((record) => !record.valid || !record.normalizedPath || !bundledPaths.has(record.normalizedPath))
      .map((record) => ({
        path: record.normalizedPath ?? record.path,
        reason:
          record.exclusionReason ??
          (!record.included
            ? "ユーザーまたはAIの選択によりコード連結の対象外"
            : "文字数上限または添付用ファイル数上限のため未収録")
      }));
  }

  const generatedAt = new Date().toISOString();
  const overview = renderOverview({ ...input, bundledSources, omittedSources, generatedAt });
  if (overview.length > input.maxFileChars) {
    throw new FeatureContextError("OUTPUT_LIMIT", undefined, "01-overview.md exceeds the per-file limit");
  }
  const contents: ArtifactContent[] = [{ name: "01-overview.md", content: overview }, ...sourceArtifacts];
  const totalChars = contents.reduce((sum, item) => sum + item.content.length, 0);
  if (contents.length > input.maxOutputFiles || totalChars > input.maxTotalChars) {
    throw new FeatureContextError(
      "OUTPUT_LIMIT",
      undefined,
      `files=${contents.length}, chars=${totalChars}, limit=${input.maxTotalChars}`
    );
  }

  const bundleDir = path.join(input.outputDir, "bundle");
  const artifacts: BundleArtifact[] = contents.map((item) => ({
    name: item.name,
    path: path.join(bundleDir, item.name),
    chars: item.content.length
  }));
  const selections = Object.fromEntries(
    input.records
      .filter((record) => record.normalizedPath)
      .map((record) => [record.normalizedPath!, record.included])
  );
  const manifest: Manifest = {
    schemaVersion: "1.1",
    feature: input.investigation.feature,
    projectRoot: input.projectRoot,
    generatedAt,
    gitCommitId: input.gitCommitId,
    options: {
      provider: input.provider,
      summary: input.summary,
      concat: input.concat,
      maxOutputFiles: input.maxOutputFiles,
      maxTotalChars: input.maxTotalChars,
      maxFileChars: input.maxFileChars,
      ...(input.geminiApiModel ? { geminiApiModel: input.geminiApiModel } : {})
    },
    provider: {
      id: input.provider,
      cliVersion: input.cliVersion
    },
    investigation: input.investigation,
    relatedFiles: input.records,
    validation: {
      detected: input.records.length,
      valid: input.records.filter((record) => record.valid).length,
      invalid: input.records.filter((record) => !record.valid).length
    },
    selections,
    bundledSources,
    omittedSources,
    bundleFiles: artifacts,
    totalChars,
    estimatedTokens: Math.ceil(totalChars / 4),
    tokenEstimateMethod: "UTF-16文字数 ÷ 4 を切り上げ（概算）",
    warnings: input.warnings,
    uncertainties: input.investigation.uncertainties
  };

  if (!input.dryRun) {
    await writeBundleAtomically(input.projectRoot, input.outputDir, contents, manifest, input.force);
  }
  return manifest;
}

function initialOmissions(
  records: ValidationRecord[],
  concat: boolean,
  maxOutputFiles: number
): OmittedSource[] {
  return records.map((record) => ({
    path: record.normalizedPath ?? record.path,
    reason:
      record.exclusionReason ??
      (!record.included
        ? "ユーザーまたはAIの選択によりコード連結の対象外"
        : !concat
          ? "コード連結オプションが無効"
          : maxOutputFiles <= 1
            ? "添付用ファイル上限が1件のためoverviewのみ生成"
            : "文字数上限または添付用ファイル数上限のため未収録")
  }));
}
