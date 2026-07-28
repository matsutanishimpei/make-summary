/**
 * @feature-context
 * @feature feature discovery, 構造化コメント
 * @role ローカル機能探索で共有する構造化コメントの契約を定義する
 * @entry StructuredFileComment
 * @flow ソースコメント -> parser -> discovery index
 * @related structured-comments.ts
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
