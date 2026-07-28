import path from "node:path";
import { MobileGateway } from "../gateway/server.js";
import { GatewaySettingsStore } from "../gateway/settings.js";
import type {
  GatewayStatus,
  PairingInfo,
  RegisteredProject
} from "../gateway/types.js";
import { ElectronCredentialStore } from "./secure-store.js";
import { TailscaleService } from "./tailscale.js";

export interface RemoteControllerOptions {
  userDataDir: string;
  mobileStaticDir: string;
  credentials: ElectronCredentialStore;
  onEnabledChanged?: (enabled: boolean) => void;
}

export class RemoteController {
  readonly settings: GatewaySettingsStore;
  readonly credentials: ElectronCredentialStore;
  readonly gateway: MobileGateway;
  readonly tailscale = new TailscaleService();

  constructor(private readonly options: RemoteControllerOptions) {
    this.settings = new GatewaySettingsStore(
      path.join(options.userDataDir, "mobile-gateway.json")
    );
    this.credentials = options.credentials;
    this.gateway = new MobileGateway({
      settings: this.settings,
      credentials: this.credentials,
      staticDir: options.mobileStaticDir
    });
  }

  async initialize(): Promise<void> {
    const settings = await this.settings.load();
    if (settings.enabled) {
      await this.gateway.start(settings.port);
      this.options.onEnabledChanged?.(true);
    }
  }

  async dispose(): Promise<void> {
    await this.gateway.stop();
  }

  async status(autoStart: boolean): Promise<GatewayStatus> {
    const [hasGeminiApiKey, tailscale] = await Promise.all([
      this.credentials.hasGeminiApiKey(),
      this.tailscale.inspect()
    ]);
    return this.gateway.status({ hasGeminiApiKey, autoStart, tailscale });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      const settings = await this.settings.load();
      await this.gateway.start(settings.port);
      await this.settings.update((value) => {
        value.enabled = true;
      });
    } else {
      await this.gateway.stop();
      await this.settings.update((value) => {
        value.enabled = false;
      });
    }
    this.options.onEnabledChanged?.(enabled);
  }

  async registerProject(root: string, label?: string): Promise<RegisteredProject> {
    return this.settings.registerProject(root, label);
  }

  async removeProject(projectId: string): Promise<boolean> {
    return this.settings.removeProject(projectId);
  }

  async revokeDevice(sessionId: string): Promise<boolean> {
    return this.settings.revokeSession(sessionId);
  }

  async configureTailscale(): Promise<{ publicUrl: string; output: string }> {
    const settings = await this.settings.load();
    if (!this.gateway.running) await this.gateway.start(settings.port);
    const configured = await this.tailscale.configureServe(settings.port);
    await this.settings.update((value) => {
      value.enabled = true;
      value.publicUrl = configured.publicUrl;
    });
    this.options.onEnabledChanged?.(true);
    return configured;
  }

  async createPairing(): Promise<PairingInfo> {
    if (!this.gateway.running) {
      const settings = await this.settings.load();
      await this.gateway.start(settings.port);
    }
    return this.gateway.createPairing();
  }
}
