import path from "node:path";
import type { CollectedFile } from "../types.js";

export function renderCodeBlock(file: CollectedFile): string {
  const language = markdownLanguage(file.record.normalizedPath!);
  const maxTicks = Math.max(3, ...[...file.content.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = "`".repeat(maxTicks);
  const suffix = file.content.endsWith("\n") ? "" : "\n";
  return `## ${file.record.normalizedPath}\n\n- 役割: ${file.record.role}\n- 選定理由: ${file.record.reason}\n- 行範囲: 1-${file.lineCount}\n\n${fence}${language}\n${file.content}${suffix}${fence}\n\n`;
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
