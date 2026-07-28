/**
 * @feature-context
 * @feature feature discovery, explainable ranking, multilingual embedding, context selection
 * @role path・comment・symbol・import・意味類似度・graphを根拠ごとの点数として合成し候補順を決める
 * @entry rankDiscoveryIndex
 * @flow query expansion + DiscoveryIndex + EmbeddingProvider + ImportGraph -> evidence -> stable ranking
 * @related query.ts, embedding.ts, import-graph.ts, types.ts
 * @caution 合計点だけでなく全evidenceを返し、人とtestが選定理由を検証できるようにする
 */

import path from "node:path";
import {
  cosineSimilarity,
  LocalMultilingualEmbedding
} from "./embedding.js";
import { expandImportGraph } from "./import-graph.js";
import {
  expandDiscoveryQuery,
  normalizeDiscoveryText
} from "./query.js";
import type {
  DiscoveryFile,
  DiscoveryEmbeddingSummary,
  DiscoveryIndex,
  DiscoveryQueryTerm,
  DiscoveryRanking,
  DiscoveryRankingOptions,
  ImportGraph,
  RankedDiscoveryFile,
  RankingEvidence,
  RankingEvidenceKind
} from "./types.js";

const directKinds = new Set<RankingEvidenceKind>([
  "structured-feature",
  "role",
  "entry",
  "path",
  "symbol",
  "comment",
  "import",
  "content",
  "semantic"
]);

const EMBEDDING_BATCH_SIZE = 128;

export async function rankDiscoveryIndex(
  index: DiscoveryIndex,
  graph: ImportGraph,
  rawQuery: string,
  options: DiscoveryRankingOptions = {},
  signal?: AbortSignal
): Promise<DiscoveryRanking> {
  const query = expandDiscoveryQuery(rawQuery);
  const base = index.files.map((file) => rankFile(file, query.terms));
  const warnings: string[] = [];
  let embedding: DiscoveryEmbeddingSummary | undefined;
  const embeddingProvider =
    options.embedding === false
      ? undefined
      : options.embedding ?? new LocalMultilingualEmbedding();
  if (embeddingProvider) {
    try {
      embedding = await addSemanticEvidence(
        base,
        index.files,
        rawQuery,
        embeddingProvider,
        options,
        signal
      );
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      warnings.push(
        `多言語Embeddingを適用できなかったため文字列順位だけを使用します (${detail(error)})`
      );
    }
  }
  const byPath = new Map(base.map((file) => [file.path, file]));
  const seeds = base
    .filter((file) => file.direct)
    .sort(compareRankedFiles)
    .slice(0, options.maxGraphSeeds ?? 12);
  const graphEvidence = new Map<string, RankingEvidence[]>();

  for (const seed of seeds) {
    const relations = expandImportGraph(graph, [seed.path], {
      maxDepth: options.graphDepth ?? 2,
      directions: ["dependency", "dependent"]
    });
    for (const relation of relations) {
      const kind =
        relation.direction === "dependency" ? "graph-dependency" : "graph-dependent";
      const baseScore = relation.direction === "dependency" ? 140 : 110;
      const score = Math.max(
        25,
        Math.round((baseScore + Math.min(seed.score, 300) * 0.15) / relation.depth)
      );
      const values = graphEvidence.get(relation.path) ?? [];
      values.push({
        kind,
        score,
        detail:
          relation.direction === "dependency"
            ? `${seed.path}から${relation.depth}段のimport先`
            : `${seed.path}へつながる${relation.depth}段の利用元`,
        via: relation.via,
        depth: relation.depth
      });
      graphEvidence.set(relation.path, values);
    }
  }

  for (const [targetPath, values] of graphEvidence) {
    const target = byPath.get(targetPath);
    if (!target) continue;
    const selected = dedupeGraphEvidence(values)
      .sort((left, right) => right.score - left.score || left.detail.localeCompare(right.detail))
      .slice(0, 3);
    target.evidence.push(...selected);
    target.score = sumEvidence(target.evidence);
    if (!target.direct) {
      target.relation = selected.some((evidence) => evidence.kind === "graph-dependency")
        ? "dependency"
        : "dependent";
    }
  }

  const maxResults = options.maxResults ?? index.files.length;
  const minScore = options.minScore ?? 0;
  const files = base
    .filter((file) => file.score >= minScore)
    .sort(compareRankedFiles)
    .slice(0, Math.max(0, maxResults));
  const directMatchCount = files.filter((file) => file.direct).length;
  const graphMatchCount = files.filter(
    (file) => file.relation === "dependency" || file.relation === "dependent"
  ).length;
  if (query.terms.length === 0) warnings.push("検索に使える機能語を抽出できませんでした。");
  if (directMatchCount === 0) {
    warnings.push("機能語へ直接一致するfileがなく、source配置によるfallback順です。");
  }

  return { query, files, directMatchCount, graphMatchCount, embedding, warnings };
}

