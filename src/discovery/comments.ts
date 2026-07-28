/**
 * @feature-context
 * @feature feature discovery, comment index, docstring
 * @role 複数言語の通常コメントとdocstringを検索用の短いcomment recordへ変換する
 * @entry extractComments
 * @flow source sample -> comment detection -> delimiter cleanup -> indexed comments
 * @related structured-comments.ts, file-index.ts
 * @caution URLやコードをcommentとして誤検出し得るため順位付けでは補助信号として扱う
 */

import { STRUCTURED_COMMENT_MARKER } from "./structured-comments.js";
import type { IndexedComment } from "./types.js";

const commentPattern =
  /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?:'''|""")[\s\S]*?(?:'''|""")|(?:^[\t ]*(?:(?:\/\/)|#|--)[^\r\n]*(?:\r?\n|$))+/gm;
const MAX_COMMENT_CHARS = 4_000;

export function extractComments(source: string): IndexedComment[] {
  const result: IndexedComment[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(commentPattern)) {
    const text = cleanComment(match[0]);
    if (!text) continue;
    const clipped = text.slice(0, MAX_COMMENT_CHARS);
    const key = clipped.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      text: clipped,
      line: lineAt(source, match.index),
      structured: clipped.toLowerCase().includes(STRUCTURED_COMMENT_MARKER)
    });
  }
  return result;
}

function cleanComment(value: string): string {
  return value
    .replace(/^\/\*+|^<!--|^(?:'''|""")/, "")
    .replace(/\*\/$|-->$|(?:'''|""")$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\t ]*(?:\*|\/\/|#|--)?[\t ]?/, "").trim())
    .filter(Boolean)
    .join("\n")
    .normalize("NFKC")
    .trim();
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}
