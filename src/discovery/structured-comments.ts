/**
 * @feature-context
 * @feature feature discovery, 構造化コメント, file annotation
 * @role 言語ごとの先頭コメントから検索可能な機能メタデータを決定的に抽出する
 * @entry parseStructuredFileComment, validateStructuredFileComment
 * @flow source text -> comment block detection -> tag parsing -> normalized metadata
 * @related types.ts, structured-file-comments.md
 * @caution コメントは信頼できない入力として扱い、実コードやパス検証より優先しない
 */

import type {
  StructuredCommentValidation,
  StructuredFileComment
} from "./types.js";

export const STRUCTURED_COMMENT_MARKER = "@feature-context";
export const STRUCTURED_COMMENT_MAX_SCAN_CHARS = 16_384;

const knownTags = new Set([
  "feature-context",
  "feature",
  "role",
  "entry",
  "flow",
  "related",
  "caution"
]);

export function parseStructuredFileComment(source: string): StructuredFileComment | null {
  const block = findMarkedComment(source.slice(0, STRUCTURED_COMMENT_MAX_SCAN_CHARS));
  if (!block) return null;

  const values = new Map<string, string[]>();
  const unknownTags: string[] = [];
  for (const line of cleanCommentLines(block)) {
    const match = line.match(/^@([a-z][a-z-]*)(?:\s+(.+?))?\s*$/i);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    const value = match[2]?.trim() ?? "";
    if (!knownTags.has(tag)) {
      unknownTags.push(tag);
      continue;
    }
    if (tag === "feature-context" || !value) continue;
    const existing = values.get(tag) ?? [];
    existing.push(value);
    values.set(tag, existing);
  }

  return {
    features: normalizeList(values.get("feature")),
    role: normalizeText(values.get("role")?.[0] ?? ""),
    entryPoints: normalizeList(values.get("entry")),
    flow: normalizeRepeatedText(values.get("flow")),
    related: normalizeList(values.get("related")),
    cautions: normalizeRepeatedText(values.get("caution")),
    unknownTags: [...new Set(unknownTags)].sort(),
    raw: block
  };
}

export function validateStructuredFileComment(
  comment: StructuredFileComment | null
): StructuredCommentValidation {
  const issues: string[] = [];
  if (!comment) {
    return {
      valid: false,
      issues: [`${STRUCTURED_COMMENT_MARKER}を含むファイルコメントがありません。`]
    };
  }
  if (comment.features.length === 0) issues.push("@featureを1件以上指定してください。");
  if (!comment.role) issues.push("@roleを指定してください。");
  if (comment.unknownTags.length > 0) {
    issues.push(`未対応のタグがあります: ${comment.unknownTags.join(", ")}`);
  }
  return { valid: issues.length === 0, issues };
}

function findMarkedComment(source: string): string | null {
  const candidates: Array<{ index: number; text: string }> = [];
  collectMatches(candidates, source, /\/\*[\s\S]*?\*\//g);
  collectMatches(candidates, source, /<!--[\s\S]*?-->/g);
  collectMatches(candidates, source, /(?:'''|""")[\s\S]*?(?:'''|""")/g);
  collectMatches(
    candidates,
    source,
    /(?:^[\t ]*(?:(?:\/\/)|#|--)[^\r\n]*(?:\r?\n|$))+/gm
  );
  return (
    candidates
      .filter((candidate) => candidate.text.toLowerCase().includes(STRUCTURED_COMMENT_MARKER))
      .sort((left, right) => left.index - right.index)[0]?.text ?? null
  );
}

function collectMatches(
  target: Array<{ index: number; text: string }>,
  source: string,
  pattern: RegExp
): void {
  for (const match of source.matchAll(pattern)) {
    target.push({ index: match.index, text: match[0] });
  }
}

function cleanCommentLines(block: string): string[] {
  return block
    .replace(/^\/\*+|^<!--|^(?:'''|""")/, "")
    .replace(/\*\/$|-->$|(?:'''|""")$/, "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[\t ]*(?:\*|\/\/|#|--)?[\t ]?/, "")
        .trim()
    );
}

function normalizeList(lines: string[] | undefined): string[] {
  return unique(
    (lines ?? [])
      .flatMap((line) => line.split(/\s*(?:,|、|\|)\s*/))
      .map(normalizeText)
      .filter(Boolean)
  );
}

function normalizeRepeatedText(lines: string[] | undefined): string[] {
  return unique((lines ?? []).map(normalizeText).filter(Boolean));
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
