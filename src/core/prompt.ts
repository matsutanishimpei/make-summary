export function createInvestigationPrompt(feature: string, includeSummary: boolean): string {
  return `あなたは読み取り専用のコード調査担当です。ソースコードや設定を絶対に変更しないでください。

調査対象: ${feature}

次を実施してください。
1. 指定機能のエントリーポイントを探す。
2. UI、サービス、状態管理、ドメインロジック、API、バックエンド、型、テストを入口から出口までたどる。
3. 直接関係するファイルと間接依存を区別し、priorityをcore/supporting/testで付ける。
4. 各ファイルの役割、選定理由、関連度、プロジェクトに適した意味単位のgroupを示す。
5. 実在するプロジェクト相対パスだけを "/" 区切りで返す。
6. 不明点と推測をuncertaintiesへ明示する。
7. ソースコード本文は返さず、変更もしない。
8. JSON以外の説明やMarkdownコードフェンスを返さない。
${includeSummary ? "9. overviewと各ファイルのsummaryに簡潔な要約を含める。" : "9. 詳細な要約は不要だが、roleとreasonは必ず含める。"}

厳密に次のJSON形式で返してください。
{
  "feature": ${JSON.stringify(feature)},
  "overview": "機能全体の説明（要約不要時は空文字可）",
  "flow": ["入口", "処理", "出口"],
  "files": [{
    "path": "src/example.ts",
    "role": "役割",
    "reason": "選定理由",
    "priority": "core",
    "group": "frontend",
    "recommended": true,
    "summary": "要約有効時のみ"
  }],
  "uncertainties": []
}`;
}
