/**
 * @feature-context
 * @feature multilingual embedding, semantic search, local feature discovery
 * @role 日本語・英語の概念とsubwordを決定的なローカルベクトルへ変換する標準EmbeddingProvider
 * @entry LocalMultilingualEmbedding.embed, cosineSimilarity
 * @flow indexed meaning text -> concept and subword features -> normalized vector -> similarity
 * @related query.ts, ranker.ts, types.ts
 * @caution 学習済みニューラルモデルではない。外部送信せず、将来のONNX providerと交換可能な基準実装である
 */

import {
  detectDiscoveryConcepts,
  normalizeDiscoveryText
} from "./query.js";
import type { EmbeddingProvider } from "./types.js";

const DEFAULT_DIMENSIONS = 384;
const MAX_TOKEN_FEATURES = 160;
const MAX_SUBWORD_FEATURES = 400;

export class LocalMultilingualEmbedding implements EmbeddingProvider {
  readonly id = "local-multilingual-concept-subword-v1";
  readonly dimensions: number;

  constructor(dimensions = DEFAULT_DIMENSIONS) {
    if (!Number.isInteger(dimensions) || dimensions < 64 || dimensions > 4096) {
      throw new RangeError("Embedding dimensionsは64～4096の整数で指定してください。");
    }
    this.dimensions = dimensions;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const text of texts) {
      throwIfAborted(signal);
      vectors.push(this.vectorize(text));
    }
    return vectors;
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = normalizeDiscoveryText(text);
    if (!normalized) return vector;

    for (const concept of detectDiscoveryConcepts(text)) {
      addFeature(vector, `concept:${concept}`, 12);
    }

    const tokens = [...new Set(normalized.split(" ").filter(Boolean))]
      .slice(0, MAX_TOKEN_FEATURES);
    for (const token of tokens) {
      addFeature(vector, `token:${token}`, 1.5);
    }

    const subwords = new Set<string>();
    for (const token of tokens) {
      const characters = [...token];
      for (const size of [2, 3, 4]) {
        for (let index = 0; index <= characters.length - size; index += 1) {
          subwords.add(characters.slice(index, index + size).join(""));
          if (subwords.size >= MAX_SUBWORD_FEATURES) break;
        }
        if (subwords.size >= MAX_SUBWORD_FEATURES) break;
      }
      if (subwords.size >= MAX_SUBWORD_FEATURES) break;
    }
    for (const subword of subwords) {
      addFeature(vector, `subword:${subword}`, 0.2);
    }

    return normalizeVector(vector);
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const hash = fnv1a(feature);
  const index = hash % vector.length;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[index] += weight * sign;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("多言語Embeddingをキャンセルしました。");
  error.name = "AbortError";
  throw error;
}
