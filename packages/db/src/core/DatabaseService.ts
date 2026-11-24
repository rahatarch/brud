import { createHash } from 'node:crypto';
import type {
  DatabaseConfig,
  SecretMetadata,
  StorageDriver,
} from '../contracts/types.js';
import { MemoryDriver } from '../drivers/MemoryDriver.js';
import { FileDriver } from '../drivers/FileDriver.js';
import { SQLiteDriver } from '../drivers/SQLiteDriver.js';
import { SecretsVault } from '../vault/SecretsVault.js';

export class DatabaseService {
  private readonly driver: StorageDriver;
  private readonly vault: SecretsVault;
  private initialized = false;

  constructor(config: DatabaseConfig = {}) {
    if (config.driver === 'sqlite') {
      this.driver = new SQLiteDriver(config.path ?? ':memory:');
    } else if (config.driver === 'file') {
      this.driver = new FileDriver(config.path ?? './.brud-data');
    } else {
      this.driver = new MemoryDriver();
    }

    this.vault = new SecretsVault(config.encryptionKey);
  }

  get driverName(): string {
    return this.driver.name;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.driver.initialize();
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    await this.driver.shutdown();
    this.initialized = false;
  }

  getNamespace(callerId?: string): string {
    const raw = callerId && callerId.trim().length > 0 ? callerId.trim() : 'anonymous';
    return createHash('sha256').update(raw).digest('hex');
  }

  // --- Key-Value Document Store ---

  async get<T = unknown>(namespace: string, key: string): Promise<T | null> {
    this.validateKey(key);
    await this.ensureInitialized();
    const val = await this.driver.get(namespace, key);
    return val as T | null;
  }

  async set(namespace: string, key: string, value: unknown): Promise<void> {
    this.validateKey(key);
    await this.ensureInitialized();
    await this.driver.set(namespace, key, value);
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    this.validateKey(key);
    await this.ensureInitialized();
    return this.driver.delete(namespace, key);
  }

  async has(namespace: string, key: string): Promise<boolean> {
    this.validateKey(key);
    await this.ensureInitialized();
    return this.driver.has(namespace, key);
  }

  async list(namespace: string, prefix?: string): Promise<string[]> {
    await this.ensureInitialized();
    return this.driver.list(namespace, prefix);
  }

  async update<T extends Record<string, unknown>>(
    namespace: string,
    key: string,
    patch: Partial<T>,
  ): Promise<T> {
    this.validateKey(key);
    await this.ensureInitialized();
    const existing = await this.driver.get(namespace, key);
    let updated: T;
    if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      updated = { ...(existing as T), ...patch };
    } else {
      updated = { ...patch } as T;
    }
    await this.driver.set(namespace, key, updated);
    return updated;
  }

  // --- Secrets Vault ---

  async getSecret(namespace: string, key: string): Promise<string | null> {
    this.validateKey(key);
    await this.ensureInitialized();
    const record = await this.driver.getSecret(namespace, key);
    if (!record) {
      return null;
    }
    return this.vault.decrypt(record);
  }

  async setSecret(
    namespace: string,
    key: string,
    plaintext: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.validateKey(key);
    await this.ensureInitialized();
    const existing = await this.driver.getSecret(namespace, key);
    const version = existing ? existing.version + 1 : 1;
    const record = this.vault.encrypt(key, plaintext, metadata, version);
    await this.driver.setSecret(namespace, record);
  }

  async deleteSecret(namespace: string, key: string): Promise<boolean> {
    this.validateKey(key);
    await this.ensureInitialized();
    return this.driver.deleteSecret(namespace, key);
  }

  async hasSecret(namespace: string, key: string): Promise<boolean> {
    this.validateKey(key);
    await this.ensureInitialized();
    return this.driver.hasSecret(namespace, key);
  }

  async listSecrets(namespace: string): Promise<SecretMetadata[]> {
    await this.ensureInitialized();
    return this.driver.listSecrets(namespace);
  }

  private validateKey(key: string): void {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
