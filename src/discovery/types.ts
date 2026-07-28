/**
 * @feature-context
 * @feature feature discovery, 構造化コメント, symbol index, import graph, multilingual embedding, explainable ranking
 * @role ローカル機能探索で共有する索引・graph・query・Embedding・順位付け結果の契約を定義する
 * @entry StructuredFileComment, DiscoveryIndex, ImportGraph, EmbeddingProvider, DiscoveryRanking
 * @flow source files -> discovery index -> embedding + import graph -> explainable ranker
 * @related structured-comments.ts, file-index.ts, import-graph.ts, query.ts, embedding.ts, ranker.ts
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

export type QueryTermOrigin = "original" | "related";

export interface DiscoveryQueryTerm {
  value: string;
  origin: QueryTermOrigin;
  weight: number;
  concept?: string;
}

export interface DiscoveryQuery {
  raw: string;
  terms: DiscoveryQueryTerm[];
  concepts: string[];
}

export type RankingEvidenceKind =
  | "structured-feature"
  | "role"
  | "entry"
  | "path"
  | "symbol"
  | "comment"
  | "import"
  | "content"
  | "semantic"
  | "source-layout"
  | "small-file"
  | "test-file"
  | "graph-dependency"
  | "graph-dependent";

export interface RankingEvidence {
  kind: RankingEvidenceKind;
  score: number;
  detail: string;
  terms?: string[];
  via?: string;
  depth?: number;
}

export type DiscoveryRelation = "direct" | "dependency" | "dependent" | "fallback";

export interface RankedDiscoveryFile {
  path: string;
  score: number;
  relation: DiscoveryRelation;
  direct: boolean;
  matchedTerms: string[];
  evidence: RankingEvidence[];
}

export interface DiscoveryRanking {
  query: DiscoveryQuery;
  files: RankedDiscoveryFile[];
  directMatchCount: number;
  graphMatchCount: number;
  embedding?: DiscoveryEmbeddingSummary;
  warnings: string[];
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface DiscoveryEmbeddingSummary {
  provider: string;
  dimensions: number;
  threshold: number;
  matchedFiles: number;
}

export interface DiscoveryRankingOptions {
  maxResults?: number;
  minScore?: number;
  graphDepth?: number;
  maxGraphSeeds?: number;
  embedding?: EmbeddingProvider | false;
  semanticWeight?: number;
  semanticThreshold?: number;
}

export interface DiscoverFeatureOptions {
  indexLimits?: DiscoveryIndexLimits;
  ranking?: DiscoveryRankingOptions;
}

export interface FeatureDiscoveryResult {
  index: DiscoveryIndex;
  graph: ImportGraph;
  ranking: DiscoveryRanking;
}
