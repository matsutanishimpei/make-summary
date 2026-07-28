import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/contracts/manifest.js";

describe("manifest contract", () => {
  it("現在のスキーマを実行時に検証する", () => {
    const manifest = parseManifest(validManifest());
    expect(manifest.schemaVersion).toBe("1.1");
    expect(manifest.provider.id).toBe("codex");
  });

  it("旧Gemini CLI形式を1.1へ移行する", () => {
    const legacy = validManifest() as Record<string, unknown>;
    delete legacy.provider;
    legacy.schemaVersion = "1.0";
    legacy.geminiCliVersion = "0.52.0";
    const options = legacy.options as Record<string, unknown>;
    delete options.provider;

    const manifest = parseManifest(legacy);
    expect(manifest.provider).toEqual({ id: "gemini", cliVersion: "0.52.0" });
    expect(manifest.options.provider).toBe("gemini");
  });

  it("未対応スキーマや壊れた関連ファイルを拒否する", () => {
    expect(() => parseManifest({ ...validManifest(), schemaVersion: "9.0" })).toThrow(
      "未対応"
    );
    expect(() =>
      parseManifest({
        ...validManifest(),
        relatedFiles: [{ path: "src/login.ts" }]
      })
    ).toThrow();
  });
});

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: "1.1",
    feature: "ログイン機能",
    projectRoot: "C:\\project",
    generatedAt: "2026-01-01T00:00:00.000Z",
    gitCommitId: null,
    options: {
      provider: "codex",
      summary: true,
      concat: true,
      maxOutputFiles: 5,
      maxTotalChars: 120_000,
      maxFileChars: 60_000
    },
    provider: { id: "codex", cliVersion: "mock" },
    investigation: {
      feature: "ログイン機能",
      overview: "概要",
      flow: ["Login"],
      files: [],
      uncertainties: []
    },
    relatedFiles: [],
    validation: { detected: 0, valid: 0, invalid: 0 },
    selections: {},
    bundledSources: [],
    omittedSources: [],
    bundleFiles: [],
    totalChars: 0,
    estimatedTokens: 0,
    tokenEstimateMethod: "文字数 ÷ 4",
    warnings: [],
    uncertainties: []
  };
}
