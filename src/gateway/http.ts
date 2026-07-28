import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const maxRequestBytes = 64 * 1_024;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "application/jsonで送信してください。");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxRequestBytes) throw new HttpError(413, "リクエストが大きすぎます。");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "JSONを読み取れません。");
  }
}

export function assertSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== request.headers.host) {
      throw new HttpError(403, "異なるサイトからの操作は許可されていません。");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Originが不正です。");
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    try {
      output[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookies instead of turning an unauthenticated request into a server error.
    }
  }
  return output;
}

export function sessionCookie(token: string, lifetimeMs: number): string {
  return `fcb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(lifetimeMs / 1_000)}`;
}

export function expiredSessionCookie(): string {
  return "fcb_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

export function safeDownloadName(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^\.+|-+$/g, "")
      .slice(0, 80) || "feature"
  );
}

export function contentDisposition(filename: string, mode: "inline" | "attachment"): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "private, no-store"
  });
  response.end(body);
}

export async function serveStatic(
  staticDir: string,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "この操作は許可されていません。");
  }
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = path.resolve(staticDir, relative);
  const root = path.resolve(staticDir);
  const pathRelative = path.relative(root, candidate);
  if (
    pathRelative === ".." ||
    pathRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(pathRelative)
  ) {
    throw new HttpError(404, "ファイルが見つかりません。");
  }
  let filePath = candidate;
  try {
    if (!(await fs.stat(filePath)).isFile()) throw new Error("not file");
  } catch {
    filePath = path.join(root, "index.html");
  }
  let content: Buffer;
  try {
    content = await fs.readFile(filePath);
  } catch {
    throw new HttpError(503, "スマホ画面がまだビルドされていません。");
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-type": mimeType(extension),
    "content-length": String(content.length),
    "cache-control":
      path.basename(filePath) === "index.html" || path.basename(filePath) === "sw.js"
        ? "no-cache"
        : "public, max-age=31536000, immutable"
  });
  if (request.method === "HEAD") response.end();
  else response.end(content);
}

function mimeType(extension: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json"
  };
  return types[extension] ?? "application/octet-stream";
}
