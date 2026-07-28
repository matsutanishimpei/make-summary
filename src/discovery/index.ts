/**
 * @feature-context
 * @feature feature discovery, public API, symbol index, comment index, import graph
 * @role ローカル機能探索coreの索引・import解析・graph展開IFを一か所から再exportする
 * @entry discovery module consumers
 * @flow consumer -> discovery public API -> internal modules
 * @related structured-comments.ts, file-index.ts, imports.ts, import-graph.ts, types.ts
 * @caution 内部補助関数を公開して互換性対象へしない
 */

export * from "./types.js";
export * from "./structured-comments.js";
export * from "./symbols.js";
export * from "./comments.js";
export * from "./file-index.js";
export * from "./imports.js";
export * from "./import-graph.js";
