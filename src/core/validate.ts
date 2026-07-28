/**
 * @feature-context
 * @feature safe file validation, feature discovery, secret exclusion
 * @role プロジェクト外参照・生成物・秘密情報path・binaryをcore境界で拒否する
 * @entry validateRelatedFiles, matchesBuiltInExclusion, readVerifiedProjectFile
 * @flow AI candidate or local index path -> normalize -> exclusion -> realpath verification
 * @related gitignore.ts, secrets.ts, discovery/file-index.ts
 * @caution .feature-contextを含む生成成果物は再調査・API送信対象へ戻さない
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { FeatureContextError } from "./errors.js";
import { GitIgnoreResolver } from "./gitignore.js";
import type { InvestigationFile, ValidationRecord } from "./types.js";

export const blockedDirectories = new Set([
  "node_modules",
  ".git",
  ".feature-context",
  "dist",
  "build",
  "coverage"
]);
export const blockedExactNames = new Set([".env", "id_rsa", "id_ed25519"]);
export const blockedExtensions = new Set([".pem", ".key", ".p12", ".pfx"]);

export interface ValidationOutcome {
  records: ValidationRecord[];
  warnings: string[];
}

export async function validateRelatedFiles(
  projectRoot: string,
  files: InvestigationFile[],
  selections: Record<string, boolean> = {}
): Promise<ValidationOutcome> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(projectRoot);
    if (!(await fs.stat(rootReal)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new FeatureContextError(
      code === "EACCES" || code === "EPERM" ? "READ_DENIED" : "ROOT_NOT_FOUND",
      undefined,
      error instanceof Error ? error.message : String(error)
    );
  }

  const ignoreResolver = new GitIgnoreResolver(rootReal);

  const seen = new Set<string>();
  const records: ValidationRecord[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const normalized = normalizeRelativePath(file.path);
    const selectionKey = normalized ?? file.path;
    const userSelected = Object.prototype.hasOwnProperty.call(selections, selectionKey)
      ? selections[selectionKey]
      : null;
    const base: ValidationRecord = {
      ...file,
      ...(normalized ? { normalizedPath: normalized } : {}),
      valid: false,
      included: false,
      userSelected
    };
    const exclude = (reason: string) => {
      const record = { ...base, exclusionReason: reason };
      records.push(record);
      warnings.push(`${file.path}: ${reason}`);
    };

    if (!normalized) {
      exclude("絶対パスまたはパストラバーサルを含むため除外");
      continue;
    }
    const dedupeKey = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(dedupeKey)) {
      exclude("重複パスのため除外");
      continue;
    }
    seen.add(dedupeKey);
    const segments = normalized.split("/");
    if (matchesBuiltInExclusion(normalized)) {
      exclude("秘密情報または生成物の除外ルールに一致");
      continue;
    }
    if (await ignoreResolver.isIgnored(normalized)) {
      exclude(".gitignoreの対象");
      continue;
    }

    const absolute = path.resolve(rootReal, ...segments);
    try {
      const real = await fs.realpath(absolute);
      if (!isInside(rootReal, real)) {
        exclude("シンボリックリンクの参照先がプロジェクト外");
        continue;
      }
      const stat = await fs.stat(real);
      if (!stat.isFile()) {
        exclude("通常ファイルではない");
        continue;
      }
      const handle = await fs.open(real, "r");
      try {
        const sample = Buffer.alloc(Math.min(8192, stat.size));
        await handle.read(sample, 0, sample.length, 0);
        if (isBinaryBuffer(sample)) {
          exclude("バイナリファイル");
          continue;
        }
      } finally {
        await handle.close();
      }
      records.push({
        ...base,
        normalizedPath: normalized,
        valid: true,
        included: userSelected ?? file.recommended,
        size: stat.size
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      exclude(
        code === "ENOENT"
          ? "ファイルが存在しない"
          : code === "EACCES" || code === "EPERM"
            ? "読み取り権限がない"
            : `読み取りに失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { records, warnings };
}

export function normalizeRelativePath(input: string): string | null {
  if (!input || input.includes("\0") || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) {
    return null;
  }
  const normalized = input.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/");
  if (!parts.length || parts.some((part) => !part || part === ".." || part === ".")) return null;
  return parts.join("/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function matchesBuiltInExclusion(relativePath: string): boolean {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  const basename = segments.at(-1)!.toLowerCase();
  return (
    segments.some((segment) => blockedDirectories.has(segment.toLowerCase())) ||
    blockedExactNames.has(basename) ||
    basename.startsWith(".env.") ||
    blockedExtensions.has(path.posix.extname(basename))
  );
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

export async function readVerifiedProjectFile(
  projectRoot: string,
  relativePath: string,
  maxBytes?: number
): Promise<Buffer> {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || matchesBuiltInExclusion(normalized)) {
    throw new Error("安全なプロジェクト相対パスではありません");
  }
  const rootReal = await fs.realpath(projectRoot);
  const absolute = path.resolve(rootReal, ...normalized.split("/"));
  const before = await fs.lstat(absolute);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error("通常ファイルではないか、シンボリックリンクです");
  }
  const real = await fs.realpath(absolute);
  if (!isInside(rootReal, real)) {
    throw new Error("ファイルの参照先がプロジェクト外です");
  }

  const handle = await fs.open(real, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error("通常ファイルではありません");
    if (
      before.dev !== 0 &&
      before.ino !== 0 &&
      (before.dev !== opened.dev || before.ino !== opened.ino)
    ) {
      throw new Error("検証後にファイルが差し替えられました");
    }
    if (maxBytes === undefined) return await handle.readFile();
    const size = Math.min(Math.max(0, maxBytes), opened.size);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
