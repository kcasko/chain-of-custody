'use strict';
// Writes the stub Lambda bundle inputs to .local/stage-b/lambda/ and prints
// their SHA-256 so the deployed bundle can be traced to the tested sources.
// Zipping is done by the deploy step (python zipfile, stdlib only).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSpec } = require('./build-spec.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.local', 'stage-b', 'lambda');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const files = {
  'handler.cjs': fs.readFileSync(path.join(__dirname, 'lambda', 'handler.cjs')),
  'synthetic-evidence.json': fs.readFileSync(path.join(__dirname, 'lambda', 'synthetic-evidence.json')),
  'tool-spec.json': Buffer.from(`${JSON.stringify(buildSpec(), null, 2)}\n`),
};
const manifest = {};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  manifest[name] = crypto.createHash('sha256').update(data).digest('hex');
}
fs.writeFileSync(path.join(OUT, '..', 'lambda-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
