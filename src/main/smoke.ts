import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeDataDir = mkdtempSync(path.join(os.tmpdir(), "feature-context-smoke-"));
app.setPath("userData", path.join(smokeDataDir, "user-data"));
app.setPath("cache", path.join(smokeDataDir, "cache"));
app.disableHardwareAcceleration();
app.on("will-quit", () => rmSync(smokeDataDir, { recursive: true, force: true }));
const timer = setTimeout(() => {
  process.stderr.write("Electron smoke test timed out.\n");
  app.exit(1);
}, 15_000);

app.whenReady().then(async () => {
  ipcMain.handle("mobile:status", () => ({
    ok: true,
    value: {
      enabled: false,
      running: false,
      port: 43127,
      localUrl: "http://127.0.0.1:43127",
      publicUrl: "",
      projects: [],
      pairedDevices: [],
      hasGeminiApiKey: false,
      autoStart: false,
      tailscale: { installed: false, connected: false }
    }
  }));
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  let preloadFailure = "";
  window.webContents.on("preload-error", (_event, _preloadPath, error) => {
    preloadFailure = error.message;
  });
  try {
    await window.loadFile(path.join(__dirname, "../../renderer/index.html"));
    const state = await window.webContents.executeJavaScript(`({
      title: document.querySelector("h1")?.textContent,
      api: typeof window.featureContext?.start,
      remoteApi: typeof window.featureContext?.getRemoteStatus,
      generateButton: document.querySelector("button.primary")?.textContent?.trim(),
      providers: Array.from(document.querySelectorAll("#provider option")).map((option) => option.value)
    })`);
    const mobileEntryExists = existsSync(path.join(__dirname, "../../mobile/index.html"));
    if (
      preloadFailure ||
      state.title !== "Feature Context Builder" ||
      state.api !== "function" ||
      state.remoteApi !== "function" ||
      state.generateButton !== "コンテキストを生成" ||
      JSON.stringify(state.providers) !== JSON.stringify(["gemini", "gemini-api", "codex"]) ||
      !mobileEntryExists
    ) {
      throw new Error(
        `Unexpected renderer state: ${JSON.stringify(state)} mobile=${mobileEntryExists} ${preloadFailure}`
      );
    }
    process.stdout.write(`Electron smoke test passed: ${JSON.stringify(state)}\n`);
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    clearTimeout(timer);
    app.exit(1);
  }
});
