/**
 * @feature-context
 * @feature feature discovery, import graph, dependency extraction
 * @role 複数言語のsource sampleからimport・require・module参照を軽量抽出する
 * @entry extractImports
 * @flow source sample -> language patterns -> normalized import references
 * @related import-graph.ts, file-index.ts, types.ts
 * @caution parserではないため文字列内の誤検出を許容し、解決できたproject内pathだけをgraph化する
 */

import type {
  DiscoveryLanguage,
  ImportKind,
  IndexedImport
} from "./types.js";

interface ImportPattern {
  pattern: RegExp;
  specifierGroup: number;
  kind: ImportKind;
}

const patterns: Partial<Record<DiscoveryLanguage, ImportPattern[]>> = {
  typescript: javascriptPatterns(),
  javascript: javascriptPatterns(),
  python: [
    {
      pattern: /(?:^|\n)\s*from\s+([.\w]+)\s+import\s+/g,
      specifierGroup: 1,
      kind: "static"
    },
    {
      pattern: /(?:^|\n)\s*import\s+([A-Za-z_][\w.]*)/g,
      specifierGroup: 1,
      kind: "static"
    }
  ],
  go: [
    {
      pattern: /(?:^|\n)\s*import\s+(?:[A-Za-z_][\w]*\s+)?["`]([^"`]+)["`]/g,
      specifierGroup: 1,
      kind: "static"
    },
    {
      pattern: /(?:^|\n)\s*(?:[A-Za-z_][\w]*\s+)?["`]([^"`]+)["`]/g,
      specifierGroup: 1,
      kind: "static"
    }
  ],
  rust: [
    {
      pattern: /(?:^|\n)\s*(?:pub\s+)?mod\s+([A-Za-z_][\w]*)\s*;/g,
      specifierGroup: 1,
      kind: "module"
    },
    {
      pattern: /(?:^|\n)\s*use\s+((?:crate|self|super)::[A-Za-z_][\w:]*)/g,
      specifierGroup: 1,
      kind: "static"
    }
  ],
  java: [
    {
      pattern: /(?:^|\n)\s*import\s+(?:static\s+)?([A-Za-z_$][\w$.*]*)\s*;/g,
      specifierGroup: 1,
      kind: "static"
    }
  ],
  csharp: [
    {
      pattern: /(?:^|\n)\s*using\s+(?:[A-Za-z_][\w]*\s*=\s*)?([A-Za-z_][\w.]*)\s*;/g,
      specifierGroup: 1,
      kind: "static"
    }
  ],
  ruby: [
    {
      pattern: /(?:^|\n)\s*require_relative\s+["']([^"']+)["']/g,
      specifierGroup: 1,
      kind: "require"
    }
  ],
  php: [
    {
      pattern: /(?:^|\n)\s*(?:require|require_once|include|include_once)\s*\(?\s*["']([^"']+)["']/g,
      specifierGroup: 1,
      kind: "require"
    },
    {
      pattern: /(?:^|\n)\s*use\s+([A-Za-z_\\][\w\\]*)\s*;/g,
      specifierGroup: 1,
      kind: "static"
    }
  ]
};

export function extractImports(
  source: string,
  language: DiscoveryLanguage
): IndexedImport[] {
  const imports: IndexedImport[] = [];
  const seen = new Set<string>();
  for (const descriptor of patterns[language] ?? []) {
    for (const match of source.matchAll(descriptor.pattern)) {
      const specifier = match[descriptor.specifierGroup]?.trim();
      if (!specifier) continue;
      const key = `${descriptor.kind}:${specifier}:${lineAt(source, match.index)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imports.push({
        specifier,
        kind: descriptor.kind,
        line: lineAt(source, match.index)
      });
    }
  }
  return imports.sort(
    (left, right) =>
      left.line - right.line ||
      left.specifier.localeCompare(right.specifier, "en") ||
      left.kind.localeCompare(right.kind)
  );
}

function javascriptPatterns(): ImportPattern[] {
  return [
    {
      pattern: /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
      specifierGroup: 1,
      kind: "static"
    },
    {
      pattern: /(?:^|\n)\s*export\s+(?:type\s+)?(?:\*|{[\s\S]*?})\s+from\s+["']([^"']+)["']/g,
      specifierGroup: 1,
      kind: "re-export"
    },
    {
      pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      specifierGroup: 1,
      kind: "dynamic"
    },
    {
      pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      specifierGroup: 1,
      kind: "require"
    }
  ];
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}
