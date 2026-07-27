import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.disableHardwareAcceleration();
const timer = setTimeout(() => {
  process.stderr.write("Electron smoke test timed out.\n");
  app.exit(1);
}, 15_000);

app.whenReady().then(async () => {
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
      generateButton: document.querySelector("button.primary")?.textContent?.trim()
    })`);
    if (
      preloadFailure ||
      state.title !== "Feature Context Builder" ||
      state.api !== "function" ||
      state.generateButton !== "コンテキストを生成"
    ) {
      throw new Error(`Unexpected renderer state: ${JSON.stringify(state)} ${preloadFailure}`);
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
