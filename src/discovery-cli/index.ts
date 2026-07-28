#!/usr/bin/env node
/**
 * @feature-context
 * @feature feature discovery CLI, local context selection, explainable ranking
 * @role ローカル探索coreをスクリプトやデバッグから利用する薄いCLIを提供する
 * @entry feature-discovery command, runFeatureDiscoveryCli
 * @flow command arguments -> discoverFeature -> text or JSON result
 * @related ../discovery/discover.ts, ../discovery/types.ts
 * @caution ソース本文や秘密情報を標準出力へ出さず、成果物も書き込まない
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Command,
  CommanderError,
  InvalidArgumentError
} from "commander";
import { discoverFeature } from "../discovery/discover.js";
import type {
  DiscoverFeatureOptions,
  FeatureDiscoveryResult,
  RankedDiscoveryFile
} from "../discovery/types.js";

interface DiscoveryCliOptions {
  root: string;
  max: number;
  depth: number;
  minScore: number;
  format: "text" | "json";
  explain: boolean;
  maxFiles: number;
  maxScanBytes: number;
  maxFileBytes: number;
}

export interface DiscoveryCliDependencies {
  discover?: typeof discoverFeature;
  cwd?: () => string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  signal?: AbortSignal;
}

interface DiscoveryCliJsonResult {
  schemaVersion: "1.0";
  feature: string;
  projectRoot: string;
  index: {
    indexedFiles: number;
    scannedFiles: number;
    scannedBytes: number;
  };
  query: FeatureDiscoveryResult["ranking"]["query"];
  results: RankedDiscoveryFile[];
  unresolvedImports: FeatureDiscoveryResult["graph"]["unresolved"];
  warnings: string[];
}

export async function runFeatureDiscoveryCli(
  argv: string[],
  dependencies: DiscoveryCliDependencies = {}
): Promise<number> {
  const writeOut = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const writeError = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const cwd = dependencies.cwd?.() ?? process.cwd();
  const discover = dependencies.discover ?? discoverFeature;
  let exitCode = 0;

  const program = createProgram(writeOut, writeError);
  program.action(async (feature: string, commandOptions: DiscoveryCliOptions) => {
    const root = path.resolve(cwd, commandOptions.root);
    const options: DiscoverFeatureOptions = {
      indexLimits: {
        maxFiles: commandOptions.maxFiles,
        maxScanBytes: commandOptions.maxScanBytes,
        maxFileBytes: commandOptions.maxFileBytes
      },
      ranking: {
        maxResults: commandOptions.max,
        minScore: commandOptions.minScore,
        graphDepth: commandOptions.depth
      }
    };

    try {
      const result = await discover(root, feature, options, dependencies.signal);
      if (commandOptions.format === "json") {
        writeOut(`${JSON.stringify(toJsonResult(feature, result), null, 2)}\n`);
      } else {
        writeOut(formatTextResult(feature, result, commandOptions.explain));
      }
    } catch (error) {
      exitCode = 1;
      writeError(`探索に失敗しました: ${errorMessage(error)}\n`);
    }
  });

  try {
    await program.parseAsync(["node", "feature-discovery", ...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    writeError(`引数を処理できませんでした: ${errorMessage(error)}\n`);
    return 1;
  }

  return exitCode;
}

function createProgram(
  writeOut: (text: string) => void,
  writeError: (text: string) => void
): Command {
  return new Command()
    .name("feature-discovery")
    .description("AIへ送信せず、ローカルで機能関連ファイルを順位付けします")
    .argument("<feature>", "調べたい機能・目的")
    .option("--root <path>", "プロジェクトルート", ".")
    .option("--max <n>", "表示する最大ファイル数", parsePositiveInteger, 50)
    .option("--depth <n>", "importグラフをたどる深さ（0～5）", parseDepth, 2)
    .option("--min-score <n>", "表示する最低スコア", parseNonNegativeInteger, 0)
    .option("--format <format>", "出力形式（text または json）", parseFormat, "text")
    .option("--explain", "text出力に根拠の詳細を表示する", false)
    .option("--max-files <n>", "走査する最大ファイル数", parsePositiveInteger, 25_000)
    .option(
      "--max-scan-bytes <n>",
      "走査する合計バイト数の上限",
      parsePositiveInteger,
      256 * 1024 * 1024
    )
    .option(
      "--max-file-bytes <n>",
      "索引へ読む1ファイルのバイト数上限",
      parsePositiveInteger,
      256 * 1024
    )
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut,
      writeErr: writeError
    });
}

function parsePositiveInteger(value: string): number {
  const parsed = parseInteger(value);
  if (parsed < 1) {
    throw new InvalidArgumentError("1以上の整数を指定してください");
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = parseInteger(value);
  if (parsed < 0) {
    throw new InvalidArgumentError("0以上の整数を指定してください");
  }
  return parsed;
}

function parseDepth(value: string): number {
  const parsed = parseNonNegativeInteger(value);
  if (parsed > 5) {
    throw new InvalidArgumentError("0～5の整数を指定してください");
  }
  return parsed;
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("整数を指定してください");
  }
  return parsed;
}

function parseFormat(value: string): "text" | "json" {
  if (value !== "text" && value !== "json") {
    throw new InvalidArgumentError("text または json を指定してください");
  }
  return value;
}

function toJsonResult(
  feature: string,
  result: FeatureDiscoveryResult
): DiscoveryCliJsonResult {
  return {
    schemaVersion: "1.0",
    feature,
    projectRoot: result.index.projectRoot,
    index: {
      indexedFiles: result.index.files.length,
      scannedFiles: result.index.scannedFiles,
      scannedBytes: result.index.scannedBytes
    },
    query: result.ranking.query,
    results: result.ranking.files,
    unresolvedImports: result.graph.unresolved,
    warnings: [...result.index.warnings, ...result.ranking.warnings]
  };
}

function formatTextResult(
  feature: string,
  result: FeatureDiscoveryResult,
  explain: boolean
): string {
  const lines = [
    `機能: ${feature}`,
    `プロジェクト: ${result.index.projectRoot}`,
    `索引: ${result.index.files.length}ファイル（走査 ${result.index.scannedFiles}件）`,
    ""
  ];

  if (result.ranking.files.length === 0) {
    lines.push("条件に一致するファイルはありませんでした。");
  }

  result.ranking.files.forEach((file, index) => {
    lines.push(
      `${String(index + 1).padStart(2, " ")}. [${file.score}] ${file.path} (${file.relation})`
    );
    if (explain) {
      for (const evidence of file.evidence) {
        lines.push(`    - ${evidence.kind}: ${evidence.score >= 0 ? "+" : ""}${evidence.score} ${evidence.detail}`);
      }
    }
  });

  const warnings = [...result.index.warnings, ...result.ranking.warnings];
  if (warnings.length > 0) {
    lines.push("", "警告:");
    warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const exitCode = await runFeatureDiscoveryCli(process.argv.slice(2), {
    signal: controller.signal
  });
  process.exitCode = exitCode;
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === path.resolve(fileURLToPath(import.meta.url))) {
  void main();
}
