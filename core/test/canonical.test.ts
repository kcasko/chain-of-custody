// T00: canonical form, domain-separated hashes and Ed25519 against golden
// vectors produced by independent tools (sha256sum, OpenSSL).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalize, CanonicalizationError } from '../src/canonical.ts';
import {
  PURPOSE, recordHash, signingKeyFromSeed, signCheckpointBody, verifyCheckpointSignature, keyIdFor, sha256Hex, type Purpose,
} from '../src/crypto.ts';

const vectors = JSON.parse(readFileSync(new URL('./vectors/v1.json', import.meta.url), 'utf8'));

test('canonical strings match hand-written golden vectors', () => {
  for (const v of vectors.canonical) assert.equal(canonicalize(v.input), v.canonical, v.name);
});

test('record hashes match sha256sum-computed golden vectors', () => {
  for (const h of vectors.hashes) {
    assert.equal(recordHash(h.purpose as Purpose, vectors.canonical[h.canonicalIndex].input), h.sha256);
  }
});

test('purpose separation: the same record hashes differently per purpose', () => {
  const input = vectors.canonical[5].input;
  const all = Object.values(PURPOSE).map((p) => recordHash(p, input));
  assert.equal(new Set(all).size, all.length);
});

test('key order and object construction do not change the canonical form', () => {
  const a = { x: 1, y: { b: [1, 2], a: 'z' } };
  const b = JSON.parse('{"y":{"a":"z","b":[1,2]},"x":1}');
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(canonicalize(Object.assign(Object.create(null), { k: 1 })), '{"k":1}');
});

test('array order is significant', () => {
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test('rejects every value outside the v1 domain instead of converting it', () => {
  for (const r of vectors.rejected) assert.throws(() => canonicalize(r.input), CanonicalizationError, r.name);
  const bad: unknown[] = [
    NaN, Infinity, -0, 10n, undefined, () => 1, Symbol('s'), new Date(0), Buffer.from('a'), new Map(),
    '\uD800', 'ok\uDC00', { 'é': 1 }, { a: undefined }, [1, undefined], new (class Foo {})(),
  ];
  for (const v of bad) assert.throws(() => canonicalize(v), CanonicalizationError, String(typeof v));
});

test('error messages carry the path of the offending value', () => {
  assert.throws(() => canonicalize({ outer: { list: [1, 2.5] } }), /\.outer\.list\[1\]/);
});

test('evidence bytes hash is plain SHA-256 (same as sha256sum)', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('Ed25519 checkpoint signature matches the OpenSSL-verified vector', () => {
  const s = vectors.signature;
  const key = signingKeyFromSeed(Buffer.from(s.seedHex, 'hex'));
  assert.equal(key.publicKeyRaw.toString('hex'), s.publicKeyHex);
  assert.equal(key.keyId, s.keyId);
  assert.equal(keyIdFor(Buffer.from(s.publicKeyHex, 'hex')), s.keyId);
  assert.equal(signCheckpointBody(key, s.body), s.signatureHex);
  assert.equal(verifyCheckpointSignature(Buffer.from(s.publicKeyHex, 'hex'), s.body, s.signatureHex), true);
});

test('signature fails on a changed body, a different key or a malformed signature', () => {
  const s = vectors.signature;
  const pub = Buffer.from(s.publicKeyHex, 'hex');
  assert.equal(verifyCheckpointSignature(pub, { ...s.body, sequence: 4 }, s.signatureHex), false);
  const other = signingKeyFromSeed(Buffer.alloc(32, 7));
  assert.equal(verifyCheckpointSignature(other.publicKeyRaw, s.body, s.signatureHex), false);
  assert.equal(verifyCheckpointSignature(pub, s.body, 'zz'), false);
  assert.equal(verifyCheckpointSignature(pub, s.body, s.signatureHex.replace(/^../, '00')), false);
  assert.equal(verifyCheckpointSignature(Buffer.alloc(5), s.body, s.signatureHex), false);
});
