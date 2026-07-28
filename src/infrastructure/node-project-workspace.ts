import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectWorkspacePort } from "../application/ports.js";
import { parseManifest } from "../contracts/manifest.js";
import { collectSelectedFiles } from "../core/bundle.js";
import { FeatureContextError } from "../core/errors.js";
import type { Manifest } from "../core/types.js";
import { validateRelatedFiles } from "../core/validate.js";

const execFileAsync = promisify(execFile);

export class NodeProjectWorkspace implements ProjectWorkspacePort {
  async resolveProjectRoot(input: string): Promise<string> {
    try {
      const root = await fs.realpath(path.resolve(input));
      if (!(await fs.stat(root)).isDirectory()) throw new Error("not a directory");
      return root;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new FeatureContextError(
        code === "EACCES" || code === "EPERM" ? "READ_DENIED" : "ROOT_NOT_FOUND",
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  resolveOutputDir(projectRoot: string, outputBase: string | undefined, name: string): string {
    const base = outputBase ? path.resolve(projectRoot, outputBase) : path.join(projectRoot, ".feature-context");
    this.assertOutputInside(projectRoot, base);
    const output = path.resolve(base, safeName(name));
    this.assertOutputInside(projectRoot, output);
    return output;
  }

  assertOutputInside(projectRoot: string, outputDir: string): void {
    const relative = path.relative(projectRoot, outputDir);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new FeatureContextError("INVALID_OUTPUT");
    }
  }

  async assertOutputAvailable(outputDir: string): Promise<void> {
    try {
      const stat = await fs.stat(outputDir);
      if (!stat.isDirectory() || (await fs.readdir(outputDir)).length > 0) {
        throw new FeatureContextError("OUTPUT_EXISTS");
      }
    } catch (error) {
      if (error instanceof FeatureContextError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  validateRelatedFiles = validateRelatedFiles;
  collectSelectedFiles = collectSelectedFiles;

  async getGitCommitId(root: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        windowsHide: true,
        timeout: 5000
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async readManifest(manifestPath: string): Promise<Manifest> {
    try {
      return parseManifest(JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8")));
    } catch (error) {
      throw new FeatureContextError("INVALID_OUTPUT", "manifest.jsonを読み取れません。", String(error));
    }
  }
}

export function resolveOutputDir(
  projectRoot: string,
  outputBase: string | undefined,
  name: string
): string {
  return new NodeProjectWorkspace().resolveOutputDir(projectRoot, outputBase, name);
}

function safeName(input: string): string {
  const name = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+|-+$/g, "")
    .slice(0, 64);
  return name || "feature";
}
