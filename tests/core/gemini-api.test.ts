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
