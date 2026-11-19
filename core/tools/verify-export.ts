// Offline export verifier: checks a downloaded package against a trust file
// obtained separately (public checkpoint key and a reference head). Uses only
// core/src/verifier.ts, which imports no domain service, store or network code.
//
// Usage: node core/tools/verify-export.ts <package.json> <trust.json> [--json]
// Exit codes: 0 VERIFIED, 1 VERIFIED_WITH_WARNINGS or FAILED, 2 usage or unreadable input.
//
// What a pass means: the history is complete and unaltered from genesis through
// the signed checkpoint, the evidence bytes match their registered hashes, and
// the package is at least as new as the trusted reference. It does NOT prove
// the original material is authentic or true: a forged document registered
// honestly verifies perfectly.

import { readFileSync } from 'node:fs';
import { verifyExport, type Trust } from '../src/verifier.ts';

const MAX_BYTES = 64 * 1024 * 1024;

function readJson(path: string, what: string): unknown {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_BYTES) throw new Error(`${what} is larger than ${MAX_BYTES} bytes`);
  return JSON.parse(bytes.toString('utf8'));
}

function main(argv: string[]): number {
  const args = argv.filter((a) => a !== '--json');
  if (args.length !== 2) {
    console.error('usage: node core/tools/verify-export.ts <package.json> <trust.json> [--json]');
    return 2;
  }
  let pkg: unknown;
  let trust: Trust;
  try {
    pkg = readJson(args[0]!, 'package');
    trust = readJson(args[1]!, 'trust file') as Trust;
  } catch (err) {
    console.error(`cannot read input: ${(err as Error).message}`);
    return 2;
  }
  let report;
  try {
    report = verifyExport(pkg, trust);
  } catch (err) {
    // The verifier reports problems as findings; a throw means the trust file itself is unusable.
    console.error(`verification could not run: ${(err as Error).message}`);
    return 2;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Status:      ${report.status}`);
    console.log(`Freshness:   ${report.freshness}`);
    console.log(`History:     valid through #${report.validThrough} of ${report.eventCount}; signed checkpoint anchors #${report.anchoredThrough}`);
    console.log(`Evidence:    ${report.evidence.filter((e) => e.verified).length} of ${report.evidence.length} files match their registered hashes`);
    for (const f of report.findings) console.log(`  ${f.severity.toUpperCase()} ${f.code}${f.sequence ? ` (#${f.sequence})` : ''}: ${f.detail}`);
    console.log('Integrity only: this does not prove the original material is authentic or true.');
  }
  return report.status === 'VERIFIED' ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
