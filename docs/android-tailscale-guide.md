# Android版 Tailscale・スマホ連携マニュアル

このマニュアルでは、AndroidスマートフォンからPC上のFeature Context Builderを操作し、生成したMarkdownまたはZIPをスマートフォンへ保存するまでを説明します。

難しいネットワーク設定やルーターのポート開放は不要です。PCとAndroidを同じTailscaleネットワーク（tailnet）へ接続して使用します。

## 最初に知っておくこと

- 対応するAndroidはAndroid 8.0以降です。
- PCとAndroidの両方へTailscaleをインストールします。
- PCとAndroidでは、同じGoogleアカウントまたは同じSSOアカウントでTailscaleへログインします。
- スマホから利用する間、PCは起動したままにし、スリープさせないでください。
- PC上でFeature Context BuilderとTailscaleが動作している必要があります。
- 自宅のWi-Fi同士である必要はありません。Androidがモバイル回線、PCが自宅や職場の通常回線でも利用できます。
- Feature Context Builderは公開インターネットへ公開されません。同じtailnetへ参加している端末だけが接続できます。

公式情報:

- [AndroidへTailscaleをインストールする](https://tailscale.com/docs/install/android)
- [Android版Tailscaleのダウンロード](https://tailscale.com/download/android)
- [Tailscale Serveについて](https://tailscale.com/docs/features/tailscale-serve)

## 1. PC側のTailscaleを準備する

すでにPCでTailscaleへログイン済みなら、この章は読み飛ばして構いません。

1. [Tailscaleのダウンロードページ](https://tailscale.com/download/windows)をPCで開きます。
2. Windows版Tailscaleをインストールします。
3. Tailscaleを起動します。
4. ログインを選び、使用するGoogleアカウントなどでログインします。
5. WindowsのタスクトレイにTailscaleのアイコンが表示され、接続済みになったことを確認します。

あとでAndroidでも、ここで使用したものと同じアカウントを選びます。

## 2. AndroidへTailscaleをインストールする

1. AndroidでGoogle Playを開きます。
2. `Tailscale`を検索します。
3. 開発元がTailscale Inc.であることを確認してインストールします。
4. Tailscaleアプリを開きます。
5. `Get Started`などの開始ボタンをタップします。
6. AndroidからVPN接続の許可を求められたら許可します。
7. 通知の許可を求められた場合は、再認証期限などの通知を受け取れるよう許可することを推奨します。

VPNの許可は、AndroidがTailscale経由でPCへ安全に接続するために必要です。Tailscaleを通常利用するだけなら、すべてのインターネット通信がPC経由になるわけではありません。Feature Context BuilderではExit Nodeの設定も不要です。

## 3. AndroidをPCと同じtailnetへ接続する

1. AndroidのTailscaleアプリでログインを選びます。
2. PCでGoogleアカウントを使った場合は`Sign in with Google`を選びます。
3. PCで別のSSOを使った場合は`Sign in with other`を選びます。
4. PCと同じアカウントでログインします。
5. AndroidのTailscaleアプリが接続済みになっていることを確認します。
6. 端末一覧にPCとAndroidの両方が表示されることを確認します。

Android上部のステータス領域に鍵やVPNのアイコンが表示される場合があります。表示名やボタン名はTailscaleとAndroidのバージョンにより多少異なります。

### QRコードが2種類あることに注意

Tailscale自体にも端末追加用QRコードがありますが、Feature Context BuilderがPC画面に表示するQRコードとは別物です。

- TailscaleのQR: Androidをtailnetへ参加させるもの
- Feature Context BuilderのQR: 参加済みAndroidをFeature Context Builderへ登録するもの

通常はAndroidのTailscaleアプリへPCと同じアカウントでログインし、そのあとFeature Context BuilderのQRを読み取れば十分です。

## 4. PCでFeature Context Builderを準備する

PowerShellでプロジェクトフォルダを開き、次を実行します。

```powershell
npm run dev
```

Feature Context Builderが開いたら、次の順で設定します。

1. 上部の「スマホ版」を選びます。
2. 「プロジェクトを追加」を押します。
3. スマホで利用するプロジェクトフォルダを選択します。Windowsの選択画面では、`Ctrl`キーを押しながら選ぶと複数フォルダをまとめて追加できます。
4. Gemini APIを使う場合:
   - 上部の「共通設定」を選び、「Gemini APIキー」へ新しいキーを入力します。
   - 「Windowsへ暗号化保存」を押します。このキーはPC版とスマホ版で共有されます。
   - 「スマホ版」へ戻ります。
5. 「Tailscale Serveを自動設定」を押します。
6. 次の状態を確認します。
   - ローカルサーバー: `起動中`
   - Tailscale: `接続済み`
   - スマホ用URL: `準備済み`

初めてTailscale Serveを使う場合は、tailnetのHTTPS機能を有効化するためブラウザで承認を求められることがあります。案内が表示されたら内容を確認して有効化してください。

自動設定に失敗する場合は、PCのPowerShellで次を実行し、表示された案内URLをブラウザで開きます。

```powershell
tailscale serve --yes --bg 43127
tailscale serve status
```

Feature Context Builderの既定ポートは`43127`です。アプリの設定を変更している場合は、そのポート番号へ置き換えてください。`tailscale funnel`は使わないでください。Funnelは公開インターネット向けの別機能です。

## 5. AndroidをFeature Context Builderへ登録する

1. PCのFeature Context Builderで「スマホ登録用QRを表示」を押します。
2. Androidの標準カメラ、Googleレンズ、またはQR読み取り機能を開きます。
3. PC画面のQRコードを読み取ります。
4. 表示されたHTTPSのURLをChromeで開きます。
5. Feature Context Builderのスマホ画面が表示されたら登録完了です。

QRコードは次の安全制限があります。

- 有効期限は5分です。
- 1回だけ利用できます。
- 期限切れや読み取り失敗の場合は、PCでQRコードを閉じて新しく作り直します。
- QR画像やQRの下に表示されるURLを第三者へ送らないでください。

一度登録したAndroidは、セッションが有効な間は毎回QRを読む必要がありません。登録を解除したい場合は、PC画面の「登録済みスマートフォン」から「接続解除」を押します。

## 6. Androidのホーム画面へ追加する

毎回URLを探さずに起動できるよう、ChromeからWebアプリとしてインストールできます。

1. AndroidのChromeでFeature Context Builderを開きます。
2. アドレスバー右側のメニュー`︙`をタップします。
3. 「ホーム画面に追加」または「アプリをインストール」を選びます。
4. 画面の案内に従ってインストールします。
5. Androidのホーム画面にFeature Context Builderのアイコンが追加されたことを確認します。

Chromeのバージョンにより「インストールしてショートカットを作成」など、少し異なる名前で表示されることがあります。

参考: [Androidでウェブアプリを使用する](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=ja)

## 7. Androidからコード調査を実行する

1. AndroidでTailscaleが接続済みであることを確認します。
2. ホーム画面のFeature Context Builderを開きます。
3. PCで登録したプロジェクトを選びます。
4. 調べたい機能・目的を入力します。
5. 使用するAIを選びます。
   - Gemini API
   - Gemini CLI
   - Codex CLI
6. 必要に応じて要約、コード連結、最大ファイル数、最大文字数を変更します。
7. 「コンテキストを生成」を押します。
8. 画面で進捗を確認します。

Gemini CLIまたはCodex CLIを選ぶ場合は、PC側で該当CLIがインストール・認証済みである必要があります。Gemini APIを選ぶ場合は、PC側へAPIキーを暗号化保存しておく必要があります。APIキーがAndroidへ送られることはありません。

処理中はAndroidの画面を閉じてもPC側で処理が続きます。再度スマホ画面を開くと、PCアプリが起動し続けている間は実行履歴から状態を確認できます。

## 8. MarkdownとZIPをスマートフォンで使う

生成が完了すると、次の操作ができます。

- 各Markdownをプレビュー
- Markdownを個別保存
- 対応ブラウザでMarkdownを他アプリへ共有
- 全Markdownを1つのZIPとして保存
- 関連ソースの含める・除外するを変更
- AIを再実行せずにbundleだけ再構築

### ZIPをChatGPTへ添付する流れ

1. 結果画面で「ZIPを保存」をタップします。
2. Androidの`Download`または`ダウンロード`フォルダへ保存します。
3. ChatGPTの添付ボタンをタップします。
4. ファイル選択画面から保存したZIPを選びます。

ZIPには添付用のMarkdownだけが含まれます。PCの絶対パスを含む内部管理用`manifest.json`はZIPへ入れません。

ChatGPT側がZIPを受け付けない場合や、内容を個別に渡したい場合は、生成ファイル一覧からMarkdownを個別保存して添付してください。

## 9. 普段の起動方法

PC側:

1. PCを起動します。
2. Tailscaleが接続済みであることを確認します。
3. Feature Context Builderを起動します。
4. スマホ連携が起動中であることを確認します。

「Windowsログイン時に自動起動し、スマホ連携を待ち受ける」を有効にすると、Feature Context Builderはログイン時にバックグラウンド起動します。ウィンドウを閉じてもスマホ連携が有効ならタスクトレイで動き続けます。

Android側:

1. Tailscaleを接続済みにします。
2. ホーム画面のFeature Context Builderを開きます。

## 10. 接続できないとき

### スマホ画面が開かない

次を上から順に確認します。

1. PCの電源が入っている
2. PCがスリープしていない
3. PCのTailscaleが接続済み
4. AndroidのTailscaleが接続済み
5. PCとAndroidが同じTailscaleアカウント・tailnet
6. Feature Context BuilderがPCで起動中
7. PC画面のローカルサーバーが「起動中」
8. PC画面のスマホ用URLが「準備済み」
9. `tailscale serve status`で転送状態を確認できる

Wi-Fiからモバイル回線、またはモバイル回線からWi-Fiへ切り替えた直後は、AndroidのTailscaleを一度開いて接続状態を確認してください。

### Tailscaleが接続できない

- AndroidのVPN接続許可を拒否していないか確認します。
- 別のVPNアプリを使用中なら、一時的に停止して確認します。AndroidではVPNアプリ同士が競合する場合があります。
- ホテルや店舗のWi-Fiでログイン画面がある場合は、一度Tailscaleを切断し、Wi-Fiのログインを完了してから再接続します。
- AndroidとPCのTailscaleアプリを最新版へ更新します。
- Androidの省電力設定でTailscaleが強く制限されている場合は、Tailscaleを制限対象から外して確認します。

参考:

- [Tailscaleトラブルシューティング](https://tailscale.com/docs/reference/troubleshooting)
- [他のVPNとの併用](https://tailscale.com/docs/reference/faq/other-vpns)

### `EADDRINUSE`または「ポートはすでに使用中」と表示される

以前開いたFeature Context Builderがタスクトレイで動作中のまま、`npm run dev`でもう1つ起動しています。

1. WindowsのタスクトレイでFeature Context Builderを探します。
2. 右クリックして「終了」を選びます。
3. 開いている別のFeature Context Builderも閉じます。
4. `npm run dev`でもう一度起動します。

最新版は二重起動を検出し、新しいプロセスを増やさず既存ウィンドウを前面へ表示します。修正前のアプリが残っている場合だけ、一度タスクトレイから完全終了してください。

### QRコードが無効と表示される

- QRコードの5分の有効期限が切れています。
- 同じQRコードがすでに使用されています。
- PCで新しいQRコードを表示して読み直してください。

### Gemini APIが実行できない

PCのFeature Context Builderで、「共通設定」の「Gemini APIキー」へ新しいキーを入力し、「Windowsへ暗号化保存」を押してください。保存したキーはPC版とスマホ版で共有されます。AndroidへAPIキーを入力する必要はありません。

### Gemini CLIまたはCodex CLIが実行できない

CLIはAndroidではなくPC上で実行されます。PC側でCLIのインストールと認証を確認してください。

```powershell
gemini --version
gemini

codex --version
codex login
```

### ZIPが見つからない

Chromeのダウンロード一覧、AndroidのFilesアプリ、または`Download`フォルダを確認してください。機種により保存時に確認画面が表示されます。

### ホーム画面のアイコンから開けない

ホーム画面へ追加したWebアプリもTailscale経由でPCへ接続します。AndroidのTailscale、PC、Feature Context Builderのすべてが起動中か確認してください。

## 11. 利用を停止・解除する

一時停止:

- AndroidのTailscaleを切断する
- またはPCのFeature Context Builderで「スマホ連携を停止」を押す

特定のAndroidだけを解除:

1. PCのFeature Context Builderを開きます。
2. 「登録済みスマートフォン」を確認します。
3. 対象端末の「接続解除」を押します。

AndroidからWebアプリを削除:

1. Androidの設定を開きます。
2. 「アプリ」からFeature Context Builderを探します。
3. 「アンインストール」を選びます。

ホーム画面から削除しただけでは、PC側に保存された端末登録は解除されません。不要になった端末はPC側でも接続解除してください。

## セキュリティ上の注意

- Feature Context BuilderのQRコードや接続URLを第三者へ共有しないでください。
- PCの登録プロジェクトには、スマホから調査してよいものだけを登録してください。
- 使用しなくなったAndroidはPC画面から接続解除してください。
- Tailscale Funnelやルーターのポート開放は不要です。設定しないでください。
- 成果物をChatGPTなどへ送信する前に、Markdownのプレビューで内容を確認してください。
- `.env`や秘密鍵などは自動除外されますが、ソース内へ独自形式で埋め込まれた秘密情報を完全に検出できるとは限りません。
