import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * Noise Protocol Framework revision 34, pattern NNpsk0, instantiated with
 * X25519 / ChaCha20-Poly1305 / SHA-256.
 *
 * The pattern is:
 *
 *   -> psk, e
 *   <- e, ee
 *
 * The pre-shared key is the daemon's 256-bit token. Both endpoints prove
 * possession of it; the ephemeral X25519 exchange gives each session fresh
 * key material and forward secrecy. The handshake hash is available as a
 * channel binding after `split()`.
 */
export const NOISE_PROTOCOL_NAME = 'Noise_NNpsk0_25519_ChaChaPoly_SHA256';

const HASHLEN = 32;
const DHLEN = 32;
const TAGLEN = 16;
const MAX_NONCE = (1n << 64n) - 1n;

const PROTOCOL_NAME = Buffer.from(NOISE_PROTOCOL_NAME, 'ascii');

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/**
 * Derives the fixed-size Noise PSK from the on-disk token.
 *
 * Token files stay human-readable 256-bit hex strings; Noise requires exactly
 * 32 key bytes, so the secret is hashed once on both ends.
 */
export function derivePsk(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export type NoiseRole = 'initiator' | 'responder';

export interface NoiseHandshakeOptions {
  readonly role: NoiseRole;
  readonly psk: Buffer;
  readonly prologue?: Buffer;
}

export interface NoiseCipherState {
  encrypt(ad: Buffer, plaintext: Buffer): Buffer;
  decrypt(ad: Buffer, ciphertext: Buffer): Buffer;
  readonly nonce: bigint;
}

export interface NoiseTransport {
  readonly send: NoiseCipherState;
  readonly receive: NoiseCipherState;
  readonly handshakeHash: Buffer;
}

function hash(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * Noise's HKDF, which is HKDF-SHA256 with the chaining key as salt and an
 * empty info string. Outputs are always HASHLEN bytes each.
 */
function hkdf(
  chainingKey: Buffer,
  inputKeyMaterial: Buffer,
  outputs: 2 | 3,
): Buffer[] {
  const tempKey = hmac(chainingKey, inputKeyMaterial);
  const output1 = hmac(tempKey, Buffer.from([0x01]));
  const output2 = hmac(tempKey, Buffer.concat([output1, Buffer.from([0x02])]));

  if (outputs === 2) {
    return [output1, output2];
  }

  const output3 = hmac(tempKey, Buffer.concat([output2, Buffer.from([0x03])]));
  return [output1, output2, output3];
}

function nonceBytes(nonce: bigint): Buffer {
  const bytes = Buffer.alloc(12);
  bytes.writeBigUInt64LE(nonce, 4);
  return bytes;
}

function encryptAead(
  key: Buffer,
  nonce: bigint,
  associatedData: Buffer,
  plaintext: Buffer,
): Buffer {
  const cipher = createCipheriv('chacha20-poly1305', key, nonceBytes(nonce), {
    authTagLength: TAGLEN,
  });
  cipher.setAAD(associatedData, { plaintextLength: plaintext.length });

  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function decryptAead(
  key: Buffer,
  nonce: bigint,
  associatedData: Buffer,
  ciphertext: Buffer,
): Buffer {
  if (ciphertext.length < TAGLEN) {
    throw new Error('Noise ciphertext is shorter than the authentication tag');
  }

  const body = ciphertext.subarray(0, ciphertext.length - TAGLEN);
  const tag = ciphertext.subarray(ciphertext.length - TAGLEN);
  const decipher = createDecipheriv('chacha20-poly1305', key, nonceBytes(nonce), {
    authTagLength: TAGLEN,
  });
  decipher.setAAD(associatedData, { plaintextLength: body.length });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function rawPublicKey(key: KeyObject): Buffer {
  return key.export({ type: 'spki', format: 'der' }).subarray(-DHLEN);
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== DHLEN) {
    throw new Error(`Expected a ${DHLEN}-byte X25519 public key`);
  }

  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

function diffieHellmanRaw(privateKey: KeyObject, remotePublic: Buffer): Buffer {
  return diffieHellman({
    privateKey,
    publicKey: publicKeyFromRaw(remotePublic),
  });
}

interface KeyPair {
  readonly publicKey: Buffer;
  readonly privateKey: KeyObject;
}

function generateKeyPair(): KeyPair {
  const pair = generateKeyPairSync('x25519');

  return {
    publicKey: rawPublicKey(pair.publicKey),
    privateKey: pair.privateKey,
  };
}

class CipherState implements NoiseCipherState {
  private key: Buffer | undefined;

  private counter = 0n;

  constructor(key: Buffer | undefined) {
    this.key = key;
  }

  get nonce(): bigint {
    return this.counter;
  }

  encrypt(ad: Buffer, plaintext: Buffer): Buffer {
    if (this.key === undefined) {
      return plaintext;
    }

    if (this.counter >= MAX_NONCE) {
      throw new Error('Noise nonce exhausted');
    }

    const ciphertext = encryptAead(this.key, this.counter, ad, plaintext);
    this.counter += 1n;

    return ciphertext;
  }

  decrypt(ad: Buffer, ciphertext: Buffer): Buffer {
    if (this.key === undefined) {
      return ciphertext;
    }

    if (this.counter >= MAX_NONCE) {
      throw new Error('Noise nonce exhausted');
    }

    const plaintext = decryptAead(this.key, this.counter, ad, ciphertext);
    this.counter += 1n;

    return plaintext;
  }
}

class SymmetricState {
  private chainingKey: Buffer;

  private handshakeHash: Buffer;

  private cipher = new CipherState(undefined);

  constructor(protocolName: Buffer) {
    this.handshakeHash = protocolName.length <= HASHLEN
      ? Buffer.concat([protocolName, Buffer.alloc(HASHLEN - protocolName.length)])
      : hash(protocolName);
    this.chainingKey = Buffer.from(this.handshakeHash);
  }

  mixHash(data: Buffer): void {
    this.handshakeHash = hash(Buffer.concat([this.handshakeHash, data]));
  }

  mixKey(inputKeyMaterial: Buffer): void {
    const [chainingKey, tempKey] = hkdf(this.chainingKey, inputKeyMaterial, 2) as [
      Buffer,
      Buffer,
    ];

    this.chainingKey = chainingKey;
    this.cipher = new CipherState(tempKey);
  }

  mixKeyAndHash(inputKeyMaterial: Buffer): void {
    const [chainingKey, tempHash, tempKey] = hkdf(
      this.chainingKey,
      inputKeyMaterial,
      3,
    ) as [Buffer, Buffer, Buffer];

    this.chainingKey = chainingKey;
    this.mixHash(tempHash);
    this.cipher = new CipherState(tempKey);
  }

  encryptAndHash(plaintext: Buffer): Buffer {
    const ciphertext = this.cipher.encrypt(this.handshakeHash, plaintext);
    this.mixHash(ciphertext);

    return ciphertext;
  }

  decryptAndHash(ciphertext: Buffer): Buffer {
    const plaintext = this.cipher.decrypt(this.handshakeHash, ciphertext);
    this.mixHash(ciphertext);

    return plaintext;
  }

  split(): NoiseTransport {
    const [first, second] = hkdf(this.chainingKey, Buffer.alloc(0), 2) as [
      Buffer,
      Buffer,
    ];

    return {
      send: new CipherState(first),
      receive: new CipherState(second),
      handshakeHash: Buffer.from(this.handshakeHash),
    };
  }

  get hash(): Buffer {
    return this.handshakeHash;
  }
}

/**
 * One side of an NNpsk0 handshake.
 *
 * Usage is strictly alternating: the initiator writes message 1 and reads
 * message 2; the responder reads message 1 and writes message 2. A call in the
 * wrong order, a malformed payload, or a failed AEAD tag throws and the caller
 * must abandon the connection.
 */
export class NoiseHandshake {
  private readonly role: NoiseRole;

  private readonly psk: Buffer;

  private readonly symmetric: SymmetricState;

  private ephemeral: KeyPair | undefined;

  private remoteEphemeral: Buffer | undefined;

  private messageIndex = 0;

  private splitResult: NoiseTransport | undefined;

  constructor(options: NoiseHandshakeOptions) {
    if (options.psk.length !== 32) {
      throw new Error('Noise PSK must be exactly 32 bytes');
    }

    this.role = options.role;
    this.psk = Buffer.from(options.psk);
    this.symmetric = new SymmetricState(PROTOCOL_NAME);
    this.symmetric.mixHash(options.prologue ?? Buffer.alloc(0));
  }

  writeMessage(payload: Buffer = Buffer.alloc(0)): Buffer {
    const expectedRole = this.messageIndex === 0 ? 'initiator' : 'responder';

    if (this.role !== expectedRole) {
      throw new Error(`Noise ${this.role} cannot write handshake message ${this.messageIndex + 1}`);
    }

    if (this.splitResult !== undefined) {
      throw new Error('Noise handshake is already complete');
    }

    if (this.messageIndex === 0) {
      this.symmetric.mixKeyAndHash(this.psk);
      const ephemeral = this.generateEphemeral();
      const output = [ephemeral.publicKey];

      this.symmetric.mixHash(ephemeral.publicKey);
      this.symmetric.mixKey(ephemeral.publicKey);
      output.push(this.symmetric.encryptAndHash(payload));

      this.messageIndex = 1;

      return Buffer.concat(output);
    }

    const ephemeral = this.generateEphemeral();
    const output = [ephemeral.publicKey];

    this.symmetric.mixHash(ephemeral.publicKey);
    this.symmetric.mixKey(ephemeral.publicKey);
    this.symmetric.mixKey(this.diffieHellman(ephemeral, this.requireRemoteEphemeral()));
    output.push(this.symmetric.encryptAndHash(payload));

    this.messageIndex = 2;
    this.splitResult = this.symmetric.split();

    return Buffer.concat(output);
  }

  readMessage(message: Buffer): Buffer {
    const expectedRole = this.messageIndex === 0 ? 'responder' : 'initiator';

    if (this.role !== expectedRole) {
      throw new Error(`Noise ${this.role} cannot read handshake message ${this.messageIndex + 1}`);
    }

    if (this.splitResult !== undefined) {
      throw new Error('Noise handshake is already complete');
    }

    if (message.length < DHLEN + TAGLEN) {
      throw new Error('Noise handshake message is too short');
    }

    if (this.messageIndex === 0) {
      // The first NNpsk0 message pattern is `psk, e`; the responder processes
      // the same tokens as the sender.
      this.symmetric.mixKeyAndHash(this.psk);
    }

    const remoteEphemeral = Buffer.from(message.subarray(0, DHLEN));
    const payload = message.subarray(DHLEN);

    this.symmetric.mixHash(remoteEphemeral);
    this.symmetric.mixKey(remoteEphemeral);
    this.remoteEphemeral = remoteEphemeral;

    if (this.messageIndex === 0) {
      const plaintext = this.symmetric.decryptAndHash(payload);
      this.messageIndex = 1;

      return plaintext;
    }

    this.symmetric.mixKey(this.diffieHellman(this.requireEphemeral(), remoteEphemeral));
    const plaintext = this.symmetric.decryptAndHash(payload);
    this.messageIndex = 2;
    this.splitResult = this.symmetric.split();

    return plaintext;
  }

  split(): NoiseTransport {
    if (this.splitResult === undefined) {
      throw new Error('Noise handshake has not completed');
    }

    return this.role === 'initiator'
      ? {
          send: this.splitResult.send,
          receive: this.splitResult.receive,
          handshakeHash: this.splitResult.handshakeHash,
        }
      : {
          send: this.splitResult.receive,
          receive: this.splitResult.send,
          handshakeHash: this.splitResult.handshakeHash,
        };
  }

  get handshakeHash(): Buffer {
    return this.symmetric.hash;
  }

  private generateEphemeral(): KeyPair {
    if (this.ephemeral !== undefined) {
      throw new Error('Noise ephemeral key was already generated');
    }

    this.ephemeral = generateKeyPair();

    return this.ephemeral;
  }

  private requireEphemeral(): KeyPair {
    if (this.ephemeral === undefined) {
      throw new Error('Noise ephemeral key is missing');
    }

    return this.ephemeral;
  }

  private requireRemoteEphemeral(): Buffer {
    if (this.remoteEphemeral === undefined) {
      throw new Error('Noise remote ephemeral key is missing');
    }

    return this.remoteEphemeral;
  }

  private diffieHellman(local: KeyPair, remote: Buffer): Buffer {
    return diffieHellmanRaw(local.privateKey, remote);
  }
}