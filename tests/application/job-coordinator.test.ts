import { describe, expect, it } from "vitest";
import { JobCoordinator } from "../../src/application/jobs/job-coordinator.js";

describe("JobCoordinator", () => {
  it("進捗・完了・結果を一貫した状態として通知する", async () => {
    const coordinator = new JobCoordinator<{ feature: string }, string, string>();
    const handle = coordinator.start("job-1", { feature: "ログイン" }, async ({ report }) => {
      report("調査中");
      return "完了結果";
    });
    const states: string[] = [];
    coordinator.subscribe("job-1", (job) => states.push(`${job.state}:${job.progress ?? ""}`));

    await expect(handle.completion).resolves.toBe("完了結果");
    expect(coordinator.require("job-1")).toMatchObject({
      state: "completed",
      result: "完了結果"
    });
    expect(states).toContain("completed:調査中");
  });

  it("キャンセル時にAbortSignalを伝えてcancelledへ遷移する", async () => {
    const coordinator = new JobCoordinator<undefined, string, string>();
    const handle = coordinator.start("job-2", undefined, async ({ signal }) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), {
          code: "CANCELLED"
        })));
      });
      return "unreachable";
    });

    expect(coordinator.cancel("job-2")).toBe(true);
    await expect(handle.completion).rejects.toMatchObject({ code: "CANCELLED" });
    expect(coordinator.require("job-2").state).toBe("cancelled");
  });

  it("完了ジョブだけを上限に従って整理し、実行中ジョブを残す", async () => {
    const coordinator = new JobCoordinator<number, number, never>({ maxJobs: 2 });
    await coordinator.start("one", 1, async () => 1).completion;
    await coordinator.start("two", 2, async () => 2).completion;
    await coordinator.start("three", 3, async () => 3).completion;

    expect(coordinator.get("one")).toBeUndefined();
    expect(coordinator.list().map((job) => job.id)).toEqual(["two", "three"]);
  });
});
