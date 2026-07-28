import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDiscoveryIndex } from "../../src/discovery/index.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "feature-discovery-index-日本語 "));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("buildDiscoveryIndex", () => {
  it("安全なfileからstructured comment・通常comment・symbolを索引する", async () => {
    await write(
      "src/LoginService.ts",
      `/**
 * @feature-context
 * @feature ログイン, auth
 * @role credentialを検証する
 * @entry authenticate
 */
// セッションを開始する
export class LoginService {}
export async function authenticate() { return true; }
`
    );
    await write(
      "worker.py",
      `"""通知を配送するworker。"""
class NotificationWorker:
    def deliver(self):
        pass
`
    );

    const index = await buildDiscoveryIndex(root);

    expect(index.files.map((file) => file.path)).toEqual(["src/LoginService.ts", "worker.py"]);
    const login = index.files[0];
    expect(login.structuredComment?.features).toEqual(["ログイン", "auth"]);
    expect(login.symbols).toEqual([
      expect.objectContaining({ name: "LoginService", kind: "class", exported: true }),
      expect.objectContaining({ name: "authenticate", kind: "function", exported: true })
    ]);
    expect(login.comments.some((comment) => comment.text.includes("セッション"))).toBe(true);
    expect(login.imports).toEqual([]);
    expect(login.searchText).toContain("credentialを検証する");
    expect(index.files[1].symbols).toEqual([
      expect.objectContaining({ name: "NotificationWorker", kind: "class" }),
      expect.objectContaining({ name: "deliver", kind: "function" })
    ]);
  });

  it("gitignore・生成成果物・秘密情報・binary・symbolic linkを除外する", async () => {
    await write(".gitignore", "ignored.ts\npackages/app/generated/\nlink-target/\n");
    await write("safe.ts", "export const safeValue = true;\n");
    await write("ignored.ts", "export const ignored = true;\n");
    await write("packages/app/generated/client.ts", "export const generated = true;\n");
    await write(".feature-context/login/bundle/01-overview.md", "previous source context");
    await write(".env.local", "TOKEN=do-not-index");
    await write("secret.ts", `export const apiKey = "AIza${"A".repeat(35)}";\n`);
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    await write("link-target/linked.ts", "export const linked = true;\n");
    await fs.symlink(
      path.join(root, "link-target"),
      path.join(root, "linked-directory"),
      "junction"
    );

    const index = await buildDiscoveryIndex(root);

    expect(index.files.map((file) => file.path)).toEqual([".gitignore", "safe.ts"]);
    expect(index.warnings.join("\n")).toContain("Google APIキー");
    expect(index.warnings.join("\n")).toContain("シンボリックリンク");
  });

  it("走査file数と読み取り量の上限を警告する", async () => {
    await write("a.ts", "export const a = 1;\n");
    await write("b.ts", "export const b = 2;\n");

    const fileLimited = await buildDiscoveryIndex(root, { maxFiles: 1 });
    const byteLimited = await buildDiscoveryIndex(root, {
      maxScanBytes: 8_192,
      maxFileBytes: 8_192
    });

    expect(fileLimited.scannedFiles).toBe(1);
    expect(fileLimited.warnings.join("\n")).toContain("上限1件");
    expect(byteLimited.files).toHaveLength(2);
  });

  it("AbortSignalで走査を開始前に止める", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildDiscoveryIndex(root, {}, controller.signal)).rejects.toThrow(
      "キャンセル"
    );
  });
});

async function write(relative: string, content: string): Promise<void> {
  const absolute = path.join(root, ...relative.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}
