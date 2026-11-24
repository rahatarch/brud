import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SecretRecord } from '../contracts/types.js';

export class SecretsVault {
  private readonly masterKey: Buffer;

  constructor(masterKeyInput?: string) {
    // If no key is supplied, derive from process seed or fallback deterministically
    const seed = masterKeyInput ?? process.env.BRUD_DB_SECRET_KEY ?? 'brud-default-vault-master-seed-key';
    this.masterKey = createHash('sha256').update(seed, 'utf8').digest();
  }

  public encrypt(
    key: string,
    plaintext: string,
    metadata?: Readonly<Record<string, unknown>>,
    version: number = 1,
  ): SecretRecord {
    const iv = randomBytes(12); // Standard 96-bit IV for AES-GCM
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      key,
      cipherText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      version,
      createdAt: Date.now(),
      ...(metadata !== undefined ? { metadata } : {}),
    };
  }

  public decrypt(record: Pick<SecretRecord, 'cipherText' | 'iv' | 'tag'>): string {
    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.cipherText, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
