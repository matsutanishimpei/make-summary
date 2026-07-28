import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import QRCode from "qrcode";
import {
  FeatureContextError,
  FeatureContextService,
  isAiProvider,
  type BuildOptions,
  type BuildResult,
  type ProgressEvent
} from "../core/index.js";
import { GatewaySettingsStore } from "./settings.js";
import type {
  GatewayStatus,
  MobileBuildRequest,
  MobileProject,
  PairingInfo,
  PairedSession,
  RebuildRequest,
  RemoteJob,
  RemoteJobResult
} from "./types.js";
import { createBundleZip } from "./zip.js";

const pairLifetimeMs = 5 * 60_000;
const sessionLifetimeMs = 180 * 24 * 60 * 60_000;
const maxRequestBytes = 64 * 1_024;
const maxJobs = 20;

export interface GatewayCredentialProvider {
  getGeminiApiKey(): Promise<string | undefined>;
}

export interface MobileGatewayOptions {
  settings: GatewaySettingsStore;
  staticDir: string;
  credentials?: GatewayCredentialProvider;
  serviceFactory?: () => FeatureContextService;
  host?: string;
  now?: () => Date;
}

interface PairingToken {
  hash: string;
  expiresAt: number;
}

interface InternalJob {
  view: RemoteJob;
  controller: AbortController;
  listeners: Set<ServerResponse>;
  buildResult?: BuildResult;
}

export class MobileGateway {
  private server?: Server;
  private port?: number;
  private readonly jobs = new Map<string, InternalJob>();
  private readonly pairings = new Map<string, PairingToken>();
  private readonly pairingAttempts = new Map<string, number[]>();
  private readonly host: string;
  private readonly now: () => Date;

  constructor(private readonly options: MobileGatewayOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.now = options.now ?? (() => new Date());
  }

  get running(): boolean {
    return Boolean(this.server?.listening);
  }

