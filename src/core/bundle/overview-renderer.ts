/**
 * @feature-context
 * @feature bundle overview, source coverage, manifest presentation
 * @role bundleの調査結果、関連tree、実コードの全文・部分収録状況を人向けMarkdownへ描画する
 * @entry renderOverview
 * @flow package input + bundled line ranges -> coverage labels -> overview markdown
 * @related package-bundle.ts, code-packer.ts, ../tree.ts
 * @caution 一部だけ収録したファイルを全文収録と表示しない
 */

import { getProviderDescriptor } from "../../contracts/providers.js";
import { buildCodeTree } from "../tree.js";
import type { BundledSource, OmittedSource } from "../types.js";
import type { PackageInput } from "./model.js";

export function renderOverview(
  input: PackageInput & {
    bundledSources: BundledSource[];
    omittedSources: OmittedSource[];
    generatedAt: string;
  }
): string {
  const bundled = new Set(input.bundledSources.map((item) => item.path));
  const coverage = sourceCoverage(input);
  const valid = input.records.filter((record) => record.valid && record.normalizedPath);
  const tree = buildCodeTree(
    valid.map((record) => ({
      path: record.normalizedPath!,
      omitted: !bundled.has(record.normalizedPath!)
    }))
  );
  const lines = [
    `# ${input.investigation.feature} — Feature Context`,
    "",
    `生成日時: ${input.generatedAt}`,
    `GitコミットID: ${input.gitCommitId ?? "取得できませんでした"}`,
    `調査AI: ${getProviderDescriptor(input.provider).label} (${input.cliVersion})`,
    "",
    "## 関連コードツリー",
    "",
    "```text",
    tree || "(有効な関連パスなし)",
    "```",
    "",
    "## 関連ファイル一覧",
    "",
    "| パス | 役割 | 選定理由 | 優先度 | グループ | コード収録 |",
    "|---|---|---|---|---|---|",
    ...input.records.map((record) => {
      const filePath = record.normalizedPath ?? record.path;
      return `| ${escapeCell(filePath)} | ${escapeCell(record.role)} | ${escapeCell(record.reason)} | ${record.priority} | ${escapeCell(record.group)} | ${coverage.get(filePath) ?? "未収録"} |`;
    }),
    "",
    "## 処理フロー",
    "",
    ...(input.investigation.flow.length
      ? input.investigation.flow.map((step, index) => `${index + 1}. ${step}`)
      : ["処理フローは検出されませんでした。"]),
    "",
    "## 収録されたファイル",
    "",
    ...(input.bundledSources.length
      ? input.bundledSources.map(
          (item) => `- \`${item.path}\` → \`${item.artifact}\`（${item.lineStart}-${item.lineEnd}行）`
        )
      : ["- コード連結なし"]),
    "",
    "## 収録されなかったファイル",
    "",
    ...(input.omittedSources.length
      ? input.omittedSources.map((item) => `- \`${item.path}\`: ${item.reason}`)
      : ["- なし"]),
    "",
    "## 警告",
    "",
    ...(input.warnings.length ? input.warnings.map((warning) => `- ${warning}`) : ["- なし"]),
    "",
    "## 不明点",
    "",
    ...(input.investigation.uncertainties.length
      ? input.investigation.uncertainties.map((item) => `- ${item}`)
      : ["- なし"])
  ];
  if (input.summary) {
    const details = input.investigation.summaryDetails;
    lines.push(
      "",
      "## 機能要約",
      "",
      input.investigation.overview || "AIから機能全体の要約は返されませんでした。",
      "",
      "### 主要コンポーネントとファイル別要約",
      "",
      ...valid.map(
        (record) =>
          `- \`${record.normalizedPath}\`: ${record.summary || record.role}（${record.reason}）`
      ),
      "",
      "### 主要コンポーネントの責務",
      "",
      ...summaryLines(details?.responsibilities, "AIから主要コンポーネントの責務は返されませんでした。"),
      "",
      "### 状態とデータの流れ",
      "",
      ...summaryLines(details?.stateAndDataFlow, "AIから状態とデータの流れは返されませんでした。"),
      "",
      "### API",
      "",
      ...summaryLines(details?.apis, "AIからAPI情報は返されませんでした。"),
      "",
      "### 外部依存",
      "",
      ...summaryLines(details?.externalDependencies, "AIから外部依存は返されませんでした。"),
      "",
      "### 修正時の注意点",
      "",
      ...summaryLines(details?.changeCautions, "AIから修正時の注意点は返されませんでした。")
    );
  }
  lines.push("");
  return lines.join("\n");
}

function sourceCoverage(input: PackageInput & { bundledSources: BundledSource[] }): Map<string, string> {
  const lineCounts = new Map(
    input.collected.map((file) => [file.record.normalizedPath!, file.lineCount])
  );
  const ranges = new Map<string, BundledSource[]>();
  for (const item of input.bundledSources) {
    const values = ranges.get(item.path) ?? [];
    values.push(item);
    ranges.set(item.path, values);
  }

  return new Map(
    [...ranges].map(([filePath, values]) => {
      const ordered = [...values].sort((left, right) => left.lineStart - right.lineStart);
      const lineCount = lineCounts.get(filePath);
      let nextLine = 1;
      const complete = lineCount !== undefined && ordered.every((range) => {
        if (range.lineStart !== nextLine) return false;
        nextLine = range.lineEnd + 1;
        return true;
      }) && nextLine > lineCount;
      return [filePath, complete ? "全文収録" : "一部収録"];
    })
  );
}

function summaryLines(items: string[] | undefined, emptyMessage: string): string[] {
  return items?.length ? items.map((item) => `- ${item}`) : [`- ${emptyMessage}`];
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
