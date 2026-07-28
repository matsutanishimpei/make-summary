# Repository instructions

## Structured file comments

新規作成、または責務・処理フロー・主要依存を変更するプロジェクト所有のソースファイルには、ファイル先頭へ構造化コメントを付けてください。

```ts
/**
 * @feature-context
 * @feature 機能名, related-term
 * @role このファイルが担う責務
 * @entry 外部から呼ばれる主な入口
 * @flow 入口 -> 主要処理 -> 出口
 * @related 密接に関連するシンボルまたはファイル
 * @caution 変更時に守る契約や注意点
 */
```

- `@feature`と`@role`は必須です。
- 複数値はカンマ、読点、または`|`で区切ります。
- 実装変更時はコメントも更新し、古い説明を残さないでください。
- コメントは検索の強い手掛かりですが、実コードより優先される仕様書ではありません。
- 生成コード、vendor、型宣言だけのファイル、単純な再exportだけのファイルは対象外です。
- `src/discovery`配下のファイルは、例外なく構造化コメントを付けてください。

## Verification

変更後は最低限、次を実行してください。

```powershell
npm test
npm run typecheck
npm run build
```
