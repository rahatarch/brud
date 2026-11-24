import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretMetadata, SecretRecord, StorageDriver } from '../contracts/types.js';

export class SQLiteDriver implements StorageDriver {
  public readonly name = 'sqlite';
  private readonly dbPath: string;
  private db: DatabaseSync | null = null;

  private getStmt: StatementSync | null = null;
  private setStmt: StatementSync | null = null;
  private deleteStmt: StatementSync | null = null;
  private hasStmt: StatementSync | null = null;
  private listStmt: StatementSync | null = null;

  private getSecretStmt: StatementSync | null = null;
  private setSecretStmt: StatementSync | null = null;
  private deleteSecretStmt: StatementSync | null = null;
  private hasSecretStmt: StatementSync | null = null;
  private listSecretsStmt: StatementSync | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  public async initialize(): Promise<void> {
    if (this.dbPath !== ':memory:') {
      await mkdir(dirname(this.dbPath), { recursive: true });
    }

    const db = new DatabaseSync(this.dbPath);
    if (this.dbPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    }
    db.exec('PRAGMA busy_timeout = 5000;');

    db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        namespace  TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS secrets (
        namespace  TEXT NOT NULL,
        key        TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv         TEXT NOT NULL,
        tag        TEXT NOT NULL,
        version    INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        metadata   TEXT,
        PRIMARY KEY (namespace, key)
      ) STRICT;
    `);

    this.getStmt = db.prepare('SELECT value FROM entries WHERE namespace = ? AND key = ?');
    this.setStmt = db.prepare(`
      INSERT INTO entries(namespace, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.deleteStmt = db.prepare('DELETE FROM entries WHERE namespace = ? AND key = ?');
    this.hasStmt = db.prepare('SELECT 1 FROM entries WHERE namespace = ? AND key = ?');
    this.listStmt = db.prepare('SELECT key FROM entries WHERE namespace = ? ORDER BY key');

    this.getSecretStmt = db.prepare('SELECT key, ciphertext, iv, tag, version, created_at, metadata FROM secrets WHERE namespace = ? AND key = ?');
    this.setSecretStmt = db.prepare(`
      INSERT INTO secrets(namespace, key, ciphertext, iv, tag, version, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, version = excluded.version, created_at = excluded.created_at, metadata = excluded.metadata
    `);
    this.deleteSecretStmt = db.prepare('DELETE FROM secrets WHERE namespace = ? AND key = ?');
    this.hasSecretStmt = db.prepare('SELECT 1 FROM secrets WHERE namespace = ? AND key = ?');
    this.listSecretsStmt = db.prepare('SELECT key, version, created_at, metadata FROM secrets WHERE namespace = ? ORDER BY key');

    this.db = db;
  }

  public async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public async get(namespace: string, key: string): Promise<unknown | null> {
    const row = this.getStmt?.get(namespace, key) as { value: string } | undefined;
    return row !== undefined ? JSON.parse(row.value) : null;
  }

  public async set(namespace: string, key: string, value: unknown): Promise<void> {
    this.setStmt?.run(namespace, key, JSON.stringify(value), Date.now());
  }

  public async delete(namespace: string, key: string): Promise<boolean> {
    const result = this.deleteStmt?.run(namespace, key);
    return (result?.changes ?? 0) > 0;
  }

  public async has(namespace: string, key: string): Promise<boolean> {
    const row = this.hasStmt?.get(namespace, key);
    return row !== undefined;
  }

  public async list(namespace: string, prefix?: string): Promise<string[]> {
    const rows = (this.listStmt?.all(namespace) ?? []) as { key: string }[];
    const keys = rows.map((r) => r.key);
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }

  public async getSecret(namespace: string, key: string): Promise<SecretRecord | null> {
    const row = this.getSecretStmt?.get(namespace, key) as {
      key: string;
      ciphertext: string;
      iv: string;
      tag: string;
      version: number;
      created_at: number;
      metadata: string | null;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      key: row.key,
      cipherText: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
      version: row.version,
      createdAt: row.created_at,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) as Record<string, unknown> } : {}),
    };
  }

  public async setSecret(namespace: string, record: SecretRecord): Promise<void> {
    this.setSecretStmt?.run(
      namespace,
      record.key,
      record.cipherText,
      record.iv,
      record.tag,
      record.version,
      record.createdAt,
      record.metadata ? JSON.stringify(record.metadata) : null,
    );
  }

  public async deleteSecret(namespace: string, key: string): Promise<boolean> {
    const result = this.deleteSecretStmt?.run(namespace, key);
    return (result?.changes ?? 0) > 0;
  }

  public async hasSecret(namespace: string, key: string): Promise<boolean> {
    const row = this.hasSecretStmt?.get(namespace, key);
    return row !== undefined;
  }

  public async listSecrets(namespace: string): Promise<SecretMetadata[]> {
    const rows = (this.listSecretsStmt?.all(namespace) ?? []) as {
      key: string;
      version: number;
      created_at: number;
      metadata: string | null;
    }[];

    return rows.map((row) => ({
      key: row.key,
      version: row.version,
      createdAt: row.created_at,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) as Record<string, unknown> } : {}),
    }));
  }
}
