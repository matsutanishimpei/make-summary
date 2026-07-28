import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FeatureContextError,
  FeatureContextService,
  type BuildResult,
  type ProgressEvent,
  parseDesktopBuildRequest,
  parseDesktopRebuildRequest,
  type DesktopBuildRequest,
  type DesktopRebuildRequest
} from "../core/index.js";
import { JobCoordinator } from "../application/jobs/job-coordinator.js";
import { RemoteController } from "./remote-controller.js";
import { resolveDesktopBuildOptions } from "./resolve-options.js";
import { ElectronCredentialStore } from "./secure-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopJobs = new JobCoordinator<undefined, BuildResult, ProgressEvent>();
const allowedFiles = new Set<string>();
const allowedOutputs = new Set<string>();
let mainWindow: BrowserWindow | undefined;
let remoteController: RemoteController | undefined;
let credentialStore: ElectronCredentialStore | undefined;
let tray: Tray | undefined;
let remoteEnabled = false;
let isQuitting = false;
const launchHidden = process.argv.includes("--hidden");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
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
  window.on("close", (event) => {
    if (remoteEnabled && tray && !tray.isDestroyed() && !isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  void window.loadFile(path.join(__dirname, "../../renderer/index.html"));
  mainWindow = window;
  return window;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", async () => {
    if (!app.isReady()) await app.whenReady();
    createWindow();
  });

  app.whenReady().then(async () => {
    credentialStore = new ElectronCredentialStore(
      path.join(app.getPath("userData"), "credentials.json")
    );
    remoteController = new RemoteController({
      userDataDir: app.getPath("userData"),
      mobileStaticDir: path.join(__dirname, "../../mobile"),
      credentials: credentialStore,
      onEnabledChanged: updateRemoteEnabled
    });
    try {
      await remoteController.initialize();
    } catch (error) {
      process.stderr.write(
        `スマホ連携サーバーの自動起動に失敗しました: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    registerIpc();
    if (!launchHidden || !remoteEnabled || !tray) createWindow();
    app.on("activate", () => {
      createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && (!remoteEnabled || !tray)) app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    void remoteController?.dispose();
  });
}

function registerIpc(): void {
  ipcMain.handle("dialog:select-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:select-folders", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "multiSelections"],
      title: "スマホから利用するプロジェクトフォルダを選択"
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("job:start", async (event, jobId: string, options: DesktopBuildRequest) =>
    safeInvoke(async () => {
      const request = parseDesktopBuildRequest(options);
      const resolvedOptions = await resolveDesktopBuildOptions(request, requireCredentialStore());
      return runJob(event.sender, jobId, (service, signal, report) =>
        service.build(
          resolvedOptions,
          report,
          signal
        )
      );
    })
  );

  ipcMain.handle("job:rebuild", async (event, jobId: string, options: DesktopRebuildRequest) =>
    safeInvoke(() =>
      runJob(event.sender, jobId, (service, signal, report) =>
        service.rebuild(parseDesktopRebuildRequest(options), report, signal)
      )
    )
  );

  ipcMain.handle("job:cancel", (_event, jobId: string) => {
    return desktopJobs.cancel(jobId);
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

  ipcMain.handle("mobile:status", () =>
    safeInvoke(async () => requireRemoteController().status(getAutoStart()))
  );

  ipcMain.handle("mobile:set-enabled", (_event, enabled: boolean) =>
    safeInvoke(async () => {
      await requireRemoteController().setEnabled(enabled === true);
      return requireRemoteController().status(getAutoStart());
    })
  );

  ipcMain.handle("mobile:register-projects", (_event, roots: string[]) =>
    safeInvoke(async () => {
      if (!Array.isArray(roots) || roots.some((root) => typeof root !== "string")) {
        throw new Error("登録するプロジェクトフォルダが不正です。");
      }
      await requireRemoteController().registerProjects(roots);
      return requireRemoteController().status(getAutoStart());
    })
  );

  ipcMain.handle("mobile:remove-project", (_event, projectId: string) =>
    safeInvoke(async () => {
      await requireRemoteController().removeProject(projectId);
      return requireRemoteController().status(getAutoStart());
    })
  );

  ipcMain.handle("mobile:revoke-device", (_event, sessionId: string) =>
    safeInvoke(async () => {
      await requireRemoteController().revokeDevice(sessionId);
      return requireRemoteController().status(getAutoStart());
    })
  );

  ipcMain.handle("mobile:create-pairing", () =>
    safeInvoke(async () => requireRemoteController().createPairing())
  );

  ipcMain.handle("mobile:configure-tailscale", () =>
    safeInvoke(async () => {
      await requireRemoteController().configureTailscale();
      return requireRemoteController().status(getAutoStart());
    })
  );

  ipcMain.handle("settings:credentials", () =>
    safeInvoke(async () => requireCredentialStore().getGeminiCredentialStatus())
  );

  ipcMain.handle("settings:save-gemini-key", (_event, apiKey: string) =>
    safeInvoke(async () => {
      await requireCredentialStore().setGeminiApiKey(apiKey);
      return requireCredentialStore().getGeminiCredentialStatus();
    })
  );

  ipcMain.handle("settings:clear-gemini-key", () =>
    safeInvoke(async () => {
      await requireCredentialStore().clearGeminiApiKey();
      return requireCredentialStore().getGeminiCredentialStatus();
    })
  );

  ipcMain.handle("app:set-auto-start", (_event, enabled: boolean) =>
    safeInvoke(async () => {
      setAutoStart(enabled === true);
      return requireRemoteController().status(getAutoStart());
    })
  );
}

async function runJob(
  sender: Electron.WebContents,
  jobId: string,
  operation: (
    service: FeatureContextService,
    signal: AbortSignal,
    report: (progress: ProgressEvent) => void
  ) => Promise<BuildResult>
): Promise<BuildResult> {
  if (desktopJobs.get(jobId)) {
    throw new FeatureContextError("CLI_FAILED", "同じ処理がすでに実行中です。");
  }
  const handle = desktopJobs.start(jobId, undefined, ({ signal, report }) =>
    operation(new FeatureContextService(), signal, (progress) => {
      report(progress);
      if (!sender.isDestroyed()) sender.send("job:progress", jobId, progress);
    })
  );
  try {
    const result = await handle.completion;
    registerResult(result);
    return result;
  } finally {
    desktopJobs.remove(jobId);
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

function requireRemoteController(): RemoteController {
  if (!remoteController) throw new Error("スマホ連携の初期化が完了していません。");
  return remoteController;
}

function requireCredentialStore(): ElectronCredentialStore {
  if (!credentialStore) throw new Error("共通設定の初期化が完了していません。");
  return credentialStore;
}

function updateRemoteEnabled(enabled: boolean): void {
  remoteEnabled = enabled;
  if (enabled) ensureTray();
  else {
    tray?.destroy();
    tray = undefined;
  }
}

function ensureTray(): void {
  if (tray && !tray.isDestroyed()) return;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#0c6b70"/><path d="M8 9h16v3H11v5h10v3H11v5H8z" fill="white"/></svg>`;
    const icon = nativeImage
      .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
      .resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip("Feature Context Builder – スマホ連携中");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Feature Context Builderを開く", click: () => createWindow() },
        {
          label: "終了",
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on("double-click", () => createWindow());
  } catch (error) {
    process.stderr.write(
      `タスクトレイの初期化に失敗しました: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

function loginItemOptions(openAtLogin?: boolean): Electron.Settings {
  return {
    ...(openAtLogin === undefined ? {} : { openAtLogin }),
    path: process.execPath,
    args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"]
  };
}

function getAutoStart(): boolean {
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setAutoStart(enabled: boolean): void {
  app.setLoginItemSettings(loginItemOptions(enabled));
}
