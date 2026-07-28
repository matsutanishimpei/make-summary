# Feature Context Builder

Feature Context Builder は、プロジェクトフォルダと「ログイン機能」「通知機能」などの調査対象を指定し、Gemini CLI、Gemini API、または Codex CLI にコードベースを調査させるWindows対応デスクトップツールです。関連コードツリー、選定理由、任意の要約、任意の実コード連結を、ChatGPTへ添付しやすい最大5件のMarkdownへ整理します。

調査するソースファイル数に上限5件を設けるものではありません。必要なソースを件数固定せず検証し、最終成果物だけを最大5件へ梱包します。

## 必要環境

- Windows 10/11（macOS/Linuxでも開発構成は動作しますが、主対象はWindowsです）
- Node.js 20以上
- npm
- Gemini CLI、Gemini APIキー、Codex CLIのいずれか（利用するものだけで構いません）
- Git（コミットIDの記録に使用。Git管理外でも生成可能です）
- Tailscale（スマートフォン連携を使う場合のみ。PCとスマートフォンの両方）

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

## Gemini APIの準備

Gemini CLIのGoogleアカウント認証が利用できない場合は、Google AI StudioでGemini APIキーを作成し、GUIの「共通設定」へ一度保存してから「PC版」またはスマホで「Gemini API」を選択してください。

