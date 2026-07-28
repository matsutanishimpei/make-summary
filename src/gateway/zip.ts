import { promises as fs } from "node:fs";
import { zipSync } from "fflate";
import type { BuildResult } from "../core/types.js";

export async function createBundleZip(result: BuildResult): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const artifact of result.manifest.bundleFiles) {
    entries[artifact.name] = new Uint8Array(await fs.readFile(artifact.path));
  }
  return zipSync(entries, { level: 6 });
}
