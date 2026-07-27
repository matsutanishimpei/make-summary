# Feature Context Builder

Feature Context Builder は、プロジェクトフォルダと「ログイン機能」「通知機能」などの調査対象を指定し、インストール済みの Gemini CLI にコードベースを調査させるWindows対応デスクトップツールです。関連コードツリー、選定理由、任意の要約、任意の実コード連結を、ChatGPTへ添付しやすい最大5件のMarkdownへ整理します。

調査するソースファイル数に上限5件を設けるものではありません。必要なソースを件数固定せず検証し、最終成果物だけを最大5件へ梱包します。

## 必要環境

- Windows 10/11（macOS/Linuxでも開発構成は動作しますが、主対象はWindowsです）
- Node.js 20以上
- npm
- Gemini CLI
- Git（コミットIDの記録に使用。Git管理外でも生成可能です）

## Gemini CLIの準備

公式の標準インストール方法:

```powershell
npm install -g @google/gemini-cli
gemini
```

初回の `gemini` 起動で認証方式を選び、ブラウザでログインします。準備後に次を確認してください。

```powershell
gemini --version
gemini --help
```

本ツールは起動のたびに利用可能なCLIを検査し、非対話の `--prompt` と機械可読な `--output-format json` を利用します。対応CLIが `--approval-mode plan` を提供する場合は、読み取り専用の計画モードを明示します。`--yolo`、`auto_edit`、無制限な自動承認は使いません。

- [Gemini CLI 公式クイックスタート](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/index.md)
- [Gemini CLI CLIリファレンス](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md)
- [Gemini CLI Headless mode](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md)

## セットアップとGUI起動

```powershell
npm install
npm run dev
```

`npm run dev` は型チェックとビルドを行ってからElectronアプリを起動します。GUIだけで次を完了できます。

1. プロジェクトフォルダを選択
2. 調べたい機能・目的を入力
3. 要約、コード連結、最大ファイル数、文字数上限を指定
4. 生成し、進捗を確認（実行中はキャンセル可能）
5. 結果と各Markdownをプレビュー
6. 関連ソースを含める・除外する
7. Geminiを再実行せずbundleだけ再構築
8. 出力フォルダを開く、または `01-overview.md` をコピー

既存成果物を上書きする場合、GUIは確認ダイアログを表示します。

## CLI

ビルド後に次のように実行できます。

```powershell
node dist/node/cli/index.js "ログイン機能" --root .
node dist/node/cli/index.js "ログイン機能" --root . --summary
node dist/node/cli/index.js "ログイン機能" --root . --concat
node dist/node/cli/index.js "ログイン機能" --root . --summary --concat
```

パッケージをリンクした場合は `feature-context` コマンドも利用できます。

```powershell
npm link
feature-context "ログイン機能" --root . --summary --concat
```

### CLIオプション

| オプション | 説明 | 既定値 |
|---|---|---|
| `--root <path>` | 調査対象プロジェクト | `.` |
| `--out <path>` | プロジェクト内の出力ベース | `.feature-context` |
| `--name <name>` | 成果物ディレクトリ名 | 機能名から生成 |
| `--summary` | overviewへ要約を追加 | 無効 |
| `--concat` | 実ファイルのコードを連結 | 無効 |
| `--max-output-files <1-5>` | bundle内Markdown上限 | `5` |
| `--max-total-chars <n>` | 成果物全体の文字数上限 | `120000` |
| `--dry-run` | ファイルを書かずに調査と梱包を検証 | 無効 |
| `--verbose` | エラーの技術的詳細を表示 | 無効 |
| `--force` | 既存成果物の上書きを許可 | 無効 |

Ctrl+C / SIGTERM でキャンセルすると、実行中のGemini子プロセスも終了します。

## 出力構造

```text
.feature-context/
└─ ログイン機能/
   ├─ manifest.json
   └─ bundle/
      ├─ 01-overview.md
      ├─ 02-frontend.md
      ├─ 03-backend.md
      ├─ 04-shared.md
      └─ 05-tests.md
```

`manifest.json` は内部管理用で、添付用ファイル数には含みません。`bundle` 内のMarkdownは必ず指定上限（最大5件）以内です。`01-overview.md` は常に生成し、ツリー、関連ファイルと理由、処理フロー、収録・未収録、警告、不明点、生成日時、GitコミットIDを含みます。

コード連結を有効にした場合だけ、残りの最大4件へ意味グループ単位で実コードを収録します。概算トークン数は「UTF-16文字数 ÷ 4（切り上げ）」です。

## アーキテクチャ

```text
React Renderer (Desktop GUI)
        │ IPC
Electron Main
        │
feature-context-core
  ├─ GeminiRunner interface / GeminiCliRunner
  ├─ JSON parser / prompt
  ├─ path・gitignore・binary・secret validation
  ├─ deterministic code tree
  ├─ source collection
  └─ bundle / manifest packaging
        │
Thin CLI (同じcore)
```

GUIのReactコンポーネントはGeminiやファイルシステムを直接操作しません。Gemini呼び出しは `GeminiRunner` インターフェースで差し替え可能で、テストはモックのみを使用します。

## セキュリティ上の注意

- Geminiは対象プロジェクトを作業ディレクトリとして起動します。
- 実行ファイルと引数を分離し、`shell: false` で起動します。
- 読み取り専用の指示と、利用可能なら `--approval-mode plan` を使います。
- `.env`、`.env.*`、秘密鍵拡張子、SSH秘密鍵、`node_modules`、`.git`、`dist`、`build`、`coverage` を除外します。
- `.gitignore` 対象、バイナリ、重複、存在しないファイル、プロジェクト外参照、危険なシンボリックリンクをcore側で拒否します。
- コード本文はGeminiに再生成させず、検証済みの実ファイルを直接読みます。
- 出力先はプロジェクト内だけに制限します。
- 成果物は外部サービスへ自動送信されません。送付前に必ずプレビューしてください。

ファイル名による基本的な秘密情報除外は行いますが、任意形式の埋め込みシークレットを完全には検出できません。成果物を共有する前に内容を確認してください。

## 開発・テスト

```powershell
npm run typecheck
npm test
npm run build
npm run test:smoke
```

テストは一時プロジェクトと `GeminiRunner` のモックを使用し、実際のGemini CLIやネットワークを呼びません。coreの正常系、最大5件梱包、オプション、選択・再構築、危険パス、gitignore、秘密情報、バイナリ、不正JSON、CLI異常、タイムアウト、キャンセル、Windows日本語パス、文字数上限、コード一致、上書き防止を検証します。GUIは主要な初回入力と生成操作を検証します。`test:smoke` は非表示のElectronウィンドウを起動し、React画面とsandboxed preload IPCが実際に読み込まれることを確認します。

## 現在の制限事項

- Geminiの調査品質は利用モデル、認証、対象プロジェクト、Gemini CLIのバージョンに依存します。
- 1ファイルが大きすぎて上限に収まらない場合、現版は途中分割せず未収録としてmanifestへ記録します。
- ルート `.gitignore` を評価します。サブディレクトリ固有の `.gitignore` の階層評価は未対応です。
- GUIからGeminiタイムアウト値や追加除外パターンを変更する画面はありません。
- インストーラー生成、高度な配布署名、自動アップデートは未実装です。
- Chrome拡張、ChatGPTの自動操作・送信、OpenAI API、Gemini API直接利用、クラウド保存、ソース編集・自動修正は実装しません。
