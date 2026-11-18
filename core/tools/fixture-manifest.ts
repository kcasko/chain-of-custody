// Usage: node core/tools/fixture-manifest.ts [--write]
// Without --write: exits 1 if any manifest hash or size differs from the bytes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ROOT, loadManifest, withComputedHashes } from '../src/fixtures.ts';

const current = loadManifest();
const computed = withComputedHashes(current);
const same = JSON.stringify(current) === JSON.stringify(computed);
if (process.argv.includes('--write')) {
  writeFileSync(join(FIXTURE_ROOT, 'manifest.json'), `${JSON.stringify(computed, null, 2)}\n`);
  console.log(same ? 'manifest already up to date' : 'manifest hashes and sizes written from bytes');
} else {
  console.log(same ? 'manifest matches fixture bytes' : 'manifest DOES NOT match fixture bytes; run with --write after reviewing');
  process.exitCode = same ? 0 : 1;
}
