/**
 * @feature-context
 * @feature feature discovery, public API
 * @role ローカル機能探索coreの公開IFを一か所から再exportする
 * @entry discovery module consumers
 * @flow consumer -> discovery public API -> internal modules
 * @related structured-comments.ts, types.ts
 * @caution 内部補助関数を公開して互換性対象へしない
 */

export * from "./types.js";
export * from "./structured-comments.js";
