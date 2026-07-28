import { promises as fs } from "node:fs";
import { GitIgnoreResolver } from "../gitignore.js";
import { findSensitiveContent } from "../secrets.js";
import { readVerifiedProjectFile } from "../validate.js";
import type { CollectedFile, ValidationRecord } from "../types.js";

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
