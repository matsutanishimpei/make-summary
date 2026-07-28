/**
 * @feature-context
 * @feature feature discovery, symbol index, comment index, safe local scan
 * @role プロジェクトを安全に走査し、構造化コメント・通常コメント・シンボルのローカル索引を作る
 * @entry buildDiscoveryIndex
 * @flow project root -> exclusions and gitignore -> safe sample -> symbol/comment index
 * @related symbols.ts, comments.ts, structured-comments.ts, validate.ts
 * @caution 索引は候補発見用であり、送信・収集前の完全な再検証を置き換えない
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { GitIgnoreResolver } from "../core/gitignore.js";
import { findSensitiveContent } from "../core/secrets.js";
import {
  isBinaryBuffer,
  matchesBuiltInExclusion,
  readVerifiedProjectFile
} from "../core/validate.js";
import { extractComments } from "./comments.js";
import { parseStructuredFileComment } from "./structured-comments.js";
import { detectLanguage, extractSymbols } from "./symbols.js";
import type {
  DiscoveryFile,
  DiscoveryIndex,
  DiscoveryIndexLimits
} from "./types.js";

export const DEFAULT_DISCOVERY_MAX_FILES = 25_000;
export const DEFAULT_DISCOVERY_MAX_SCAN_BYTES = 256 * 1024 * 1024;
export const DEFAULT_DISCOVERY_MAX_FILE_BYTES = 256 * 1024;
const MIN_SAMPLE_BYTES = 8_192;

export async function buildDiscoveryIndex(
  projectRoot: string,
  limits: DiscoveryIndexLimits = {},
  signal?: AbortSignal
): Promise<DiscoveryIndex> {
  const root = await fs.realpath(projectRoot);
  const maxFiles = limits.maxFiles ?? DEFAULT_DISCOVERY_MAX_FILES;
  const maxScanBytes = limits.maxScanBytes ?? DEFAULT_DISCOVERY_MAX_SCAN_BYTES;
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_DISCOVERY_MAX_FILE_BYTES;
  validateLimits(maxFiles, maxScanBytes, maxFileBytes);

  const ignoreResolver = new GitIgnoreResolver(root);
  const files: DiscoveryFile[] = [];
  const warnings: string[] = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  let stopped = false;

  const stop = (message: string) => {
    if (!stopped) warnings.push(message);
    stopped = true;
  };

  async function visit(directory: string, relativeDirectory = ""): Promise<void> {
    throwIfAborted(signal);
    if (stopped) return;
    let children: import("node:fs").Dirent[];
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`${relativeDirectory || "."}: 索引作成中に読み取れませんでした (${detail(error)})`);
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      throwIfAborted(signal);
      if (stopped) break;
      const relative = (relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name
      ).replaceAll("\\", "/");
      if (matchesBuiltInExclusion(relative)) continue;
      if (await ignoreResolver.isIgnored(relative, child.isDirectory())) continue;
      if (child.isSymbolicLink()) {
        warnings.push(`${relative}: シンボリックリンクのためローカル索引から除外`);
        continue;
      }
      const absolute = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolute, relative);
        continue;
      }
      if (!child.isFile()) continue;
      if (scannedFiles >= maxFiles) {
        stop(`ローカル索引の走査ファイル数が上限${maxFiles}件に達したため、残りを省略`);
        break;
      }
      try {
        const stat = await fs.stat(absolute);
        const plannedBytes = Math.min(stat.size, maxFileBytes);
        if (scannedBytes + plannedBytes > maxScanBytes) {
          stop(`ローカル索引の読み取り量が上限${formatBytes(maxScanBytes)}に達したため、残りを省略`);
          break;
        }
        scannedFiles += 1;
        const buffer = await readVerifiedProjectFile(root, relative, plannedBytes);
        scannedBytes += buffer.length;
        if (isBinaryBuffer(buffer)) continue;
        const sample = new TextDecoder("utf-8", { fatal: true })
          .decode(buffer)
          .replace(/\r\n?/g, "\n");
        const sensitive = findSensitiveContent(sample);
        if (sensitive) {
          warnings.push(`${relative}: ${sensitive.kind}を検出したためローカル索引から除外`);
          continue;
        }
        const language = detectLanguage(relative);
        const structuredComment = parseStructuredFileComment(sample);
        const comments = extractComments(sample);
        const symbols = extractSymbols(sample, language);
        files.push({
          path: relative,
          size: stat.size,
          language,
          sample,
          truncated: stat.size > buffer.length,
          symbols,
          comments,
          structuredComment,
          searchText: createSearchText(relative, structuredComment, symbols, comments)
        });
      } catch (error) {
        warnings.push(`${relative}: ローカル索引作成中に読み取れませんでした (${detail(error)})`);
      }
    }
  }

  await visit(root);
  return {
    projectRoot: root,
    files: files.sort((left, right) => left.path.localeCompare(right.path, "en")),
    scannedFiles,
    scannedBytes,
    warnings
  };
}

function createSearchText(
  relativePath: string,
  structured: ReturnType<typeof parseStructuredFileComment>,
  symbols: ReturnType<typeof extractSymbols>,
  comments: ReturnType<typeof extractComments>
): string {
  return [
    relativePath,
    ...(structured?.features ?? []),
    structured?.role ?? "",
    ...(structured?.entryPoints ?? []),
    ...(structured?.flow ?? []),
    ...(structured?.related ?? []),
    ...symbols.flatMap((symbol) => [symbol.name, symbol.kind]),
    ...comments.map((comment) => comment.text)
  ]
    .filter(Boolean)
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase();
}

function validateLimits(maxFiles: number, maxScanBytes: number, maxFileBytes: number): void {
  if (
    !Number.isInteger(maxFiles) ||
    maxFiles < 1 ||
    !Number.isInteger(maxScanBytes) ||
    maxScanBytes < MIN_SAMPLE_BYTES ||
    !Number.isInteger(maxFileBytes) ||
    maxFileBytes < MIN_SAMPLE_BYTES
  ) {
    throw new Error("ローカル索引の走査上限が不正です。");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("ローカル索引の作成をキャンセルしました。");
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}
