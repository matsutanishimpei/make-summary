/**
 * @feature-context
 * @feature bundle generation, code excerpts, source markdown
 * @role 検証済みソースの全体または連続行範囲を、出典情報付きMarkdown code blockへ変換する
 * @entry renderCodeBlock
 * @flow collected file + line range -> exact source slice -> safe code fence
 * @related code-packer.ts, ../types.ts
 * @caution 本文は改変せず、指定範囲が元ファイルの実在行から外れないようにする
 */

import path from "node:path";
import type { CollectedFile } from "../types.js";

export function renderCodeBlock(
  file: CollectedFile,
  lineStart = 1,
  lineEnd = file.lineCount
): string {
  if (lineStart < 1 || lineEnd < lineStart || lineEnd > file.lineCount) {
    throw new RangeError(`コード範囲が不正です: ${lineStart}-${lineEnd}/${file.lineCount}`);
  }
  const content = file.content.split("\n").slice(lineStart - 1, lineEnd).join("\n");
  const language = markdownLanguage(file.record.normalizedPath!);
  const maxTicks = Math.max(3, ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = "`".repeat(maxTicks);
  const suffix = content.endsWith("\n") ? "" : "\n";
  return `## ${file.record.normalizedPath}\n\n- 役割: ${file.record.role}\n- 選定理由: ${file.record.reason}\n- 行範囲: ${lineStart}-${lineEnd}\n\n${fence}${language}\n${content}${suffix}${fence}\n\n`;
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
