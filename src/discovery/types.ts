/**
 * @feature-context
 * @feature feature discovery, 構造化コメント, symbol index, import graph
 * @role ローカル機能探索で共有する索引・import関係・graph展開の契約を定義する
 * @entry StructuredFileComment, DiscoveryIndex, ImportGraph
 * @flow source files -> discovery index -> import graph -> ranker
 * @related structured-comments.ts, file-index.ts, imports.ts, import-graph.ts
 * @caution 永続化する場合はschema versionを追加して互換性を管理する
 */

export interface StructuredFileComment {
  features: string[];
  role: string;
  entryPoints: string[];
  flow: string[];
  related: string[];
  cautions: string[];
  unknownTags: string[];
  raw: string;
}

export interface StructuredCommentValidation {
  valid: boolean;
  issues: string[];
}

export type DiscoveryLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "ruby"
  | "php"
  | "other";

export type SymbolKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "module"
  | "trait"
  | "record";

export interface IndexedSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  line: number;
}

export interface IndexedComment {
  text: string;
  line: number;
  structured: boolean;
}

export interface DiscoveryFile {
  path: string;
  size: number;
  language: DiscoveryLanguage;
  sample: string;
  truncated: boolean;
  symbols: IndexedSymbol[];
  comments: IndexedComment[];
  imports: IndexedImport[];
  structuredComment: StructuredFileComment | null;
  searchText: string;
}

export interface DiscoveryIndex {
  projectRoot: string;
  files: DiscoveryFile[];
  scannedFiles: number;
  scannedBytes: number;
  warnings: string[];
}

export interface DiscoveryIndexLimits {
  maxFiles?: number;
  maxScanBytes?: number;
  maxFileBytes?: number;
}

export type ImportKind =
  | "static"
  | "re-export"
  | "dynamic"
  | "require"
  | "module";

export interface IndexedImport {
  specifier: string;
  kind: ImportKind;
  line: number;
}

export interface ImportEdge {
  from: string;
  to: string;
  specifier: string;
  kind: ImportKind;
  line: number;
}

export interface UnresolvedImport {
  from: string;
  specifier: string;
  line: number;
}

export interface ImportGraph {
  edges: ImportEdge[];
  unresolved: UnresolvedImport[];
}

export type ImportGraphDirection = "dependency" | "dependent";

export interface ImportGraphRelation {
  path: string;
  via: string;
  depth: number;
  direction: ImportGraphDirection;
  edge: ImportEdge;
}

export interface ImportGraphExpansionOptions {
  maxDepth?: number;
  directions?: ImportGraphDirection[];
}
