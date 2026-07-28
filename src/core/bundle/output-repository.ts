import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FeatureContextError } from "../errors.js";
import type { Manifest } from "../types.js";
import type { ArtifactContent } from "./model.js";

export async function writeBundleAtomically(
  projectRoot: string,
  outputDir: string,
  contents: ArtifactContent[],
  manifest: Manifest,
  force: boolean
): Promise<void> {
  const resolvedOutput = path.resolve(outputDir);
  await assertSafeOutputLocation(projectRoot, resolvedOutput);
  const parentDir = path.dirname(resolvedOutput);
  await fs.mkdir(parentDir, { recursive: true });
  const existing = await existingDirectoryState(resolvedOutput);
  if (existing === "invalid") {
    throw new FeatureContextError("INVALID_OUTPUT", "出力先が通常のディレクトリではありません。");
  }
  if (existing === "nonempty" && !force) throw new FeatureContextError("OUTPUT_EXISTS");

  const unique = `${process.pid}-${randomUUID()}`;
  const baseName = path.basename(resolvedOutput);
  const stageDir = path.join(parentDir, `.${baseName}.stage-${unique}`);
  const backupDir = path.join(parentDir, `.${baseName}.backup-${unique}`);
  let previousMoved = false;
  let replacementInstalled = false;
  try {
    if (existing !== "missing" && force) {
      await fs.cp(resolvedOutput, stageDir, {
        recursive: true,
        dereference: false,
        errorOnExist: true
      });
    } else {
      await fs.mkdir(stageDir);
    }

    const stagedBundle = path.join(stageDir, "bundle");
    await prepareStagedBundle(stagedBundle);
    for (const item of contents) {
      await fs.writeFile(path.join(stagedBundle, item.name), item.content, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    await fs.writeFile(path.join(stageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (existing !== "missing") {
      await fs.rename(resolvedOutput, backupDir);
      previousMoved = true;
    }
    try {
      await fs.rename(stageDir, resolvedOutput);
      replacementInstalled = true;
    } catch (error) {
      if (previousMoved) {
        await fs.rename(backupDir, resolvedOutput);
        previousMoved = false;
      }
      throw error;
    }
    if (previousMoved) {
      await fs.rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      previousMoved = false;
    }
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => {});
    if (previousMoved && !replacementInstalled && !(await pathExists(resolvedOutput))) {
      try {
        await fs.rename(backupDir, resolvedOutput);
        previousMoved = false;
      } catch {
        // The original error below retains the write failure diagnostics.
      }
    }
    if (error instanceof FeatureContextError) throw error;
    throw new FeatureContextError(
      "INVALID_OUTPUT",
      "成果物を安全に書き込めませんでした。既存成果物は可能な限り保持されています。",
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
  }
}

async function prepareStagedBundle(bundleDir: string): Promise<void> {
  try {
    const stat = await fs.lstat(bundleDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      await fs.rm(bundleDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      await fs.mkdir(bundleDir, { recursive: true });
      return;
    }
    for (const entry of await fs.readdir(bundleDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".md") && (entry.isFile() || entry.isSymbolicLink())) {
        await fs.unlink(path.join(bundleDir, entry.name));
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(bundleDir, { recursive: true });
  }
}

async function assertSafeOutputLocation(projectRoot: string, outputDir: string): Promise<void> {
  const rootReal = await fs.realpath(projectRoot);
  if (!isSameOrInside(rootReal, outputDir) || path.resolve(rootReal) === path.resolve(outputDir)) {
    throw new FeatureContextError("INVALID_OUTPUT");
  }
  let cursor = outputDir;
  while (true) {
    try {
      const real = await fs.realpath(cursor);
      if (!isSameOrInside(rootReal, real)) throw new FeatureContextError("INVALID_OUTPUT");
      return;
    } catch (error) {
      if (error instanceof FeatureContextError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new FeatureContextError("INVALID_OUTPUT");
      cursor = parent;
    }
  }
}

async function existingDirectoryState(
  directory: string
): Promise<"missing" | "empty" | "nonempty" | "invalid"> {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return "invalid";
    return (await fs.readdir(directory)).length === 0 ? "empty" : "nonempty";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isSameOrInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
