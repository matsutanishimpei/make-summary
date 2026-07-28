import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GeminiCredentialStatus } from "../credentials.js";
import type { GatewayCredentialProvider } from "../gateway/server.js";

interface StoredCredentials {
  schemaVersion: 1;
  geminiApiKey?: string;
}

export class ElectronCredentialStore implements GatewayCredentialProvider {
  constructor(private readonly filePath: string) {}

  async getGeminiApiKey(): Promise<string | undefined> {
    try {
      const stored = JSON.parse(await fs.readFile(this.filePath, "utf8")) as StoredCredentials;
      if (!stored.geminiApiKey) return process.env.GEMINI_API_KEY?.trim() || undefined;
      return safeStorage.decryptString(Buffer.from(stored.geminiApiKey, "base64")).trim() || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return process.env.GEMINI_API_KEY?.trim() || undefined;
      }
      throw error;
    }
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return Boolean(await this.getGeminiApiKey());
  }

  async getGeminiCredentialStatus(): Promise<GeminiCredentialStatus> {
    try {
      const stored = JSON.parse(await fs.readFile(this.filePath, "utf8")) as StoredCredentials;
      if (stored.geminiApiKey) {
        const decrypted = safeStorage.decryptString(Buffer.from(stored.geminiApiKey, "base64")).trim();
        if (decrypted) return { hasKey: true, source: "encrypted" };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return process.env.GEMINI_API_KEY?.trim()
      ? { hasKey: true, source: "environment" }
      : { hasKey: false, source: null };
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    const normalized = apiKey.trim();
    if (!normalized) {
      await this.clearGeminiApiKey();
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windowsの安全な資格情報暗号化を利用できません。");
    }
    const value: StoredCredentials = {
      schemaVersion: 1,
      geminiApiKey: safeStorage.encryptString(normalized).toString("base64")
    };
    await writeAtomically(this.filePath, value);
  }

  async clearGeminiApiKey(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function writeAtomically(filePath: string, value: StoredCredentials): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.rename(temporary, filePath);
}
