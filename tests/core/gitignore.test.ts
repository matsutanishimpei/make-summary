import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitIgnoreResolver } from "../../src/core/gitignore.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "feature-context-gitignore-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("GitIgnoreResolver", () => {
  it("サブディレクトリ基準のルールをその配下だけへ適用する", async () => {
    await write("src/.gitignore", "generated/\n");
    await write("src/generated/output.ts", "ignored");
    await write("generated/output.ts", "included");
    const resolver = new GitIgnoreResolver(root);

    await expect(resolver.isIgnored("src/generated/output.ts")).resolves.toBe(true);
    await expect(resolver.isIgnored("generated/output.ts")).resolves.toBe(false);
    await expect(resolver.isIgnored("src\\generated\\output.ts")).resolves.toBe(true);
  });

  it("子の否定ルールで親のファイル除外ルールを上書きする", async () => {
    await write(".gitignore", "*.log\n");
    await write("src/.gitignore", "!keep.log\n");
    await write("src/keep.log", "included");
    await write("src/drop.log", "ignored");
    const resolver = new GitIgnoreResolver(root);

    await expect(resolver.isIgnored("src/keep.log")).resolves.toBe(false);
    await expect(resolver.isIgnored("src/drop.log")).resolves.toBe(true);
  });

  it("親ディレクトリ自体が除外されている場合は子から再包含しない", async () => {
    await write(".gitignore", "vendor/\n");
    await write("vendor/.gitignore", "!keep.ts\n");
    await write("vendor/keep.ts", "still ignored");
    const resolver = new GitIgnoreResolver(root);

    await expect(resolver.isIgnored("vendor/keep.ts")).resolves.toBe(true);
  });
});

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}
