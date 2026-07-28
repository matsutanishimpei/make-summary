// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import type { BuildResult } from "../../src/core/types";
import type { GatewayStatus } from "../../src/gateway/types";

const result: BuildResult = {
  outputDir: "C:\\project\\.feature-context\\login",
  manifestPath: "C:\\project\\.feature-context\\login\\manifest.json",
  manifest: {
    schemaVersion: "1.1",
    feature: "ログイン機能",
    projectRoot: "C:\\project",
    generatedAt: "2026-01-01T00:00:00.000Z",
    gitCommitId: null,
    options: {
      provider: "gemini",
      summary: true,
      concat: true,
      maxOutputFiles: 5,
      maxTotalChars: 120000,
      maxFileChars: 60000
    },
    provider: { id: "gemini", cliVersion: "mock" },
    investigation: {
      feature: "ログイン機能",
      overview: "概要",
      flow: ["Login"],
      files: [],
      uncertainties: []
    },
    relatedFiles: [],
    validation: { detected: 0, valid: 0, invalid: 0 },
    selections: {},
    bundledSources: [],
    omittedSources: [],
    bundleFiles: [
      {
        name: "01-overview.md",
        path: "C:\\project\\.feature-context\\login\\bundle\\01-overview.md",
        chars: 100
      }
    ],
    totalChars: 100,
    estimatedTokens: 25,
    tokenEstimateMethod: "文字数 ÷ 4",
    warnings: [],
    uncertainties: []
  }
};

const gatewayStatus: GatewayStatus = {
  enabled: false,
  running: false,
  port: 43127,
  localUrl: "http://127.0.0.1:43127",
  publicUrl: "",
  projects: [],
  pairedDevices: [],
  hasGeminiApiKey: false,
  autoStart: false,
  tailscale: {
    installed: false,
    connected: false,
    message: "not installed"
  }
};

describe("App", () => {
  afterEach(cleanup);

  beforeEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "job-1" },
      configurable: true
    });
    window.featureContext = {
      selectFolder: vi.fn().mockResolvedValue("C:\\project"),
      selectFolders: vi.fn().mockResolvedValue([
        "C:\\projects\\project-a",
        "D:\\日本語 projects\\project-b"
      ]),
      start: vi.fn().mockResolvedValue(result),
      rebuild: vi.fn().mockResolvedValue(result),
      cancel: vi.fn().mockResolvedValue(true),
      onProgress: vi.fn().mockReturnValue(() => {}),
      readArtifact: vi.fn().mockResolvedValue("# overview"),
      openOutput: vi.fn().mockResolvedValue(undefined),
      copyOverview: vi.fn().mockResolvedValue(undefined),
      getRemoteStatus: vi.fn().mockResolvedValue(gatewayStatus),
      setRemoteEnabled: vi.fn().mockResolvedValue({ ...gatewayStatus, enabled: true, running: true }),
      registerRemoteProjects: vi.fn().mockResolvedValue(gatewayStatus),
      removeRemoteProject: vi.fn().mockResolvedValue(gatewayStatus),
      revokeRemoteDevice: vi.fn().mockResolvedValue(gatewayStatus),
      createRemotePairing: vi.fn().mockResolvedValue({
        url: "https://pc.example.ts.net/#pair=secret",
        expiresAt: "2026-01-01T00:05:00.000Z",
        qrDataUrl: "data:image/png;base64,AA=="
      }),
      configureTailscale: vi.fn().mockResolvedValue(gatewayStatus),
      getGeminiCredentialStatus: vi.fn().mockResolvedValue({ hasKey: false, source: null }),
      saveGeminiApiKey: vi.fn().mockResolvedValue({ hasKey: true, source: "encrypted" }),
      clearGeminiApiKey: vi.fn().mockResolvedValue({ hasKey: false, source: null }),
      setAutoStart: vi.fn().mockResolvedValue(gatewayStatus)
    };
  });

  it("初回操作を案内し、入力後はGUIだけで生成できる", async () => {
    render(<App />);
    const generate = screen.getByRole("button", { name: "コンテキストを生成" });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
    await waitFor(() => expect(screen.getByLabelText("プロジェクトフォルダ")).toHaveValue("C:\\project"));
    fireEvent.change(screen.getByLabelText("調べたい機能・目的"), {
      target: { value: "ログイン機能" }
    });
    fireEvent.change(screen.getByLabelText("調査に使うAI"), {
      target: { value: "codex" }
    });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    await waitFor(() =>
      expect(window.featureContext.start).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({ provider: "codex" })
      )
    );
    expect(await screen.findByRole("heading", { name: "生成結果" })).toBeInTheDocument();
    expect(screen.getByText("01-overview.md")).toBeInTheDocument();
  });

  it("Gemini APIを選択し、共通の保存済みキーと指定モデルを使える", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
    await waitFor(() => expect(screen.getByLabelText("プロジェクトフォルダ")).toHaveValue("C:\\project"));
    fireEvent.change(screen.getByLabelText("調べたい機能・目的"), {
      target: { value: "通知機能" }
    });
    fireEvent.change(screen.getByLabelText("調査に使うAI"), {
      target: { value: "gemini-api" }
    });
    expect(screen.getByText("共通のGemini APIキー")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("モデル"), {
      target: { value: "gemini-test" }
    });
    fireEvent.click(screen.getByRole("button", { name: "コンテキストを生成" }));
    await waitFor(() =>
      expect(window.featureContext.start).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({
          provider: "gemini-api",
          geminiApiModel: "gemini-test"
        })
      )
    );
    expect(window.featureContext.start).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geminiApiKey: expect.anything() })
    );
  });

  it("複数のプロジェクトフォルダを選択してスマホ利用へ一括登録できる", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /スマホ版/ }));
    fireEvent.click(await screen.findByRole("button", { name: "プロジェクトを追加" }));
    await waitFor(() => expect(window.featureContext.selectFolders).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(window.featureContext.registerRemoteProjects).toHaveBeenCalledWith([
        "C:\\projects\\project-a",
        "D:\\日本語 projects\\project-b"
      ])
    );
  });

  it("共通設定からPC・スマホ共通のGemini APIキーを暗号化保存できる", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /共通設定/ }));
    const input = await screen.findByLabelText("Gemini APIキー");
    fireEvent.change(input, { target: { value: "new-shared-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Windowsへ暗号化保存" }));

    await waitFor(() =>
      expect(window.featureContext.saveGeminiApiKey).toHaveBeenCalledWith("new-shared-key")
    );
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.getByText("Windowsへ暗号化保存済み")).toBeInTheDocument();
  });
});