async function addSemanticEvidence(
  rankedFiles: RankedDiscoveryFile[],
  indexedFiles: DiscoveryFile[],
  rawQuery: string,
  provider: NonNullable<Exclude<DiscoveryRankingOptions["embedding"], false>>,
  options: DiscoveryRankingOptions,
  signal?: AbortSignal
): Promise<DiscoveryEmbeddingSummary> {
  const threshold = options.semanticThreshold ?? 0.28;
  const weight = options.semanticWeight ?? 160;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("semanticThresholdは0～1で指定してください。");
  }
  if (!Number.isFinite(weight) || weight < 0) {
    throw new RangeError("semanticWeightは0以上で指定してください。");
  }
  if (!Number.isInteger(provider.dimensions) || provider.dimensions < 1) {
    throw new RangeError("EmbeddingProviderのdimensionsが不正です。");
  }

  const [queryVector] = await provider.embed([rawQuery], signal);
  validateVector(queryVector, provider);
  let matchedFiles = 0;
  for (let start = 0; start < indexedFiles.length; start += EMBEDDING_BATCH_SIZE) {
    throwIfAborted(signal);
    const batch = indexedFiles.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await provider.embed(
      batch.map((file) => file.searchText),
      signal
    );
    if (vectors.length !== batch.length) {
      throw new Error(
        `EmbeddingProviderが${batch.length}件に対して${vectors.length}件を返しました。`
      );
    }
    vectors.forEach((vector, offset) => {
      validateVector(vector, provider);
      const similarity = cosineSimilarity(queryVector, vector);
      if (similarity < threshold) return;
      const target = rankedFiles[start + offset];
      if (!target) return;
      target.evidence.push({
        kind: "semantic",
        score: Math.max(1, Math.round(weight * similarity)),
        detail: `${provider.id}による意味類似度 ${similarity.toFixed(3)}`
      });
      target.score = sumEvidence(target.evidence);
      target.direct = true;
      target.relation = "direct";
      matchedFiles += 1;
    });
  }

  return {
    provider: provider.id,
    dimensions: provider.dimensions,
    threshold,
    matchedFiles
  };
}

