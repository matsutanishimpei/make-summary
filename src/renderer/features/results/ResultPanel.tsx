import { getProviderDescriptor } from "../../../contracts/providers";
import type { BuildResult, ValidationRecord } from "../../../core/types";

export interface ResultPanelProps {
  result: BuildResult;
  selections: Record<string, boolean>;
  setSelections: (value: Record<string, boolean>) => void;
  running: boolean;
  onPreview: (path: string, name: string) => void;
  onOpen: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
  onRebuild: () => void;
}

export function ResultPanel(props: ResultPanelProps) {
  const { manifest } = props.result;
  const tree = renderTree(manifest.relatedFiles.filter((file) => file.valid));
  return (
    <section className="panel result-panel" aria-labelledby="result-title">
      <div className="section-heading">
        <div><span className="step-number">03</span><h2 id="result-title">生成結果</h2></div>
        <p>{manifest.feature}</p>
      </div>

      <div className="metrics">
        <Metric
          label={`${getProviderDescriptor(manifest.provider.id).label}が検出`}
          value={`${manifest.validation.detected}件`}
        />
        <Metric label="コードへ採用" value={`${new Set(manifest.bundledSources.map((item) => item.path)).size}件`} />
        <Metric label="添付用ファイル" value={`${manifest.bundleFiles.length}件`} />
        <Metric label="合計文字数" value={manifest.totalChars.toLocaleString()} />
        <Metric label="概算トークン" value={`約${manifest.estimatedTokens.toLocaleString()}`} />
      </div>
      <p className="estimate-note">{manifest.tokenEstimateMethod}</p>

      <div className="result-grid">
        <div>
          <h3>関連コードツリー</h3>
          <pre className="tree">{tree || "(有効な関連ファイルなし)"}</pre>
        </div>
        <div>
          <h3>警告と不明点</h3>
          <ul className="plain-list">
            {[...manifest.warnings, ...manifest.uncertainties].length
              ? [...manifest.warnings, ...manifest.uncertainties].map((item, index) => <li key={index}>{item}</li>)
              : <li>警告・不明点はありません。</li>}
          </ul>
        </div>
      </div>

      <div className="source-selection">
        <div className="subheading">
          <div><h3>関連ソースの選択</h3><p>変更後はAIを再実行せず、bundleだけを再構築できます。</p></div>
          <button type="button" className="secondary" onClick={props.onRebuild} disabled={props.running}>
            選択内容でbundleを再構築
          </button>
        </div>
        <div className="source-table-wrap">
          <table>
            <thead><tr><th>含める</th><th>パス</th><th>優先度</th><th>役割・選定理由</th></tr></thead>
            <tbody>
              {manifest.relatedFiles.map((file, index) => {
                const key = file.normalizedPath ?? file.path;
                return (
                  <tr key={`${key}-${index}`} className={!file.valid ? "excluded-row" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${key}を含める`}
                        checked={Boolean(props.selections[key])}
                        disabled={!file.valid || props.running}
                        onChange={(event) =>
                          props.setSelections({ ...props.selections, [key]: event.target.checked })
                        }
                      />
                    </td>
                    <td><code>{key}</code>{!file.valid && <span className="reason">{file.exclusionReason}</span>}</td>
                    <td><span className={`priority priority-${file.priority}`}>{file.priority}</span></td>
                    <td>{file.role}<small>{file.reason}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="omissions">
        <h3>除外・未収録ファイルと理由</h3>
        <ul className="plain-list">
          {manifest.omittedSources.length
            ? manifest.omittedSources.map((item, index) => <li key={`${item.path}-${index}`}><code>{item.path}</code> — {item.reason}</li>)
            : <li>ありません。</li>}
        </ul>
      </div>

      <div className="artifacts">
        <h3>生成ファイル</h3>
        {manifest.bundleFiles.map((file) => (
          <div className="artifact-row" key={file.name}>
            <div><strong>{file.name}</strong><small>{file.chars.toLocaleString()}文字</small></div>
            <button type="button" className="text-button" onClick={() => props.onPreview(file.path, file.name)}>プレビュー</button>
          </div>
        ))}
      </div>

      <div className="actions result-actions">
        <button type="button" className="secondary" onClick={props.onOpen}>出力フォルダを開く</button>
        <button type="button" className="secondary" onClick={props.onCopy}>overviewをコピー</button>
        <button type="button" className="secondary" onClick={props.onRegenerate} disabled={props.running}>成果物全体を再生成</button>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function renderTree(records: ValidationRecord[]): string {
  const paths = records
    .map((record) => record.normalizedPath)
    .filter((value): value is string => Boolean(value))
    .sort();
  const root: Record<string, unknown> = {};
  for (const filePath of paths) {
    let node = root;
    for (const part of filePath.split("/")) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
  }
  const lines: string[] = [];
  const visit = (node: Record<string, unknown>, prefix = "") => {
    const entries = Object.entries(node);
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      const children = child as Record<string, unknown>;
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${name}${Object.keys(children).length ? "/" : ""}`);
      visit(children, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(root);
  return lines.join("\n");
}
