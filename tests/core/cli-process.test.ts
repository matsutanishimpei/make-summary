import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWindowsNpmShim, runCliProcess } from "../../src/core/index.js";

describe("runCliProcess", () => {
  it("タイムアウト時に子プロセスを終了する", async () => {
    await expect(
      runCliProcess({
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
        timeoutMs: 50,
        providerName: "Mock"
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("AbortSignalで子プロセスを終了する", async () => {
    const controller = new AbortController();
    const running = runCliProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      signal: controller.signal,
      providerName: "Mock"
    });
    setTimeout(() => controller.abort(), 50);

    await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("Windowsのnpm .cmd shimをシェルなしでJavaScript実体へ解決する", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feature-context-shim-"));
    const script = path.join(directory, "node_modules", "@example", "cli", "index.js");
    const shim = path.join(directory, "example.cmd");
    try {
      await fs.mkdir(path.dirname(script), { recursive: true });
      await fs.writeFile(script, "console.log('ok');\n", "utf8");
      await fs.writeFile(
        shim,
        '"%NODE_EXE%" "%~dp0\\node_modules\\@example\\cli\\index.js" %*\r\n',
        "utf8"
      );

      expect(resolveWindowsNpmShim(shim)).toMatchObject({
        executable: process.execPath,
        argsPrefix: [script]
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
