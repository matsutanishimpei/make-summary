/**
 * @feature-context
 * @feature bundle generation, output budgets, manifest
 * @role overviewと実コードの実測文字数を調整し、安全な上限内でbundleとmanifestを確定する
 * @entry packageBundle
 * @flow recommended + priority sorting -> budget-aware code packing -> exact overview -> atomic output
 * @related code-packer.ts, overview-renderer.ts, output-repository.ts
 * @caution 最大文字数を超えず、固定余白ではなく再梱包で実コードへ使える容量を確保する
 */

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
    const recommendedA = a.record.recommended ? 0 : 1;
    const recommendedB = b.record.recommended ? 0 : 1;
    return (
      recommendedA - recommendedB ||
      priorityRank[a.record.priority] - priorityRank[b.record.priority] ||
      a.record.normalizedPath!.localeCompare(b.record.normalizedPath!)
    );
  });

  let sourceArtifacts: ArtifactContent[] = [];
  let bundledSources: BundledSource[] = [];
  let omittedSources = initialOmissions(input.records, input.concat, input.maxOutputFiles);
  const generatedAt = new Date().toISOString();

  const preliminaryOverview = renderOverview({
    ...input,
    bundledSources,
    omittedSources,
    generatedAt
  });
  if (preliminaryOverview.length > input.maxFileChars || preliminaryOverview.length > input.maxTotalChars) {
    throw new FeatureContextError("OUTPUT_LIMIT", undefined, "01-overview.md alone exceeds the configured limit");
  }

  if (input.concat && input.maxOutputFiles > 1) {
    let codeBudget = Math.max(0, input.maxTotalChars - preliminaryOverview.length);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const packed = packCode(
        sorted,
        input.maxOutputFiles - 1,
        input.maxFileChars,
        codeBudget
      );
      const bundledPaths = new Set(packed.bundled.map((item) => item.path));
      const nextOmitted = input.records
        .filter((record) => !record.valid || !record.normalizedPath || !bundledPaths.has(record.normalizedPath))
        .map((record) => ({
          path: record.normalizedPath ?? record.path,
          reason:
            record.exclusionReason ??
            (!record.included
              ? "安全検証によりコード連結の対象外"
              : "文字数上限または添付用ファイル数上限のため未収録")
        }));
      const nextOverview = renderOverview({
        ...input,
        bundledSources: packed.bundled,
        omittedSources: nextOmitted,
        generatedAt
      });
      const nextCodeChars = packed.artifacts.reduce((sum, item) => sum + item.content.length, 0);
      const overflow = nextOverview.length + nextCodeChars - input.maxTotalChars;

      sourceArtifacts = packed.artifacts;
      bundledSources = packed.bundled;
      omittedSources = nextOmitted;
      if (overflow <= 0) break;
      codeBudget = Math.max(0, codeBudget - overflow);
    }
  }

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
        ? "安全検証によりコード連結の対象外"
        : !concat
          ? "コード連結オプションが無効"
          : maxOutputFiles <= 1
            ? "添付用ファイル上限が1件のためoverviewのみ生成"
            : "文字数上限または添付用ファイル数上限のため未収録")
  }));
}
