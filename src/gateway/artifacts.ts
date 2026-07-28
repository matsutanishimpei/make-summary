import { promises as fs } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { contentDisposition, HttpError, safeDownloadName } from "./http.js";
import type { GatewayJob } from "./job-service.js";
import { createBundleZip } from "./zip.js";

type CompletedGatewayJob = GatewayJob & { result: NonNullable<GatewayJob["result"]> };

export async function sendArtifact(
  job: CompletedGatewayJob,
  name: string,
  response: ServerResponse,
  download: boolean
): Promise<void> {
  const artifact = job.result.manifest.bundleFiles.find((item) => item.name === name);
  if (!artifact || path.basename(name) !== name) {
    throw new HttpError(404, "成果物が見つかりません。");
  }
  const content = await fs.readFile(artifact.path);
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-length": String(content.length),
    "cache-control": "private, no-store",
    "content-disposition": contentDisposition(name, download ? "attachment" : "inline")
  });
  response.end(content);
}

export async function sendBundleZip(
  job: CompletedGatewayJob,
  response: ServerResponse
): Promise<void> {
  const zip = await createBundleZip(job.result);
  const filename = `${safeDownloadName(job.metadata.feature)}-feature-context.zip`;
  response.writeHead(200, {
    "content-type": "application/zip",
    "content-length": String(zip.length),
    "cache-control": "private, no-store",
    "content-disposition": contentDisposition(filename, "attachment")
  });
  response.end(Buffer.from(zip));
}
