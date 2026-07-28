import { describe, expect, it } from "vitest";
import { findSensitiveContent } from "../../src/core/index.js";

describe("findSensitiveContent", () => {
  it("代表的なトークンとコードへ直書きされた認証情報を値を漏らさず分類する", () => {
    const googleKey = ["AIza", "C".repeat(35)].join("");
    expect(findSensitiveContent(`export const value = "${googleKey}";`)).toEqual({
      kind: "Google APIキー"
    });
    expect(findSensitiveContent('const password = "correct-horse-battery-staple";')).toEqual({
      kind: "コード内へ直接記述された認証情報"
    });
  });

  it("環境変数参照と明らかなテスト用プレースホルダーは除外しない", () => {
    expect(findSensitiveContent("const apiKey = process.env.GEMINI_API_KEY;")).toBeNull();
    expect(findSensitiveContent('const apiKey = "test-key-placeholder";')).toBeNull();
    expect(findSensitiveContent('const token = "replace-with-your-token";')).toBeNull();
  });
});
