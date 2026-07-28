import { describe, expect, it, vi } from "vitest";
import { resolveDesktopBuildOptions } from "../../src/main/resolve-options.js";
import type { BuildOptions } from "../../src/core/types.js";

const baseOptions: BuildOptions = {
  projectRoot: "C:\\project",
  feature: "ログイン機能",
  provider: "gemini-api",
  summary: true,
  concat: true,
  maxOutputFiles: 5,
  maxTotalChars: 120_000
};

describe("resolveDesktopBuildOptions", () => {
  it("PC版のGemini API実行へ共通の暗号化保存キーを渡す", async () => {
    const credentials = {
      getGeminiApiKey: vi.fn().mockResolvedValue("stored-key")
    };

    await expect(resolveDesktopBuildOptions(baseOptions, credentials)).resolves.toEqual({
      ...baseOptions,
      geminiApiKey: "stored-key"
    });
    expect(credentials.getGeminiApiKey).toHaveBeenCalledOnce();
  });

  it("Gemini API以外では資格情報を読み出さない", async () => {
    const credentials = {
      getGeminiApiKey: vi.fn().mockResolvedValue("stored-key")
    };
    const options = { ...baseOptions, provider: "codex" as const };

    await expect(resolveDesktopBuildOptions(options, credentials)).resolves.toBe(options);
    expect(credentials.getGeminiApiKey).not.toHaveBeenCalled();
  });

  it("rendererから渡された一時キーより共通ストアを優先する", async () => {
    const credentials = {
      getGeminiApiKey: vi.fn().mockResolvedValue("stored-key")
    };

    await expect(
      resolveDesktopBuildOptions({ ...baseOptions, geminiApiKey: "renderer-key" }, credentials)
    ).resolves.toEqual({
      ...baseOptions,
      geminiApiKey: "stored-key"
    });
  });
});
