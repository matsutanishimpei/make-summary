import { FEATURE_CONTEXT_LIMITS } from "./defaults.js";
import { isProviderId } from "./providers.js";
import type { BuildOptions, RebuildOptions } from "../core/types.js";

export type DesktopBuildRequest = Omit<BuildOptions, "geminiApiKey">;
export type DesktopRebuildRequest = RebuildOptions;

export function parseDesktopBuildRequest(value: unknown): DesktopBuildRequest {
  const input = asRecord(value, "生成条件が不正です。");
  const projectRoot = requiredString(input.projectRoot, "プロジェクトフォルダ");
  const feature = requiredString(input.feature, "調査対象");
  if (feature.length > 2_000) throw new Error("調査対象は2,000文字以内で入力してください。");
  const provider = input.provider === undefined ? undefined : input.provider;
  if (provider !== undefined && !isProviderId(provider)) {
    throw new Error("選択されたAIプロバイダーが不正です。");
  }
  const summary = requiredBoolean(input.summary, "要約");
  const concat = requiredBoolean(input.concat, "コード連結");
  const maxOutputFiles = boundedInteger(
    input.maxOutputFiles,
    FEATURE_CONTEXT_LIMITS.minOutputFiles,
    FEATURE_CONTEXT_LIMITS.maxOutputFiles,
    "添付用ファイル数"
  );
  const maxTotalChars = boundedInteger(
    input.maxTotalChars,
    FEATURE_CONTEXT_LIMITS.minTotalChars,
    FEATURE_CONTEXT_LIMITS.maxTotalChars,
    "合計文字数"
  );
  const selections = optionalBooleanMap(input.selections);

  return {
    projectRoot,
    feature,
    ...(provider ? { provider } : {}),
    summary,
    concat,
    maxOutputFiles,
    maxTotalChars,
    ...optionalStringProperty(input, "outputDir"),
    ...optionalStringProperty(input, "name"),
    ...optionalStringProperty(input, "geminiApiModel", /^[a-zA-Z0-9._-]+$/),
    ...optionalIntegerProperty(input, "maxFileChars", 1_000, FEATURE_CONTEXT_LIMITS.maxTotalChars),
    ...optionalIntegerProperty(input, "timeoutMs", 1_000, 60 * 60 * 1_000),
    ...optionalBooleanProperty(input, "dryRun"),
    ...optionalBooleanProperty(input, "force"),
    ...optionalBooleanProperty(input, "verbose"),
    ...(selections ? { selections } : {})
  };
}

export function parseDesktopRebuildRequest(value: unknown): DesktopRebuildRequest {
  const input = asRecord(value, "bundle再構築条件が不正です。");
  return {
    manifestPath: requiredString(input.manifestPath, "manifest"),
    selections: optionalBooleanMap(input.selections, true)!,
    ...optionalIntegerProperty(
      input,
      "maxOutputFiles",
      FEATURE_CONTEXT_LIMITS.minOutputFiles,
      FEATURE_CONTEXT_LIMITS.maxOutputFiles
    ),
    ...optionalIntegerProperty(
      input,
      "maxTotalChars",
      FEATURE_CONTEXT_LIMITS.minTotalChars,
      FEATURE_CONTEXT_LIMITS.maxTotalChars
    ),
    ...optionalBooleanProperty(input, "force")
  };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}を入力してください。`);
  return value.trim();
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}の指定が不正です。`);
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label}は${min}～${max}で指定してください。`);
  }
  return value as number;
}

function optionalStringProperty(
  input: Record<string, unknown>,
  key: string,
  pattern?: RegExp
): Record<string, string> {
  const value = input[key];
  if (value === undefined) return {};
  if (typeof value !== "string" || (pattern && !pattern.test(value))) {
    throw new Error(`${key}の指定が不正です。`);
  }
  return { [key]: value };
}

function optionalIntegerProperty(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): Record<string, number> {
  const value = input[key];
  if (value === undefined) return {};
  return { [key]: boundedInteger(value, min, max, key) };
}

function optionalBooleanProperty(
  input: Record<string, unknown>,
  key: string
): Record<string, boolean> {
  const value = input[key];
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw new Error(`${key}の指定が不正です。`);
  return { [key]: value };
}

function optionalBooleanMap(
  value: unknown,
  required = false
): Record<string, boolean> | undefined {
  if (value === undefined && !required) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 10_000 ||
    Object.values(value).some((item) => typeof item !== "boolean")
  ) {
    throw new Error("関連ソースの選択が不正です。");
  }
  return { ...(value as Record<string, boolean>) };
}
