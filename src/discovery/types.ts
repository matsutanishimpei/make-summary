/**
 * @feature-context
 * @feature feature discovery, 構造化コメント, symbol index
 * @role ローカル機能探索で共有するコメント・シンボル索引の契約を定義する
 * @entry StructuredFileComment, DiscoveryIndex
 * @flow source files -> discovery index -> graph and ranker
 * @related structured-comments.ts, file-index.ts
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
