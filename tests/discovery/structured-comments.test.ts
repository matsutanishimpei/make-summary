import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseStructuredFileComment,
  validateStructuredFileComment
} from "../../src/discovery/index.js";

describe("structured file comments", () => {
  it("block commentを正規化して構造化する", () => {
    const parsed = parseStructuredFileComment(`
/**
 * @feature-context
 * @feature ログイン、auth | login
 * @role   認証処理を開始する
 * @entry LoginPage, submitLogin
 * @flow LoginPage -> AuthService
 * @related TokenStore
 * @caution 成功後だけtokenを保存する
 */
export function submitLogin() {}
`);

    expect(parsed).toMatchObject({
      features: ["ログイン", "auth", "login"],
      role: "認証処理を開始する",
      entryPoints: ["LoginPage", "submitLogin"],
      flow: ["LoginPage -> AuthService"],
      related: ["TokenStore"],
      cautions: ["成功後だけtokenを保存する"]
    });
    expect(validateStructuredFileComment(parsed)).toEqual({ valid: true, issues: [] });
  });

  it("line commentとPython docstringを扱う", () => {
    const lineComment = parseStructuredFileComment(`
# @feature-context
# @feature 通知, notification
# @role push通知を配送する
def deliver():
    pass
`);
    const docstring = parseStructuredFileComment(`
"""
@feature-context
@feature 課金, billing
@role 請求額を計算する
"""
def calculate():
    pass
`);

    expect(lineComment?.features).toEqual(["通知", "notification"]);
    expect(docstring?.role).toBe("請求額を計算する");
  });

  it("必須tagと未知tagを検証する", () => {
    const parsed = parseStructuredFileComment(`
/**
 * @feature-context
 * @feature login
 * @owner team-a
 */
`);

    expect(validateStructuredFileComment(parsed)).toEqual({
      valid: false,
      issues: ["@roleを指定してください。", "未対応のタグがあります: owner"]
    });
    expect(validateStructuredFileComment(null).valid).toBe(false);
  });

  it("discovery配下の全実装が構造化コメントを持つ", async () => {
    const directory = path.resolve("src/discovery");
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".ts"));
    for (const file of files) {
      const source = await fs.readFile(path.join(directory, file), "utf8");
      expect(validateStructuredFileComment(parseStructuredFileComment(source)), file).toEqual({
        valid: true,
        issues: []
      });
    }
  });
});
