import type { SecretMetadata, SecretRecord, StorageDriver, StorageRecord } from '../contracts/types.js';

export class MemoryDriver implements StorageDriver {
  public readonly name = 'memory';
  private readonly store = new Map<string, Map<string, StorageRecord>>();
  private readonly secretsStore = new Map<string, Map<string, SecretRecord>>();

  public async initialize(): Promise<void> {
    // In-memory driver requires no disk initialization.
  }

  public async shutdown(): Promise<void> {
    this.store.clear();
    this.secretsStore.clear();
  }

  private getNamespace(namespace: string): Map<string, StorageRecord> {
    let ns = this.store.get(namespace);
    if (!ns) {
      ns = new Map();
      this.store.set(namespace, ns);
    }
    return ns;
  }

  private getSecretsNamespace(namespace: string): Map<string, SecretRecord> {
    let ns = this.secretsStore.get(namespace);
    if (!ns) {
      ns = new Map();
      this.secretsStore.set(namespace, ns);
    }
    return ns;
  }

  public async get(namespace: string, key: string): Promise<unknown | null> {
    const record = this.getNamespace(namespace).get(key);
    return record !== undefined ? structuredClone(record.value) : null;
  }

  public async set(namespace: string, key: string, value: unknown): Promise<void> {
    this.getNamespace(namespace).set(key, {
      key,
      value: structuredClone(value),
      updatedAt: Date.now(),
    });
  }

  public async delete(namespace: string, key: string): Promise<boolean> {
    return this.getNamespace(namespace).delete(key);
  }

  public async has(namespace: string, key: string): Promise<boolean> {
    return this.getNamespace(namespace).has(key);
  }

  public async list(namespace: string, prefix?: string): Promise<string[]> {
    const keys = [...this.getNamespace(namespace).keys()];
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }

  public async getSecret(namespace: string, key: string): Promise<SecretRecord | null> {
    const record = this.getSecretsNamespace(namespace).get(key);
    return record !== undefined ? structuredClone(record) : null;
  }

  public async setSecret(namespace: string, record: SecretRecord): Promise<void> {
    this.getSecretsNamespace(namespace).set(record.key, structuredClone(record));
  }

  public async deleteSecret(namespace: string, key: string): Promise<boolean> {
    return this.getSecretsNamespace(namespace).delete(key);
  }

  public async hasSecret(namespace: string, key: string): Promise<boolean> {
    return this.getSecretsNamespace(namespace).has(key);
  }

  public async listSecrets(namespace: string): Promise<SecretMetadata[]> {
    const records = [...this.getSecretsNamespace(namespace).values()];
    return records.map((r) => ({
      key: r.key,
      version: r.version,
      createdAt: r.createdAt,
      ...(r.metadata !== undefined ? { metadata: structuredClone(r.metadata) } : {}),
    }));
  }
}
