import type { RemoteJob } from "../gateway/types";

export function stateLabel(state: RemoteJob["state"]): string {
  const labels: Record<RemoteJob["state"], string> = {
    queued: "待機中",
    running: "実行中",
    completed: "完了",
    error: "エラー",
    cancelled: "キャンセル"
  };
  return labels[state];
}

export function defaultDeviceName(): string {
  const platform = navigator.userAgent.includes("iPhone")
    ? "iPhone"
    : navigator.userAgent.includes("Android")
      ? "Android"
      : "スマートフォン";
  return `${platform} (${new Date().toLocaleDateString("ja-JP")})`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
