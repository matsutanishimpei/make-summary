/**
 * @feature-context
 * @feature feature discovery, public API, symbol index, comment index
 * @role ローカル機能探索coreのコメントparserと安全な索引IFを一か所から再exportする
 * @entry discovery module consumers
 * @flow consumer -> discovery public API -> internal modules
 * @related structured-comments.ts, file-index.ts, symbols.ts, comments.ts, types.ts
 * @caution 内部補助関数を公開して互換性対象へしない
 */

export * from "./types.js";
export * from "./structured-comments.js";
export * from "./symbols.js";
export * from "./comments.js";
export * from "./file-index.js";
