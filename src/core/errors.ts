export type ErrorCode =
  | "CLI_NOT_FOUND"
  | "CLI_UNAUTHENTICATED"
  | "CLI_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "INVALID_JSON"
  | "NO_VALID_FILES"
  | "ROOT_NOT_FOUND"
  | "READ_DENIED"
  | "INVALID_OUTPUT"
  | "OUTPUT_LIMIT"
  | "OUTPUT_EXISTS"
  | "INVALID_OPTIONS";

const messages: Record<ErrorCode, string> = {
  CLI_NOT_FOUND: "Gemini CLIが見つかりません。Gemini CLIをインストールし、ターミナルで gemini --version を確認してください。",
  CLI_UNAUTHENTICATED: "Gemini CLIが認証されていません。ターミナルで gemini を起動して認証を完了してください。",
  CLI_FAILED: "Gemini CLIの実行に失敗しました。詳細ログを確認してから再実行してください。",
  TIMEOUT: "Gemini CLIの処理がタイムアウトしました。対象を絞るか、タイムアウト設定を見直してください。",
  CANCELLED: "処理をキャンセルしました。入力内容を変更して再実行できます。",
  INVALID_JSON: "Gemini CLIから有効なJSONを取得できませんでした。もう一度実行してください。",
  NO_VALID_FILES: "安全に利用できる関連ファイルがありませんでした。調査対象または除外設定を確認してください。",
  ROOT_NOT_FOUND: "プロジェクトフォルダが存在しません。正しいフォルダを選択してください。",
  READ_DENIED: "プロジェクト内のファイルを読み取れません。アクセス権限を確認してください。",
  INVALID_OUTPUT: "出力先が不正です。出力先はプロジェクト内を指定してください。",
  OUTPUT_LIMIT: "成果物を指定された文字数上限に収められません。上限を増やしてください。",
  OUTPUT_EXISTS: "同名の成果物がすでにあります。上書きを確認するか、別の名前を指定してください。",
  INVALID_OPTIONS: "入力値が不正です。ファイル数と文字数の上限を確認してください。"
};

export class FeatureContextError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message = messages[code],
    public readonly details?: string
  ) {
    super(message);
    this.name = "FeatureContextError";
  }
}

export function asFeatureContextError(error: unknown): FeatureContextError {
  if (error instanceof FeatureContextError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new FeatureContextError("CANCELLED", undefined, error.stack);
  }
  return new FeatureContextError(
    "CLI_FAILED",
    undefined,
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
}
