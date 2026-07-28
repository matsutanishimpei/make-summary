import { describe, expect, it, vi } from "vitest";
import { GeminiCliRunner } from "../../src/core/index.js";
import type { CliExecutor } from "../../src/core/index.js";

const investigation = {
  feature: "login",
  overview: "login flow",
  flow: ["LoginPage", "AuthService.login"],
  files: [
    {
      path: "src/Login.tsx",
      role: "entry point",
      reason: "starts the login flow",
      priority: "core",
      group: "frontend",
      recommended: true
    }
  ],
  uncertainties: []
};

describe("GeminiCliRunner", () => {
  it("uses non-interactive JSON output with read-only and trust-safe flags when supported", async () => {
    const execute = vi.fn<CliExecutor>(async (request) => {
      if (request.args[0] === "--version") {
        return { stdout: "0.52.0\n", stderr: "", exitCode: 0 };
      }
      if (request.args[0] === "--help") {
        return {
          stdout: "--prompt --output-format --approval-mode plan --skip-trust",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: JSON.stringify({ response: JSON.stringify(investigation) }),
        stderr: "",
        exitCode: 0
      };
    });
    const runner = new GeminiCliRunner("gemini-test", execute);

    await runner.investigate({
      projectRoot: "C:\\work dir\\project",
      prompt: "investigate login",
      timeoutMs: 30_000
    });

    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executable: "gemini-test",
        args: [
          "--skip-trust",
          "--approval-mode",
          "plan",
          "--prompt",
          "investigate login",
          "--output-format",
          "json"
        ],
        cwd: "C:\\work dir\\project",
        providerName: "Gemini"
      })
    );
  });
});
