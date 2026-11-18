// S3ObjectStore. There is no official local S3, so these tests use the real
// AWS SDK S3Client with its network layer replaced: requests are serialized
// exactly as they would be sent (headers, query, checksum), and a small
// in-memory bucket answers with S3's documented status codes and headers.
// This proves the adapter's requests and error mapping, not S3 itself; a run
// against a real versioned bucket is still needed (needs approval, see ADR 0007).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { ObjectExistsError } from '../../../core/src/evidence.ts';
import { verifyExport } from '../../../core/src/verifier.ts';
import { CASE, USERS, human, makeWorld, registerFixtures } from '../../../core/test/helpers.ts';
import { S3ObjectStore } from '../src/s3-objects.ts';

interface Req { method: string; path: string; query: Record<string, string | string[] | null>; headers: Record<string, string>; body?: unknown }

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === 'string' || body instanceof Uint8Array) return Buffer.from(body as Uint8Array);
  const chunks: Buffer[] = [];
  for await (const c of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

function xmlError(statusCode: number, code: string) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;
  return { statusCode, headers: { 'content-type': 'application/xml' }, body: Readable.from([Buffer.from(body)]) };
}

// Minimal versioned bucket with S3's conditional-write and checksum behavior.
class FakeBucket {
  objects = new Map<string, Map<string, Buffer>>();
  versioning = true;
  requests: Req[] = [];
  nextVersionId: (() => string) | undefined;
  failWith: { status: number; code: string } | undefined;
  omitVersionHeaderOnGet = false;
  #n = 0;

  async handle(r: Req) {
    this.requests.push(r);
    if (this.failWith) return xmlError(this.failWith.status, this.failWith.code);
    // Virtual-hosted addressing: the bucket is in the hostname, the path is the key.
    const key = decodeURIComponent(r.path.replace(/^\//, ''));
    if (r.method === 'PUT') {
      const bytes = await bodyBytes(r.body);
      const sent = r.headers['x-amz-checksum-sha256'];
      if (sent && sent !== createHash('sha256').update(bytes).digest('base64')) return xmlError(400, 'BadDigest');
      if (r.headers['if-none-match'] === '*' && this.objects.has(key)) return xmlError(412, 'PreconditionFailed');
      const versionId = this.versioning ? (this.nextVersionId?.() ?? `ver${(this.#n += 1)}AbC.d_e`) : 'null';
      const versions = this.objects.get(key) ?? new Map();
      versions.set(versionId, bytes);
      this.objects.set(key, versions);
      return { statusCode: 200, headers: this.versioning ? { 'x-amz-version-id': versionId, etag: '"e"' } : { etag: '"e"' }, body: Readable.from([]) };
    }
    if (r.method === 'GET') {
      const versionId = r.query.versionId as string | undefined;
      const versions = this.objects.get(key);
      if (!versions) return xmlError(404, 'NoSuchKey');
      if (!versionId) return xmlError(400, 'TestRejectsLatestRead');
      const bytes = versions.get(versionId);
      if (!bytes) return xmlError(404, 'NoSuchVersion');
      const versionHeader: Record<string, string> = this.omitVersionHeaderOnGet ? {} : { 'x-amz-version-id': versionId };
      return { statusCode: 200, headers: { ...versionHeader, 'content-length': String(bytes.length), 'x-amz-checksum-sha256': createHash('sha256').update(bytes).digest('base64') }, body: Readable.from([bytes]) };
    }
    return xmlError(405, 'MethodNotAllowed');
  }
}

function setup(options: { keyPrefix?: string } = {}) {
  const bucket = new FakeBucket();
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request: Req) => ({ response: await bucket.handle({ ...request, headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])) }) }),
    } as never,
  });
  const store = new S3ObjectStore({ client, bucket: 'coc-evidence-test', keyPrefix: options.keyPrefix });
  return { bucket, store };
}

test('putNew sends If-None-Match: * and the SHA-256 checksum, and returns the S3 version ID', async () => {
  const { bucket, store } = setup({ keyPrefix: 'case-a/' });
  const bytes = new TextEncoder().encode('synthetic evidence bytes');
  const { versionId } = await store.putNew('originals/BW-001/x', bytes);
  assert.match(versionId, /^ver1/);
  const put = bucket.requests[0]!;
  assert.equal(put.method, 'PUT');
  assert.equal(put.headers['if-none-match'], '*');
  assert.equal(put.headers['x-amz-checksum-sha256'], createHash('sha256').update(bytes).digest('base64'));
  assert.ok(put.path.endsWith('/case-a/originals/BW-001/x'), put.path);
  assert.deepEqual(await store.getVersion('originals/BW-001/x', versionId), bytes);
});

