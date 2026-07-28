/**
 * @feature-context
 * @feature feature discovery, symbol index, code structure
 * @role 複数言語のソース断片からclass・function・typeなどの宣言を軽量抽出する
 * @entry extractSymbols, detectLanguage
 * @flow source sample -> language detector -> declaration patterns -> indexed symbols
 * @related file-index.ts, types.ts
 * @caution 完全なparserではないため誤検出を許容し、順位付けの根拠の1つとしてだけ使う
 */

import path from "node:path";
import type {
  DiscoveryLanguage,
  IndexedSymbol,
  SymbolKind
} from "./types.js";

interface SymbolPattern {
  pattern: RegExp;
  kind: SymbolKind | ((match: RegExpMatchArray) => SymbolKind);
  nameGroup: number;
  exported?: (match: RegExpMatchArray) => boolean;
}

const extensionLanguages: Record<string, DiscoveryLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyw": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php"
};

const javascriptPatterns: SymbolPattern[] = [
  {
    pattern:
      /(?:^|\n)\s*((?:export\s+)?(?:default\s+)?)(?:declare\s+)?(?:async\s+)?(class|function|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    kind: (match) => declarationKind(match[2]),
    nameGroup: 3,
    exported: (match) => /\bexport\b/.test(match[1])
  }
];

const patterns: Partial<Record<DiscoveryLanguage, SymbolPattern[]>> = {
  typescript: javascriptPatterns,
  javascript: javascriptPatterns,
  python: [
    {
      pattern: /(?:^|\n)\s*(class|def|async\s+def)\s+([A-Za-z_][\w]*)/g,
      kind: (match) => (match[1] === "class" ? "class" : "function"),
      nameGroup: 2,
      exported: (match) => !match[2].startsWith("_")
    }
  ],
  go: [
    {
      pattern: /(?:^|\n)\s*func(?:\s+\([^)]*\))?\s+([A-Za-z_][\w]*)\s*\(/g,
      kind: "function",
      nameGroup: 1,
      exported: (match) => /^[A-Z]/.test(match[1])
    },
    {
      pattern: /(?:^|\n)\s*type\s+([A-Za-z_][\w]*)\s+(struct|interface)\b/g,
      kind: (match) => (match[2] === "interface" ? "interface" : "type"),
      nameGroup: 1,
      exported: (match) => /^[A-Z]/.test(match[1])
    }
  ],
  rust: [
    {
      pattern:
        /(?:^|\n)\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|type|mod|const)\s+([A-Za-z_][\w]*)/g,
      kind: (match) => rustKind(match[2]),
      nameGroup: 3,
      exported: (match) => Boolean(match[1])
    }
  ],
  java: [classLikePattern()],
  csharp: [classLikePattern()],
  ruby: [
    {
      pattern: /(?:^|\n)\s*(class|module|def)\s+(?:self\.)?([A-Za-z_][\w:!?=]*)/g,
      kind: (match) =>
        match[1] === "class" ? "class" : match[1] === "module" ? "module" : "function",
      nameGroup: 2,
      exported: () => true
    }
  ],
  php: [
    {
      pattern:
        /(?:^|\n)\s*(?:final\s+|abstract\s+)?(class|interface|trait|enum|function)\s+([A-Za-z_][\w]*)/g,
      kind: (match) => declarationKind(match[1]),
      nameGroup: 2,
      exported: () => true
    }
  ]
};

export function detectLanguage(relativePath: string): DiscoveryLanguage {
  return extensionLanguages[path.posix.extname(relativePath.toLowerCase())] ?? "other";
}

export function extractSymbols(
  source: string,
  language: DiscoveryLanguage
): IndexedSymbol[] {
  const result: IndexedSymbol[] = [];
  const seen = new Set<string>();
  for (const descriptor of patterns[language] ?? []) {
    for (const match of source.matchAll(descriptor.pattern)) {
      const name = match[descriptor.nameGroup];
      const kind =
        typeof descriptor.kind === "function" ? descriptor.kind(match) : descriptor.kind;
      const key = `${kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        name,
        kind,
        exported: descriptor.exported?.(match) ?? false,
        line: lineAt(source, match.index)
      });
    }
  }
  return result.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
}

function classLikePattern(): SymbolPattern {
  return {
    pattern:
      /(?:^|\n)\s*((?:(?:public|protected|private|internal|static|abstract|sealed|final)\s+)*)(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g,
    kind: (match) => declarationKind(match[2]),
    nameGroup: 3,
    exported: (match) => /\bpublic\b/.test(match[1])
  };
}

function declarationKind(value: string): SymbolKind {
  if (value.includes("function") || value === "def" || value === "fn") return "function";
  if (value === "const" || value === "let" || value === "var") return "variable";
  if (value === "struct" || value === "type") return "type";
  if (value === "mod" || value === "module") return "module";
  if (value === "trait") return "trait";
  if (value === "record") return "record";
  if (
    value === "class" ||
    value === "interface" ||
    value === "enum"
  ) {
    return value;
  }
  return "type";
}

function rustKind(value: string): SymbolKind {
  return declarationKind(value);
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}
