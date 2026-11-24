import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SecretMetadata, SecretRecord, StorageDriver, StorageRecord } from '../contracts/types.js';

interface NamespaceData {
  entries: Record<string, StorageRecord>;
  secrets: Record<string, SecretRecord>;
}

export class FileDriver implements StorageDriver {
  public readonly name = 'file';
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  public async initialize(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  public async shutdown(): Promise<void> {
    // No explicit connection to close for file driver.
  }

  private namespaceFile(namespace: string): string {
    return join(this.rootDir, `${namespace}.json`);
  }

  private async loadNamespace(namespace: string): Promise<NamespaceData> {
    const filePath = this.namespaceFile(namespace);
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as NamespaceData;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: {}, secrets: {} };
      }
      throw error;
    }
  }

  private async saveNamespace(namespace: string, data: NamespaceData): Promise<void> {
    const targetFile = this.namespaceFile(namespace);
    await mkdir(dirname(targetFile), { recursive: true });

    const tempFile = `${targetFile}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
    const payload = JSON.stringify(data, null, 2);

    await writeFile(tempFile, payload, 'utf8');
    try {
      await rename(tempFile, targetFile);
    } catch (err: unknown) {
      try {
        await unlink(tempFile);
      } catch {
        // Ignore cleanup failure
      }
      throw err;
    }
  }

  public async get(namespace: string, key: string): Promise<unknown | null> {
    const data = await this.loadNamespace(namespace);
    const record = data.entries[key];
    return record !== undefined ? record.value : null;
  }

  public async set(namespace: string, key: string, value: unknown): Promise<void> {
    const data = await this.loadNamespace(namespace);
    data.entries[key] = {
      key,
      value,
      updatedAt: Date.now(),
    };
    await this.saveNamespace(namespace, data);
  }

  public async delete(namespace: string, key: string): Promise<boolean> {
    const data = await this.loadNamespace(namespace);
    if (!(key in data.entries)) {
      return false;
    }
    delete data.entries[key];
    await this.saveNamespace(namespace, data);
    return true;
  }

  public async has(namespace: string, key: string): Promise<boolean> {
    const data = await this.loadNamespace(namespace);
    return key in data.entries;
  }

  public async list(namespace: string, prefix?: string): Promise<string[]> {
    const data = await this.loadNamespace(namespace);
    const keys = Object.keys(data.entries);
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }

  public async getSecret(namespace: string, key: string): Promise<SecretRecord | null> {
    const data = await this.loadNamespace(namespace);
    return data.secrets[key] ?? null;
  }

  public async setSecret(namespace: string, record: SecretRecord): Promise<void> {
    const data = await this.loadNamespace(namespace);
    data.secrets[record.key] = record;
    await this.saveNamespace(namespace, data);
  }

  public async deleteSecret(namespace: string, key: string): Promise<boolean> {
    const data = await this.loadNamespace(namespace);
    if (!(key in data.secrets)) {
      return false;
    }
    delete data.secrets[key];
    await this.saveNamespace(namespace, data);
    return true;
  }

  public async hasSecret(namespace: string, key: string): Promise<boolean> {
    const data = await this.loadNamespace(namespace);
    return key in data.secrets;
  }

  public async listSecrets(namespace: string): Promise<SecretMetadata[]> {
    const data = await this.loadNamespace(namespace);
    return Object.values(data.secrets).map((r) => ({
      key: r.key,
      version: r.version,
      createdAt: r.createdAt,
      ...(r.metadata !== undefined ? { metadata: r.metadata } : {}),
    }));
  }
}