1. [Google AI StudioのAPIキーページ](https://aistudio.google.com/app/apikey)でキーを作成
2. GUIの「共通設定」→「Gemini APIキー」へ貼り付け
3. 「Windowsへ暗号化保存」を押す
4. 「PC版」で「Gemini API」を選び、必要に応じてモデル名を変更
5. コンテキストを生成

既定モデルは `gemini-3.5-flash` です。GUIで保存したAPIキーはElectronの `safeStorage` を通してWindowsの暗号化機能でPCに保存し、PC版とスマホ版で共有します。平文のキーは `manifest.json`、bundle、ログへ保存しません。CLIから利用する場合は、コマンドライン引数ではなく環境変数を使います。

Googleの無料枠では、送信した内容がサービス改善に利用される場合があります。機密コードで利用する前に、Google AI Studioのデータ利用条件と対象プロジェクトの方針を確認してください。

```powershell
$env:GEMINI_API_KEY="取得したAPIキー"
node dist/node/cli/index.js "ログイン機能" --root . --provider gemini-api --summary --concat
```

Gemini APIはローカルフォルダを直接参照できません。そのためcoreが次の順で入力コンテキストを作ります。

1. プロジェクト内の通常テキストファイルを決定的に走査
2. `.gitignore`、秘密情報パス、生成物、バイナリ、シンボリックリンクを除外
3. 全体のパス一覧と、関連度を優先したコード本文を最大600,000文字へ整理
4. ファイル本文を「信頼できないデータ」と明示してGemini APIへ送信
5. JSON Schemaによる構造化出力を要求
6. coreでJSONを再検証し、不正な場合だけ1回補正を依頼
7. 返された全パスを通常どおりcoreで再検証

構造化出力はJSONの構文を安定させますが、パスの実在性や内容の正しさまでは保証しません。そのため、APIの返答を信用せず、CLI利用時と同じパス・秘密情報検査を必ず通します。

- [Gemini APIの開始方法](https://ai.google.dev/gemini-api/docs/generate-content/get-started)
- [Gemini APIの構造化出力](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini APIの料金と無料枠](https://ai.google.dev/gemini-api/docs/pricing)

## Codex CLIの準備

公式npmパッケージを使う場合:

```powershell
npm install -g @openai/codex
codex login
```

準備後に次を確認してください。

```powershell
codex --version
codex exec --help
```

本ツールは非対話の `codex exec` を `--json --sandbox read-only` で実行します。調査指示は標準入力で渡し、`--full-auto` やsandboxを無効化するオプションは使いません。

- [Codex CLI](https://developers.openai.com/codex/cli/)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/)

## セットアップとGUI起動

```powershell
npm install
npm run dev
```

`npm run dev` は型チェックとビルドを行ってからElectronアプリを起動します。GUIだけで次を完了できます。

画面は「PC版」「スマホ版」「共通設定」に分かれています。「共通設定」で保存したGemini APIキーはPC版とスマホ版の両方が利用します。

1. 「PC版」でプロジェクトフォルダを選択
2. 調べたい機能・目的を入力
3. Gemini CLI / Gemini API / Codex CLI、要約、コード連結、最大ファイル数、文字数上限を指定
4. 生成し、進捗を確認（実行中はキャンセル可能）
5. 結果と各Markdownをプレビュー
6. 関連ソースを含める・除外する
7. AIを再実行せずbundleだけ再構築
8. 出力フォルダを開く、または `01-overview.md` をコピー

既存成果物を上書きする場合、GUIは確認ダイアログを表示します。

## スマートフォンから使う

PCとスマートフォンに[Tailscale](https://tailscale.com/download)を入れ、同じアカウント（tailnet）へ接続すると、一般的な家庭回線やモバイル回線からも利用できます。ルーターのポート開放や固定IPは不要です。公開インターネットへは出さず、TailscaleのプライベートなHTTPS接続だけを使います。

Androidでのインストールから初回接続、QR登録、ホーム画面追加、ZIPの添付、トラブル対応までは、[Android版 Tailscale・スマホ連携マニュアル](docs/android-tailscale-guide.md)で画面操作に沿って説明しています。

初回設定はPCのGUIで行います。

1. 通常どおりプロジェクトフォルダを選ぶ
2. 「スマホ版」から「現在のプロジェクトを登録」
3. Gemini APIを使う場合は、「共通設定」でAPIキーを「Windowsへ暗号化保存」
4. 「Tailscale Serveを自動設定」を押す
5. 「接続用QRコード」を表示し、スマートフォンで読み取る
6. 必要なら「Windowsログイン時にバックグラウンド起動」を有効にする
7. スマートフォンのブラウザで「ホーム画面に追加」するとPWAとして起動できる

スマホ画面では、登録済みプロジェクトとGemini CLI / Gemini API / Codex CLIを選び、進捗確認、キャンセル、成果物プレビュー、Markdown保存・共有、ZIP保存、関連ソースの再選択、AIを再実行しないbundle再構築まで行えます。ブラウザの複数ファイル共有が使えない場合はZIP保存へ切り替えてください。

PCアプリのウィンドウを閉じても、スマホ連携が有効ならタスクトレイで動作を続けます。スマホから使う間はPCが起動中かつスリープしておらず、Feature Context BuilderとTailscaleが動作している必要があります。終了する場合はタスクトレイのメニューから終了してください。

アプリは二重起動を防止し、もう一度起動した場合は既存ウィンドウを表示します。旧版がタスクトレイに残った状態で`EADDRINUSE`が表示された場合だけ、タスクトレイから旧版を完全終了して再起動してください。

Tailscale CLIを手動で確認する場合:

```powershell
tailscale status
tailscale serve status
```

GUIが設定する転送は `tailscale serve --yes --bg 43127` 相当です（ポートは設定値）。`--yes`は初回確認を非対話で完了するために使い、`tailscale funnel` は使用しません。詳しくは[Tailscale Serveの公式リファレンス](https://tailscale.com/docs/reference/tailscale-cli/serve)を参照してください。

## CLI

ビルド後に次のように実行できます。

```powershell
node dist/node/cli/index.js "ログイン機能" --root .
node dist/node/cli/index.js "ログイン機能" --root . --summary
node dist/node/cli/index.js "ログイン機能" --root . --concat
node dist/node/cli/index.js "ログイン機能" --root . --summary --concat
node dist/node/cli/index.js "ログイン機能" --root . --provider gemini-api --summary --concat
node dist/node/cli/index.js "ログイン機能" --root . --provider codex --summary --concat
```

パッケージをリンクした場合は `feature-context` コマンドも利用できます。

```powershell
npm link
feature-context "ログイン機能" --root . --summary --concat
```

### CLIオプション

| オプション | 説明 | 既定値 |
|---|---|---|
| `--provider <gemini\|gemini-api\|codex>` | 調査に使うAI | `gemini` |
| `--gemini-model <model>` | Gemini APIで使うモデル | `gemini-3.5-flash` |
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

Ctrl+C / SIGTERM でキャンセルすると、実行中のAI CLI子プロセスまたはGemini APIのHTTP要求も終了します。Gemini APIキーは `GEMINI_API_KEY`、モデルの環境変数による既定値変更は `GEMINI_API_MODEL` でも指定できます。

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
  ├─ Encrypted credential store (PC / Mobile shared)
  ├─ MobileGateway (127.0.0.1)
  │    ├─ QR pairing / session
  │    ├─ registered projects only
  │    ├─ progress SSE / cancel / rebuild
  │    └─ Markdown ZIP
  │          │
  │    Tailscale Serve (private HTTPS)
  │          │
  │    Mobile React PWA
  │
feature-context-core
  ├─ InvestigationRunner interface
  │    ├─ GeminiCliRunner
  │    ├─ GeminiApiRunner
  │    └─ CodexCliRunner
  ├─ safe project snapshot for Gemini API
  ├─ JSON parser / prompt
  ├─ path・gitignore・binary・secret validation
  ├─ deterministic code tree
  ├─ source collection
  └─ bundle / manifest packaging
        │
Thin CLI (同じcore)
```

GUIのReactコンポーネントはAI呼び出しやファイルシステムを直接操作しません。AI呼び出しは `InvestigationRunner` インターフェースで分離され、CLI実行やGemini API通信をモックへ差し替えられます。パス検証、コード収集、梱包はすべてのプロバイダーで同じcoreを通ります。

## セキュリティ上の注意

- 選択したAI CLIは対象プロジェクトを作業ディレクトリとして起動します。
- Gemini APIキーはHTTPヘッダーで送り、URL、ログ、manifest、bundleへ保存しません。
- Gemini APIへ送る前にも `.gitignore`、秘密情報パス、バイナリ、秘密鍵らしい本文をローカルで除外します。
- Gemini APIへ送るファイル本文を命令として扱わないよう、プロンプトインジェクション対策の境界を明示します。
- 実行ファイルと引数を分離し、`shell: false` で起動します。
- Windowsのnpm製 `.cmd` shimは実体のJavaScriptを検証・解決し、シェルを介さずに起動します。
- 読み取り専用の指示に加え、Geminiでは利用可能なら `--approval-mode plan`、Codexでは `--sandbox read-only` を使います。
- `.env`、`.env.*`、秘密鍵拡張子、SSH秘密鍵、`node_modules`、`.git`、`dist`、`build`、`coverage` を除外します。
- `.gitignore` 対象、バイナリ、重複、存在しないファイル、プロジェクト外参照、危険なシンボリックリンクをcore側で拒否します。
- コード本文はAI CLIに再生成させず、検証済みの実ファイルを直接読みます。
- 出力先はプロジェクト内だけに制限します。
- 成果物は外部サービスへ自動送信されません。Gemini APIを選んだ場合だけ、調査用コード索引がGoogleへ送信されます。送付前にGUIの説明を確認してください。
- スマホ用HTTPサーバーは `127.0.0.1` だけで待ち受け、Tailscale ServeがプライベートなHTTPSを終端します。
- スマホはPCで事前登録したプロジェクトIDだけを選択でき、任意のパスや出力先を指定できません。
- QRペアリング値は32バイトの乱数で、URLフラグメントに載せるためHTTPリクエストへ送信されず、5分・1回で失効します。
- 端末セッション値はCookieへ `HttpOnly`、`Secure`、`SameSite=Strict` を設定し、PCにはSHA-256ハッシュだけを保存します。PCのGUIから端末ごとに失効できます。
- 共通のGemini APIキーはスマホへ送らず、Electronの `safeStorage`（WindowsではOSの暗号化機能）でPCへ暗号化保存し、PC版とスマホ版で共有します。環境変数 `GEMINI_API_KEY` も利用できます。
- スマホ向けZIPには `bundle` のMarkdownだけを含めます。絶対パスを含む内部管理用 `manifest.json` はPCに残します。
- Tailscale Funnel、ルーターのポート開放、パブリックlisten、クラウド保存は行いません。

ファイル名による基本的な秘密情報除外は行いますが、任意形式の埋め込みシークレットを完全には検出できません。成果物を共有する前に内容を確認してください。

## 開発・テスト

```powershell
npm run typecheck
npm test
npm run build
npm run test:smoke
```

テストは一時プロジェクト、`InvestigationRunner`、Gemini API HTTP通信のモックを使用し、実際のAI CLIや外部ネットワークを呼びません。coreの正常系、プロバイダー選択、Codex JSONL解析、Gemini APIの構造化出力・補正再試行・認証エラー・利用上限・キャンセル、安全なコード索引、最大5件梱包、オプション、選択・再構築、危険パス、gitignore、秘密情報、バイナリ、不正JSON、CLI異常、タイムアウト、Windows日本語パス、文字数上限、コード一致、上書き防止を検証します。スマホ連携は未認証拒否、1回限りのQRペアリング、登録プロジェクト制限、実coreを通した生成、MarkdownだけのZIPを検証します。GUIはPC版・スマホ版・共通設定の切り替え、3プロバイダーの選択、共通APIキーの暗号化保存、保存済みキーを使うPC生成、スマホ登録操作を検証します。`test:smoke` は非表示のElectronウィンドウを起動し、3画面、共通設定IPC、モバイルIPC、ビルド済みPWAが実際に読み込まれることを確認します。

## 現在の制限事項

- 調査品質は選択したCLIのモデル、認証、対象プロジェクト、CLIバージョンに依存します。
- 1ファイルが大きすぎて上限に収まらない場合、現版は途中分割せず未収録としてmanifestへ記録します。
- ルート `.gitignore` を評価します。サブディレクトリ固有の `.gitignore` の階層評価は未対応です。
- GUIからAI CLIのタイムアウト値や追加除外パターンを変更する画面はありません。
- Gemini APIへ送るコード本文は最大600,000文字です。超過分はパス一覧のみとなり、大規模リポジトリではCLIより調査精度が下がる場合があります。
- Gemini APIの無料枠、利用可能モデル、レート制限、データ利用条件はGoogle側の設定と変更に依存します。
- スマホ連携はPC上のプロセスを遠隔操作するため、PCの電源・ネットワーク・アプリ・Tailscaleのいずれかが停止すると利用できません。PCのスリープ解除機能は実装していません。
- スマホのジョブ履歴はPCアプリのメモリ内に最大20件だけ保持し、PCアプリを終了すると消えます。生成済み成果物そのものは各プロジェクト内に残ります。
- Web Share APIのファイル共有可否はOSとブラウザに依存します。未対応環境向けに個別MarkdownとZIPのダウンロードを用意しています。
- Tailscaleのインストール、tailnetへのログイン、端末ポリシー設定は利用者が行う必要があります。
- インストーラー生成、高度な配布署名、自動アップデートは未実装です。
- Chrome拡張、ChatGPTの自動操作・送信、OpenAI API、クラウド保存、ソース編集・自動修正は実装しません。
