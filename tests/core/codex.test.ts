import { describe, expect, it, vi } from "vitest";
import { CodexCliRunner, parseCodexJsonl } from "../../src/core/index.js";
import type { CliExecutor } from "../../src/core/index.js";

const investigation = {
  feature: "通知機能",
  overview: "通知の流れ",
  flow: ["NotificationButton", "NotificationService"],
  files: [
    {
      path: "src/notifications.ts",
      role: "通知サービス",
      reason: "通知処理を実行する",
      priority: "core",
      group: "domain",
      recommended: true
    }
  ],
  uncertainties: []
};

describe("Codex JSONL parser", () => {
  it("最後のagent_messageから調査JSONを取り出す", () => {
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "test" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: JSON.stringify(investigation) }
      }),
      JSON.stringify({ type: "turn.completed", usage: {} })
    ].join("\n");

    expect(parseCodexJsonl(output)).toMatchObject(investigation);
  });

  it("コードフェンス付きのagent_messageも安全に解析する", () => {
    const output = JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: `\`\`\`json\n${JSON.stringify(investigation)}\n\`\`\``
      }
    });

    expect(parseCodexJsonl(output).feature).toBe("通知機能");
  });

  it("有効な調査結果がなければINVALID_JSONにする", () => {
    expect(() =>
      parseCodexJsonl(JSON.stringify({ type: "turn.completed", usage: {} }))
    ).toThrowError(expect.objectContaining({ code: "INVALID_JSON" }));
  });
});

describe("CodexCliRunner", () => {
  it("日本語と空白を含む作業ディレクトリでread-onlyの非対話実行を使う", async () => {
    const execute = vi.fn<CliExecutor>(async (request) => {
      if (request.args[0] === "--version") {
        return { stdout: "codex-cli 1.2.3\n", stderr: "", exitCode: 0 };
      }
      if (request.args.includes("--help")) {
        return {
          stdout: "--json --sandbox --skip-git-repo-check",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(investigation) }
        }),
        stderr: "",
        exitCode: 0
      };
    });
    const runner = new CodexCliRunner("codex-test", execute);
    const projectRoot = "C:\\開発 フォルダ\\通知アプリ";

    await runner.investigate({
      projectRoot,
      prompt: "通知機能を調査",
      timeoutMs: 30_000
    });

    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executable: "codex-test",
        args: [
          "exec",
          "--json",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "-"
        ],
        cwd: projectRoot,
        stdin: "通知機能を調査",
        providerName: "Codex"
      })
    );
  });
});
