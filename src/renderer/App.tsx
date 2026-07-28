import { useEffect, useMemo, useState } from "react";
import type {
  BuildOptions,
  BuildResult,
  AiProvider,
  ProgressEvent,
  ProgressStage,
  ValidationRecord
} from "../core/types";

const baseProgressSteps: Array<{ stage: ProgressStage; label: string }> = [
  { stage: "checking-cli", label: "AI CLIを確認中" },
  { stage: "investigating", label: "コードベースを調査中" },
  { stage: "validating", label: "関連ファイルを検証中" },
  { stage: "collecting", label: "コードを収集中" },
  { stage: "packing", label: "添付用ファイルへ整理中" }
];

type RunState = "idle" | "running" | "completed" | "error" | "cancelled";
const defaultGeminiApiModel = "gemini-3.5-flash";

export function App() {
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiApiModel, setGeminiApiModel] = useState(defaultGeminiApiModel);
  const [projectRoot, setProjectRoot] = useState("");
  const [feature, setFeature] = useState("");
  const [summary, setSummary] = useState(true);
  const [concat, setConcat] = useState(true);
  const [maxFiles, setMaxFiles] = useState(5);
  const [maxChars, setMaxChars] = useState(120_000);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(
    () =>
      window.featureContext.onProgress((incomingJobId, event) => {
        if (incomingJobId === jobId) setProgress(event);
      }),
    [jobId]
  );

  const options: BuildOptions = useMemo(
    () => ({
      projectRoot,
      feature: feature.trim(),
      provider,
      ...(provider === "gemini-api"
        ? { geminiApiKey, geminiApiModel: geminiApiModel.trim() }
        : {}),
      summary,
      concat,
      maxOutputFiles: maxFiles,
      maxTotalChars: maxChars
    }),
    [
      projectRoot,
      feature,
      provider,
      geminiApiKey,
      geminiApiModel,
      summary,
      concat,
      maxFiles,
      maxChars
    ]
  );
  const providerName =
    provider === "codex" ? "Codex CLI" : provider === "gemini-api" ? "Gemini API" : "Gemini CLI";
  const progressSteps = baseProgressSteps.map((step) =>
    step.stage === "checking-cli" ? { ...step, label: `${providerName}を確認中` } : step
  );

  const canGenerate =
    runState !== "running" &&
    projectRoot.trim().length > 0 &&
    feature.trim().length > 0 &&
    maxFiles >= 1 &&
    maxFiles <= 5 &&
    maxChars >= 1000;

  async function chooseFolder() {
    const selected = await window.featureContext.selectFolder();
    if (selected) setProjectRoot(selected);
  }

  async function generate(force = false) {
    const id = crypto.randomUUID();
    setJobId(id);
    setRunState("running");
    setProgress({ stage: "checking-cli", message: `${providerName}を確認中` });
    setError(null);
    setNotice("");
    setPreview(null);
    try {
      const next = await window.featureContext.start(id, { ...options, force });
      acceptResult(next);
    } catch (caught) {
      const problem = normalizeError(caught);
      if (
        !force &&
        (problem.code === "OUTPUT_EXISTS" || problem.message.includes("同名の成果物"))
      ) {
        setRunState("idle");
        if (window.confirm("同名の成果物があります。内容を確認したうえで上書きしますか？")) {
          await generate(true);
        }
        return;
      }
      setError({ message: problem.message, details: problem.details });
      setRunState(problem.code === "CANCELLED" ? "cancelled" : "error");
    } finally {
      setJobId((current) => (current === id ? null : current));
    }
  }

  async function regenerate() {
    if (window.confirm(`現在の成果物を上書きし、${providerName}の調査から再実行しますか？`)) {
      await generate(true);
    }
  }

  async function cancel() {
    if (!jobId) return;
    await window.featureContext.cancel(jobId);
  }

  async function rebuild() {
    if (!result) return;
    const id = crypto.randomUUID();
    setJobId(id);
    setRunState("running");
    setError(null);
    setNotice("");
    try {
      const next = await window.featureContext.rebuild(id, {
        manifestPath: result.manifestPath,
        selections,
        maxOutputFiles: maxFiles,
        maxTotalChars: maxChars,
        force: true
      });
      acceptResult(next);
      setNotice("AIを再実行せず、選択内容からbundleを再構築しました。");
    } catch (caught) {
      const problem = normalizeError(caught);
      setError({ message: problem.message, details: problem.details });
      setRunState(problem.code === "CANCELLED" ? "cancelled" : "error");
    } finally {
      setJobId((current) => (current === id ? null : current));
    }
  }

  function acceptResult(next: BuildResult) {
    setResult(next);
    setSelections(next.manifest.selections);
    setRunState("completed");
    setProgress({ stage: "completed", message: "完了" });
  }

  async function showPreview(filePath: string, name: string) {
    try {
      setPreview({ name, content: await window.featureContext.readArtifact(filePath) });
    } catch (caught) {
      setError({ message: normalizeError(caught).message });
    }
  }

  async function copyOverview() {
    const overview = result?.manifest.bundleFiles.find((file) => file.name === "01-overview.md");
    if (!overview) return;
    await window.featureContext.copyOverview(overview.path);
    setNotice("01-overview.mdをクリップボードへコピーしました。");
  }

  const currentStep = progressSteps.findIndex((item) => item.stage === progress?.stage);
  const errorDetails = error ? error.details || `message=${error.message}` : "";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">READ-ONLY CODE RESEARCH</p>
          <h1>Feature Context Builder</h1>
          <p className="subtitle">
            調べたい機能を指定すると、選択したAIが関連コードを探し、ChatGPTへ添付しやすいMarkdownに整理します。
          </p>
        </div>
        <span className={`status-badge status-${runState}`}>
          {runState === "running"
            ? "実行中"
            : runState === "completed"
              ? "完了"
              : runState === "error"
                ? "エラー"
                : runState === "cancelled"
                  ? "キャンセル済み"
                  : "待機中"}
        </span>
      </header>

      <main>
        <section className="panel input-panel" aria-labelledby="input-title">
          <div className="section-heading">
            <div>
              <span className="step-number">01</span>
              <h2 id="input-title">調査内容</h2>
            </div>
            <p>まずプロジェクトフォルダと、知りたい機能を入力してください。</p>
          </div>

          <div className="field">
            <label htmlFor="project-root">プロジェクトフォルダ</label>
            <div className="path-input">
              <input
                id="project-root"
                value={projectRoot}
                onChange={(event) => setProjectRoot(event.target.value)}
                placeholder="例: C:\projects\my-app"
                disabled={runState === "running"}
              />
              <button type="button" className="secondary" onClick={chooseFolder} disabled={runState === "running"}>
                フォルダを選択
              </button>
            </div>
            <small>ソースは読み取りのみです。成果物はプロジェクト内の .feature-context に保存します。</small>
          </div>

          <div className="field">
            <label htmlFor="feature">調べたい機能・目的</label>
            <textarea
              id="feature"
              rows={4}
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
              placeholder="例: ログイン画面からトークン保存までの認証フロー"
              disabled={runState === "running"}
            />
          </div>

          <div className="field">
            <label htmlFor="provider">調査に使うAI</label>
            <select
              id="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as AiProvider)}
              disabled={runState === "running"}
            >
              <option value="gemini">Gemini CLI</option>
              <option value="gemini-api">Gemini API</option>
              <option value="codex">Codex CLI</option>
            </select>
            <small>
              CLIは読み取り専用で実行します。Gemini APIでは、安全性を検査したコード索引をGoogleへ送信します。
            </small>
          </div>

          {provider === "gemini-api" && (
            <div className="api-settings" aria-label="Gemini API設定">
              <div className="field">
                <label htmlFor="gemini-api-key">Gemini APIキー</label>
                <input
                  id="gemini-api-key"
                  type="password"
                  value={geminiApiKey}
                  onChange={(event) => setGeminiApiKey(event.target.value)}
                  placeholder="Google AI Studioで取得したAPIキー"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={runState === "running"}
                />
                <small>
                  このキーは成果物や設定ファイルへ保存しません。未入力時はGEMINI_API_KEYを使用します。
                </small>
              </div>
              <div className="field">
                <label htmlFor="gemini-api-model">モデル</label>
                <input
                  id="gemini-api-model"
                  value={geminiApiModel}
                  onChange={(event) => setGeminiApiModel(event.target.value)}
                  spellCheck={false}
                  disabled={runState === "running"}
                />
                <small>
                  既定値は無料枠で利用可能な安定版Flashです。利用できない場合はAI Studioのモデル名へ変更してください。
                </small>
              </div>
              <p className="api-disclosure">
                Gemini APIを選ぶと、.env・秘密鍵・gitignore対象・バイナリ等を除外したコード内容が外部APIへ送信されます。
                送信上限を超える部分はパス一覧だけを利用します。
              </p>
            </div>
          )}

          <div className="option-grid">
            <label className="check-card">
              <input
                type="checkbox"
                checked={summary}
                onChange={(event) => setSummary(event.target.checked)}
                disabled={runState === "running"}
              />
              <span><strong>要約を生成</strong><small>目的、処理フロー、注意点をoverviewへ追加</small></span>
            </label>
            <label className="check-card">
              <input
                type="checkbox"
                checked={concat}
                onChange={(event) => setConcat(event.target.checked)}
                disabled={runState === "running"}
              />
              <span><strong>関連コードを連結</strong><small>検証済みの実ファイルをMarkdownへ収録</small></span>
            </label>
          </div>

          <div className="limit-grid">
            <div className="field">
              <label htmlFor="max-files">添付用ファイル数の上限</label>
              <select
                id="max-files"
                value={maxFiles}
                onChange={(event) => setMaxFiles(Number(event.target.value))}
                disabled={runState === "running"}
              >
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}ファイル</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="max-chars">コンテキスト全体の文字数上限</label>
              <input
                id="max-chars"
                type="number"
                min={1000}
                step={1000}
                value={maxChars}
                onChange={(event) => setMaxChars(Number(event.target.value))}
                disabled={runState === "running"}
              />
            </div>
          </div>

          <div className="actions">
            <button type="button" className="primary" onClick={() => generate()} disabled={!canGenerate}>
              コンテキストを生成
            </button>
            <button type="button" className="danger-quiet" onClick={cancel} disabled={runState !== "running"}>
              キャンセル
            </button>
          </div>
        </section>

        <section className="panel progress-panel" aria-labelledby="progress-title" aria-live="polite">
          <div className="section-heading compact">
            <div><span className="step-number">02</span><h2 id="progress-title">実行状況</h2></div>
            <p>{progress?.message ?? "生成を開始すると、ここに進捗を表示します。"}</p>
          </div>
          <ol className="progress-list">
            {progressSteps.map((item, index) => {
              const state =
                runState === "completed" || currentStep > index
                  ? "done"
                  : currentStep === index && runState === "running"
                    ? "active"
                    : "pending";
              return (
                <li key={item.stage} className={state}>
                  <span className="progress-dot" aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ol>
          {error && (
            <div className="error-box" role="alert">
              <strong>{error.message}</strong>
              <p>入力や選択したAIの認証状態を確認して、もう一度実行できます。</p>
              <details><summary>技術的な詳細</summary><pre>{errorDetails}</pre></details>
            </div>
          )}
          {notice && <div className="notice" role="status">{notice}</div>}
        </section>

        {result && (
          <ResultPanel
            result={result}
            selections={selections}
            setSelections={setSelections}
            running={runState === "running"}
            onPreview={showPreview}
            onOpen={() => window.featureContext.openOutput(result.outputDir)}
            onCopy={copyOverview}
            onRegenerate={regenerate}
            onRebuild={rebuild}
          />
        )}
      </main>

      {preview && (
        <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="preview-title">
          <section className="preview-dialog">
            <header>
              <h2 id="preview-title">{preview.name}</h2>
              <button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="プレビューを閉じる">×</button>
            </header>
            <pre tabIndex={0}>{preview.content}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

interface ResultPanelProps {
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

function ResultPanel(props: ResultPanelProps) {
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
          label={`${providerDisplayName(manifest.provider.id)}が検出`}
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

function providerDisplayName(provider: AiProvider): string {
  if (provider === "codex") return "Codex";
  if (provider === "gemini-api") return "Gemini API";
  return "Gemini";
}

function normalizeError(error: unknown): { message: string; code?: string; details?: string } {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string };
    return { message: value.message ?? "予期しないエラーが発生しました。", code: value.code, details: value.details };
  }
  return { message: String(error) };
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
