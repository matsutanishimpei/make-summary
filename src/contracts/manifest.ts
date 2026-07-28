import { validateInvestigation } from "../core/investigation.js";
import type {
  BundleArtifact,
  BundledSource,
  Manifest,
  OmittedSource,
  ValidationRecord
} from "../core/types.js";
import { isProviderId } from "./providers.js";

export function parseManifest(value: unknown): Manifest {
  const input = record(value, "manifestのルートがオブジェクトではありません。");
  migrateLegacyManifest(input);
  if (input.schemaVersion !== "1.1") {
    throw new Error(`未対応のmanifestスキーマです: ${String(input.schemaVersion)}`);
  }

  const options = record(input.options, "manifest.optionsが不正です。");
  const provider = record(input.provider, "manifest.providerが不正です。");
  if (!isProviderId(provider.id) || !isProviderId(options.provider)) {
    throw new Error("manifestのAIプロバイダーが不正です。");
  }
  if (provider.id !== options.provider) {
    throw new Error("manifestのAIプロバイダー指定が一致しません。");
  }

  return {
    schemaVersion: "1.1",
    feature: nonEmptyString(input.feature, "feature"),
    projectRoot: nonEmptyString(input.projectRoot, "projectRoot"),
    generatedAt: stringValue(input.generatedAt, "generatedAt"),
    gitCommitId:
      input.gitCommitId === null ? null : stringValue(input.gitCommitId, "gitCommitId"),
    options: {
      provider: provider.id,
      summary: booleanValue(options.summary, "options.summary"),
      concat: booleanValue(options.concat, "options.concat"),
      maxOutputFiles: positiveInteger(options.maxOutputFiles, "options.maxOutputFiles"),
      maxTotalChars: positiveInteger(options.maxTotalChars, "options.maxTotalChars"),
      maxFileChars: positiveInteger(options.maxFileChars, "options.maxFileChars"),
      ...(typeof options.geminiApiModel === "string"
        ? { geminiApiModel: options.geminiApiModel }
        : {})
    },
    provider: {
      id: provider.id,
      cliVersion: stringValue(provider.cliVersion, "provider.cliVersion")
    },
    investigation: validateInvestigation(input.investigation),
    relatedFiles: arrayValue(input.relatedFiles, "relatedFiles").map(parseValidationRecord),
    validation: parseValidationCounts(input.validation),
    selections: booleanMap(input.selections, "selections"),
    bundledSources: arrayValue(input.bundledSources, "bundledSources").map(parseBundledSource),
    omittedSources: arrayValue(input.omittedSources, "omittedSources").map(parseOmittedSource),
    bundleFiles: arrayValue(input.bundleFiles, "bundleFiles").map(parseBundleArtifact),
    totalChars: nonNegativeInteger(input.totalChars, "totalChars"),
    estimatedTokens: nonNegativeInteger(input.estimatedTokens, "estimatedTokens"),
    tokenEstimateMethod: stringValue(input.tokenEstimateMethod, "tokenEstimateMethod"),
    warnings: stringArray(input.warnings, "warnings"),
    uncertainties: stringArray(input.uncertainties, "uncertainties")
  };
}

function migrateLegacyManifest(input: Record<string, unknown>): void {
  if (!input.provider && typeof input.geminiCliVersion === "string") {
    input.provider = { id: "gemini", cliVersion: input.geminiCliVersion };
    input.schemaVersion = "1.1";
    const options = record(input.options, "manifest.optionsが不正です。");
    options.provider = "gemini";
  }
}

function parseValidationRecord(value: unknown, index: number): ValidationRecord {
  const item = record(value, `relatedFiles[${index}]が不正です。`);
  const priority = item.priority;
  if (!["core", "supporting", "test"].includes(String(priority))) {
    throw new Error(`relatedFiles[${index}].priorityが不正です。`);
  }
  return {
    path: stringValue(item.path, `relatedFiles[${index}].path`),
    role: stringValue(item.role, `relatedFiles[${index}].role`),
    reason: stringValue(item.reason, `relatedFiles[${index}].reason`),
    priority: priority as ValidationRecord["priority"],
    group: stringValue(item.group, `relatedFiles[${index}].group`),
    recommended: booleanValue(item.recommended, `relatedFiles[${index}].recommended`),
    valid: booleanValue(item.valid, `relatedFiles[${index}].valid`),
    included: booleanValue(item.included, `relatedFiles[${index}].included`),
    userSelected:
      item.userSelected === null
        ? null
        : booleanValue(item.userSelected, `relatedFiles[${index}].userSelected`),
    ...(typeof item.summary === "string" ? { summary: item.summary } : {}),
    ...(typeof item.normalizedPath === "string" ? { normalizedPath: item.normalizedPath } : {}),
    ...(typeof item.exclusionReason === "string" ? { exclusionReason: item.exclusionReason } : {}),
    ...(typeof item.size === "number" ? { size: nonNegativeInteger(item.size, "size") } : {})
  };
}

function parseValidationCounts(value: unknown): Manifest["validation"] {
  const item = record(value, "validationが不正です。");
  return {
    detected: nonNegativeInteger(item.detected, "validation.detected"),
    valid: nonNegativeInteger(item.valid, "validation.valid"),
    invalid: nonNegativeInteger(item.invalid, "validation.invalid")
  };
}

function parseBundledSource(value: unknown, index: number): BundledSource {
  const item = record(value, `bundledSources[${index}]が不正です。`);
  return {
    path: stringValue(item.path, "bundledSources.path"),
    artifact: stringValue(item.artifact, "bundledSources.artifact"),
    lineStart: positiveInteger(item.lineStart, "bundledSources.lineStart"),
    lineEnd: positiveInteger(item.lineEnd, "bundledSources.lineEnd")
  };
}

function parseOmittedSource(value: unknown, index: number): OmittedSource {
  const item = record(value, `omittedSources[${index}]が不正です。`);
  return {
    path: stringValue(item.path, "omittedSources.path"),
    reason: stringValue(item.reason, "omittedSources.reason")
  };
}

function parseBundleArtifact(value: unknown, index: number): BundleArtifact {
  const item = record(value, `bundleFiles[${index}]が不正です。`);
  return {
    name: stringValue(item.name, "bundleFiles.name"),
    path: stringValue(item.path, "bundleFiles.path"),
    chars: nonNegativeInteger(item.chars, "bundleFiles.chars")
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}が配列ではありません。`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}が文字列ではありません。`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!result.trim()) throw new Error(`${label}が空です。`);
  return result;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}が真偽値ではありません。`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label}が0以上の整数ではありません。`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const result = nonNegativeInteger(value, label);
  if (result < 1) throw new Error(`${label}が正の整数ではありません。`);
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  const values = arrayValue(value, label);
  if (values.some((item) => typeof item !== "string")) {
    throw new Error(`${label}に文字列以外が含まれています。`);
  }
  return values as string[];
}

function booleanMap(value: unknown, label: string): Record<string, boolean> {
  const item = record(value, `${label}が不正です。`);
  if (Object.values(item).some((entry) => typeof entry !== "boolean")) {
    throw new Error(`${label}に真偽値以外が含まれています。`);
  }
  return item as Record<string, boolean>;
}
