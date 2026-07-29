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
import { packCode } from "../../src/core/bundle/code-packer.js";

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

  it("同じグループのコードが1成果物へ収まらない場合も空き枠へ分割する", async () => {
    const files = [];
    for (let index = 0; index < 4; index += 1) {
      const filePath = `src/large-${index}.ts`;
      await write(filePath, `export const value${index} = "${"x".repeat(3_000)}";\n`);
      files.push({
        path: filePath,
        role: `大きな処理 ${index}`,
        reason: "同じ機能グループ",
        priority: "core" as const,
        group: "frontend",
        recommended: true
      });
    }
    const result = await createService(new MockRunner({ ...investigation(), files })).build(
      options({
        name: "split-same-group",
        maxOutputFiles: 5,
        maxFileChars: 5_000
      })
    );

    expect(result.manifest.bundledSources).toHaveLength(4);
    expect(result.manifest.bundleFiles.filter((file) => file.name !== "01-overview.md")).toHaveLength(4);
    expect(result.manifest.bundleFiles.map((file) => file.name)).toEqual([
      "01-overview.md",
      "02-frontend.md",
      "03-frontend-2.md",
      "04-frontend-3.md",
      "05-frontend-4.md"
    ]);
  });

  it("大きなファイルは実コードの連続行へ分け、成果物の空きをできるだけ使う", () => {
    const lines = Array.from(
      { length: 80 },
      (_, index) => `export const value${index} = "${String(index).padStart(2, "0")}-${"x".repeat(32)}";`
    );
    const content = `${lines.join("\n")}\n`;
    const packed = packCode(
      [{
        record: {
          path: "src/large.ts",
          normalizedPath: "src/large.ts",
          role: "大きな実装",
          reason: "梱包の分割を検証",
          priority: "core",
          group: "core",
          recommended: true,
          valid: true,
          included: true,
          userSelected: null
        },
        content,
        lineCount: content.split("\n").length
      }],
      3,
      1_000,
      3_000
    );

    expect(packed.artifacts).toHaveLength(3);
    expect(packed.artifacts.every((artifact) => artifact.content.length <= 1_000)).toBe(true);
    expect(packed.bundled).toHaveLength(3);
    expect(packed.bundled[0].lineStart).toBe(1);
    expect(packed.bundled[1].lineStart).toBe(packed.bundled[0].lineEnd + 1);
    expect(packed.bundled[2].lineStart).toBe(packed.bundled[1].lineEnd + 1);
    expect(packed.bundled[0].lineEnd).toBeLessThan(lines.length);
    expect(packed.artifacts.map((artifact) => artifact.content).join("\n")).toContain(lines[0]);
    expect(packed.artifacts.map((artifact) => artifact.content).join("\n")).toContain(
      lines[packed.bundled[2].lineStart - 1]
    );
  });

  it("小さいgroupの成果物に残った容量も、別groupの関連コードで埋める", () => {
    const record = (
      filePath: string,
      group: string,
      role: string
    ) => ({
      path: filePath,
      normalizedPath: filePath,
      role,
      reason: "group間の空き容量を検証",
      priority: "core" as const,
      group,
      recommended: true,
      valid: true,
      included: true,
      userSelected: null
    });
    const largeLines = Array.from(
      { length: 60 },
      (_, index) => `export const implementation${index} = "${"x".repeat(28)}";`
    );
    const packed = packCode(
      [
        {
          record: record(".gitignore", "config", "除外設定"),
          content: "dist/\nbuild/\n",
          lineCount: 3
        },
        {
          record: record("src/implementation.ts", "core", "主要実装"),
          content: `${largeLines.join("\n")}\n`,
          lineCount: largeLines.length + 1
        }
      ],
      2,
      1_000,
      2_000
    );

    expect(packed.artifacts).toHaveLength(2);
    expect(packed.artifacts[0].content).toContain("dist/\nbuild/\n");
    expect(packed.artifacts[0].content).toContain(largeLines[0]);
    const implementationRanges = packed.bundled.filter(
      (item) => item.path === "src/implementation.ts"
    );
    expect(implementationRanges).toHaveLength(2);
    expect(implementationRanges[1].lineStart).toBe(implementationRanges[0].lineEnd + 1);
    expect(packed.artifacts.every((artifact) => artifact.content.length > 850)).toBe(true);
  });

  it("部分収録をoverviewへ明示し、bundle全体の実測上限内までコードを詰める", async () => {
    const filePath = "src/large-multiline.ts";
    const content = Array.from(
      { length: 180 },
      (_, index) => `export function operation${index}() { return "${"x".repeat(24)}"; }`
    ).join("\n");
    await write(filePath, content);
    const result = await createService(
      new MockRunner({
        feature: "大きな実装",
        overview: "",
        flow: [],
        files: [{
          path: filePath,
          role: "主要実装",
          reason: "部分収録の統合検証",
          priority: "core",
          group: "core",
          recommended: true
        }],
        uncertainties: []
      })
    ).build(options({
      name: "partial-source",
      summary: false,
      maxOutputFiles: 3,
      maxFileChars: 2_000,
      maxTotalChars: 6_000
    }));

    expect(result.manifest.totalChars).toBeLessThanOrEqual(6_000);
    expect(result.manifest.bundledSources).toHaveLength(2);
    expect(result.manifest.bundledSources[1].lineStart)
      .toBe(result.manifest.bundledSources[0].lineEnd + 1);
    expect(result.manifest.bundledSources[1].lineEnd).toBeLessThan(180);
    const overview = await fs.readFile(result.manifest.bundleFiles[0].path, "utf8");
    expect(overview).toContain(`| ${filePath} | 主要実装 | 部分収録の統合検証 | core | core | 一部収録 |`);
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
    expect(overview).toContain("### 主要コンポーネントの責務");
    expect(overview).toContain("Login: 入力を受け付ける");
    expect(overview).toContain("### 状態とデータの流れ");
    expect(overview).toContain("フォームからセッションへ流れる");
    expect(overview).toContain("### API");
    expect(overview).toContain("POST /api/login");
    expect(overview).toContain("### 外部依存");
    expect(overview).toContain("外部IdP");
    expect(overview).toContain("### 修正時の注意点");
    expect(overview).toContain("セッション互換性を維持する");
  });

  it("全関連候補を保ったまま、Geminiを再実行せず容量条件だけで再構築する", async () => {
    const runner = new MockRunner(investigation());
    const service = createService(runner);
    const first = await service.build(options({ name: "rebuild" }));
    const rebuilt = await service.rebuild({
      manifestPath: first.manifestPath,
      maxOutputFiles: 4,
      force: true
    });
    expect(runner.investigateCalls).toBe(1);
    expect(new Set(rebuilt.manifest.bundledSources.map((file) => file.path))).toEqual(
      new Set(["src/Login.tsx", "src/auth.ts", "tests/auth.test.ts"])
    );
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

  it("force再生成は完成した成果物を入れ替え、管理外ファイルを保持する", async () => {
    const service = createService(new MockRunner(investigation()));
    const first = await service.build(options({ name: "atomic" }));
    await fs.writeFile(path.join(first.outputDir, "notes.txt"), "利用者メモ", "utf8");
    await fs.writeFile(path.join(first.outputDir, "bundle", "notes.txt"), "bundleメモ", "utf8");

    const rebuilt = await service.build(options({ name: "atomic", force: true }));

    expect(await fs.readFile(path.join(rebuilt.outputDir, "notes.txt"), "utf8")).toBe("利用者メモ");
    expect(await fs.readFile(path.join(rebuilt.outputDir, "bundle", "notes.txt"), "utf8")).toBe("bundleメモ");
    const siblings = await fs.readdir(path.dirname(rebuilt.outputDir));
    expect(siblings.some((name) => name.includes(".atomic.stage-") || name.includes(".atomic.backup-"))).toBe(false);
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

  it("サブディレクトリの.gitignore対象を関連ファイルから除外する", async () => {
    await write("packages/app/.gitignore", "generated/\n*.local.ts\n!keep.local.ts\n");
    await write("packages/app/generated/schema.ts", "export const generated = true;\n");
    await write("packages/app/private.local.ts", "export const privateValue = true;\n");
    await write("packages/app/keep.local.ts", "export const keep = true;\n");

    const result = await validateRelatedFiles(root, [
      file("packages/app/generated/schema.ts"),
      file("packages\\app\\private.local.ts"),
      file("packages/app/keep.local.ts")
    ]);

    expect(result.records.map((record) => ({
      path: record.normalizedPath,
      valid: record.valid
    }))).toEqual([
      { path: "packages/app/generated/schema.ts", valid: false },
      { path: "packages/app/private.local.ts", valid: false },
      { path: "packages/app/keep.local.ts", valid: true }
    ]);
  });

  it("AIが弱い関連とした安全な候補も自動的に含める", async () => {
    await write("src/weakly-related.ts", "export const setting = true;\n");
    const candidate = {
      ...file("src/weakly-related.ts"),
      recommended: false
    };

    const automatic = await validateRelatedFiles(root, [candidate]);
    expect(automatic.records[0]).toMatchObject({
      valid: true,
      included: true,
      userSelected: null,
      recommended: false
    });

  });

  it("検証後に追加されたgitignoreとコード内シークレットを収集直前に再検査する", async () => {
    const apiKey = ["AIza", "A".repeat(35)].join("");
    await write("src/secret.ts", `export const apiKey = "${apiKey}";\n`);
    await write("src/later-ignored.ts", "export const ignored = true;\n");
    const files = [file("src/secret.ts"), file("src/later-ignored.ts")];
    const validation = await validateRelatedFiles(root, files);
    expect(validation.records.every((record) => record.valid)).toBe(true);
    await fs.writeFile(path.join(root, ".gitignore"), "src/later-ignored.ts\n", "utf8");

    const service = createService(
      new MockRunner({
        feature: "安全性",
        overview: "",
        flow: [],
        files,
        uncertainties: []
      })
    );
    await expect(service.build(options({ name: "sensitive-content" }))).rejects.toMatchObject({
      code: "NO_VALID_FILES",
      details: expect.stringMatching(/Google APIキー|gitignore/)
    });
  });
});

function investigation(): Investigation {
  return {
    feature: "ログイン機能",
    overview: "認証機能の要約",
    flow: ["Login", "login()", "session"],
    summaryDetails: {
      responsibilities: ["Login: 入力を受け付ける", "AuthService: 認証を実行する"],
      stateAndDataFlow: ["フォームからセッションへ流れる"],
      apis: ["POST /api/login"],
      externalDependencies: ["外部IdP"],
      changeCautions: ["セッション互換性を維持する"]
    },
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