test('an existing key is refused by S3 and surfaces as ObjectExistsError; the original is untouched', async () => {
  const { bucket, store } = setup();
  const { versionId } = await store.putNew('k', Buffer.from('original'));
  await assert.rejects(store.putNew('k', Buffer.from('replacement')), ObjectExistsError);
  assert.equal(bucket.objects.get('k')!.size, 1);
  assert.equal(Buffer.from((await store.getVersion('k', versionId))!).toString(), 'original');
});

test('an unversioned bucket is refused: without a version ID nothing can be pinned', async () => {
  const { bucket, store } = setup();
  bucket.versioning = false;
  await assert.rejects(store.putNew('k', Buffer.from('x')), /versioning must be enabled/);
});

test('a bucket with versioning suspended is refused: S3 returns the literal version ID "null"', async () => {
  const { bucket, store } = setup();
  bucket.nextVersionId = () => 'null';
  await assert.rejects(store.putNew('k', Buffer.from('x')), /versioning must be enabled/);
});

test('a version ID outside the accepted format is refused on write', async () => {
  const { bucket, store } = setup();
  bucket.nextVersionId = () => 'has spaces/and slashes';
  await assert.rejects(store.putNew('k', Buffer.from('x')), /outside the accepted format/);
});

test('reads always name a version; unknown keys and versions read as undefined', async () => {
  const { bucket, store } = setup();
  const { versionId } = await store.putNew('k', Buffer.from('x'));
  assert.equal(await store.getVersion('k', 'verUnknown'), undefined);
  assert.equal(await store.getVersion('missing', versionId), undefined);
  const gets = bucket.requests.filter((r) => r.method === 'GET');
  assert.ok(gets.every((g) => typeof g.query.versionId === 'string' && g.query.versionId.length > 0));
  assert.ok(gets.every((g) => g.headers['x-amz-checksum-mode'] === 'ENABLED'));
});

test('a read whose response does not confirm the requested version is refused', async () => {
  const { bucket, store } = setup();
  const { versionId } = await store.putNew('k', Buffer.from('x'));
  bucket.omitVersionHeaderOnGet = true;
  await assert.rejects(store.getVersion('k', versionId), /did not confirm the requested version/);
});

test('a malformed version ID is never sent to S3 (no fallback to the latest object)', async () => {
  const { bucket, store } = setup();
  await store.putNew('k', Buffer.from('x'));
  const before = bucket.requests.length;
  for (const bad of ['', 'null/../x', 'a b', 'x'.repeat(129)]) assert.equal(await store.getVersion('k', bad), undefined);
  assert.equal(bucket.requests.length, before);
});

test('other S3 errors fail closed: access denied and conditional-write conflicts are thrown, not mapped', async () => {
  const { bucket, store } = setup();
  const { versionId } = await store.putNew('k', Buffer.from('x'));
  bucket.failWith = { status: 403, code: 'AccessDenied' };
  await assert.rejects(store.getVersion('k', versionId), (e: Error) => e.name === 'AccessDenied');
  bucket.failWith = { status: 409, code: 'ConditionalRequestConflict' };
  await assert.rejects(store.putNew('k2', Buffer.from('y')), (e: Error) => !(e instanceof ObjectExistsError) && e.name === 'ConditionalRequestConflict');
});

test('the domain registers, reads and exports evidence through the S3 adapter, and the export verifies', async () => {
  const { bucket, store } = setup({ keyPrefix: 'coc/' });
  const w = makeWorld({ objects: store });
  const versions = await registerFixtures(w);
  assert.equal([...bucket.objects.keys()].length, versions.size);
  assert.ok([...bucket.objects.keys()].every((k) => k.startsWith('coc/originals/')));
  const payload = { evidence: ['BW-001/original', 'BW-002/transcode-2026'].map((k) => ({ evidenceId: k.split('/')[0]!, versionId: versions.get(k)! })), destination: 'internal:case-export-store' };
  assert.ok((await w.checkpoints.issue(CASE, new Date('2026-11-18T17:00:00.000Z'))).ok);
  const req = await w.approvals.requestExport(human(USERS.investigator), CASE, payload);
  assert.ok(req.ok);
  assert.ok((await w.approvals.approve(human(USERS.supervisor), req.value.approvalId)).ok);
  const pkg = await w.exports.exportCase(human(USERS.investigator), CASE, req.value.approvalId, payload);
  assert.ok(pkg.ok, JSON.stringify(pkg));
  const r = verifyExport(JSON.parse(JSON.stringify(pkg.value)), { expectedCaseId: CASE, keys: [w.trustedKey] });
  assert.ok(r.status === 'VERIFIED' || r.status === 'VERIFIED_WITH_WARNINGS', JSON.stringify(r.findings));
  assert.ok(r.evidence.every((e) => e.verified));
});
