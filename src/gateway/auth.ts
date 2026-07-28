import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import QRCode from "qrcode";
import { HttpError } from "./http.js";
import { GatewaySettingsStore } from "./settings.js";
import type { PairedSession, PairingInfo } from "./types.js";

export const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60_000;
const pairLifetimeMs = 5 * 60_000;

interface PairingToken {
  hash: string;
  expiresAt: number;
}

export class GatewayAuthService {
  private readonly pairings = new Map<string, PairingToken>();
  private readonly pairingAttempts = new Map<string, number[]>();

  constructor(
    private readonly settings: GatewaySettingsStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createPairing(baseUrl: string): Promise<PairingInfo> {
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

  async pairDevice(
    remoteAddress: string,
    token: unknown,
    deviceName: unknown
  ): Promise<{ sessionToken: string; session: PairedSession }> {
    const now = this.now().getTime();
    const attempts = (this.pairingAttempts.get(remoteAddress) ?? []).filter(
      (at) => now - at < 10 * 60_000
    );
    if (attempts.length >= 10) throw new HttpError(429, "ペアリング試行が多すぎます。");
    attempts.push(now);
    this.pairingAttempts.set(remoteAddress, attempts);

    const tokenHash = typeof token === "string" ? hashToken(token) : "";
    const match = [...this.pairings.entries()].find(
      ([, pairing]) => pairing.expiresAt > now && safeHashEqual(pairing.hash, tokenHash)
    );
    if (!match) throw new HttpError(401, "ペアリングコードが無効か期限切れです。");
    this.pairings.delete(match[0]);

    const sessionToken = randomBytes(32).toString("base64url");
    const at = this.now().toISOString();
    const session: PairedSession = {
      id: randomUUID(),
      deviceName: normalizeDeviceName(deviceName),
      tokenHash: hashToken(sessionToken),
      createdAt: at,
      lastUsedAt: at,
      expiresAt: new Date(now + SESSION_LIFETIME_MS).toISOString()
    };
    await this.settings.addSession(session);
    return { sessionToken, session };
  }

  async authenticate(sessionToken: string | undefined): Promise<PairedSession | undefined> {
    if (!sessionToken) return undefined;
    const hash = hashToken(sessionToken);
    const settings = await this.settings.load();
    const now = this.now();
    const session = settings.sessions.find(
      (candidate) =>
        Date.parse(candidate.expiresAt) > now.getTime() &&
        safeHashEqual(candidate.tokenHash, hash)
    );
    if (session) {
      void this.settings.touchSession(session.id, now).catch(() => {
        // Authentication already succeeded; a last-used timestamp failure must not break the request.
      });
    }
    return session;
  }

  private prunePairings(): void {
    const now = this.now().getTime();
    for (const [id, pairing] of this.pairings) {
      if (pairing.expiresAt <= now) this.pairings.delete(id);
    }
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

function normalizeDeviceName(value: unknown): string {
  if (typeof value !== "string") return "スマートフォン";
  return value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80) || "スマートフォン";
}
