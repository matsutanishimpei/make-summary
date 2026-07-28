import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  GatewaySettings,
  PairedSession,
  RegisteredProject
} from "./types.js";

const defaultSettings: GatewaySettings = {
  schemaVersion: 1,
  enabled: false,
  port: 43_127,
  publicUrl: "",
  projects: [],
  sessions: []
};
const maxRegisteredProjects = 50;

export class GatewaySettingsStore {
  private cached?: GatewaySettings;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<GatewaySettings> {
    if (this.cached) return structuredClone(this.cached);
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as Partial<GatewaySettings>;
      this.cached = normalizeSettings(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cached = structuredClone(defaultSettings);
    }
    return structuredClone(this.cached);
  }

  async update(
    mutate: (settings: GatewaySettings) => GatewaySettings | void | Promise<GatewaySettings | void>
  ): Promise<GatewaySettings> {
    let output!: GatewaySettings;
    this.updateQueue = this.updateQueue.catch(() => {}).then(async () => {
      const current = await this.load();
      const changed = (await mutate(current)) ?? current;
      output = normalizeSettings(changed);
      await writeAtomically(this.filePath, output);
      this.cached = structuredClone(output);
    });
    await this.updateQueue;
    return structuredClone(output);
  }

  async registerProject(rootInput: string, labelInput?: string): Promise<RegisteredProject> {
    const root = await fs.realpath(path.resolve(rootInput));
    if (!(await fs.stat(root)).isDirectory()) throw new Error("プロジェクトフォルダではありません。");
    let registered!: RegisteredProject;
    await this.update((settings) => {
      const key = normalizePathKey(root);
      const existing = settings.projects.find((project) => normalizePathKey(project.root) === key);
      if (existing) {
        existing.label = normalizeLabel(labelInput, existing.label);
        registered = existing;
        return;
      }
      registered = {
        id: randomUUID(),
        label: normalizeLabel(labelInput, path.basename(root)),
        root,
        createdAt: new Date().toISOString()
      };
      settings.projects.push(registered);
    });
    return structuredClone(registered);
  }

  async registerProjects(rootInputs: string[]): Promise<RegisteredProject[]> {
    const roots: string[] = [];
    const seen = new Set<string>();
    for (const rootInput of rootInputs) {
      const root = await fs.realpath(path.resolve(rootInput));
      if (!(await fs.stat(root)).isDirectory()) throw new Error("プロジェクトフォルダではありません。");
      const key = normalizePathKey(root);
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(root);
    }
    if (!roots.length) return [];

    const registered: RegisteredProject[] = [];
    await this.update((settings) => {
      const existingKeys = new Set(settings.projects.map((project) => normalizePathKey(project.root)));
      const newProjectCount = roots.filter((root) => !existingKeys.has(normalizePathKey(root))).length;
      if (settings.projects.length + newProjectCount > maxRegisteredProjects) {
        throw new Error(`スマホ用プロジェクトは最大${maxRegisteredProjects}件まで登録できます。`);
      }
      for (const root of roots) {
        const key = normalizePathKey(root);
        const existing = settings.projects.find((project) => normalizePathKey(project.root) === key);
        if (existing) {
          registered.push(existing);
          continue;
        }
        const project = {
          id: randomUUID(),
          label: normalizeLabel(undefined, path.basename(root)),
          root,
          createdAt: new Date().toISOString()
        };
        settings.projects.push(project);
        registered.push(project);
      }
    });
    return structuredClone(registered);
  }

  async removeProject(projectId: string): Promise<boolean> {
    let removed = false;
    await this.update((settings) => {
      const before = settings.projects.length;
      settings.projects = settings.projects.filter((project) => project.id !== projectId);
      removed = settings.projects.length !== before;
    });
    return removed;
  }

  async addSession(session: PairedSession): Promise<void> {
    await this.update((settings) => {
      settings.sessions = [
        ...settings.sessions.filter((item) => item.id !== session.id),
        session
      ].slice(-20);
    });
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    let removed = false;
    await this.update((settings) => {
      const before = settings.sessions.length;
      settings.sessions = settings.sessions.filter((session) => session.id !== sessionId);
      removed = settings.sessions.length !== before;
    });
    return removed;
  }

  async touchSession(sessionId: string, at: Date): Promise<void> {
    const settings = await this.load();
    const session = settings.sessions.find((item) => item.id === sessionId);
    if (!session || at.getTime() - Date.parse(session.lastUsedAt) < 10 * 60_000) return;
    await this.update((current) => {
      const target = current.sessions.find((item) => item.id === sessionId);
      if (target) target.lastUsedAt = at.toISOString();
    });
  }
}

function normalizeSettings(input: Partial<GatewaySettings>): GatewaySettings {
  const now = Date.now();
  return {
    schemaVersion: 1,
    enabled: input.enabled === true,
    port:
      Number.isInteger(input.port) && Number(input.port) >= 1_024 && Number(input.port) <= 65_535
        ? Number(input.port)
        : defaultSettings.port,
    publicUrl: normalizePublicUrl(input.publicUrl),
    projects: Array.isArray(input.projects)
      ? input.projects.filter(isRegisteredProject).slice(0, maxRegisteredProjects)
      : [],
    sessions: Array.isArray(input.sessions)
      ? input.sessions.filter(isPairedSession).filter((session) => Date.parse(session.expiresAt) > now).slice(-20)
      : []
  };
}

function normalizePublicUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") return "";
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isRegisteredProject(value: unknown): value is RegisteredProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  return ["id", "label", "root", "createdAt"].every(
    (field) => typeof project[field] === "string" && Boolean((project[field] as string).trim())
  );
}

function isPairedSession(value: unknown): value is PairedSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return ["id", "deviceName", "tokenHash", "createdAt", "lastUsedAt", "expiresAt"].every(
    (field) => typeof session[field] === "string" && Boolean((session[field] as string).trim())
  );
}

function normalizePathKey(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeLabel(value: string | undefined, fallback: string): string {
  const label = value?.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80);
  return label || fallback || "Project";
}

async function writeAtomically(filePath: string, value: GatewaySettings): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.rename(tempPath, filePath);
}
