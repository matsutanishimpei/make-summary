# Feature Context Builder アーキテクチャ

## 方針

Feature Context Builderは、PC GUI、スマホGUI、CLIという複数の入口から、同じ調査・検証・梱包処理を利用します。UIや通信方式の都合をcoreへ持ち込まず、ファイルシステムとAIプロバイダーを境界の後ろへ分離します。

依存方向は次の一方向です。

```text
Desktop UI ─┐
Mobile UI ──┼─> Interface adapters ─> Application use cases ─> Domain/core
CLI ────────┘              │                    │
                           └──────── Infrastructure implementations
```

- `contracts`: UI、IPC、HTTP、manifestで共有するデータ契約、既定値、実行時検証
- `application`: 機能調査とbundle再構築のユースケース、ジョブの状態遷移、外部依存のPort
- `core`: AI調査、パス検証、コード収集、決定的なツリー生成、bundle生成のルール
- `infrastructure`: Node.jsのファイルシステム、Git、プロジェクトワークスペース
- `main`: Electronウィンドウ、IPC、OS連携、暗号化資格情報、Tailscale制御
- `gateway`: スマホ向けHTTPルーティング、認証、ジョブAPI、成果物配信
- `renderer`: PC向けReact画面
- `mobile`: スマホ向けReact PWAとHTTPクライアント
- `cli`: application/coreを呼ぶ薄いコマンドライン入口

## 調査とbundle再構築

```text
BuildFeatureContext
  ├─ InvestigationProviderRegistry
  │    ├─ GeminiCliRunner
  │    ├─ GeminiApiRunner
  │    └─ CodexCliRunner
  ├─ ProjectWorkspacePort
  │    └─ NodeProjectWorkspace
  ├─ validateRelatedFiles
  ├─ collectSelectedFiles
  └─ packageBundle
       ├─ overview-renderer
       ├─ code-packer
       └─ output-repository

RebuildFeatureBundle
  ├─ manifest runtime validation / migration
  ├─ ProjectWorkspacePortによる再検証・再収集
  └─ 同じpackageBundle
```

`FeatureContextService`は既存のGUI、CLI、テストから使える互換ファサードです。処理本体は`BuildFeatureContext`と`RebuildFeatureBundle`へ分離されています。再構築はAIを再実行せず、保存済みの調査結果と現在の実ファイルを再検証して同じpackagerへ渡します。

## AIプロバイダー

`InvestigationRunner`がAIごとの差を吸収し、`InvestigationProviderRegistry`がプロバイダーIDからrunnerを生成します。画面とCLIの表示名・既定値は`contracts/providers.ts`のカタログを共有します。

新しい内蔵プロバイダーを追加する場合:

1. `InvestigationRunner`実装を追加する
2. 読み取り専用・タイムアウト・キャンセル・認証エラーを実装する
3. `ProviderId`と`PROVIDER_CATALOG`へ追加する
4. default registryへfactoryを登録する
5. runner単体テスト、provider解決テスト、GUI/CLI選択テストを追加する

これは製品コードへ組み込んで配布する内蔵拡張ポイントです。外部開発者が任意コードをインストールして実行するプラグイン機構ではありません。

## ジョブ

PCとスマホは共通の`JobCoordinator`を使い、次の状態遷移を統一しています。

```text
running ──> completed
   ├──────> error
   └──────> cancelled
```

`AbortController`、進捗通知、完了結果、正規化したエラー、履歴上限を一箇所で管理します。スマホ側の`GatewayJobService`は登録済みプロジェクトの解決と生成・再構築を担当し、HTTPレスポンスやSSEの書式は扱いません。

## スマホゲートウェイ

- `server.ts`: サーバーのライフサイクルとルーティング
- `http.ts`: JSON、Cookie、Origin、セキュリティヘッダー、静的ファイル
- `auth.ts`: 1回限りのQR、レート制限、端末セッション
- `job-service.ts`: モバイルジョブの生成・再構築・キャンセル・公開DTO変換
- `artifacts.ts`: Markdownプレビュー・ダウンロードとZIP配信
- `settings.ts`: 登録済みプロジェクトと端末セッションの永続化

HTTP入力は境界で検証します。スマホはプロジェクトIDだけを送り、PCで登録されていないパスや出力先を指定できません。

## Desktop IPC

rendererからmainへ渡せる生成条件は`DesktopBuildRequest`に限定します。mainは`parseDesktopBuildRequest`で実行時検証してからuse caseへ渡します。Gemini APIキーはこのDTOに存在せず、main processがWindowsの暗号化ストアから解決します。

成果物の読み取り、出力フォルダを開く操作、クリップボードコピーは、完了したジョブがmain processへ登録したパスだけを許可します。

## UI

PC画面は`App.tsx`をcomposition rootとし、結果、スマホ連携、共通設定をfeature componentへ分離しています。スマホ画面はHTTPクライアント、ジョブ表示、共通表示・変換処理を分離しています。React component内にはAI呼び出し、Node.jsファイル操作、資格情報保存を置きません。

## manifest

`manifest.json`はschema versionを持つ内部契約です。読み込み時は`parseManifest`が全体を検証します。旧Gemini CLI専用形式は読み込み境界で`1.1`へ移行し、use case内に互換分岐を持ち込みません。未対応バージョンや壊れた値はbundle再構築前に拒否します。

## 明示的な非対象

保守性を損なう未実装項目ではなく、現在の製品範囲として次を対象外にします。

- 外部開発者が任意プラグインをインストールする仕組み
- 複数ユーザー・権限管理
- クラウド分散実行
- 複数PC間のジョブ共有
- 外部プラグインを安全なサンドボックスで動かす仕組み

単一ユーザーが自分のPC上で、安全にローカルプロジェクトを調査する用途へ集中します。
