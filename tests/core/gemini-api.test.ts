import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FetchGeminiApiTransport,
  GeminiApiRunner,
  type GeminiApiGenerateRequest,
  type GeminiApiTransport
} from "../../src/core/index.js";

class MockTransport implements GeminiApiTransport {
  requests: GeminiApiGenerateRequest[] = [];

  constructor(private readonly responses: string[]) {}

  async generate(request: GeminiApiGenerateRequest): Promise<string> {
    this.requests.push(request);
    return this.responses.shift() ?? "";
  }
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-api-日本語 "));
  await write("src/Login.tsx", "export function Login() { return 'ログイン'; }\n");
  await write("src/auth.ts", "export const authenticate = () => true;\n");
  await write(".env.local", "TOP_SECRET=never-send\n");
  await write("ignored.ts", "const ignoredSecret = 'never-send-ignored';\n");
  await write("packages/web/.gitignore", "generated/\n*.private.ts\n!safe.private.ts\n");
  await write(
    "packages/web/generated/client.ts",
    "const nestedIgnoredSecret = 'never-send-nested-generated';\n"
  );
  await write(
    "packages/web/account.private.ts",
    "const nestedPrivateSecret = 'never-send-nested-private';\n"
  );
  await write("packages/web/safe.private.ts", "export const nestedSafeFile = true;\n");
  await fs.writeFile(path.join(root, ".gitignore"), "ignored.ts\n", "utf8");
  await fs.writeFile(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("GeminiApiRunner", () => {
  it("安全なローカル索引を送り、構造化された調査結果を返す", async () => {
    const transport = new MockTransport([validResponse()]);
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      model: "gemini-test",
      maxContextChars: 50_000,
      transport
    });

    const result = await runner.investigate({
      projectRoot: root,
      prompt: "調査対象: ログイン機能\nJSONだけを返す",
      timeoutMs: 10_000
    });

    expect(result.files).toHaveLength(2);
    expect(result.summaryDetails?.responsibilities).toEqual(["Login: 入力"]);
    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0].prompt;
    expect(sent).toContain("src/Login.tsx");
    expect(sent).toContain("export function Login()");
    expect(sent).not.toContain("TOP_SECRET");
    expect(sent).not.toContain("never-send-ignored");
    expect(sent).not.toContain("never-send-nested-generated");
    expect(sent).not.toContain("never-send-nested-private");
    expect(sent).toContain("nestedSafeFile");
    expect(sent).not.toContain("image.bin");
  });

  it("不正な応答は1回だけ補正して再検証する", async () => {
    const transport = new MockTransport(["not-json", validResponse()]);
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      maxContextChars: 50_000,
      transport
    });

    await expect(
      runner.investigate({
        projectRoot: root,
        prompt: "調査対象: ログイン機能",
        timeoutMs: 10_000
      })
    ).resolves.toMatchObject({ feature: "ログイン機能" });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1].prompt).toContain("前回の応答はアプリ側の検証に失敗");
  });

  it("コード本文のシークレットをAPI送信前に除外する", async () => {
    const apiKey = ["AIza", "B".repeat(35)].join("");
    await write("src/late-secret.ts", `${"// safe prefix\n".repeat(700)}export const apiKey = "${apiKey}";\n`);
    const transport = new MockTransport([validResponse()]);
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      maxContextChars: 50_000,
      transport
    });

    const result = await runner.investigate({
      projectRoot: root,
      prompt: "調査対象: ログイン機能",
      timeoutMs: 10_000
    });

    expect(transport.requests[0].prompt).not.toContain(apiKey);
    expect(result.uncertainties.join("\n")).toContain("Google APIキー");
  });

  it("local ranking上位の本文を文字数上限内へ優先収録する", async () => {
    for (let index = 0; index < 12; index += 1) {
      await write(
        `src/aaa-unrelated-${String(index).padStart(2, "0")}.ts`,
        `// 日付表示utility\nexport const unrelated${index} = "${"x".repeat(1_400)}";\n`
      );
    }
    await write(
      "zzz/LoginFeature.ts",
      `/**
 * @feature-context
 * @feature ログイン, authentication
 * @role 認証画面からloginを開始する
 */
export const highPriorityLoginMarker = "must-be-sent";
`
    );
    const transport = new MockTransport([validResponse()]);
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      maxContextChars: 20_000,
      transport
    });

    await runner.investigate({
      projectRoot: root,
      prompt: "調査対象: ログイン機能",
      timeoutMs: 10_000
    });

    const sent = transport.requests[0].prompt;
    expect(sent).toContain("highPriorityLoginMarker");
    expect(sent).toContain("local_score=");
    expect(sent.indexOf("zzz/LoginFeature.ts")).toBeLessThan(
      sent.lastIndexOf("highPriorityLoginMarker")
    );
  });

  it("ローカルのコード収集を含む調査全体へタイムアウトを適用する", async () => {
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      transport: new MockTransport([]),
      snapshotBuilder: async (_projectRoot, _feature, _maxChars, signal) =>
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("snapshot aborted")), {
            once: true
          });
        })
    });

    await expect(
      runner.investigate({
        projectRoot: root,
        prompt: "調査対象: ログイン機能",
        timeoutMs: 20
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("API索引の走査ファイル数へ上限を適用して警告する", async () => {
    const transport = new MockTransport([validResponse()]);
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      maxContextChars: 50_000,
      maxScanFiles: 1,
      transport
    });

    const result = await runner.investigate({
      projectRoot: root,
      prompt: "調査対象: ログイン機能",
      timeoutMs: 10_000
    });

    expect(result.uncertainties.join("\n")).toContain("走査ファイル数が上限1件");
  });

  it("API索引の総読み取り量へ上限を適用して警告する", async () => {
    await write("aaa-large.ts", "a".repeat(9_000));
    await write("aab-large.ts", "b".repeat(9_000));
    const transport = new MockTransport([validResponse()]);
    const runner = new GeminiApiRunner({
      apiKey: "test-key",
      maxContextChars: 50_000,
      maxScanBytes: 8_192,
      maxFileBytes: 8_192,
      transport
    });

    const result = await runner.investigate({
      projectRoot: root,
      prompt: "調査対象: ログイン機能",
      timeoutMs: 10_000
    });

    expect(result.uncertainties.join("\n")).toContain("読み取り量が上限8 KiB");
  });

  it("APIキーがない場合はコードを読む前に分かりやすく失敗する", async () => {
    const runner = new GeminiApiRunner({ apiKey: "", transport: new MockTransport([]) });
    await expect(runner.inspect()).rejects.toMatchObject({ code: "API_KEY_MISSING" });
  });
});

