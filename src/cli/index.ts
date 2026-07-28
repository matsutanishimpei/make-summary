#!/usr/bin/env node
import { Command, Option } from "commander";
import { FeatureContextError, FeatureContextService } from "../core/index.js";
import type { AiProvider } from "../core/index.js";
import { FEATURE_CONTEXT_DEFAULTS, PROVIDER_CATALOG } from "../core/index.js";

const program = new Command();
program
  .name("feature-context")
  .description("Gemini CLI、Gemini API、Codex CLIで指定機能に関連するコードコンテキストを生成します")
  .argument("<feature>", "調べたい機能・目的")
  .addOption(
    new Option("--provider <provider>", "調査に使うAI")
      .choices(PROVIDER_CATALOG.map((provider) => provider.id))
      .default(FEATURE_CONTEXT_DEFAULTS.provider)
  )
  .option("--gemini-model <model>", "Gemini APIのモデル")
  .option("--root <path>", "プロジェクトルート", ".")
  .option("--out <path>", "出力ベース（プロジェクト内）")
  .option("--name <name>", "成果物ディレクトリ名")
  .option("--summary", "機能要約を生成", false)
  .option("--concat", "関連コードを連結", false)
  .option(
    "--max-output-files <1-5>",
    "添付用Markdownの最大数",
    parseInteger,
    FEATURE_CONTEXT_DEFAULTS.maxOutputFiles
  )
  .option(
    "--max-total-chars <n>",
    "成果物全体の文字数上限",
    parseInteger,
    FEATURE_CONTEXT_DEFAULTS.maxTotalChars
  )
  .option("--dry-run", "ファイルを書き込まず調査・梱包を検証", false)
  .option("--verbose", "技術的な詳細を表示", false)
  .option("--force", "既存成果物の上書きを許可", false)
  .action(async (feature: string, flags) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      const service = new FeatureContextService();
      const result = await service.build(
        {
          projectRoot: flags.root,
          feature,
          provider: flags.provider as AiProvider,
          geminiApiModel: flags.geminiModel,
          outputDir: flags.out,
          name: flags.name,
          summary: flags.summary,
          concat: flags.concat,
          maxOutputFiles: flags.maxOutputFiles,
          maxTotalChars: flags.maxTotalChars,
          dryRun: flags.dryRun,
          verbose: flags.verbose,
          force: flags.force
        },
        (event) => process.stderr.write(`[${event.stage}] ${event.message}\n`),
        controller.signal
      );
      process.stdout.write(
        `${flags.dryRun ? "ドライラン完了" : "生成完了"}: ${result.outputDir}\n` +
          `関連ソース: ${result.manifest.validation.detected}件 / コード収録: ${result.manifest.bundledSources.length}件\n` +
          `添付用Markdown: ${result.manifest.bundleFiles.length}件 / 合計: ${result.manifest.totalChars.toLocaleString()}文字\n`
      );
    } catch (error) {
      const known = error instanceof FeatureContextError ? error : null;
      process.stderr.write(`${known?.message ?? String(error)}\n`);
      if (flags.verbose && known?.details) process.stderr.write(`\n${known.details}\n`);
      process.exitCode = known?.code === "CANCELLED" ? 130 : 1;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  });

program.parseAsync().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`整数を指定してください: ${value}`);
  return parsed;
}
