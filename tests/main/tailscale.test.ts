import { describe, expect, it, vi } from "vitest";
import {
  TailscaleService,
  type TailscaleCommandExecutor
} from "../../src/main/tailscale.js";

describe("TailscaleService", () => {
  it("Serveを非対話確認付きでtailnet内へ設定する", async () => {
    const execute = vi.fn<TailscaleCommandExecutor>(async (_executable, args) => {
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { DNSName: "desktop.example.ts.net.", Online: true }
          }),
          stderr: ""
        };
      }
      return {
        stdout: "Serve started and running in the background.",
        stderr: ""
      };
    });
    const service = new TailscaleService({ executable: "tailscale", execute });

    await expect(service.configureServe(43_127)).resolves.toMatchObject({
      publicUrl: "https://desktop.example.ts.net"
    });
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "tailscale",
      ["serve", "--yes", "--bg", "43127"],
      expect.objectContaining({ windowsHide: true, timeout: 30_000 })
    );
  });

  it("CLIの標準エラーを捨てず、権限エラーを日本語化する", async () => {
    const execute: TailscaleCommandExecutor = async (_executable, args) => {
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { DNSName: "desktop.example.ts.net.", Online: true }
          }),
          stderr: ""
        };
      }
      throw Object.assign(new Error("Command failed"), {
        code: 1,
        stderr: "Access is denied.",
        stdout: ""
      });
    };
    const service = new TailscaleService({ executable: "tailscale", execute });

    await expect(service.configureServe(43_127)).rejects.toMatchObject({
      message: expect.stringContaining("権限"),
      code: "TAILSCALE_PERMISSION_DENIED",
      details: expect.stringContaining("Access is denied")
    });
  });
});
