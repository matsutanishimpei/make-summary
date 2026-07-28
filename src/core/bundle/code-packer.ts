import type { BundledSource, CollectedFile } from "../types.js";
import type { ArtifactContent } from "./model.js";
import { renderCodeBlock } from "./source-markdown.js";

export interface CodePackingResult {
  artifacts: ArtifactContent[];
  bundled: BundledSource[];
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
        if (header.length + candidate.block.length > maxFileChars) continue;
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
