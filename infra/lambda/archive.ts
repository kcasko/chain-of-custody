// Lambda entry for the ledger archive (ADR 0008). Bundled by esbuild at synth.

import { S3Client } from '@aws-sdk/client-s3';
import { createArchiveHandler } from '../../adapters/aws/src/ledger-archive.ts';
import { APPEND_ONLY_TABLES } from '../../core/src/tables.ts';

const bucket = process.env.ARCHIVE_BUCKET;
if (!bucket) throw new Error('ARCHIVE_BUCKET is not set');

export const handler = createArchiveHandler({ s3: new S3Client({}), bucket, appendOnlyTables: APPEND_ONLY_TABLES });
