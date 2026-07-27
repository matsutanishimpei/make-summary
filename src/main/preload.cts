import { contextBridge, ipcRenderer } from "electron";
import type { BuildOptions, BuildResult, ProgressEvent, RebuildOptions } from "../core/types.js";

export interface DesktopApi {
  selectFolder(): Promise<string | null>;
  start(jobId: string, options: BuildOptions): Promise<BuildResult>;
  rebuild(jobId: string, options: RebuildOptions): Promise<BuildResult>;
  cancel(jobId: string): Promise<boolean>;
  onProgress(listener: (jobId: string, event: ProgressEvent) => void): () => void;
  readArtifact(filePath: string): Promise<string>;
  openOutput(outputDir: string): Promise<void>;
  copyOverview(filePath: string): Promise<void>;
}

const api: DesktopApi = {
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
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
  copyOverview: (filePath) => ipcRenderer.invoke("clipboard:copy-overview", filePath)
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