  async start(portInput?: number): Promise<number> {
    if (this.running) return this.port!;
    const settings = await this.options.settings.load();
    const port = portInput ?? settings.port;
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, this.host);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        const conflict = new Error(
          `スマホ連携用ポート${port}はすでに使用中です。タスクトレイに残っているFeature Context Builderを終了してから再実行してください。`
        ) as Error & { code?: string; details?: string };
        conflict.code = "EADDRINUSE";
        conflict.details = `listen EADDRINUSE: ${this.host}:${port}`;
        throw conflict;
      }
      throw error;
    }
    this.server = server;
    const address = server.address();
    this.port = typeof address === "object" && address ? address.port : port;
    return this.port;
  }

  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.view.state === "queued" || job.view.state === "running") job.controller.abort();
      for (const listener of job.listeners) listener.end();
    }
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async createPairing(): Promise<PairingInfo> {
    const settings = await this.options.settings.load();
    const baseUrl =
      settings.publicUrl ||
      `http://${this.host === "0.0.0.0" ? "127.0.0.1" : this.host}:${this.port ?? settings.port}`;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now().getTime() + pairLifetimeMs;
    const id = randomUUID();
    this.prunePairings();
    this.pairings.set(id, { hash: hashToken(token), expiresAt });
    const url = `${baseUrl.replace(/\/$/, "")}/#pair=${token}`;
    return {
      url,
      expiresAt: new Date(expiresAt).toISOString(),
      qrDataUrl: await QRCode.toDataURL(url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 360
      })
    };
  }

  async status(
    extra: Pick<GatewayStatus, "hasGeminiApiKey" | "autoStart" | "tailscale">
  ): Promise<GatewayStatus> {
    const settings = await this.options.settings.load();
    return {
      enabled: settings.enabled,
      running: this.running,
      port: settings.port,
      localUrl: `http://127.0.0.1:${settings.port}`,
      publicUrl: settings.publicUrl,
      projects: settings.projects,
      pairedDevices: settings.sessions.map(({ tokenHash: _tokenHash, ...session }) => session),
      ...extra
    };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await this.handleApi(request, response, url);
      } else {
        await serveStatic(this.options.staticDir, request, response, url.pathname);
      }
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const known = error instanceof FeatureContextError ? error : undefined;
      sendJson(response, status, {
        error: {
          code: known?.code,
          message:
            error instanceof Error
              ? error.message
              : "スマホ連携サーバーで予期しないエラーが発生しました。"
        }
      });
    }
  }

  private async handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL
  ): Promise<void> {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") assertSameOrigin(request);

    if (method === "GET" && url.pathname === "/api/v1/health") {
      sendJson(response, 200, { ok: true, service: "feature-context-mobile" });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/pair") {
      await this.pairDevice(request, response);
      return;
    }

    const session = await this.authenticate(request);
    if (method === "GET" && url.pathname === "/api/v1/session") {
      sendJson(response, 200, {
        authenticated: Boolean(session),
        device: session
          ? { id: session.id, name: session.deviceName, expiresAt: session.expiresAt }
          : undefined
      });
      return;
    }
    if (!session) throw new HttpError(401, "スマホのペアリングが必要です。");

    if (method === "POST" && url.pathname === "/api/v1/logout") {
      await this.options.settings.revokeSession(session.id);
      response.setHeader("set-cookie", expiredSessionCookie());
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/projects") {
      const settings = await this.options.settings.load();
      const projects: MobileProject[] = settings.projects.map(({ id, label }) => ({ id, label }));
      sendJson(response, 200, { projects });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/jobs") {
      sendJson(response, 200, {
        jobs: [...this.jobs.values()].map((job) => job.view).reverse()
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/jobs") {
      const body = await readJson<MobileBuildRequest>(request);
      const job = await this.createBuildJob(body);
      sendJson(response, 202, { job: job.view });
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)$/i);
    if (method === "GET" && jobMatch) {
      sendJson(response, 200, { job: this.requireJob(jobMatch[1]).view });
      return;
    }

    const eventsMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/events$/i);
    if (method === "GET" && eventsMatch) {
      this.subscribe(this.requireJob(eventsMatch[1]), request, response);
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/cancel$/i);
    if (method === "POST" && cancelMatch) {
      const job = this.requireJob(cancelMatch[1]);
      const cancellable = job.view.state === "queued" || job.view.state === "running";
      if (cancellable) job.controller.abort();
      sendJson(response, 200, { cancelled: cancellable });
      return;
    }

    const rebuildMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/rebuild$/i);
    if (method === "POST" && rebuildMatch) {
      const source = this.requireJob(rebuildMatch[1]);
      const body = await readJson<RebuildRequest>(request);
      const job = await this.createRebuildJob(source, body);
      sendJson(response, 202, { job: job.view });
      return;
    }

    const artifactMatch = url.pathname.match(
      /^\/api\/v1\/jobs\/([a-f0-9-]+)\/artifacts\/([^/]+)$/i
    );
    if (method === "GET" && artifactMatch) {
      await this.sendArtifact(
        this.requireCompletedJob(artifactMatch[1]),
        decodeURIComponent(artifactMatch[2]),
        response,
        url.searchParams.get("download") === "1"
      );
      return;
    }

    const zipMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/bundle\.zip$/i);
    if (method === "GET" && zipMatch) {
      await this.sendZip(this.requireCompletedJob(zipMatch[1]), response);
      return;
    }

    throw new HttpError(404, "APIが見つかりません。");
  }

  private async pairDevice(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const key = request.socket.remoteAddress ?? "unknown";
    const now = this.now().getTime();
    const attempts = (this.pairingAttempts.get(key) ?? []).filter((at) => now - at < 10 * 60_000);
    if (attempts.length >= 10) throw new HttpError(429, "ペアリング試行が多すぎます。");
    attempts.push(now);
    this.pairingAttempts.set(key, attempts);

    const body = await readJson<{ token?: string; deviceName?: string }>(request);
    const tokenHash = typeof body.token === "string" ? hashToken(body.token) : "";
    const match = [...this.pairings.entries()].find(
      ([, pairing]) =>
        pairing.expiresAt > now && safeHashEqual(pairing.hash, tokenHash)
    );
    if (!match) throw new HttpError(401, "ペアリングコードが無効か期限切れです。");
    this.pairings.delete(match[0]);

    const sessionToken = randomBytes(32).toString("base64url");
    const at = this.now().toISOString();
    const session: PairedSession = {
      id: randomUUID(),
      deviceName: normalizeDeviceName(body.deviceName),
      tokenHash: hashToken(sessionToken),
      createdAt: at,
      lastUsedAt: at,
      expiresAt: new Date(now + sessionLifetimeMs).toISOString()
    };
    await this.options.settings.addSession(session);
    response.setHeader("set-cookie", sessionCookie(sessionToken));
    sendJson(response, 200, {
      ok: true,
      device: { id: session.id, name: session.deviceName, expiresAt: session.expiresAt }
    });
  }

  private async authenticate(request: IncomingMessage): Promise<PairedSession | undefined> {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.fcb_session;
    if (!token) return undefined;
    const hash = hashToken(token);
    const settings = await this.options.settings.load();
    const now = this.now();
    const session = settings.sessions.find(
      (candidate) =>
        Date.parse(candidate.expiresAt) > now.getTime() &&
        safeHashEqual(candidate.tokenHash, hash)
    );
    if (session) {
      void this.options.settings.touchSession(session.id, now).catch(() => {
        // Authentication already succeeded; a last-used timestamp failure must not break the request.
      });
    }
    return session;
  }

  private async createBuildJob(body: MobileBuildRequest): Promise<InternalJob> {
    validateBuildRequest(body);
    if ([...this.jobs.values()].some((job) => job.view.state === "running" || job.view.state === "queued")) {
      throw new HttpError(409, "別のスマホ調査が実行中です。完了後に再実行してください。");
    }
    const settings = await this.options.settings.load();
    const project = settings.projects.find((item) => item.id === body.projectId);
    if (!project) throw new HttpError(400, "登録済みプロジェクトを選択してください。");
    const key =
      body.provider === "gemini-api"
        ? await this.options.credentials?.getGeminiApiKey()
        : undefined;
    const id = randomUUID();
    const now = this.now().toISOString();
    const job: InternalJob = {
      view: {
        id,
        projectId: project.id,
        projectLabel: project.label,
        feature: body.feature.trim(),
        state: "queued",
        createdAt: now,
        updatedAt: now
      },
      controller: new AbortController(),
      listeners: new Set()
    };
    this.addJob(job);
    const options: BuildOptions = {
      projectRoot: project.root,
      feature: body.feature.trim(),
      provider: body.provider,
      geminiApiKey: key,
      geminiApiModel: body.geminiApiModel,
      summary: body.summary,
      concat: body.concat,
      maxOutputFiles: body.maxOutputFiles,
      maxTotalChars: body.maxTotalChars,
      name: `${body.feature.trim()}-${id.slice(0, 8)}`,
      force: false
    };
    this.runBuild(job, () =>
      (this.options.serviceFactory?.() ?? new FeatureContextService()).build(
        options,
        (progress) => this.updateProgress(job, progress),
        job.controller.signal
      )
    );
    return job;
  }

  private async createRebuildJob(
    source: InternalJob,
    body: RebuildRequest
  ): Promise<InternalJob> {
    if (!source.buildResult || source.view.state !== "completed") {
      throw new HttpError(409, "完了したジョブだけ再構築できます。");
    }
    if ([...this.jobs.values()].some((job) => job.view.state === "running" || job.view.state === "queued")) {
      throw new HttpError(409, "別のスマホ調査が実行中です。完了後に再実行してください。");
    }
    if (
      !body.selections ||
      typeof body.selections !== "object" ||
      Object.keys(body.selections).length > 10_000 ||
      Object.values(body.selections).some((value) => typeof value !== "boolean") ||
      (body.maxOutputFiles !== undefined &&
        (!Number.isInteger(body.maxOutputFiles) ||
          body.maxOutputFiles < 1 ||
          body.maxOutputFiles > 5)) ||
      (body.maxTotalChars !== undefined &&
        (!Number.isInteger(body.maxTotalChars) ||
          body.maxTotalChars < 1_000 ||
          body.maxTotalChars > 2_000_000))
    ) {
      throw new HttpError(400, "関連ソースの選択が不正です。");
    }
    const id = randomUUID();
    const now = this.now().toISOString();
    const job: InternalJob = {
      view: {
        id,
        projectId: source.view.projectId,
        projectLabel: source.view.projectLabel,
        feature: source.view.feature,
        state: "queued",
        createdAt: now,
        updatedAt: now
      },
      controller: new AbortController(),
      listeners: new Set()
    };
    this.addJob(job);
    this.runBuild(job, () =>
      (this.options.serviceFactory?.() ?? new FeatureContextService()).rebuild(
        {
          manifestPath: source.buildResult!.manifestPath,
          selections: body.selections,
          maxOutputFiles: body.maxOutputFiles,
          maxTotalChars: body.maxTotalChars,
          force: true
        },
        (progress) => this.updateProgress(job, progress),
        job.controller.signal
      )
    );
    return job;
  }

  private runBuild(job: InternalJob, operation: () => Promise<BuildResult>): void {
    job.view.state = "running";
    job.view.updatedAt = this.now().toISOString();
    this.publish(job);
    void operation()
      .then((result) => {
        job.buildResult = result;
        job.view.state = "completed";
        job.view.updatedAt = this.now().toISOString();
        job.view.result = toRemoteResult(job.view.id, result);
        this.publish(job);
      })
      .catch((error: unknown) => {
        const value = error as { code?: unknown; message?: unknown };
        job.view.state =
          value.code === "CANCELLED" || job.controller.signal.aborted ? "cancelled" : "error";
        job.view.updatedAt = this.now().toISOString();
        job.view.error = {
          ...(typeof value.code === "string" ? { code: value.code } : {}),
          message:
            typeof value.message === "string"
              ? value.message
              : "スマホからの調査に失敗しました。"
        };
        this.publish(job);
      });
  }

  private updateProgress(job: InternalJob, progress: ProgressEvent): void {
    job.view.progress = progress;
    job.view.updatedAt = this.now().toISOString();
    this.publish(job);
  }

  private publish(job: InternalJob): void {
    const payload = `event: job\ndata: ${JSON.stringify(job.view)}\n\n`;
    for (const listener of job.listeners) listener.write(payload);
  }

  private subscribe(
    job: InternalJob,
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write(`event: job\ndata: ${JSON.stringify(job.view)}\n\n`);
    job.listeners.add(response);
    const timer = setInterval(() => response.write(": keepalive\n\n"), 20_000);
    timer.unref();
    request.on("close", () => {
      clearInterval(timer);
      job.listeners.delete(response);
    });
  }

  private async sendArtifact(
    job: InternalJob,
    name: string,
    response: ServerResponse,
    download: boolean
  ): Promise<void> {
    const artifact = job.buildResult!.manifest.bundleFiles.find((item) => item.name === name);
    if (!artifact || path.basename(name) !== name) throw new HttpError(404, "成果物が見つかりません。");
    const content = await fs.readFile(artifact.path);
    response.writeHead(200, {
      "content-type": "text/markdown; charset=utf-8",
      "content-length": String(content.length),
      "cache-control": "private, no-store",
      "content-disposition": contentDisposition(name, download ? "attachment" : "inline")
    });
    response.end(content);
  }

  private async sendZip(job: InternalJob, response: ServerResponse): Promise<void> {
    const zip = await createBundleZip(job.buildResult!);
    const filename = `${safeDownloadName(job.view.feature)}-feature-context.zip`;
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(zip.length),
      "cache-control": "private, no-store",
      "content-disposition": contentDisposition(filename, "attachment")
    });
    response.end(Buffer.from(zip));
  }

  private addJob(job: InternalJob): void {
    this.jobs.set(job.view.id, job);
    const completed = [...this.jobs.values()].filter(
      (item) => item.view.state !== "running" && item.view.state !== "queued"
    );
    while (this.jobs.size > maxJobs && completed.length) {
      const oldest = completed.shift()!;
      this.jobs.delete(oldest.view.id);
    }
  }

  private requireJob(id: string): InternalJob {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "ジョブが見つかりません。");
    return job;
  }

  private requireCompletedJob(id: string): InternalJob {
    const job = this.requireJob(id);
    if (job.view.state !== "completed" || !job.buildResult) {
      throw new HttpError(409, "成果物はまだ生成されていません。");
    }
    return job;
  }

  private prunePairings(): void {
    const now = this.now().getTime();
    for (const [id, pairing] of this.pairings) {
      if (pairing.expiresAt <= now) this.pairings.delete(id);
    }
  }
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function validateBuildRequest(body: MobileBuildRequest): void {
  if (
    !body ||
    typeof body.projectId !== "string" ||
    typeof body.feature !== "string" ||
    !body.feature.trim() ||
    body.feature.length > 2_000 ||
    !isAiProvider(body.provider) ||
    typeof body.summary !== "boolean" ||
    typeof body.concat !== "boolean" ||
    !Number.isInteger(body.maxOutputFiles) ||
    body.maxOutputFiles < 1 ||
    body.maxOutputFiles > 5 ||
    !Number.isInteger(body.maxTotalChars) ||
    body.maxTotalChars < 1_000 ||
    body.maxTotalChars > 2_000_000 ||
    (body.geminiApiModel !== undefined &&
      (typeof body.geminiApiModel !== "string" ||
        !/^[a-zA-Z0-9._-]+$/.test(body.geminiApiModel)))
  ) {
    throw new HttpError(400, "調査内容または上限値が不正です。");
  }
}

