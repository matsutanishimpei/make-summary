/**
 * @feature-context
 * @feature desktop workflow, automatic related-source inclusion, result actions
 * @role PC版の調査条件、進捗、成果物操作、容量再構築、ファイルコメントhelpを統括する
 * @entry App
 * @flow user investigation settings -> build -> automatic source packing -> preview or capacity rebuild
 * @related features/results/ResultPanel.tsx, features/help/FileCommentHelp.tsx, ../contracts/desktop.ts
 * @caution 関連候補のfile単位選択UIを持たず、安全な候補はcoreの優先順位で自動収録する
 */

import { useEffect, useMemo, useState } from "react";
import type {
  BuildResult,
  AiProvider,
  ProgressEvent,
  ProgressStage
} from "../core/types";
import type { DesktopBuildRequest } from "../contracts/desktop";
import type { GeminiCredentialStatus } from "../credentials";
import type { GatewayStatus, PairingInfo } from "../gateway/types";
import {
  FEATURE_CONTEXT_DEFAULTS,
  FEATURE_CONTEXT_LIMITS
} from "../contracts/defaults";
import { getProviderDescriptor } from "../contracts/providers";
import { RemotePanel } from "./features/remote/RemotePanel";
import { ResultPanel } from "./features/results/ResultPanel";
import { FileCommentHelp } from "./features/help/FileCommentHelp";
import { CommonSettingsPanel } from "./features/settings/CommonSettingsPanel";
import { normalizeError } from "./utils/errors";

const baseProgressSteps: Array<{ stage: ProgressStage; label: string }> = [
  { stage: "checking-cli", label: "AI CLIを確認中" },
  { stage: "investigating", label: "コードベースを調査中" },
  { stage: "validating", label: "関連ファイルを検証中" },
  { stage: "collecting", label: "コードを収集中" },
  { stage: "packing", label: "添付用ファイルへ整理中" }
];

