import { contextBridge, ipcRenderer } from "electron";
import type { BuildOptions, BuildResult, ProgressEvent, RebuildOptions } from "../core/types.js";
import type { GeminiCredentialStatus } from "../credentials.js";
import type { GatewayStatus, PairingInfo } from "../gateway/types.js";

export interface DesktopApi {
  selectFolder(): Promise<string | null>;
  selectFolders(): Promise<string[]>;
  start(jobId: string, options: BuildOptions): Promise<BuildResult>;
  rebuild(jobId: string, options: RebuildOptions): Promise<BuildResult>;
  cancel(jobId: string): Promise<boolean>;
  onProgress(listener: (jobId: string, event: ProgressEvent) => void): () => void;
  readArtifact(filePath: string): Promise<string>;
  openOutput(outputDir: string): Promise<void>;
  copyOverview(filePath: string): Promise<void>;
  getRemoteStatus(): Promise<GatewayStatus>;
  setRemoteEnabled(enabled: boolean): Promise<GatewayStatus>;
  registerRemoteProjects(roots: string[]): Promise<GatewayStatus>;
  removeRemoteProject(projectId: string): Promise<GatewayStatus>;
  revokeRemoteDevice(sessionId: string): Promise<GatewayStatus>;
  createRemotePairing(): Promise<PairingInfo>;
  configureTailscale(): Promise<GatewayStatus>;
  getGeminiCredentialStatus(): Promise<GeminiCredentialStatus>;
  saveGeminiApiKey(apiKey: string): Promise<GeminiCredentialStatus>;
  clearGeminiApiKey(): Promise<GeminiCredentialStatus>;
  setAutoStart(enabled: boolean): Promise<GatewayStatus>;
}

const api: DesktopApi = {
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  selectFolders: () => ipcRenderer.invoke("dialog:select-folders"),
  start: async (jobId, options) => unwrap(await ipcRenderer.invoke("job:start", jobId, options)),
  rebuild: async (jobId, options) => unwrap(await ipcRenderer.invoke("job:rebuild", jobId, options)),
  cancel: (jobId) => ipcRenderer.invoke("job:cancel", jobId),
  onProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, jobId: string, progress: ProgressEvent) =>
      listener(jobId, progress);
    ipcRenderer.on("job:progress", handler);
    return () => ipcRenderer.removeListener("job:progress", handler);
  },
  readArtifact: (filePath) => ipcRenderer.invoke("artifact:read", filePath),
  openOutput: (outputDir) => ipcRenderer.invoke("shell:open-output", outputDir),
  copyOverview: (filePath) => ipcRenderer.invoke("clipboard:copy-overview", filePath),
  getRemoteStatus: async () => unwrap(await ipcRenderer.invoke("mobile:status")),
  setRemoteEnabled: async (enabled) =>
    unwrap(await ipcRenderer.invoke("mobile:set-enabled", enabled)),
  registerRemoteProjects: async (roots) =>
    unwrap(await ipcRenderer.invoke("mobile:register-projects", roots)),
  removeRemoteProject: async (projectId) =>
    unwrap(await ipcRenderer.invoke("mobile:remove-project", projectId)),
  revokeRemoteDevice: async (sessionId) =>
    unwrap(await ipcRenderer.invoke("mobile:revoke-device", sessionId)),
  createRemotePairing: async () =>
    unwrap(await ipcRenderer.invoke("mobile:create-pairing")),
  configureTailscale: async () =>
    unwrap(await ipcRenderer.invoke("mobile:configure-tailscale")),
  getGeminiCredentialStatus: async () =>
    unwrap(await ipcRenderer.invoke("settings:credentials")),
  saveGeminiApiKey: async (apiKey) =>
    unwrap(await ipcRenderer.invoke("settings:save-gemini-key", apiKey)),
  clearGeminiApiKey: async () =>
    unwrap(await ipcRenderer.invoke("settings:clear-gemini-key")),
  setAutoStart: async (enabled) =>
    unwrap(await ipcRenderer.invoke("app:set-auto-start", enabled))
};

contextBridge.exposeInMainWorld("featureContext", api);

function unwrap<T>(response: {
  ok: boolean;
  value?: T;
  error?: { message: string; code?: string; details?: string };
}): T {
  if (response.ok) return response.value as T;
  const error = new Error(response.error?.message ?? "予期しないエラーが発生しました。") as Error & {
    code?: string;
    details?: string;
  };
  error.code = response.error?.code;
  error.details = response.error?.details;
  throw error;
}
