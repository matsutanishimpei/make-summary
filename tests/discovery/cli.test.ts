import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFeatureDiscoveryCli } from "../../src/discovery-cli/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("feature-discovery CLI", () => {
  it("coreの順位付け結果をソース本文なしのJSONで返す", async () => {
    const root = await createProject();
    let stdout = "";
    let stderr = "";

    const exitCode = await runFeatureDiscoveryCli(
      ["ログイン機能", "--root", root, "--format", "json", "--max", "2"],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as {
      schemaVersion: string;
      results: Array<{ path: string; evidence: unknown[] }>;
      index: { indexedFiles: number };
      embedding?: { provider: string };
    };
    expect(result.schemaVersion).toBe("1.0");
    expect(result.index.indexedFiles).toBe(3);
    expect(result.embedding?.provider).toBe("local-multilingual-concept-subword-v1");
    expect(result.results[0].path).toBe("src/pages/LoginPage.tsx");
    expect(result.results[0].evidence.length).toBeGreaterThan(0);
    expect(stdout).not.toContain("SECRET_SOURCE_MARKER");
    expect(stdout).not.toContain("\"sample\"");
  });

  it("--explainで人が読める根拠を表示する", async () => {
    const root = await createProject();
    let stdout = "";

    const exitCode = await runFeatureDiscoveryCli(
      ["login", "--root", root, "--max", "1", "--explain"],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => undefined
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("src/pages/LoginPage.tsx");
    expect(stdout).toContain("structured-feature");
    expect(stdout).not.toContain("SECRET_SOURCE_MARKER");
  });

  it("不正なグラフ深度を終了コード1で拒否する", async () => {
    let stderr = "";
    const exitCode = await runFeatureDiscoveryCli(["login", "--depth", "6"], {
      stdout: () => undefined,
      stderr: (text) => {
        stderr += text;
      }
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("0～5");
  });

  it("--embedding offで意味類似度だけを無効化する", async () => {
    const root = await createProject();
    let stdout = "";
    const exitCode = await runFeatureDiscoveryCli(
      ["login", "--root", root, "--format", "json", "--embedding", "off"],
      {
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => undefined
      }
    );

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as {
      embedding?: unknown;
      results: Array<{ evidence: Array<{ kind: string }> }>;
    };
    expect(result.embedding).toBeUndefined();
    expect(
      result.results.flatMap((file) => file.evidence).some((item) => item.kind === "semantic")
    ).toBe(false);
  });
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-discovery-cli-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src", "pages"), { recursive: true });
  await mkdir(path.join(root, "src", "services"), { recursive: true });
  await writeFile(
    path.join(root, "src", "pages", "LoginPage.tsx"),
    `/**
 * @feature-context
 * @feature login, authentication
 * @role ログイン画面から認証処理を開始する
 * @entry LoginPage
 */
import { authenticate } from "../services/AuthService";
export function LoginPage() { return authenticate(); }
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "src", "services", "AuthService.ts"),
    `export function authenticate() {
  const marker = "SECRET_SOURCE_MARKER";
  return marker.length > 0;
}
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "src", "DateUtil.ts"),
    "export function formatDate() { return new Date().toISOString(); }\n",
    "utf8"
  );
  return root;
}