type RunState = "idle" | "running" | "completed" | "error" | "cancelled";
type AppView = "desktop" | "mobile" | "settings" | "help";
export function App() {
  const [activeView, setActiveView] = useState<AppView>("desktop");
  const [provider, setProvider] = useState<AiProvider>(FEATURE_CONTEXT_DEFAULTS.provider);
  const [geminiApiModel, setGeminiApiModel] = useState<string>(FEATURE_CONTEXT_DEFAULTS.geminiApiModel);
  const [projectRoot, setProjectRoot] = useState("");
  const [feature, setFeature] = useState("");
  const [summary, setSummary] = useState(true);
  const [concat, setConcat] = useState(true);
  const [maxFiles, setMaxFiles] = useState<number>(FEATURE_CONTEXT_DEFAULTS.maxOutputFiles);
  const [maxChars, setMaxChars] = useState<number>(FEATURE_CONTEXT_DEFAULTS.maxTotalChars);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [remoteStatus, setRemoteStatus] = useState<GatewayStatus | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [remoteNotice, setRemoteNotice] = useState("");
  const [credentialStatus, setCredentialStatus] = useState<GeminiCredentialStatus | null>(null);
  const [credentialInput, setCredentialInput] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");

  useEffect(
    () =>
      window.featureContext.onProgress((incomingJobId, event) => {
        if (incomingJobId === jobId) setProgress(event);
      }),
    [jobId]
  );

  const options: DesktopBuildRequest = useMemo(
    () => ({
      projectRoot,
      feature: feature.trim(),
      provider,
      ...(provider === "gemini-api"
        ? { geminiApiModel: geminiApiModel.trim() }
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
      geminiApiModel,
      summary,
      concat,
      maxFiles,
      maxChars
    ]
  );

  useEffect(() => {
    void refreshRemoteStatus();
    void refreshCredentialStatus();
  }, []);
  const providerName = getProviderDescriptor(provider).label;
  const progressSteps = baseProgressSteps.map((step) =>
    step.stage === "checking-cli" ? { ...step, label: `${providerName}を確認中` } : step
  );

  const canGenerate =
    runState !== "running" &&
    projectRoot.trim().length > 0 &&
    feature.trim().length > 0 &&
    maxFiles >= FEATURE_CONTEXT_LIMITS.minOutputFiles &&
    maxFiles <= FEATURE_CONTEXT_LIMITS.maxOutputFiles &&
    maxChars >= FEATURE_CONTEXT_LIMITS.minTotalChars;

  async function chooseFolder() {
    const selected = await window.featureContext.selectFolder();
    if (selected) setProjectRoot(selected);
  }

  async function addRemoteProjects() {
    const selected = await window.featureContext.selectFolders();
    if (!selected.length) return;
    await remoteAction(
      () => window.featureContext.registerRemoteProjects(selected),
      `${selected.length}件のプロジェクト選択をスマホ利用へ反映しました。`
    );
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
        maxOutputFiles: maxFiles,
        maxTotalChars: maxChars,
        force: true
      });
      acceptResult(next);
      setNotice("AIを再実行せず、現在の容量上限でbundleを再構築しました。");
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

  async function refreshRemoteStatus() {
    try {
      setRemoteStatus(await window.featureContext.getRemoteStatus());
    } catch (caught) {
      setRemoteError(normalizeError(caught).message);
    }
  }

  async function refreshCredentialStatus() {
    try {
      setCredentialStatus(await window.featureContext.getGeminiCredentialStatus());
    } catch (caught) {
      setSettingsError(normalizeError(caught).message);
    }
  }

  async function settingsAction(
    operation: () => Promise<GeminiCredentialStatus>,
    successMessage: string
  ): Promise<boolean> {
    setSettingsBusy(true);
    setSettingsError("");
    setSettingsNotice("");
    try {
      setCredentialStatus(await operation());
      setSettingsNotice(successMessage);
      void refreshRemoteStatus();
      return true;
    } catch (caught) {
      const problem = normalizeError(caught);
      setSettingsError(problem.details ? `${problem.message}\n${problem.details}` : problem.message);
      return false;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function remoteAction(
    operation: () => Promise<GatewayStatus>,
    successMessage?: string
  ): Promise<boolean> {
    setRemoteBusy(true);
    setRemoteError("");
    setRemoteNotice("");
    try {
      setRemoteStatus(await operation());
      if (successMessage) setRemoteNotice(successMessage);
      return true;
    } catch (caught) {
      const problem = normalizeError(caught);
      setRemoteError(problem.details ? `${problem.message}\n${problem.details}` : problem.message);
      return false;
    } finally {
      setRemoteBusy(false);
    }
  }

  async function createPairing() {
    setRemoteBusy(true);
    setRemoteError("");
    try {
      setPairing(await window.featureContext.createRemotePairing());
    } catch (caught) {
      setRemoteError(normalizeError(caught).message);
    } finally {
      setRemoteBusy(false);
    }
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
        {activeView === "desktop" ? (
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
        ) : activeView === "mobile" ? (
          <span className={`status-badge ${remoteStatus?.running ? "status-completed" : ""}`}>
            {remoteStatus?.running ? "連携中" : "停止中"}
          </span>
        ) : activeView === "settings" ? (
          <span className={`status-badge ${credentialStatus?.hasKey ? "status-completed" : ""}`}>
            {credentialStatus?.hasKey ? "APIキー設定済み" : "APIキー未設定"}
          </span>
        ) : (
          <span className="status-badge">ガイド</span>
        )}
      </header>

      <nav className="app-navigation" aria-label="画面切り替え">
        <div role="tablist" aria-label="Feature Context Builderの画面">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "desktop"}
            onClick={() => setActiveView("desktop")}
          >
            PC版
            <small>調査と成果物生成</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "mobile"}
            onClick={() => setActiveView("mobile")}
          >
            スマホ版
            <small>接続と端末管理</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "settings"}
            onClick={() => setActiveView("settings")}
          >
            共通設定
            <small>PC・スマホ共通</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "help"}
            onClick={() => setActiveView("help")}
          >
            コメント指針
            <small>機能・責務の残し方</small>
          </button>
        </div>
      </nav>

      <main>
        {activeView === "desktop" && (
          <>
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
              <div className="credential-summary">
                <div>
                  <strong>共通のGemini APIキー</strong>
                  <small>
                    {credentialStatus?.source === "encrypted"
                      ? "Windowsへ暗号化保存したキーをPC版とスマホ版で使用します。"
                      : credentialStatus?.source === "environment"
                        ? "環境変数GEMINI_API_KEYをPC版とスマホ版で使用します。"
                        : "共通設定でAPIキーを保存すると、PC版とスマホ版の両方で使用できます。"}
                  </small>
                </div>
                <button type="button" className="secondary" onClick={() => setActiveView("settings")}>
                  {credentialStatus?.hasKey ? "共通設定を確認" : "APIキーを設定"}
                </button>
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
            running={runState === "running"}
            onPreview={showPreview}
            onOpen={() => window.featureContext.openOutput(result.outputDir)}
            onCopy={copyOverview}
            onRegenerate={regenerate}
            onRebuild={rebuild}
          />
        )}
          </>
        )}

        {activeView === "mobile" && (
        <RemotePanel
          status={remoteStatus}
          busy={remoteBusy}
          error={remoteError}
          notice={remoteNotice}
          pairing={pairing}
          onClosePairing={() => setPairing(null)}
          onRefresh={refreshRemoteStatus}
          onToggle={(enabled) =>
            remoteAction(
              () => window.featureContext.setRemoteEnabled(enabled),
              enabled ? "スマホ連携サーバーを起動しました。" : "スマホ連携サーバーを停止しました。"
            )
          }
          onConfigureTailscale={() =>
            remoteAction(
              () => window.featureContext.configureTailscale(),
              "Tailscale Serveを設定しました。QRコードでスマホを登録できます。"
            )
          }
          onAddProjects={addRemoteProjects}
          onRemoveProject={(projectId) =>
            remoteAction(() => window.featureContext.removeRemoteProject(projectId))
          }
          onPair={createPairing}
          onRevoke={(sessionId) =>
            remoteAction(() => window.featureContext.revokeRemoteDevice(sessionId))
          }
          onAutoStart={(enabled) =>
            remoteAction(() => window.featureContext.setAutoStart(enabled))
          }
        />
        )}

        {activeView === "settings" && (
          <CommonSettingsPanel
            status={credentialStatus}
            apiKey={credentialInput}
            busy={settingsBusy}
            error={settingsError}
            notice={settingsNotice}
            onApiKeyChange={setCredentialInput}
            onSave={async () => {
              const saved = await settingsAction(
                () => window.featureContext.saveGeminiApiKey(credentialInput),
                "Gemini APIキーをWindowsの暗号化機能で保存しました。PC版とスマホ版で利用できます。"
              );
              if (saved) setCredentialInput("");
            }}
            onClear={() =>
              settingsAction(
                () => window.featureContext.clearGeminiApiKey(),
                "Windowsへ保存したGemini APIキーを削除しました。"
              )
            }
            onRefresh={refreshCredentialStatus}
          />
        )}

        {activeView === "help" && <FileCommentHelp />}
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
