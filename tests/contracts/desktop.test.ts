import { describe, expect, it } from "vitest";
import {
  parseDesktopBuildRequest,
  parseDesktopRebuildRequest
} from "../../src/contracts/desktop.js";

describe("desktop IPC contracts", () => {
  it("許可した生成条件だけを受け取り、秘密鍵フィールドを境界で破棄する", () => {
    const parsed = parseDesktopBuildRequest({
      projectRoot: " C:\\日本語 project ",
      feature: " ログイン機能 ",
      provider: "gemini-api",
      geminiApiKey: "must-not-cross-ipc",
      geminiApiModel: "gemini-test",
      summary: true,
      concat: false,
      maxOutputFiles: 5,
      maxTotalChars: 120_000
    });

    expect(parsed.projectRoot).toBe("C:\\日本語 project");
    expect(parsed.feature).toBe("ログイン機能");
    expect(parsed).not.toHaveProperty("geminiApiKey");
  });

  it("不正なプロバイダーと上限値を拒否する", () => {
    expect(() =>
      parseDesktopBuildRequest({
        projectRoot: ".",
        feature: "login",
        provider: "unknown",
        summary: true,
        concat: true,
        maxOutputFiles: 6,
        maxTotalChars: 120_000
      })
    ).toThrow();
  });

  it("bundle再構築は容量条件だけを受け取り、file選択を公開しない", () => {
    const parsed = parseDesktopRebuildRequest({
      manifestPath: "C:\\project\\.feature-context\\login\\manifest.json",
      selections: { "src/login.ts": false },
      maxOutputFiles: 3
    });
    expect(parsed).toEqual({
      manifestPath: "C:\\project\\.feature-context\\login\\manifest.json",
      maxOutputFiles: 3
    });
  });
});
