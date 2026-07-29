// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "../../src/mobile/MobileApp";
import { JobPanel } from "../../src/mobile/features/jobs/JobPanel";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 1;
  url: string;
  withCredentials = true;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  close() { this.readyState = 2; }
}

describe("MobileApp", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("未登録端末にはQRペアリングを案内する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    render(<MobileApp />);
    expect(await screen.findByRole("heading", { name: "スマホ連携" })).toBeInTheDocument();
    expect(screen.getByText(/QRコード/)).toBeInTheDocument();
  });

  it("登録済みプロジェクトだけを選んで調査を開始する", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/session") return json({ authenticated: true });
      if (url === "/api/v1/projects") {
        return json({ projects: [{ id: "project-1", label: "Web App" }] });
      }
      if (url === "/api/v1/jobs" && !init?.method) return json({ jobs: [] });
      if (url === "/api/v1/jobs" && init?.method === "POST") {
        return json(
          {
            job: {
              id: "job-1",
              projectId: "project-1",
              projectLabel: "Web App",
              feature: "ログイン機能",
              state: "running",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            }
          },
          202
        );
      }
      return json({ error: { message: "not found" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MobileApp />);
    await screen.findByRole("heading", { name: "新しい調査" });
    fireEvent.change(screen.getByLabelText("調べたい機能・目的"), {
      target: { value: "ログイン機能" }
    });
    fireEvent.click(screen.getByRole("button", { name: "コンテキストを生成" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === "/api/v1/jobs" && init?.method === "POST"
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]?.body));
      expect(body).toMatchObject({
        projectId: "project-1",
        feature: "ログイン機能",
        provider: "gemini-api"
      });
      expect(body).not.toHaveProperty("projectRoot");
      expect(body).not.toHaveProperty("geminiApiKey");
    });
  });

  it("関連ソースは選択UIではなく自動採用結果として表示する", () => {
    render(
      <JobPanel
        job={{
          id: "job-complete",
          projectId: "project-1",
          projectLabel: "Web App",
          feature: "ログイン機能",
          state: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          result: {
            feature: "ログイン機能",
            provider: "gemini",
            detectedFiles: 1,
            bundledSourceFiles: 1,
            totalChars: 1_000,
            estimatedTokens: 250,
            warnings: [],
            uncertainties: [],
            artifacts: [],
            relatedFiles: [{
              path: "src/login.ts",
              normalizedPath: "src/login.ts",
              role: "ログイン処理",
              reason: "機能の入口",
              priority: "core",
              group: "frontend",
              valid: true,
              included: true
            }],
            zipUrl: "/bundle.zip"
          }
        }}
        onCancel={vi.fn()}
        onPreview={vi.fn()}
        onShare={vi.fn()}
        onRebuild={vi.fn()}
      />
    );

    expect(screen.getByText("自動選定された関連ソース")).toBeInTheDocument();
    expect(screen.getByText("自動採用")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
