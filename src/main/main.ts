import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FeatureContextError,
  FeatureContextService,
  type BuildOptions,
  type BuildResult,
  type RebuildOptions
} from "../core/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jobs = new Map<string, AbortController>();
const allowedFiles = new Set<string>();
const allowedOutputs = new Set<string>();

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    backgroundColor: "#f4f7f9",
    title: "Feature Context Builder",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  );
  void window.loadFile(path.join(__dirname, "../../renderer/index.html"));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc(): void {
  ipcMain.handle("dialog:select-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("job:start", async (event, jobId: string, options: BuildOptions) =>
    safeInvoke(() =>
      runJob(event.sender, jobId, (service, controller) =>
        service.build(options, (progress) => event.sender.send("job:progress", jobId, progress), controller.signal)
      )
    )
  );

  ipcMain.handle("job:rebuild", async (event, jobId: string, options: RebuildOptions) =>
    safeInvoke(() =>
      runJob(event.sender, jobId, (service, controller) =>
        service.rebuild(options, (progress) => event.sender.send("job:progress", jobId, progress), controller.signal)
      )
    )
  );

  ipcMain.handle("job:cancel", (_event, jobId: string) => {
    const controller = jobs.get(jobId);
    controller?.abort();
    return Boolean(controller);
  });

  ipcMain.handle("artifact:read", async (_event, filePath: string) => {
    const resolved = path.resolve(filePath);
    if (!allowedFiles.has(resolved)) throw new Error("許可されていない成果物です。");
    return fs.readFile(resolved, "utf8");
  });

  ipcMain.handle("shell:open-output", async (_event, outputDir: string) => {
    const resolved = path.resolve(outputDir);
    if (!allowedOutputs.has(resolved)) throw new Error("許可されていない出力先です。");
    const message = await shell.openPath(resolved);
    if (message) throw new Error(message);
  });

  ipcMain.handle("clipboard:copy-overview", async (_event, filePath: string) => {
    const resolved = path.resolve(filePath);
    if (!allowedFiles.has(resolved) || path.basename(resolved) !== "01-overview.md") {
      throw new Error("許可されていない成果物です。");
    }
    clipboard.writeText(await fs.readFile(resolved, "utf8"));
  });
}

async function runJob(
  sender: Electron.WebContents,
  jobId: string,
  operation: (service: FeatureContextService, controller: AbortController) => Promise<BuildResult>
): Promise<BuildResult> {
  if (jobs.has(jobId)) throw new FeatureContextError("CLI_FAILED", "同じ処理がすでに実行中です。");
  const controller = new AbortController();
  jobs.set(jobId, controller);
  try {
    const result = await operation(new FeatureContextService(), controller);
    registerResult(result);
    return result;
  } finally {
    jobs.delete(jobId);
    if (!sender.isDestroyed()) sender.send("job:ended", jobId);
  }
}

function registerResult(result: BuildResult): void {
  allowedOutputs.add(path.resolve(result.outputDir));
  allowedFiles.add(path.resolve(result.manifestPath));
  result.manifest.bundleFiles.forEach((file) => allowedFiles.add(path.resolve(file.path)));
}

function serializeError(error: unknown): { message: string; code?: string; details?: string } {
  const original = error instanceof Error ? error : new Error(String(error));
  const serialized: { message: string; code?: string; details?: string } = {
    message: original.message,
    details: formatUnknownErrorDetails(error, original)
  };
  if (error instanceof FeatureContextError) {
    serialized.code = error.code;
    serialized.details = error.details || serialized.details;
  } else if (typeof (error as { code?: unknown }).code === "string") {
    serialized.code = (error as { code: string }).code;
  }
  return serialized;
}

function formatUnknownErrorDetails(error: unknown, original: Error): string {
  const value = error as { code?: unknown; details?: unknown; stack?: unknown; name?: unknown };
  const details = typeof value.details === "string" ? value.details.trim() : "";
  if (details) return details;
  return [
    `name=${typeof value.name === "string" ? value.name : original.name}`,
    `message=${original.message}`,
    typeof value.code === "string" ? `code=${value.code}` : undefined,
    "stack:",
    typeof value.stack === "string" ? value.stack : original.stack || "<empty>"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

async function safeInvoke<T>(
  operation: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: ReturnType<typeof serializeError> }> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}
