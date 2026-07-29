/**
 * @feature-context
 * @feature mobile workflow, automatic source inclusion, remote bundle
 * @role 登録projectの調査、進捗、成果物共有、容量条件だけを使う再構築をスマホから操作する
 * @entry MobileApp
 * @flow authenticated mobile request -> remote build -> automatic source packing -> share or capacity rebuild
 * @related features/jobs/JobPanel.tsx, api/mobile-client.ts, ../gateway/types.ts
 * @caution file単位のselectionsを送信せず、PC側で検証済みの関連候補を自動収録する
 */

import { useEffect, useState } from "react";
import type { AiProvider } from "../core/types";
import { FEATURE_CONTEXT_DEFAULTS } from "../contracts/defaults";
import type {
  MobileBuildRequest,
  MobileProject,
  RemoteJob
} from "../gateway/types";
import { fetchArtifact, mobileApi as api } from "./api/mobile-client";
import { CenteredMessage } from "./components/CenteredMessage";
import { JobPanel } from "./features/jobs/JobPanel";
import { defaultDeviceName, errorMessage, stateLabel } from "./utils";

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
  const [maxFiles, setMaxFiles] = useState<number>(FEATURE_CONTEXT_DEFAULTS.maxOutputFiles);
  const [maxChars, setMaxChars] = useState<number>(FEATURE_CONTEXT_DEFAULTS.maxTotalChars);
  const [model, setModel] = useState<string>(FEATURE_CONTEXT_DEFAULTS.geminiApiModel);
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
      const response = await fetchArtifact(activeJob.id, name);
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
          const response = await fetchArtifact(activeJob.id, artifact.name);
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
