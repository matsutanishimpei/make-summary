/**
 * @feature-context
 * @feature bundle generation, code packing, partial source inclusion
 * @role 優先順位と主groupを保ちながら、実コードを連続行範囲へ分割しgroup間の空きも使って成果物容量を最大限使う
 * @entry packCode
 * @flow collected files -> group queues -> primary group + cross-group fill -> largest fitting line ranges -> artifacts and manifest ranges
 * @related source-markdown.ts, package-bundle.ts, ../types.ts
 * @caution 元コードを要約・改変せず、同一ファイルの断片は先頭から順番に収録する
 */

import type { BundledSource, CollectedFile } from "../types.js";
import type { ArtifactContent } from "./model.js";
import { renderCodeBlock } from "./source-markdown.js";

export interface CodePackingResult {
  artifacts: ArtifactContent[];
  bundled: BundledSource[];
}

interface PendingFile {
  file: CollectedFile;
  nextLine: number;
}

interface PackedRange {
  file: CollectedFile;
  lineStart: number;
  lineEnd: number;
  block: string;
}

export function packCode(
  files: CollectedFile[],
  maxArtifacts: number,
  maxFileChars: number,
  maxTotalCodeChars: number
): CodePackingResult {
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
      bucket
        .filter((file) => file.lineCount > 0)
        .map((file): PendingFile => ({ file, nextLine: 1 }))
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
      const accepted: PackedRange[] = [];
      const fillOrder = [
        group,
        ...assignedGroups.filter((candidateGroup) => candidateGroup !== group)
      ];
      for (const fillGroup of fillOrder) {
        const fillQueue = pending.get(fillGroup);
        if (!fillQueue?.length) continue;
        const remaining: PendingFile[] = [];
        for (const candidate of fillQueue) {
          const packed = largestFittingRange(candidate, artifactLimit - content.length);
          if (!packed) {
            remaining.push(candidate);
            continue;
          }

          content += packed.block;
          accepted.push(packed);
          if (packed.lineEnd < candidate.file.lineCount) {
            remaining.push({ ...candidate, nextLine: packed.lineEnd + 1 });
          }
        }
        pending.set(fillGroup, remaining);
      }
      if (!accepted.length) continue;

      const name = `${String(sequence++).padStart(2, "0")}-${uniqueArtifactName(group, artifacts)}.md`;
      total += content.length;
      artifacts.push({ name, content });
      createdInRound = true;
      for (const range of accepted) {
        bundled.push({
          path: range.file.record.normalizedPath!,
          artifact: name,
          lineStart: range.lineStart,
          lineEnd: range.lineEnd
        });
      }
    }
    if (!createdInRound) break;
  }
  return { artifacts, bundled };
}

function largestFittingRange(candidate: PendingFile, availableChars: number): PackedRange | null {
  if (availableChars <= 0) return null;

  const lineStart = candidate.nextLine;
  let low = lineStart;
  let high = candidate.file.lineCount;
  let best: PackedRange | null = null;
  while (low <= high) {
    const lineEnd = Math.floor((low + high) / 2);
    const block = renderCodeBlock(candidate.file, lineStart, lineEnd);
    if (block.length <= availableChars) {
      best = { file: candidate.file, lineStart, lineEnd, block };
      low = lineEnd + 1;
    } else {
      high = lineEnd - 1;
    }
  }
  return best;
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
