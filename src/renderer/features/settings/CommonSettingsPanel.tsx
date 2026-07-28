import type { GeminiCredentialStatus } from "../../../credentials";

export interface CommonSettingsPanelProps {
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

export function CommonSettingsPanel(props: CommonSettingsPanelProps) {
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
