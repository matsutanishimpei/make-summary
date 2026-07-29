/**
 * @feature-context
 * @feature AI investigation, related file discovery, bundle candidates
 * @role 強い関連から弱い関連まで、容量に応じて梱包できる構造化調査指示を生成する
 * @entry createInvestigationPrompt
 * @flow feature + summary option -> broad related-file instructions -> JSON contract
 * @related investigation.ts, gemini-api.ts, validate.ts
 * @caution 根拠のないfileを増やさず、recommendedは除外指定ではなく優先度の手掛かりにする
 */

export function createInvestigationPrompt(feature: string, includeSummary: boolean): string {
  return `あなたは読み取り専用のコード調査担当です。ソースコードや設定を絶対に変更しないでください。

調査対象: ${feature}

次を実施してください。
1. 指定機能のエントリーポイントを探す。
2. UI、サービス、状態管理、ドメインロジック、API、バックエンド、型、テストを入口から出口までたどる。
3. import関係だけでなく、設定、manifest、schema、migration、build、対応testなど、少しでも具体的な関連根拠があるファイルを候補に含める。
4. 直接関係するファイルと間接依存を区別し、priorityをcore/supporting/testで付ける。
5. 各ファイルの役割、選定理由、関連度、プロジェクトに適した意味単位のgroupを示す。強い候補はrecommended=true、弱いが根拠のある候補はrecommended=falseとする。
6. 実在するプロジェクト相対パスだけを "/" 区切りで返す。
7. 不明点と推測をuncertaintiesへ明示する。
8. ソースコード本文は返さず、変更もしない。
9. JSON以外の説明やMarkdownコードフェンスを返さない。
${
  includeSummary
    ? "10. overview、各ファイルのsummary、summaryDetailsへ、主要コンポーネントの責務、状態とデータの流れ、API、外部依存、修正時の注意点を具体的に含める。"
    : "10. 詳細な要約は不要だが、roleとreasonは必ず含め、summaryDetailsの各配列は空にする。"
}

厳密に次のJSON形式で返してください。
{
  "feature": ${JSON.stringify(feature)},
  "overview": "機能全体の説明（要約不要時は空文字可）",
  "flow": ["入口", "処理", "出口"],
  "summaryDetails": {
    "responsibilities": ["主要コンポーネント: 責務"],
    "stateAndDataFlow": ["状態またはデータがどこからどこへ流れるか"],
    "apis": ["APIのエンドポイント、用途、入出力"],
    "externalDependencies": ["外部サービス、ライブラリ、実行環境への依存"],
    "changeCautions": ["修正時に壊しやすい契約、状態、テスト"]
  },
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
