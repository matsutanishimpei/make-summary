/**
 * @feature-context
 * @feature feature discovery, public API, symbol index, import graph, multilingual embedding, explainable ranking
 * @role ローカル機能探索coreの索引・graph・query・Embedding・順位付けIFを一か所から再exportする
 * @entry discovery module consumers
 * @flow consumer -> discovery public API -> internal modules
 * @related file-index.ts, import-graph.ts, query.ts, embedding.ts, ranker.ts, discover.ts, types.ts
 * @caution 内部補助関数を公開して互換性対象へしない
 */

export * from "./types.js";
export * from "./structured-comments.js";
export * from "./symbols.js";
export * from "./comments.js";
export * from "./file-index.js";
export * from "./imports.js";
export * from "./import-graph.js";
export * from "./query.js";
export * from "./embedding.js";
export * from "./ranker.js";
export * from "./discover.js";
