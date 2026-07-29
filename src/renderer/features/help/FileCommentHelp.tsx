/**
 * @feature-context
 * @feature in-app help, structured file comments, discovery guidance
 * @role ファイル単位の構造化コメントを、いつ・何の粒度で・どう保守するかの指針を表示する
 * @entry FileCommentHelp
 * @flow author question -> applicability rules -> tag guidance -> examples and maintenance checklist
 * @related ../../App.tsx, ../../../../discovery/structured-comments.ts, ../../../../docs/structured-file-comments.md
 * @caution コメントを実装より優先する仕様書にせず、検索と変更判断に必要な安定情報だけを書く
 */

const template = `/**
 * @feature-context
 * @feature 機能名, related-term
 * @role このファイルが担う責務
 * @entry 外部から呼ばれる主な入口
 * @flow 入口 -> 主要処理 -> 出口
 * @related 密接に関連するシンボルまたはファイル
 * @caution 変更時に守る契約や注意点
 */`;

export function FileCommentHelp() {
  return (
    <section className="panel help-panel" aria-labelledby="file-comment-help-title">
      <div className="section-heading">
        <div>
          <span className="step-number">HELP</span>
          <h2 id="file-comment-help-title">ファイル単位のコメント指針</h2>
        </div>
        <p>人とローカル探索が、機能・責務・変更時の注意を同じ言葉で見つけるための短い索引です。</p>
      </div>

      <div className="help-callout">
        <strong>コメントは仕様書ではありません。</strong>
        <p>実コードを正とし、コードを読めば分かる処理手順ではなく「なぜこのファイルが存在し、どの契約を守るか」を残します。</p>
      </div>

      <div className="help-grid">
        <article>
          <h3>付ける対象</h3>
          <ul>
            <li>新しく作る、プロジェクト所有の実装ファイル</li>
            <li>責務、主要な処理フロー、外部との境界を変更したファイル</li>
            <li>名前だけでは所属機能や役割を判断しにくい設定・adapter・共通処理</li>
            <li><code>src/discovery</code>配下の実装</li>
          </ul>
        </article>
        <article>
          <h3>原則として付けない対象</h3>
          <ul>
            <li>生成コード、vendor、外部から取り込んだコード</li>
            <li>型宣言だけのファイル、単純な再export</li>
            <li>内容が自明で、独立した責務を持たない小さなファイル</li>
            <li>一時的な作業メモや変更履歴。履歴はGitへ残す</li>
          </ul>
        </article>
      </div>

      <article className="help-section">
        <h3>基本形</h3>
        <p><code>@feature</code>と<code>@role</code>は必須です。それ以外は情報があるときだけ書きます。</p>
        <pre className="help-code"><code>{template}</code></pre>
      </article>

      <article className="help-section">
        <h3>タグごとの粒度</h3>
        <div className="help-tag-list">
          <div><code>@feature</code><span>利用者が検索しそうな機能名、ドメイン語、英日同義語。module名の羅列にはしない。</span></div>
          <div><code>@role</code><span>「何を知り、何を決めるファイルか」を1文で書く。内部手順の実況は避ける。</span></div>
          <div><code>@entry</code><span>外部から呼ばれる関数、class、command、route、componentなどの主入口だけを書く。</span></div>
          <div><code>@flow</code><span>入口から主要処理、出口までを短くつなぐ。すべての分岐やprivate関数は列挙しない。</span></div>
          <div><code>@related</code><span>一緒に変更判断が必要な密接なsymbol・fileだけを書く。import一覧の複製にはしない。</span></div>
          <div><code>@caution</code><span>互換性、安全性、順序、再試行、永続化など、変更時に壊しやすい契約を書く。</span></div>
        </div>
      </article>

      <div className="help-grid">
        <article>
          <h3>良いコメント</h3>
          <ul>
            <li>実装の変更後も意味が残る、安定した責務を表す</li>
            <li>ファイルを開かなくても関連候補だと判断できる</li>
            <li>入口、出口、守る契約を短く特定できる</li>
            <li>検索に使う日本語・英語の語彙を必要な範囲で含む</li>
          </ul>
        </article>
        <article>
          <h3>避けるコメント</h3>
          <ul>
            <li>「各種処理を行う」「便利機能」のように責務が曖昧</li>
            <li>関数名やimportをすべて写しただけ</li>
            <li>過去の変更内容、担当者、日付、TODOの保管場所</li>
            <li>実装に存在しない理想状態や、未確定の仕様を断定する</li>
          </ul>
        </article>
      </div>

      <article className="help-section">
        <h3>変更時のチェック</h3>
        <ol>
          <li>所属機能や検索語が変わったら<code>@feature</code>を更新する。</li>
          <li>責務を移したら<code>@role</code>と<code>@related</code>を更新する。</li>
          <li>公開入口や主要flowが変わったら<code>@entry</code>と<code>@flow</code>を更新する。</li>
          <li>新しい互換性・安全性契約が生まれたら<code>@caution</code>へ残す。</li>
          <li>コメントと実装が食い違う場合は、実装を正としてコメントを直す。</li>
        </ol>
      </article>
    </section>
  );
}
