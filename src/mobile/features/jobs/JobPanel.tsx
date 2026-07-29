/**
 * @feature-context
 * @feature mobile job results, automatic source inclusion, artifact sharing
 * @role remote jobの進捗と成果物、自動選定された関連sourceの根拠を読み取り専用で表示する
 * @entry JobPanel
 * @flow RemoteJob -> progress or result -> artifacts, source rationale, capacity rebuild
 * @related ../../MobileApp.tsx, ../../../gateway/types.ts
 * @caution sourceのcheckboxを持たず、利用者は関連候補の採否を変更しない
 */

import type { ProgressStage } from "../../../core/types";
import type { RemoteJob } from "../../../gateway/types";
import { stateLabel } from "../../utils";

const progressLabels: Array<{ stage: ProgressStage; label: string }> = [
  { stage: "checking-cli", label: "AIを確認" },
  { stage: "investigating", label: "コードを調査" },
  { stage: "validating", label: "ファイルを検証" },
  { stage: "collecting", label: "コードを収集" },
  { stage: "packing", label: "成果物を作成" }
];

export interface JobPanelProps {
  job: RemoteJob;
  onCancel: () => void;
  onPreview: (name: string) => void;
  onShare: () => void;
  onRebuild: () => void;
}

export function JobPanel(props: JobPanelProps) {
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
            <summary>自動選定された関連ソース</summary>
            {job.result.relatedFiles.map((file, index) => {
              const key = file.normalizedPath ?? file.path;
              return (
                <div key={`${key}-${index}`} className={!file.valid ? "invalid-source" : ""}>
                  <span><code>{key}</code><small>{file.role} — {file.reason}</small></span>
                  <strong>{file.valid ? "自動採用" : "除外"}</strong>
                </div>
              );
            })}
            <button type="button" onClick={props.onRebuild}>現在の上限で再構築</button>
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
