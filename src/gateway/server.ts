import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  FeatureContextError,
  FeatureContextService
} from "../core/index.js";
import { GatewaySettingsStore } from "./settings.js";
import { GatewayAuthService, SESSION_LIFETIME_MS } from "./auth.js";
import { sendArtifact, sendBundleZip } from "./artifacts.js";
import {
  assertSameOrigin,
  expiredSessionCookie,
  HttpError,
  parseCookies,
  readJson,
  sendJson,
  serveStatic,
  sessionCookie,
  setSecurityHeaders
} from "./http.js";
import {
  GatewayJobService,
  type GatewayCredentialProvider
} from "./job-service.js";
import type {
  GatewayStatus,
  MobileBuildRequest,
  MobileProject,
  PairingInfo,
  PairedSession,
  RebuildRequest
} from "./types.js";

export type { GatewayCredentialProvider } from "./job-service.js";

export interface MobileGatewayOptions {
  settings: GatewaySettingsStore;
  staticDir: string;
  credentials?: GatewayCredentialProvider;
  serviceFactory?: () => FeatureContextService;
  host?: string;
  now?: () => Date;
}

export class MobileGateway {
  private server?: Server;
  private port?: number;
  private readonly jobs: GatewayJobService;
  private readonly eventStreams = new Set<ServerResponse>();
  private readonly auth: GatewayAuthService;
  private readonly host: string;
  private readonly now: () => Date;

  constructor(private readonly options: MobileGatewayOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.now = options.now ?? (() => new Date());
    this.jobs = new GatewayJobService({
      settings: options.settings,
      credentials: options.credentials,
      serviceFactory: options.serviceFactory,
      now: this.now
    });
    this.auth = new GatewayAuthService(options.settings, this.now);
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
    this.jobs.stopAll();
    for (const response of this.eventStreams) response.end();
    this.eventStreams.clear();
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
    return this.auth.createPairing(baseUrl);
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
      sendJson(response, 200, { jobs: this.jobs.list() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/jobs") {
      const body = await readJson<MobileBuildRequest>(request);
      const job = await this.jobs.createBuild(body);
      sendJson(response, 202, { job });
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)$/i);
    if (method === "GET" && jobMatch) {
      sendJson(response, 200, { job: this.jobs.get(jobMatch[1]) });
      return;
    }

    const eventsMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/events$/i);
    if (method === "GET" && eventsMatch) {
      this.subscribe(eventsMatch[1], request, response);
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/cancel$/i);
    if (method === "POST" && cancelMatch) {
      sendJson(response, 200, { cancelled: this.jobs.cancel(cancelMatch[1]) });
      return;
    }

    const rebuildMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/rebuild$/i);
    if (method === "POST" && rebuildMatch) {
      const body = await readJson<RebuildRequest>(request);
      const job = await this.jobs.createRebuild(rebuildMatch[1], body);
      sendJson(response, 202, { job });
      return;
    }

    const artifactMatch = url.pathname.match(
      /^\/api\/v1\/jobs\/([a-f0-9-]+)\/artifacts\/([^/]+)$/i
    );
    if (method === "GET" && artifactMatch) {
      await sendArtifact(
        this.jobs.getCompleted(artifactMatch[1]),
        decodeURIComponent(artifactMatch[2]),
        response,
        url.searchParams.get("download") === "1"
      );
      return;
    }

    const zipMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/bundle\.zip$/i);
    if (method === "GET" && zipMatch) {
      await sendBundleZip(this.jobs.getCompleted(zipMatch[1]), response);
      return;
    }

    throw new HttpError(404, "APIが見つかりません。");
  }

  private async pairDevice(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson<{ token?: string; deviceName?: string }>(request);
    const paired = await this.auth.pairDevice(
      request.socket.remoteAddress ?? "unknown",
      body.token,
      body.deviceName
    );
    response.setHeader("set-cookie", sessionCookie(paired.sessionToken, SESSION_LIFETIME_MS));
    sendJson(response, 200, {
      ok: true,
      device: {
        id: paired.session.id,
        name: paired.session.deviceName,
        expiresAt: paired.session.expiresAt
      }
    });
  }

  private async authenticate(request: IncomingMessage): Promise<PairedSession | undefined> {
    const cookies = parseCookies(request.headers.cookie);
    return this.auth.authenticate(cookies.fcb_session);
  }

  private subscribe(
    jobId: string,
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    this.eventStreams.add(response);
    const unsubscribe = this.jobs.subscribe(jobId, (job) => {
      response.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
    });
    const timer = setInterval(() => response.write(": keepalive\n\n"), 20_000);
    timer.unref();
    request.on("close", () => {
      clearInterval(timer);
      unsubscribe();
      this.eventStreams.delete(response);
    });
  }

}