function toRemoteResult(jobId: string, result: BuildResult): RemoteJobResult {
  return {
    feature: result.manifest.feature,
    provider: result.manifest.provider.id,
    detectedFiles: result.manifest.validation.detected,
    bundledSourceFiles: new Set(result.manifest.bundledSources.map((item) => item.path)).size,
    totalChars: result.manifest.totalChars,
    estimatedTokens: result.manifest.estimatedTokens,
    warnings: result.manifest.warnings,
    uncertainties: result.manifest.uncertainties,
    artifacts: result.manifest.bundleFiles.map((artifact) => ({
      name: artifact.name,
      chars: artifact.chars,
      downloadUrl: `/api/v1/jobs/${jobId}/artifacts/${encodeURIComponent(artifact.name)}?download=1`
    })),
    relatedFiles: result.manifest.relatedFiles.map((record) => ({
      path: record.path,
      normalizedPath: record.normalizedPath,
      role: record.role,
      reason: record.reason,
      priority: record.priority,
      group: record.group,
      valid: record.valid,
      included: record.included,
      exclusionReason: record.exclusionReason
    })),
    selections: result.manifest.selections,
    zipUrl: `/api/v1/jobs/${jobId}/bundle.zip`
  };
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
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

function assertSameOrigin(request: IncomingMessage): void {
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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
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

function sessionCookie(token: string): string {
  return `fcb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionLifetimeMs / 1_000)}`;
}

function expiredSessionCookie(): string {
  return "fcb_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function normalizeDeviceName(value: unknown): string {
  if (typeof value !== "string") return "スマートフォン";
  return value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80) || "スマートフォン";
}

function safeDownloadName(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^\.+|-+$/g, "")
      .slice(0, 80) || "feature"
  );
}

function contentDisposition(filename: string, mode: "inline" | "attachment"): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "private, no-store"
  });
  response.end(body);
}

async function serveStatic(
  staticDir: string,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "この操作は許可されていません。");
  }
  const relative =
    pathname === "/"
      ? "index.html"
      : decodeURIComponent(pathname).replace(/^\/+/, "");
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
