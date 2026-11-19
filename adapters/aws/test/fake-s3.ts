// In-memory versioned S3 bucket for adapter tests, answering the real AWS SDK
// S3Client through a replaced request handler (see s3-objects.test.ts for
// what this does and does not prove).

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';

export interface Req { method: string; path: string; query: Record<string, string | string[] | null>; headers: Record<string, string>; body?: unknown }

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
export class FakeBucket {
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

export function fakeS3Client(bucket: FakeBucket): S3Client {
  return new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request: Req) => ({ response: await bucket.handle({ ...request, headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])) }) }),
    } as never,
  });
}