function rankFile(file: DiscoveryFile, terms: DiscoveryQueryTerm[]): RankedDiscoveryFile {
  const evidence: RankingEvidence[] = [];
  addMatchEvidence(
    evidence,
    "structured-feature",
    300,
    file.structuredComment?.features ?? [],
    terms,
    "構造化commentの@feature"
  );
  addMatchEvidence(
    evidence,
    "role",
    170,
    file.structuredComment ? [file.structuredComment.role] : [],
    terms,
    "構造化commentの@role"
  );
  addMatchEvidence(
    evidence,
    "entry",
    150,
    [
      ...(file.structuredComment?.entryPoints ?? []),
      ...(file.structuredComment?.related ?? []),
      ...(file.structuredComment?.flow ?? [])
    ],
    terms,
    "入口・関連・flow"
  );
  addMatchEvidence(evidence, "path", 220, [file.path], terms, "file path");
  addMatchEvidence(
    evidence,
    "symbol",
    190,
    file.symbols.map((symbol) => symbol.name),
    terms,
    "symbol"
  );
  addMatchEvidence(
    evidence,
    "comment",
    110,
    file.comments.map((comment) => comment.text),
    terms,
    "通常comment"
  );
  addMatchEvidence(
    evidence,
    "import",
    90,
    file.imports.map((reference) => reference.specifier),
    terms,
    "import参照"
  );
  addMatchEvidence(evidence, "content", 60, [file.sample], terms, "source sample");

  if (isSourceFile(file)) {
    evidence.push({
      kind: "source-layout",
      score: commonSourceDirectory(file.path) ? 50 : 30,
      detail: commonSourceDirectory(file.path)
        ? "一般的なsource directory内のcode"
        : "source code file"
    });
  }
  if (file.size <= 80_000) {
    evidence.push({ kind: "small-file", score: 10, detail: "80KB以下で全体を扱いやすい" });
  }
  if (/(?:test|spec|__tests__)/i.test(file.path)) {
    evidence.push({ kind: "test-file", score: -5, detail: "test fileのため直接候補では軽く減点" });
  }

  const direct = evidence.some((item) => directKinds.has(item.kind));
  return {
    path: file.path,
    score: sumEvidence(evidence),
    relation: direct ? "direct" : "fallback",
    direct,
    matchedTerms: [
      ...new Set(evidence.flatMap((item) => item.terms ?? []))
    ],
    evidence
  };
}

function addMatchEvidence(
  evidence: RankingEvidence[],
  kind: RankingEvidenceKind,
  baseScore: number,
  haystacks: string[],
  terms: DiscoveryQueryTerm[],
  label: string
): void {
  const matches = matchTerms(haystacks, terms);
  if (matches.length === 0) return;
  const strongest = Math.max(...matches.map((term) => term.weight));
  const extra = Math.min(20, Math.max(0, matches.length - 1) * 4);
  evidence.push({
    kind,
    score: Math.round(baseScore * strongest) + extra,
    detail: `${label}が「${matches.map((term) => term.value).join("・")}」と一致`,
    terms: matches.map((term) => term.value)
  });
}

function matchTerms(
  haystacks: string[],
  terms: DiscoveryQueryTerm[]
): DiscoveryQueryTerm[] {
  const normalized = haystacks.map(normalizeDiscoveryText);
  const matches = terms.filter((term) =>
    normalized.some((value) => value.includes(term.value))
  );
  return matches.sort(
    (left, right) =>
      right.weight - left.weight ||
      right.value.length - left.value.length ||
      left.value.localeCompare(right.value)
  );
}

function isSourceFile(file: DiscoveryFile): boolean {
  return file.language !== "other";
}

function commonSourceDirectory(filePath: string): boolean {
  return /(?:^|\/)(?:src|app|lib|server|client|api|packages)\//i.test(filePath);
}

function sumEvidence(evidence: RankingEvidence[]): number {
  return evidence.reduce((total, item) => total + item.score, 0);
}

function dedupeGraphEvidence(values: RankingEvidence[]): RankingEvidence[] {
  const best = new Map<string, RankingEvidence>();
  for (const value of values) {
    const key = `${value.kind}:${value.via}:${value.depth}`;
    const current = best.get(key);
    if (!current || value.score > current.score) best.set(key, value);
  }
  return [...best.values()];
}

function compareRankedFiles(left: RankedDiscoveryFile, right: RankedDiscoveryFile): number {
  return (
    right.score - left.score ||
    Number(right.direct) - Number(left.direct) ||
    left.path.localeCompare(right.path, "en")
  );
}

function validateVector(
  vector: number[] | undefined,
  provider: { id: string; dimensions: number }
): asserts vector is number[] {
  if (
    !vector ||
    vector.length !== provider.dimensions ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`${provider.id}が不正なEmbedding vectorを返しました。`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("多言語Embeddingをキャンセルしました。");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
