import { useEffect, useState } from "react";
import type { AiProvider, ProgressStage } from "../core/types";
import type {
  MobileBuildRequest,
  MobileProject,
  RemoteJob
} from "../gateway/types";

const progressLabels: Array<{ stage: ProgressStage; label: string }> = [
  { stage: "checking-cli", label: "AIを確認" },
  { stage: "investigating", label: "コードを調査" },
  { stage: "validating", label: "ファイルを検証" },
  { stage: "collecting", label: "コードを収集" },
  { stage: "packing", label: "成果物を作成" }
];

export function MobileApp() {
  const [booting, setBooting] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [projects, setProjects] = useState<MobileProject[]>([]);
  const [jobs, setJobs] = useState<RemoteJob[]>([]);
  const [activeJob, setActiveJob] = useState<RemoteJob | null>(null);
  const [feature, setFeature] = useState("");
  const [projectId, setProjectId] = useState("");
  const [provider, setProvider] = useState<AiProvider>("gemini-api");
  const [summary, setSummary] = useState(true);
  const [concat, setConcat] = useState(true);
  const [maxFiles, setMaxFiles] = useState(5);
  const [maxChars, setMaxChars] = useState(120_000);
  const [model, setModel] = useState("gemini-3.5-flash");
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!activeJob || !["queued", "running"].includes(activeJob.state)) return;
    const events = new EventSource(`/api/v1/jobs/${activeJob.id}/events`, {
      withCredentials: true
    });
    events.addEventListener("job", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as RemoteJob;
      setActiveJob(next);
      setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      if (next.result) setSelections(next.result.selections);
      if (!["queued", "running"].includes(next.state)) events.close();
    });
    events.onerror = () => {
      events.close();
      void refreshJob(activeJob.id);
    };
    return () => events.close();
  }, [activeJob?.id, activeJob?.state]);

  async function initialize() {
    setBooting(true);
    setError("");
    try {
      const pairToken = new URLSearchParams(location.hash.slice(1)).get("pair");
      if (pairToken) {
        await api("/api/v1/pair", {
          method: "POST",
          body: JSON.stringify({ token: pairToken, deviceName })
        });
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      }
      const session = await api<{ authenticated: boolean }>("/api/v1/session");
      setAuthenticated(session.authenticated);
      if (session.authenticated) await loadDashboard();
    } catch (caught) {
      setAuthenticated(false);
      setError(errorMessage(caught));
    } finally {
      setBooting(false);
    }
  }

  async function loadDashboard() {
    const [projectResponse, jobResponse] = await Promise.all([
      api<{ projects: MobileProject[] }>("/api/v1/projects"),
      api<{ jobs: RemoteJob[] }>("/api/v1/jobs")
    ]);
    setProjects(projectResponse.projects);
    setProjectId((current) => current || projectResponse.projects[0]?.id || "");
    setJobs(jobResponse.jobs);
    const latest = jobResponse.jobs[0];
    if (latest) {
      setActiveJob(latest);
      if (latest.result) setSelections(latest.result.selections);
    }
  }

  async function startJob() {
    setError("");
    setNotice("");
    setPreview(null);
    const request: MobileBuildRequest = {
      projectId,
      feature: feature.trim(),
      provider,
      summary,
      concat,
      maxOutputFiles: maxFiles,
      maxTotalChars: maxChars,
      ...(provider === "gemini-api" ? { geminiApiModel: model.trim() } : {})
    };
    try {
      const response = await api<{ job: RemoteJob }>("/api/v1/jobs", {
        method: "POST",
        body: JSON.stringify(request)
      });
      setActiveJob(response.job);
      setJobs((current) => [response.job, ...current]);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function cancelJob() {
    if (!activeJob) return;
    await api(`/api/v1/jobs/${activeJob.id}/cancel`, {
      method: "POST",
      body: "{}"
    });
    setNotice("キャンセルを要求しました。");
  }

  async function refreshJob(id: string) {
    try {
      const response = await api<{ job: RemoteJob }>(`/api/v1/jobs/${id}`);
      setActiveJob(response.job);
      if (response.job.result) setSelections(response.job.result.selections);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function rebuild() {
    if (!activeJob?.result) return;
    setError("");
    try {
      const response = await api<{ job: RemoteJob }>(
        `/api/v1/jobs/${activeJob.id}/rebuild`,
        {
          method: "POST",
          body: JSON.stringify({
            selections,
            maxOutputFiles: maxFiles,
            maxTotalChars: maxChars
          })
        }
      );
      setActiveJob(response.job);
      setJobs((current) => [response.job, ...current]);
      setNotice("AIを再実行せずbundleを再構築しています。");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function showPreview(name: string) {
    if (!activeJob) return;
    try {
      const response = await fetch(
        `/api/v1/jobs/${activeJob.id}/artifacts/${encodeURIComponent(name)}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("プレビューを取得できませんでした。");
      setPreview({ name, content: await response.text() });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function shareArtifacts() {
    if (!activeJob?.result) return;
    try {
      const files = await Promise.all(
        activeJob.result.artifacts.map(async (artifact) => {
          const response = await fetch(
            `/api/v1/jobs/${activeJob.id}/artifacts/${encodeURIComponent(artifact.name)}`,
            { credentials: "include" }
          );
          if (!response.ok) throw new Error(`${artifact.name}を取得できませんでした。`);
          return new File([await response.blob()], artifact.name, { type: "text/markdown" });
        })
      );
      const shareData = { title: activeJob.feature, files };
      if (!navigator.canShare?.(shareData)) {
        setNotice("このブラウザは複数ファイル共有に未対応です。ZIPをダウンロードしてください。");
        return;
      }
      await navigator.share(shareData);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(errorMessage(caught));
    }
  }

  async function logout() {
    await api("/api/v1/logout", { method: "POST", body: "{}" });
    setAuthenticated(false);
    setProjects([]);
    setJobs([]);
    setActiveJob(null);
  }

  if (booting) {
    return <CenteredMessage title="接続を確認中" body="PCとの安全な接続を確認しています。" />;
  }

  if (!authenticated) {
    return (
      <main className="mobile-shell pairing-screen">
        <section className="mobile-card pairing-card">
          <p className="mobile-eyebrow">FEATURE CONTEXT BUILDER</p>
          <h1>スマホ連携</h1>
          <p>PC画面に表示したQRコードを、このスマートフォンで読み取ってください。</p>
          <label>
            この端末の名前
            <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
          </label>
          {error && <div className="mobile-error">{error}</div>}
          <button type="button" onClick={initialize}>接続を再確認</button>
        </section>
      </main>
    );
  }

  const running = activeJob && ["queued", "running"].includes(activeJob.state);
  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div>
          <p className="mobile-eyebrow">READ-ONLY REMOTE</p>
          <h1>Feature Context</h1>
        </div>
        <button type="button" className="quiet-button" onClick={logout}>連携解除</button>
      </header>

      <main>
        <section className="mobile-card">
          <h2>新しい調査</h2>
          {projects.length === 0 ? (
            <div className="mobile-empty">
              PC側でプロジェクトフォルダを「スマホ利用に登録」してください。
            </div>
          ) : (
            <>
              <label>
                プロジェクト
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.label}</option>
                  ))}
                </select>
              </label>
              <label>
                調べたい機能・目的
                <textarea
                  rows={4}
                  value={feature}
                  onChange={(event) => setFeature(event.target.value)}
                  placeholder="例: ログイン画面からトークン保存まで"
                />
              </label>
              <label>
                調査に使うAI
                <select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)}>
                  <option value="gemini-api">Gemini API</option>
                  <option value="gemini">Gemini CLI</option>
                  <option value="codex">Codex CLI</option>
                </select>
              </label>
              {provider === "gemini-api" && (
                <label>
                  Geminiモデル
                  <input value={model} onChange={(event) => setModel(event.target.value)} />
                  <small>APIキーはPCに保存されたものを利用します。</small>
                </label>
              )}
              <div className="mobile-checks">
                <label><input type="checkbox" checked={summary} onChange={(event) => setSummary(event.target.checked)} />要約</label>
                <label><input type="checkbox" checked={concat} onChange={(event) => setConcat(event.target.checked)} />コード連結</label>
              </div>
              <div className="mobile-limits">
                <label>
                  最大ファイル数
                  <select value={maxFiles} onChange={(event) => setMaxFiles(Number(event.target.value))}>
                    {[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  最大文字数
                  <input type="number" min={1000} value={maxChars} onChange={(event) => setMaxChars(Number(event.target.value))} />
                </label>
              </div>
              <button
                type="button"
                onClick={startJob}
                disabled={Boolean(running) || !feature.trim() || !projectId}
              >
                コンテキストを生成
              </button>
            </>
          )}
        </section>

        {error && <div className="mobile-error" role="alert">{error}</div>}
        {notice && <div className="mobile-notice">{notice}</div>}

        {activeJob && (
          <JobPanel
            job={activeJob}
            selections={selections}
            setSelections={setSelections}
            onCancel={cancelJob}
            onPreview={showPreview}
            onShare={shareArtifacts}
            onRebuild={rebuild}
          />
        )}

        {jobs.length > 1 && (
          <section className="mobile-card">
            <h2>このPCでの実行履歴</h2>
            <div className="job-history">
              {jobs.map((job) => (
                <button
                  type="button"
                  className={job.id === activeJob?.id ? "selected-job" : ""}
                  key={job.id}
                  onClick={() => {
                    setActiveJob(job);
                    if (job.result) setSelections(job.result.selections);
                  }}
                >
                  <span>{job.feature}</span>
                  <small>{job.projectLabel} · {stateLabel(job.state)}</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      {preview && (
        <div className="mobile-preview" role="dialog" aria-modal="true">
          <section>
            <header>
              <strong>{preview.name}</strong>
              <button type="button" onClick={() => setPreview(null)}>閉じる</button>
            </header>
            <pre>{preview.content}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

interface JobPanelProps {
  job: RemoteJob;
  selections: Record<string, boolean>;
  setSelections: (value: Record<string, boolean>) => void;
  onCancel: () => void;
  onPreview: (name: string) => void;
  onShare: () => void;
  onRebuild: () => void;
}

function JobPanel(props: JobPanelProps) {
  const { job } = props;
  const currentIndex = progressLabels.findIndex((item) => item.stage === job.progress?.stage);
  const running = ["queued", "running"].includes(job.state);
  return (
    <section className="mobile-card job-card">
      <div className="job-heading">
        <div><small>{job.projectLabel}</small><h2>{job.feature}</h2></div>
        <span className={`mobile-status status-${job.state}`}>{stateLabel(job.state)}</span>
      </div>

      {running && (
        <>
          <ol className="mobile-progress">
            {progressLabels.map((item, index) => (
              <li key={item.stage} className={index <= currentIndex ? "reached" : ""}>
                <span>{index < currentIndex ? "✓" : index + 1}</span>{item.label}
              </li>
            ))}
          </ol>
          <p className="progress-message">{job.progress?.message ?? "開始しています…"}</p>
          <button type="button" className="danger-button" onClick={props.onCancel}>キャンセル</button>
        </>
      )}

      {job.error && <div className="mobile-error">{job.error.message}</div>}

      {job.result && (
        <>
          <div className="mobile-metrics">
            <div><span>関連ソース</span><strong>{job.result.detectedFiles}</strong></div>
            <div><span>コード採用</span><strong>{job.result.bundledSourceFiles}</strong></div>
            <div><span>添付文字数</span><strong>{job.result.totalChars.toLocaleString()}</strong></div>
          </div>

          <div className="mobile-actions">
            <a className="primary-link" href={job.result.zipUrl}>ZIPを保存</a>
            <button type="button" onClick={props.onShare}>Markdownを共有</button>
          </div>

          <h3>生成ファイル</h3>
          <div className="mobile-artifacts">
            {job.result.artifacts.map((artifact) => (
              <div key={artifact.name}>
                <button type="button" onClick={() => props.onPreview(artifact.name)}>{artifact.name}</button>
                <a href={artifact.downloadUrl}>保存</a>
              </div>
            ))}
          </div>

          <details className="mobile-sources">
            <summary>関連ソースを選び直す</summary>
            {job.result.relatedFiles.map((file, index) => {
              const key = file.normalizedPath ?? file.path;
              return (
                <label key={`${key}-${index}`} className={!file.valid ? "invalid-source" : ""}>
                  <input
                    type="checkbox"
                    checked={Boolean(props.selections[key])}
                    disabled={!file.valid}
                    onChange={(event) =>
                      props.setSelections({ ...props.selections, [key]: event.target.checked })
                    }
                  />
                  <span><code>{key}</code><small>{file.role} — {file.reason}</small></span>
                </label>
              );
            })}
            <button type="button" onClick={props.onRebuild}>選択内容で再構築</button>
          </details>

          {[...job.result.warnings, ...job.result.uncertainties].length > 0 && (
            <details className="mobile-warnings">
              <summary>警告と不明点</summary>
              <ul>
                {[...job.result.warnings, ...job.result.uncertainties].map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mobile-shell pairing-screen">
      <section className="mobile-card pairing-card"><h1>{title}</h1><p>{body}</p></section>
    </main>
  );
}

async function api<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  const value = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message ?? `HTTP ${response.status}`);
  return value;
}

function stateLabel(state: RemoteJob["state"]): string {
  const labels: Record<RemoteJob["state"], string> = {
    queued: "待機中",
    running: "実行中",
    completed: "完了",
    error: "エラー",
    cancelled: "キャンセル"
  };
  return labels[state];
}

function defaultDeviceName(): string {
  const platform = navigator.userAgent.includes("iPhone")
    ? "iPhone"
    : navigator.userAgent.includes("Android")
      ? "Android"
      : "スマートフォン";
  return `${platform} (${new Date().toLocaleDateString("ja-JP")})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
