export interface StorageRecord {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: number;
}

export interface SecretRecord {
  readonly key: string;
  readonly cipherText: string;
  readonly iv: string;
  readonly tag: string;
  readonly version: number;
  readonly createdAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SecretMetadata {
  readonly key: string;
  readonly version: number;
  readonly createdAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StorageDriver {
  readonly name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Key-Value Document Store
  get(namespace: string, key: string): Promise<unknown | null>;
  set(namespace: string, key: string, value: unknown): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  has(namespace: string, key: string): Promise<boolean>;
  list(namespace: string, prefix?: string): Promise<string[]>;

  // Secrets Store
  getSecret(namespace: string, key: string): Promise<SecretRecord | null>;
  setSecret(namespace: string, record: SecretRecord): Promise<void>;
  deleteSecret(namespace: string, key: string): Promise<boolean>;
  hasSecret(namespace: string, key: string): Promise<boolean>;
  listSecrets(namespace: string): Promise<SecretMetadata[]>;
}

export interface DbExposure {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  update<T extends Record<string, unknown>>(key: string, patch: Partial<T>): Promise<T>;
}

export interface SecretsExposure {
  get(key: string): Promise<string | null>;
  set(key: string, plaintext: string, metadata?: Readonly<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  list(): Promise<SecretMetadata[]>;
}

export interface DatabaseConfig {
  readonly driver?: 'memory' | 'file' | 'sqlite';
  readonly path?: string;
  readonly encryptionKey?: string;
}
