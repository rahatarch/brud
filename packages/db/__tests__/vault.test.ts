import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecretsVault } from '../src/vault/SecretsVault.js';

describe('SecretsVault AES-256-GCM', () => {
  it('encrypts and decrypts string payloads correctly', () => {
    const vault = new SecretsVault('super-secret-key-12345');
    const plaintext = 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz';

    const encrypted = vault.encrypt('api-key', plaintext);
    assert.equal(encrypted.key, 'api-key');
    assert.ok(encrypted.cipherText);
    assert.ok(encrypted.iv);
    assert.ok(encrypted.tag);
    assert.notEqual(encrypted.cipherText, plaintext);

    // IV is 96-bit (12 bytes = 16 base64 characters)
    assert.equal(Buffer.from(encrypted.iv, 'base64').length, 12);
    // Tag is 128-bit (16 bytes = 24 base64 characters)
    assert.equal(Buffer.from(encrypted.tag, 'base64').length, 16);

    const decrypted = vault.decrypt(encrypted);
    assert.equal(decrypted, plaintext);
  });

  it('generates unique IVs and distinct ciphertexts for identical plaintexts', () => {
    const vault = new SecretsVault('key-1');
    const plaintext = 'same-token';

    const enc1 = vault.encrypt('k1', plaintext);
    const enc2 = vault.encrypt('k2', plaintext);

    assert.notEqual(enc1.iv, enc2.iv);
    assert.notEqual(enc1.cipherText, enc2.cipherText);

    assert.equal(vault.decrypt(enc1), plaintext);
    assert.equal(vault.decrypt(enc2), plaintext);
  });

  it('fails decryption when ciphertext is tampered with', () => {
    const vault = new SecretsVault('key-1');
    const encrypted = vault.encrypt('k1', 'top-secret');

    const tamperedCipher = encrypted.cipherText.slice(0, -2) + (encrypted.cipherText.endsWith('AA') ? 'BB' : 'AA');
    assert.throws(
      () => vault.decrypt({ ...encrypted, cipherText: tamperedCipher }),
      /Unsupported state or unable to authenticate data/,
    );
  });

  it('fails decryption when auth tag is tampered with', () => {
    const vault = new SecretsVault('key-1');
    const encrypted = vault.encrypt('k1', 'top-secret');

    const tagBuf = Buffer.from(encrypted.tag, 'base64');
    tagBuf[0] ^= 0xff; // flip bits of the first byte without changing length
    const tamperedTag = tagBuf.toString('base64');
    assert.throws(
      () => vault.decrypt({ ...encrypted, tag: tamperedTag }),
      /Unsupported state or unable to authenticate data/,
    );
  });

  it('fails decryption when wrong key is used', () => {
    const vault1 = new SecretsVault('key-1');
    const vault2 = new SecretsVault('key-2');

    const encrypted = vault1.encrypt('k1', 'secret-for-1');
    assert.throws(
      () => vault2.decrypt(encrypted),
      /Unsupported state or unable to authenticate data/,
    );
  });

  it('works with fallback key when no key is explicitly passed', () => {
    const vault = new SecretsVault();
    const encrypted = vault.encrypt('k1', 'fallback-secret');
    assert.equal(vault.decrypt(encrypted), 'fallback-secret');
  });
});
