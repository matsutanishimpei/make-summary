import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildCodeTree } from "./tree.js";
import { FeatureContextError } from "./errors.js";
import { GitIgnoreResolver } from "./gitignore.js";
import { findSensitiveContent } from "./secrets.js";
import { readVerifiedProjectFile } from "./validate.js";
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
  const ignoreResolver = new GitIgnoreResolver(await fs.realpath(projectRoot));
  for (const record of records) {
    if (!record.valid || !record.included || !record.normalizedPath) continue;
    try {
      if (await ignoreResolver.isIgnored(record.normalizedPath)) {
        record.valid = false;
        record.included = false;
        record.exclusionReason = ".gitignoreの対象";
        warnings.push(`${record.normalizedPath}: コード収集直前の.gitignore検証で除外`);
        continue;
      }
      const raw = await readVerifiedProjectFile(projectRoot, record.normalizedPath);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(raw).replace(/\r\n?/g, "\n");
      const sensitive = findSensitiveContent(content);
      if (sensitive) {
        record.valid = false;
        record.included = false;
        record.exclusionReason = `${sensitive.kind}を検出`;
        warnings.push(`${record.normalizedPath}: ${sensitive.kind}を検出したため除外`);
        continue;
      }
      files.push({
        record,
        content,
        lineCount: content.length === 0 ? 0 : content.split("\n").length
      });
    } catch (error) {
      record.valid = false;
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
    await writeBundle(input.projectRoot, input.outputDir, contents, manifest, input.force);
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
  const mixedGroup = uniqueMixedGroup(groupOrder);
  const assignedGroups =
    groupOrder.length <= maxArtifacts
      ? groupOrder
      : maxArtifacts === 1
        ? ["code"]
        : [...groupOrder.slice(0, maxArtifacts - 1), mixedGroup];
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
  const pending = new Map(
    [...buckets].map(([group, bucket]) => [
      group,
      bucket.map((file) => ({ file, block: renderCodeBlock(file) }))
    ])
  );

  while (artifacts.length < maxArtifacts && total < maxTotalCodeChars) {
    let createdInRound = false;
    for (const group of assignedGroups) {
      if (artifacts.length >= maxArtifacts || total >= maxTotalCodeChars) break;
      const queue = pending.get(group);
      if (!queue?.length) continue;
      const header = `# 関連コード: ${group}\n\n`;
      const artifactLimit = Math.min(maxFileChars, maxTotalCodeChars - total);
      if (header.length >= artifactLimit) break;

      let content = header;
      const accepted: CollectedFile[] = [];
      const remaining: typeof queue = [];
      for (const candidate of queue) {
        if (header.length + candidate.block.length > maxFileChars) {
          continue;
        }
        if (content.length + candidate.block.length <= artifactLimit) {
          content += candidate.block;
          accepted.push(candidate.file);
        } else {
          remaining.push(candidate);
        }
      }
      pending.set(group, remaining);
      if (!accepted.length) continue;

      const name = `${String(sequence++).padStart(2, "0")}-${uniqueArtifactName(group, artifacts)}.md`;
      total += content.length;
      artifacts.push({ name, content });
      createdInRound = true;
      for (const file of accepted) {
        bundled.push({
          path: file.record.normalizedPath!,
          artifact: name,
          lineStart: 1,
          lineEnd: file.lineCount
        });
      }
    }
    if (!createdInRound) break;
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

function summaryLines(items: string[] | undefined, emptyMessage: string): string[] {
  return items?.length ? items.map((item) => `- ${item}`) : [`- ${emptyMessage}`];
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
  projectRoot: string,
  outputDir: string,
  contents: ArtifactContent[],
  manifest: Manifest,
  force: boolean
): Promise<void> {
  const resolvedOutput = path.resolve(outputDir);
  await assertSafeOutputLocation(projectRoot, resolvedOutput);
  const parentDir = path.dirname(resolvedOutput);
  await fs.mkdir(parentDir, { recursive: true });
  const existing = await existingDirectoryState(resolvedOutput);
  if (existing === "invalid") {
    throw new FeatureContextError("INVALID_OUTPUT", "出力先が通常のディレクトリではありません。");
  }
  if (existing === "nonempty" && !force) throw new FeatureContextError("OUTPUT_EXISTS");

  const unique = `${process.pid}-${randomUUID()}`;
  const baseName = path.basename(resolvedOutput);
  const stageDir = path.join(parentDir, `.${baseName}.stage-${unique}`);
  const backupDir = path.join(parentDir, `.${baseName}.backup-${unique}`);
  let previousMoved = false;
  let replacementInstalled = false;
  try {
    if (existing !== "missing" && force) {
      await fs.cp(resolvedOutput, stageDir, {
        recursive: true,
        dereference: false,
        errorOnExist: true
      });
    } else {
      await fs.mkdir(stageDir);
    }

    const stagedBundle = path.join(stageDir, "bundle");
    await prepareStagedBundle(stagedBundle);
    for (const item of contents) {
      await fs.writeFile(path.join(stagedBundle, item.name), item.content, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    await fs.writeFile(path.join(stageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (existing !== "missing") {
      await fs.rename(resolvedOutput, backupDir);
      previousMoved = true;
    }
    try {
      await fs.rename(stageDir, resolvedOutput);
      replacementInstalled = true;
    } catch (error) {
      if (previousMoved) {
        await fs.rename(backupDir, resolvedOutput);
        previousMoved = false;
      }
      throw error;
    }
    if (previousMoved) {
      await fs.rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      previousMoved = false;
    }
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => {});
    if (previousMoved && !replacementInstalled && !(await pathExists(resolvedOutput))) {
      try {
        await fs.rename(backupDir, resolvedOutput);
        previousMoved = false;
      } catch {
        // The original error below retains the write failure diagnostics.
      }
    }
    if (error instanceof FeatureContextError) throw error;
    throw new FeatureContextError(
      "INVALID_OUTPUT",
      "成果物を安全に書き込めませんでした。既存成果物は可能な限り保持されています。",
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
  }
}

async function prepareStagedBundle(bundleDir: string): Promise<void> {
  try {
    const stat = await fs.lstat(bundleDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      await fs.rm(bundleDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      await fs.mkdir(bundleDir, { recursive: true });
      return;
    }
    for (const entry of await fs.readdir(bundleDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".md") && (entry.isFile() || entry.isSymbolicLink())) {
        await fs.unlink(path.join(bundleDir, entry.name));
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(bundleDir, { recursive: true });
  }
}

async function assertSafeOutputLocation(projectRoot: string, outputDir: string): Promise<void> {
  const rootReal = await fs.realpath(projectRoot);
  if (!isSameOrInside(rootReal, outputDir) || path.resolve(rootReal) === path.resolve(outputDir)) {
    throw new FeatureContextError("INVALID_OUTPUT");
  }
  let cursor = outputDir;
  while (true) {
    try {
      const real = await fs.realpath(cursor);
      if (!isSameOrInside(rootReal, real)) throw new FeatureContextError("INVALID_OUTPUT");
      return;
    } catch (error) {
      if (error instanceof FeatureContextError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new FeatureContextError("INVALID_OUTPUT");
      cursor = parent;
    }
  }
}

async function existingDirectoryState(
  directory: string
): Promise<"missing" | "empty" | "nonempty" | "invalid"> {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return "invalid";
    return (await fs.readdir(directory)).length === 0 ? "empty" : "nonempty";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isSameOrInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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

function uniqueMixedGroup(groups: string[]): string {
  let candidate = "mixed";
  let suffix = 2;
  while (groups.includes(candidate)) candidate = `mixed-${suffix++}`;
  return candidate;
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
