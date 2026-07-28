import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewaySettingsStore } from "../../src/gateway/settings.js";

let temporary: string;
let store: GatewaySettingsStore;

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "feature-context-settings-"));
  store = new GatewaySettingsStore(path.join(temporary, "mobile-gateway.json"));
});

afterEach(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});

describe("GatewaySettingsStore.registerProjects", () => {
  it("複数フォルダを一括登録し、同じパスは重複させない", async () => {
    const first = path.join(temporary, "project one");
    const second = path.join(temporary, "日本語 project");
    await Promise.all([
      fs.mkdir(first, { recursive: true }),
      fs.mkdir(second, { recursive: true })
    ]);

    const registered = await store.registerProjects([first, second, first]);
    expect(registered).toHaveLength(2);
    expect(registered.map((project) => project.label)).toEqual(["project one", "日本語 project"]);

    const repeated = await store.registerProjects([second, first]);
    expect(repeated.map((project) => project.id)).toEqual([
      registered[1].id,
      registered[0].id
    ]);
    expect((await store.load()).projects).toHaveLength(2);
  });

  it("選択中に不正なパスがあれば一件も追加しない", async () => {
    const valid = path.join(temporary, "valid");
    await fs.mkdir(valid, { recursive: true });

    await expect(
      store.registerProjects([valid, path.join(temporary, "missing")])
    ).rejects.toThrow();
    expect((await store.load()).projects).toEqual([]);
  });
});
