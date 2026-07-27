import { promises as fs } from "node:fs";
import path from "node:path";
import createIgnore from "ignore";
import { FeatureContextError } from "./errors.js";
import type { GeminiFile, ValidationRecord } from "./types.js";

const blockedDirectories = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const blockedExactNames = new Set([".env", "id_rsa", "id_ed25519"]);
const blockedExtensions = new Set([".pem", ".key", ".p12", ".pfx"]);

export interface ValidationOutcome {
  records: ValidationRecord[];
  warnings: string[];
}

export async function validateRelatedFiles(
  projectRoot: string,
  files: GeminiFile[],
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

  const matcher = createIgnore();
  try {
    matcher.add(await fs.readFile(path.join(rootReal, ".gitignore"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new FeatureContextError("READ_DENIED", undefined, String(error));
    }
  }

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
    const basename = segments.at(-1)!.toLowerCase();
    if (
      segments.some((segment) => blockedDirectories.has(segment.toLowerCase())) ||
      blockedExactNames.has(basename) ||
      basename.startsWith(".env.") ||
      blockedExtensions.has(path.posix.extname(basename))
    ) {
      exclude("秘密情報または生成物の除外ルールに一致");
      continue;
    }
    if (matcher.ignores(normalized)) {
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
        if (isBinary(sample)) {
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

function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}
