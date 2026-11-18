// S3 adapter for the core's ObjectStore port (T14).
//
// putNew writes with If-None-Match: * so S3 itself refuses to replace an
// existing key (HTTP 412), and sends a SHA-256 checksum so S3 rejects bytes
// corrupted in transit. The bucket must have versioning enabled: the version
// ID S3 returns is the only handle the core keeps, and every read names it.
// There is no list, no "latest" read and no delete, matching the port.
//
// Production hardening that lives in infrastructure, not here: Object Lock in
// compliance mode, a bucket policy denying s3:DeleteObject*, PutObject without
// If-None-Match, and PutBucketVersioning for the application role. See ADR 0007.

import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ObjectExistsError, type ObjectStore } from '../../../core/src/evidence.ts';
import { VERSION_ID } from '../../../core/src/validate.ts';

export interface S3ObjectStoreOptions {
  readonly client: Pick<S3Client, 'send'>;
  readonly bucket: string;
  readonly keyPrefix?: string;
}

const NOT_FOUND = new Set(['NoSuchKey', 'NoSuchVersion', 'NotFound']);

function status(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

export class S3ObjectStore implements ObjectStore {
  readonly #client: Pick<S3Client, 'send'>;
  readonly #bucket: string;
  readonly #prefix: string;

  constructor(options: S3ObjectStoreOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#prefix = options.keyPrefix ?? '';
  }

  async putNew(key: string, bytes: Uint8Array): Promise<{ versionId: string }> {
    let r;
    try {
      r = await this.#client.send(new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.#prefix + key,
        Body: bytes,
        IfNoneMatch: '*',
        ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
      }));
    } catch (err) {
      if ((err as { name?: string }).name === 'PreconditionFailed' || status(err) === 412) throw new ObjectExistsError(key);
      throw err; // includes 409 ConditionalRequestConflict: fail closed, caller quarantines
    }
    const versionId = r.VersionId;
    if (!versionId || versionId === 'null') throw new Error('S3 returned no version ID; bucket versioning must be enabled');
    if (!VERSION_ID.test(versionId)) throw new Error('S3 returned a version ID outside the accepted format');
    return { versionId };
  }

  async getVersion(key: string, versionId: string): Promise<Uint8Array | undefined> {
    if (!VERSION_ID.test(versionId)) return undefined; // never send a malformed ID, never fall back to "latest"
    try {
      const r = await this.#client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.#prefix + key,
        VersionId: versionId,
        ChecksumMode: 'ENABLED',
      }));
      if (r.VersionId !== undefined && r.VersionId !== versionId) throw new Error('S3 returned a different version than requested');
      if (!r.Body) throw new Error('S3 returned no body');
      return await r.Body.transformToByteArray();
    } catch (err) {
      if (NOT_FOUND.has((err as { name?: string }).name ?? '') || status(err) === 404) return undefined;
      throw err;
    }
  }
}
