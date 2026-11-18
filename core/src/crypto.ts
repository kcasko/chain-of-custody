// Hashing and signing per spec v1. Node's built-in crypto only.

import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalBytes } from './canonical.ts';

export const PURPOSE = {
  custodyEvent: 'coc/v1/custody-event',
  approvalOperation: 'coc/v1/approval-operation',
  checkpoint: 'coc/v1/checkpoint',
  request: 'coc/v1/request',
} as const;
export type Purpose = (typeof PURPOSE)[keyof typeof PURPOSE];

export const CHECKPOINT_SIGNATURE_PURPOSE = 'coc/v1/checkpoint-signature';
export const ZERO_HASH = '0'.repeat(64);

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function separated(purpose: string, value: unknown): Buffer {
  return Buffer.concat([Buffer.from(purpose, 'utf8'), Buffer.from([0]), canonicalBytes(value)]);
}

// SHA-256( UTF8(purpose) || 0x00 || canonical bytes )
export function recordHash(purpose: Purpose, value: unknown): string {
  return sha256Hex(separated(purpose, value));
}

export function isHex64(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
}

// Ed25519 ----------------------------------------------------------------

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface SigningKey {
  readonly privateKey: KeyObject;
  readonly publicKeyRaw: Buffer;
  readonly keyId: string;
}

export function keyIdFor(publicKeyRaw: Uint8Array): string {
  return sha256Hex(publicKeyRaw);
}

// Deterministic key from a 32-byte seed (tests and golden vectors only).
export function signingKeyFromSeed(seed: Uint8Array): SigningKey {
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKeyRaw = Buffer.from(spki.subarray(spki.length - 32));
  return { privateKey, publicKeyRaw, keyId: keyIdFor(publicKeyRaw) };
}

export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function checkpointSigningMessage(body: unknown): Buffer {
  return separated(CHECKPOINT_SIGNATURE_PURPOSE, body);
}

export function signCheckpointBody(key: SigningKey, body: unknown): string {
  return sign(null, checkpointSigningMessage(body), key.privateKey).toString('hex');
}

export function verifyCheckpointSignature(publicKeyRaw: Uint8Array, body: unknown, signatureHex: string): boolean {
  if (typeof signatureHex !== 'string' || !/^[0-9a-f]{128}$/.test(signatureHex)) return false;
  try {
    return verify(null, checkpointSigningMessage(body), publicKeyFromRaw(publicKeyRaw), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}
