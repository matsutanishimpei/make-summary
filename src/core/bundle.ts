import { promises as fs } from "node:fs";
import path from "node:path";
import { buildCodeTree } from "./tree.js";
import { FeatureContextError } from "./errors.js";
import type {
  BundleArtifact,
  BundledSource,
  CollectedFile,
  Investigation,
  Manifest,
  OmittedSource,
  ValidationRecord
} from "./types.js";

interface PackageInput {
  projectRoot: string;
  outputDir: string;
  investigation: Investigation;
  records: ValidationRecord[];
  collected: CollectedFile[];
  summary: boolean;
  concat: boolean;
  maxOutputFiles: number;
  maxTotalChars: number;
  maxFileChars: number;
  geminiApiModel?: string;
  provider: Manifest["provider"]["id"];
  cliVersion: string;
  gitCommitId: string | null;
  warnings: string[];
  dryRun: boolean;
  force: boolean;
}

interface ArtifactContent {
  name: string;
  content: string;
}

const priorityRank = { core: 0, supporting: 1, test: 2 } as const;

export async function collectSelectedFiles(
  projectRoot: string,
  records: ValidationRecord[]
): Promise<{ files: CollectedFile[]; warnings: string[] }> {
  const files: CollectedFile[] = [];
  const warnings: string[] = [];
  for (const record of records) {
    if (!record.valid || !record.included || !record.normalizedPath) continue;
    const absolute = path.join(projectRoot, ...record.normalizedPath.split("/"));
    try {
      const raw = await fs.readFile(absolute);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(raw).replace(/\r\n?/g, "\n");
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
        record.included = false;
        record.exclusionReason = "秘密鍵らしい内容を検出";
        warnings.push(`${record.normalizedPath}: 秘密鍵らしい内容を検出したため除外`);
        continue;
      }
      files.push({
        record,
        content,
        lineCount: content.length === 0 ? 0 : content.split("\n").length
      });
    } catch (error) {
      record.included = false;
      record.exclusionReason = "テキストとして読み取れない";
      warnings.push(
        `${record.normalizedPath}: コード収集時に読み取れませんでした (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
  return { files, warnings };
}

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
    await writeBundle(input.outputDir, contents, manifest, input.force);
  }
  return manifest;
}

function packCode(
  files: CollectedFile[],
  maxArtifacts: number,
  maxFileChars: number,
  maxTotalCodeChars: number
): { artifacts: ArtifactContent[]; bundled: BundledSource[] } {
  if (maxArtifacts <= 0 || maxTotalCodeChars <= 0) return { artifacts: [], bundled: [] };
  const groupOrder = [...new Set(files.map((file) => sanitizeGroup(file.record.group)))];
  const assignedGroups =
    groupOrder.length <= maxArtifacts
      ? groupOrder
      : maxArtifacts === 1
        ? ["code"]
        : [...groupOrder.slice(0, maxArtifacts - 1), "mixed"];
  const buckets = new Map<string, CollectedFile[]>();
  assignedGroups.forEach((group) => buckets.set(group, []));
  for (const file of files) {
    const group = sanitizeGroup(file.record.group);
    const bucket = buckets.has(group) ? group : assignedGroups.at(-1)!;
    buckets.get(bucket)!.push(file);
  }

  let total = 0;
  let sequence = 2;
  const artifacts: ArtifactContent[] = [];
  const bundled: BundledSource[] = [];
  for (const [group, bucket] of buckets) {
    if (!bucket.length) continue;
    let content = `# 関連コード: ${group}\n\n`;
    const accepted: CollectedFile[] = [];
    for (const file of bucket) {
      const block = renderCodeBlock(file);
      if (
        content.length + block.length > maxFileChars ||
        total + content.length + block.length > maxTotalCodeChars
      ) {
        continue;
      }
      content += block;
      accepted.push(file);
    }
    if (!accepted.length) continue;
    const name = `${String(sequence++).padStart(2, "0")}-${uniqueArtifactName(group, artifacts)}.md`;
    total += content.length;
    artifacts.push({ name, content });
    for (const file of accepted) {
      bundled.push({
        path: file.record.normalizedPath!,
        artifact: name,
        lineStart: 1,
        lineEnd: file.lineCount
      });
    }
  }
  return { artifacts, bundled };
}

function renderCodeBlock(file: CollectedFile): string {
  const language = markdownLanguage(file.record.normalizedPath!);
  const maxTicks = Math.max(3, ...[...file.content.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = "`".repeat(maxTicks);
  const suffix = file.content.endsWith("\n") ? "" : "\n";
  return `## ${file.record.normalizedPath}\n\n- 役割: ${file.record.role}\n- 選定理由: ${file.record.reason}\n- 行範囲: 1-${file.lineCount}\n\n${fence}${language}\n${file.content}${suffix}${fence}\n\n`;
}

function renderOverview(
  input: PackageInput & {
    bundledSources: BundledSource[];
    omittedSources: OmittedSource[];
    generatedAt: string;
  }
): string {
  const bundled = new Set(input.bundledSources.map((item) => item.path));
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
    `調査AI: ${providerName(input.provider)} (${input.cliVersion})`,
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
      return `| ${escapeCell(filePath)} | ${escapeCell(record.role)} | ${escapeCell(record.reason)} | ${record.priority} | ${escapeCell(record.group)} | ${bundled.has(filePath) ? "収録" : "未収録"} |`;
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
      "### 状態・データ・API・外部依存・修正時の注意",
      "",
      "上記の処理フロー、各ファイルの役割・選定理由、不明点を併せて参照してください。明示されていない依存関係は推測せず、実装を変更する前にコード上で再確認してください。"
    );
  }
  lines.push("");
  return lines.join("\n");
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

async function writeBundle(
  outputDir: string,
  contents: ArtifactContent[],
  manifest: Manifest,
  force: boolean
): Promise<void> {
  const bundleDir = path.join(outputDir, "bundle");
  try {
    await fs.access(path.join(outputDir, "manifest.json"));
    if (!force) throw new FeatureContextError("OUTPUT_EXISTS");
  } catch (error) {
    if (error instanceof FeatureContextError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(bundleDir, { recursive: true });
  if (force) {
    for (const entry of await fs.readdir(bundleDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        await fs.unlink(path.join(bundleDir, entry.name));
      }
    }
  }
  for (const item of contents) {
    await fs.writeFile(path.join(bundleDir, item.name), item.content, "utf8");
  }
  await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function providerName(provider: Manifest["provider"]["id"]): string {
  if (provider === "codex") return "Codex CLI";
  if (provider === "gemini-api") return "Gemini API";
  return "Gemini CLI";
}

function sanitizeGroup(group: string): string {
  const normalized = group.normalize("NFKC").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "code";
}

function uniqueArtifactName(group: string, artifacts: ArtifactContent[]): string {
  const existing = new Set(artifacts.map((item) => item.name.replace(/^\d+-/, "").replace(/\.md$/, "")));
  if (!existing.has(group)) return group;
  let suffix = 2;
  while (existing.has(`${group}-${suffix}`)) suffix += 1;
  return `${group}-${suffix}`;
}

function markdownLanguage(filePath: string): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  return (
    {
      ".ts": "typescript",
      ".tsx": "tsx",
      ".js": "javascript",
      ".jsx": "jsx",
      ".json": "json",
      ".css": "css",
      ".scss": "scss",
      ".html": "html",
      ".md": "markdown",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".kt": "kotlin",
      ".cs": "csharp",
      ".rb": "ruby",
      ".php": "php",
      ".sql": "sql",
      ".sh": "bash",
      ".ps1": "powershell",
      ".yml": "yaml",
      ".yaml": "yaml",
      ".xml": "xml",
      ".vue": "vue",
      ".svelte": "svelte"
    }[extension] ?? "text"
  );
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
