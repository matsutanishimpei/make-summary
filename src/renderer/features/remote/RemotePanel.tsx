import type { GatewayStatus, PairingInfo } from "../../../gateway/types";

export interface RemotePanelProps {
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

export function RemotePanel(props: RemotePanelProps) {
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
