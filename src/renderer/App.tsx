import { useEffect, useMemo, useState } from "react";
import type {
  BuildOptions,
  BuildResult,
  AiProvider,
  ProgressEvent,
  ProgressStage,
  ValidationRecord
} from "../core/types";
import type { GeminiCredentialStatus } from "../credentials";
import type { GatewayStatus, PairingInfo } from "../gateway/types";

const baseProgressSteps: Array<{ stage: ProgressStage; label: string }> = [
  { stage: "checking-cli", label: "AI CLIを確認中" },
  { stage: "investigating", label: "コードベースを調査中" },
  { stage: "validating", label: "関連ファイルを検証中" },
  { stage: "collecting", label: "コードを収集中" },
  { stage: "packing", label: "添付用ファイルへ整理中" }
];

type RunState = "idle" | "running" | "completed" | "error" | "cancelled";
type AppView = "desktop" | "mobile" | "settings";
const defaultGeminiApiModel = "gemini-3.5-flash";

export function App() {
  const [activeView, setActiveView] = useState<AppView>("desktop");
  const [provider, setProvider] = useState<AiProvider>("gemini");
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

  const options: BuildOptions = useMemo(
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
        ) : (
          <span className={`status-badge ${credentialStatus?.hasKey ? "status-completed" : ""}`}>
            {credentialStatus?.hasKey ? "APIキー設定済み" : "APIキー未設定"}
          </span>
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

interface RemotePanelProps {
  status: GatewayStatus | null;
  busy: boolean;
  error: string;
  notice: string;
  pairing: PairingInfo | null;
  onClosePairing: () => void;
  onRefresh: () => void;
  onToggle: (enabled: boolean) => void;
  onConfigureTailscale: () => void;
  onAddProjects: () => void;
  onRemoveProject: (projectId: string) => void;
  onPair: () => void;
  onRevoke: (sessionId: string) => void;
  onAutoStart: (enabled: boolean) => void;
}

function RemotePanel(props: RemotePanelProps) {
  const status = props.status;
  return (
    <section className="panel remote-panel" aria-labelledby="remote-title">
      <div className="section-heading">
        <div><span className="step-number">REMOTE</span><h2 id="remote-title">スマホ連携</h2></div>
        <p>登録済みプロジェクトだけを、Tailscale経由でスマートフォンから操作します。</p>
      </div>

      {!status ? (
        <div className="remote-loading">
          <span>スマホ連携の状態を確認しています。</span>
          <button type="button" className="text-button" onClick={props.onRefresh}>再確認</button>
        </div>
      ) : (
        <>
          <div className="remote-status-grid">
            <div>
              <span>ローカルサーバー</span>
              <strong className={status.running ? "ok-text" : ""}>
                {status.running ? "起動中" : "停止中"}
              </strong>
              <small>{status.localUrl}</small>
            </div>
            <div>
              <span>Tailscale</span>
              <strong className={status.tailscale.connected ? "ok-text" : ""}>
                {!status.tailscale.installed
                  ? "未インストール"
                  : status.tailscale.connected
                    ? "接続済み"
                    : "未接続"}
              </strong>
              <small>{status.tailscale.dnsName ?? status.tailscale.message ?? "状態を取得できません"}</small>
            </div>
            <div>
              <span>スマホ用URL</span>
              <strong className={status.publicUrl ? "ok-text" : ""}>
                {status.publicUrl ? "準備済み" : "未設定"}
              </strong>
              <small>{status.publicUrl || "Tailscale Serveを設定してください"}</small>
            </div>
          </div>

          <div className="remote-primary-actions">
            <button
              type="button"
              className={status.running ? "danger-quiet" : "secondary"}
              onClick={() => props.onToggle(!status.running)}
              disabled={props.busy}
            >
              {status.running ? "スマホ連携を停止" : "スマホ連携を起動"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={props.onConfigureTailscale}
              disabled={props.busy}
            >
              Tailscale Serveを自動設定
            </button>
            <button
              type="button"
              className="primary"
              onClick={props.onPair}
              disabled={props.busy || !status.running || !status.publicUrl}
            >
              スマホ登録用QRを表示
            </button>
          </div>

          <label className="remote-switch">
            <input
              type="checkbox"
              checked={status.autoStart}
              onChange={(event) => props.onAutoStart(event.target.checked)}
              disabled={props.busy}
            />
            Windowsログイン時に自動起動し、スマホ連携を待ち受ける
          </label>

          <div className="remote-box">
            <div className="remote-box-heading">
              <div><h3>利用可能なプロジェクト</h3><p>複数フォルダをまとめて選択できます。スマホから任意パスは指定できません。</p></div>
              <button
                type="button"
                className="secondary"
                onClick={props.onAddProjects}
                disabled={props.busy}
              >
                プロジェクトを追加
              </button>
            </div>
            {status.projects.length ? (
              <ul className="remote-list">
                {status.projects.map((project) => (
                  <li key={project.id}>
                    <div><strong>{project.label}</strong><small>{project.root}</small></div>
                    <button type="button" className="text-button" onClick={() => props.onRemoveProject(project.id)} disabled={props.busy}>解除</button>
                  </li>
                ))}
              </ul>
            ) : <p className="remote-empty">まだ登録されていません。</p>}
          </div>

          <div className="remote-box paired-devices">
            <h3>登録済みスマートフォン</h3>
            {status.pairedDevices.length ? (
              <ul className="remote-list">
                {status.pairedDevices.map((device) => (
                  <li key={device.id}>
                    <div>
                      <strong>{device.deviceName}</strong>
                      <small>最終利用: {new Date(device.lastUsedAt).toLocaleString("ja-JP")}</small>
                    </div>
                    <button type="button" className="text-button" onClick={() => props.onRevoke(device.id)} disabled={props.busy}>接続解除</button>
                  </li>
                ))}
              </ul>
            ) : <p className="remote-empty">登録済み端末はありません。</p>}
          </div>
        </>
      )}

      {props.error && <div className="error-box remote-message"><pre>{props.error}</pre></div>}
      {props.notice && <div className="notice">{props.notice}</div>}

      {props.pairing && (
        <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="pairing-title">
          <section className="pairing-dialog">
            <header>
              <div><h2 id="pairing-title">スマホでQRコードを読み取る</h2><p>5分以内に読み取ってください。コードは一度だけ使えます。</p></div>
              <button type="button" className="icon-button" onClick={props.onClosePairing} aria-label="QRコードを閉じる">×</button>
            </header>
            <img src={props.pairing.qrDataUrl} alt="スマホ登録用QRコード" />
            <code>{props.pairing.url}</code>
            <small>有効期限: {new Date(props.pairing.expiresAt).toLocaleString("ja-JP")}</small>
          </section>
        </div>
      )}
    </section>
  );
}

interface CommonSettingsPanelProps {
  status: GeminiCredentialStatus | null;
  apiKey: string;
  busy: boolean;
  error: string;
  notice: string;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onRefresh: () => void;
}

function CommonSettingsPanel(props: CommonSettingsPanelProps) {
  const statusLabel = !props.status
    ? "確認中"
    : props.status.source === "encrypted"
      ? "Windowsへ暗号化保存済み"
      : props.status.source === "environment"
        ? "環境変数 GEMINI_API_KEY を使用中"
        : "未設定";

  return (
    <section className="panel settings-panel" aria-labelledby="settings-title">
      <div className="section-heading">
        <div><span className="step-number">SETTINGS</span><h2 id="settings-title">共通設定</h2></div>
        <p>PC版とスマホ版の両方で利用する認証情報を、このPCで一元管理します。</p>
      </div>

      <div className="settings-card">
        <div className="settings-card-heading">
          <div>
            <h3>Gemini API認証</h3>
            <p>保存した1つのAPIキーを、PCからの生成とスマホからの生成で共有します。</p>
          </div>
          <strong className={props.status?.hasKey ? "credential-state is-set" : "credential-state"}>
            {statusLabel}
          </strong>
        </div>

        <div className="field">
          <label htmlFor="common-gemini-api-key">Gemini APIキー</label>
          <input
            id="common-gemini-api-key"
            type="password"
            value={props.apiKey}
            onChange={(event) => props.onApiKeyChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={props.status?.hasKey ? "変更する場合だけ新しいキーを入力" : "Google AI Studioで取得したAPIキー"}
            disabled={props.busy}
          />
          <small>
            平文は保持せず、ElectronのsafeStorageを通してWindowsの暗号化機能で保存します。
            スマホ、成果物、manifest、ログへは出力しません。
          </small>
        </div>

        <div className="inline-actions">
          <button
            type="button"
            className="primary"
            onClick={props.onSave}
            disabled={props.busy || !props.apiKey.trim()}
          >
            Windowsへ暗号化保存
          </button>
          {props.status?.source === "encrypted" && (
            <button type="button" className="danger-quiet" onClick={props.onClear} disabled={props.busy}>
              保存済みキーを削除
            </button>
          )}
          <button type="button" className="text-button" onClick={props.onRefresh} disabled={props.busy}>
            状態を再確認
          </button>
        </div>

        {props.status?.source === "environment" && (
          <p className="settings-hint">
            現在はWindowsへ保存したキーではなく、起動環境のGEMINI_API_KEYを利用しています。
            この画面から暗号化保存すると、保存したキーが優先されます。
          </p>
        )}
      </div>

      <div className="settings-usage-grid">
        <div><strong>PC版</strong><p>「Gemini API」を選ぶと、ここで設定したキーを自動的に使用します。</p></div>
        <div><strong>スマホ版</strong><p>スマホへキーを送らず、PC上のゲートウェイが同じキーを使用します。</p></div>
      </div>

      {props.error && <div className="error-box remote-message"><pre>{props.error}</pre></div>}
      {props.notice && <div className="notice">{props.notice}</div>}
    </section>
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
