import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FeatureContextError,
  FeatureContextService,
  parseInvestigation,
  validateRelatedFiles,
  type BuildOptions,
  type AiProvider,
  type CliInfo,
  type InvestigationRunRequest,
  type InvestigationRunner,
  type Investigation
} from "../../src/core/index.js";

class MockRunner implements InvestigationRunner {
  inspectCalls = 0;
  investigateCalls = 0;
  constructor(
    private readonly result: Investigation,
    private readonly failure?: FeatureContextError,
    readonly provider: AiProvider = "gemini"
  ) {}
  async inspect(): Promise<CliInfo> {
    this.inspectCalls += 1;
    return { provider: this.provider, version: "0.0.0-mock", help: "--prompt --output-format" };
  }
  async investigate(): Promise<Investigation> {
    this.investigateCalls += 1;
    if (this.failure) throw this.failure;
    return structuredClone(this.result);
  }
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "feature-context-日本語 "));
  await write("src/Login.tsx", "export const Login = () => 'ログイン';\r\n");
  await write("src/auth.ts", "export async function login() {\r\n  return true;\r\n}\r\n");
  await write("tests/auth.test.ts", "import { login } from '../src/auth';\nvoid login();\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("FeatureContextService", () => {
  it("正常な調査結果を最大5件のbundleへ生成する", async () => {
    const service = createService(new MockRunner(investigation()));
    const result = await service.build(options({ summary: true, concat: true }));
    expect(result.manifest.validation.detected).toBe(3);
    expect(result.manifest.validation.valid).toBe(3);
    expect(result.manifest.bundleFiles.length).toBeLessThanOrEqual(5);
    expect(result.manifest.bundleFiles[0].name).toBe("01-overview.md");
    expect(await fs.readFile(result.manifestPath, "utf8")).toContain('"schemaVersion": "1.1"');
    expect(result.manifest.provider).toEqual({ id: "gemini", cliVersion: "0.0.0-mock" });
  });

  it("選択したCodexプロバイダーを解決してmanifestへ記録する", async () => {
    const runner = new MockRunner(investigation(), undefined, "codex");
    let resolvedProvider: AiProvider | undefined;
    const service = new FeatureContextService((provider) => {
      resolvedProvider = provider;
      return runner;
    });
    const result = await service.build(options({ name: "codex", provider: "codex" }));
    expect(resolvedProvider).toBe("codex");
    expect(result.manifest.options.provider).toBe("codex");
    expect(result.manifest.provider).toEqual({ id: "codex", cliVersion: "0.0.0-mock" });
  });

  it("Gemini APIキーはrunnerへだけ渡し、manifestへ保存しない", async () => {
    const runner = new MockRunner(investigation(), undefined, "gemini-api");
    let resolvedKey: string | undefined;
    const service = new FeatureContextService((_provider, config) => {
      resolvedKey = config?.geminiApiKey;
      return runner;
    });
    const result = await service.build(
      options({
        name: "gemini-api",
        provider: "gemini-api",
        geminiApiKey: "never-persist-this",
        geminiApiModel: "gemini-test"
      })
    );
    expect(resolvedKey).toBe("never-persist-this");
    expect(JSON.stringify(result.manifest)).not.toContain("never-persist-this");
    expect(result.manifest.provider.id).toBe("gemini-api");
  });

  it("多数の関連ソースでも調査件数を制限せず、成果物だけ最大5件にする", async () => {
    const files = [];
    for (let index = 0; index < 20; index += 1) {
      const filePath = `src/group-${index % 8}/file-${index}.ts`;
      await write(filePath, `export const value${index} = ${index};\n`);
      files.push({
        path: filePath,
        role: `role ${index}`,
        reason: `reason ${index}`,
        priority: index < 4 ? ("core" as const) : ("supporting" as const),
        group: `group-${index % 8}`,
        recommended: true
      });
    }
    const result = await createService(
      new MockRunner({ ...investigation(), files })
    ).build(options({ name: "many" }));
    expect(result.manifest.validation.detected).toBe(20);
    expect(result.manifest.bundleFiles.length).toBeLessThanOrEqual(5);
  });

  it("要約とコード連結を個別に無効化できる", async () => {
    const result = await createService(new MockRunner(investigation())).build(
      options({ name: "no-options", summary: false, concat: false })
    );
    expect(result.manifest.bundleFiles).toHaveLength(1);
    expect(result.manifest.bundledSources).toHaveLength(0);
    const overview = await fs.readFile(result.manifest.bundleFiles[0].path, "utf8");
    expect(overview).not.toContain("## 機能要約");
  });

  it("要約有効時だけoverviewへ要約を含める", async () => {
    const result = await createService(new MockRunner(investigation())).build(
      options({ name: "summary-only", summary: true, concat: false })
    );
    const overview = await fs.readFile(result.manifest.bundleFiles[0].path, "utf8");
    expect(overview).toContain("## 機能要約");
    expect(overview).toContain("認証機能の要約");
  });

  it("ユーザー選択を優先し、Geminiを再実行せずbundleだけ再構築する", async () => {
    const runner = new MockRunner(investigation());
    const service = createService(runner);
    const first = await service.build(options({ name: "rebuild" }));
    const rebuilt = await service.rebuild({
      manifestPath: first.manifestPath,
      selections: {
        "src/Login.tsx": false,
        "src/auth.ts": true,
        "tests/auth.test.ts": false
      },
      force: true
    });
    expect(runner.investigateCalls).toBe(1);
    expect(rebuilt.manifest.bundledSources.map((file) => file.path)).toEqual(["src/auth.ts"]);
  });

  it("文字数上限を超える場合は明示的に失敗する", async () => {
    const oversized = investigation();
    oversized.overview = "長い要約".repeat(500);
    await expect(
      createService(new MockRunner(oversized)).build(
        options({ name: "too-small", maxTotalChars: 1000 })
      )
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("連結したコード本文は改行統一以外、元ファイルと一致する", async () => {
    const result = await createService(new MockRunner(investigation())).build(
      options({ name: "exact-code" })
    );
    const artifact = result.manifest.bundleFiles.find((file) => file.name !== "01-overview.md");
    expect(artifact).toBeDefined();
    const output = await fs.readFile(artifact!.path, "utf8");
    expect(output).toContain("export async function login() {\n  return true;\n}\n");
    expect(output).not.toContain("\r\n");
  });

  it("既存成果物は--force相当がなければ上書きしない", async () => {
    const service = createService(new MockRunner(investigation()));
    await service.build(options({ name: "protected" }));
    await expect(service.build(options({ name: "protected" }))).rejects.toMatchObject({
      code: "OUTPUT_EXISTS"
    });
    await expect(service.build(options({ name: "protected", force: true }))).resolves.toBeDefined();
  });

  it("manifestがなくても既存ファイルのある出力先を上書きしない", async () => {
    const output = path.join(root, ".feature-context", "partial", "bundle");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "01-overview.md"), "既存内容", "utf8");
    await expect(
      createService(new MockRunner(investigation())).build(options({ name: "partial" }))
    ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(await fs.readFile(path.join(output, "01-overview.md"), "utf8")).toBe("既存内容");
  });

  it.each([
    ["Gemini CLI異常終了", new FeatureContextError("CLI_FAILED")],
    ["タイムアウト", new FeatureContextError("TIMEOUT")],
    ["キャンセル", new FeatureContextError("CANCELLED")]
  ])("%sを分類して返す", async (_label, failure) => {
    await expect(
      createService(new MockRunner(investigation(), failure)).build(
        options({ dryRun: true })
      )
    ).rejects.toMatchObject({ code: failure.code });
  });

  it("AbortSignalによるキャンセルを処理する", async () => {
    const runner: InvestigationRunner = {
      provider: "gemini",
      inspect: async () => ({ provider: "gemini", version: "mock", help: "--output-format" }),
      investigate: ({ signal }: InvestigationRunRequest) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new FeatureContextError("CANCELLED")),
            { once: true }
          );
        })
    };
    const controller = new AbortController();
    const running = createService(runner).build(options({ dryRun: true }), undefined, controller.signal);
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("Gemini JSONとパス検証", () => {
  it("不正JSONを拒否する", () => {
    expect(() => parseInvestigation("これはJSONではない")).toThrowError(
      expect.objectContaining({ code: "INVALID_JSON" })
    );
  });

  it("存在しない、重複、プロジェクト外、gitignore、秘密情報、バイナリを除外する", async () => {
    await fs.writeFile(path.join(root, ".gitignore"), "ignored.ts\n", "utf8");
    await write("ignored.ts", "ignored");
    await write(".env.local", "SECRET=value");
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    const outside = path.join(path.dirname(root), "outside.ts");
    await fs.writeFile(outside, "outside", "utf8");
    const files = [
      file("missing.ts"),
      file("src/auth.ts"),
      file("src\\auth.ts"),
      file("../outside.ts"),
      file(outside),
      file("ignored.ts"),
      file(".env.local"),
      file("binary.bin")
    ];
    const result = await validateRelatedFiles(root, files);
    expect(result.records.filter((record) => record.valid)).toHaveLength(1);
    expect(result.warnings.join("\n")).toMatch(/存在しない/);
    expect(result.warnings.join("\n")).toMatch(/重複/);
    expect(result.warnings.join("\n")).toMatch(/パストラバーサル/);
    expect(result.warnings.join("\n")).toMatch(/gitignore/);
    expect(result.warnings.join("\n")).toMatch(/秘密情報/);
    expect(result.warnings.join("\n")).toMatch(/バイナリ/);
    await fs.rm(outside, { force: true });
  });

  it("日本語・空白を含むWindows形式の相対パスを正規化する", async () => {
    await write("画面 部品/ログイン.ts", "export const label = 'ログイン';\n");
    const result = await validateRelatedFiles(root, [file("画面 部品\\ログイン.ts")]);
    expect(result.records[0]).toMatchObject({
      valid: true,
      normalizedPath: "画面 部品/ログイン.ts"
    });
  });
});

function investigation(): Investigation {
  return {
    feature: "ログイン機能",
    overview: "認証機能の要約",
    flow: ["Login", "login()", "session"],
    files: [
      {
        path: "src/Login.tsx",
        role: "画面",
        reason: "入口",
        priority: "core",
        group: "frontend",
        recommended: true,
        summary: "ログイン画面"
      },
      {
        path: "src/auth.ts",
        role: "認証サービス",
        reason: "認証を実行",
        priority: "core",
        group: "backend",
        recommended: true,
        summary: "認証処理"
      },
      {
        path: "tests/auth.test.ts",
        role: "テスト",
        reason: "認証を検証",
        priority: "test",
        group: "tests",
        recommended: true,
        summary: "認証テスト"
      }
    ],
    uncertainties: ["外部IdPの設定は未確認"]
  };
}

function options(overrides: Partial<BuildOptions> = {}): BuildOptions {
  return {
    projectRoot: root,
    feature: "ログイン機能",
    summary: true,
    concat: true,
    maxOutputFiles: 5,
    maxTotalChars: 120_000,
    ...overrides
  };
}

function file(filePath: string) {
  return {
    path: filePath,
    role: "role",
    reason: "reason",
    priority: "supporting" as const,
    group: "shared",
    recommended: true
  };
}

async function write(relativePath: string, content: string) {
  const absolute = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}

function createService(runner: InvestigationRunner): FeatureContextService {
  return new FeatureContextService(() => runner);
}