describe("FetchGeminiApiTransport", () => {
  it("APIキーをヘッダーで送り、JSON Schemaによる構造化出力を要求する", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: validResponse() }] } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const transport = new FetchGeminiApiTransport(fetchMock as typeof fetch, "https://example.test/v1beta");
    await expect(
      transport.generate({
        apiKey: "secret-key",
        model: "gemini-test",
        prompt: "prompt",
        timeoutMs: 10_000
      })
    ).resolves.toContain('"feature"');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/v1beta/models/gemini-test:generateContent");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "secret-key" });
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
    expect(body.generationConfig.responseFormat.text.schema.properties.files.type).toBe("array");
    expect(body.generationConfig.responseFormat.text.schema.properties.summaryDetails.type).toBe("object");
    expect(String(init?.body)).not.toContain("secret-key");
  });

  it("認証失敗と利用上限を識別する", async () => {
    const auth = new FetchGeminiApiTransport(
      vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 403 })) as typeof fetch
    );
    const rate = new FetchGeminiApiTransport(
      vi.fn(async () => new Response('{"error":{"message":"quota"}}', { status: 429 })) as typeof fetch
    );
    const request = {
      apiKey: "secret",
      model: "gemini-test",
      prompt: "prompt",
      timeoutMs: 10_000
    };
    await expect(auth.generate(request)).rejects.toMatchObject({ code: "API_UNAUTHENTICATED" });
    await expect(rate.generate(request)).rejects.toMatchObject({ code: "API_RATE_LIMIT" });
  });

  it("API仕様不一致の400応答を更新案内付きで表示する", async () => {
    const transport = new FetchGeminiApiTransport(
      vi.fn(
        async () =>
          new Response(
            '{"error":{"status":"INVALID_ARGUMENT","message":"invalid response format"}}',
            { status: 400 }
          )
      ) as typeof fetch
    );

    await expect(
      transport.generate({
        apiKey: "secret",
        model: "gemini-test",
        prompt: "prompt",
        timeoutMs: 10_000
      })
    ).rejects.toMatchObject({
      code: "API_FAILED",
      message: expect.stringContaining("最新版"),
      details: expect.stringContaining("INVALID_ARGUMENT")
    });
  });

  it("キャンセル時は進行中のHTTP要求も中止する", async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );
    const transport = new FetchGeminiApiTransport(fetchMock as typeof fetch);
    const controller = new AbortController();
    const running = transport.generate({
      apiKey: "secret",
      model: "gemini-test",
      prompt: "prompt",
      timeoutMs: 10_000,
      signal: controller.signal
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

function validResponse(): string {
  return JSON.stringify({
    feature: "ログイン機能",
    overview: "概要",
    flow: ["Login", "authenticate"],
    summaryDetails: {
      responsibilities: ["Login: 入力"],
      stateAndDataFlow: ["入力から認証結果へ"],
      apis: ["POST /login"],
      externalDependencies: [],
      changeCautions: ["認証契約を維持"]
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
        role: "認証処理",
        reason: "認証を実行",
        priority: "core",
        group: "domain",
        recommended: true,
        summary: "認証サービス"
      }
    ],
    uncertainties: []
  });
}

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}
