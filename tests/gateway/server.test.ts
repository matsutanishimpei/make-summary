import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FeatureContextError,
  FeatureContextService,
  type CliInfo,
  type Investigation,
  type InvestigationRunner
} from "../../src/core/index.js";
import { MobileGateway } from "../../src/gateway/server.js";
import { GatewaySettingsStore } from "../../src/gateway/settings.js";

class MockRunner implements InvestigationRunner {
  readonly provider = "gemini" as const;

  async inspect(): Promise<CliInfo> {
    return { provider: "gemini", version: "mock", help: "--output-format" };
  }

  async investigate(): Promise<Investigation> {
    return {
      feature: "ログイン機能",
      overview: "ログインの概要",
      flow: ["Login", "authenticate"],
      files: [
        {
          path: "src/login.ts",
          role: "ログイン処理",
          reason: "機能の入口",
          priority: "core",
          group: "frontend",
          recommended: true,
          summary: "ログイン"
        }
      ],
      uncertainties: []
    };
  }
}

let temporary: string;
let projectRoot: string;
let staticDir: string;
let settings: GatewaySettingsStore;
let gateway: MobileGateway;
let origin: string;

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "feature-context-gateway-"));
  projectRoot = path.join(temporary, "日本語 project");
  staticDir = path.join(temporary, "mobile");
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "login.ts"), "export const login = true;\n", "utf8");
  await fs.writeFile(path.join(staticDir, "index.html"), "<h1>mobile</h1>", "utf8");
  settings = new GatewaySettingsStore(path.join(temporary, "settings.json"));
  await settings.registerProject(projectRoot, "テストプロジェクト");
  await settings.update((value) => {
    value.publicUrl = "https://desktop.example.ts.net";
  });
  gateway = new MobileGateway({
    settings,
    staticDir,
    serviceFactory: () => new FeatureContextService(() => new MockRunner())
  });
  const port = await gateway.start(0);
  origin = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await gateway.stop();
  await fs.rm(temporary, { recursive: true, force: true });
});

describe("MobileGateway", () => {
  it("未認証アクセスを拒否し、一度限りのQRトークンで端末を登録する", async () => {
    const rejected = await fetch(`${origin}/api/v1/projects`);
    expect(rejected.status).toBe(401);

    const pairing = await gateway.createPairing();
    expect(pairing.url).toMatch(/^https:\/\/desktop\.example\.ts\.net\/#pair=/);
    expect(pairing.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const token = new URL(pairing.url).hash.replace("#pair=", "");
    const paired = await post("/api/v1/pair", { token, deviceName: "iPhone" });
    expect(paired.response.status).toBe(200);
    expect(paired.cookie).toMatch(/^fcb_session=/);

    const projects = await fetch(`${origin}/api/v1/projects`, {
      headers: { cookie: paired.cookie! }
    });
    expect(projects.status).toBe(200);
    expect(await projects.json()).toMatchObject({
      projects: [{ label: "テストプロジェクト" }]
    });

    const reused = await post("/api/v1/pair", { token, deviceName: "別端末" });
    expect(reused.response.status).toBe(401);
  });

  it("登録プロジェクトで調査し、MarkdownとZIPだけをスマホへ返す", async () => {
    const cookie = await pair();
    const configured = await settings.load();
    const started = await post(
      "/api/v1/jobs",
      {
        projectId: configured.projects[0].id,
        feature: "ログイン機能",
        provider: "gemini",
        summary: true,
        concat: true,
        maxOutputFiles: 5,
        maxTotalChars: 120_000
      },
      cookie
    );
    expect(started.response.status).toBe(202);
    const jobId = (started.value as { job: { id: string } }).job.id;
    const job = await waitForJob(jobId, cookie);
    expect(job.state).toBe("completed");
    expect(job.result?.artifacts[0].name).toBe("01-overview.md");

    const markdown = await fetch(
      `${origin}/api/v1/jobs/${jobId}/artifacts/01-overview.md`,
      { headers: { cookie } }
    );
    expect(markdown.status).toBe(200);
    expect(await markdown.text()).toContain("# ログイン機能");

    const zipResponse = await fetch(`${origin}/api/v1/jobs/${jobId}/bundle.zip`, {
      headers: { cookie }
    });
    expect(zipResponse.status).toBe(200);
    const archive = unzipSync(new Uint8Array(await zipResponse.arrayBuffer()));
    expect(Object.keys(archive)).toContain("01-overview.md");
    expect(Object.keys(archive)).not.toContain("manifest.json");
    expect(strFromU8(archive["01-overview.md"])).toContain("src/login.ts");
  });

  it("スマホから未登録のPCパスを指定できない", async () => {
    const cookie = await pair();
    const response = await post(
      "/api/v1/jobs",
      {
        projectId: "C:\\Users\\someone\\secret",
        projectRoot: "C:\\Users\\someone\\secret",
        feature: "秘密",
        provider: "gemini",
        summary: true,
        concat: true,
        maxOutputFiles: 5,
        maxTotalChars: 120_000
      },
      cookie
    );
    expect(response.response.status).toBe(400);
  });

  it("スマホ連携ポートの二重使用を分かりやすく報告する", async () => {
    const conflicting = new MobileGateway({ settings, staticDir });
    const port = Number(new URL(origin).port);

    await expect(conflicting.start(port)).rejects.toMatchObject({
      code: "EADDRINUSE",
      message: expect.stringContaining("タスクトレイ")
    });
  });
});

async function pair(): Promise<string> {
  const pairing = await gateway.createPairing();
  const token = new URL(pairing.url).hash.replace("#pair=", "");
  const result = await post("/api/v1/pair", { token, deviceName: "test phone" });
  return result.cookie!;
}

async function post(
  pathname: string,
  body: unknown,
  cookie?: string
): Promise<{ response: Response; value: unknown; cookie?: string }> {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return {
    response,
    value: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

async function waitForJob(jobId: string, cookie: string): Promise<{
  state: string;
  result?: { artifacts: Array<{ name: string }> };
}> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${origin}/api/v1/jobs/${jobId}`, {
      headers: { cookie }
    });
    const value = (await response.json()) as {
      job: {
        state: string;
        result?: { artifacts: Array<{ name: string }> };
      };
    };
    if (!["queued", "running"].includes(value.job.state)) return value.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new FeatureContextError("TIMEOUT");
}
