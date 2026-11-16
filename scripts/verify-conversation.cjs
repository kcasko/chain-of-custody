'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function verify(directory) {
  const records = fs.readFileSync(path.join(directory, 'transcript.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const requests = records.filter(r => r.kind === 'request');
  const replies = records.filter(r => r.kind === 'reply');
  const deliveries = records.filter(r => r.kind === 'delivered');
  const complete = records.at(-1);
  assert.equal(complete.kind, 'complete');
  assert.equal(complete.verdict, 'PASS');
  assert.equal(requests.length, 4);
  assert.equal(replies.length, 4);
  assert.equal(deliveries.length, 4);
  assert.equal(new Set(deliveries.map(r => r.envelopeId)).size, 4);
  assert.equal(requests[0].prompt, requests[1].prompt, 'Independent review prompts must match');
  const context = fs.readFileSync(path.join(directory, 'frozen-context.md'), 'utf8');
  for (const request of requests) assert.ok(request.prompt.includes(context));
  for (const who of ['claude', 'codex']) {
    const own = replies.filter(r => r.who === who).sort((a, b) => a.turn - b.turn);
    assert.equal(own.length, 2);
    for (const reply of own) {
      assert.ok(reply.text.includes(complete.nonce));
      assert.ok(requests.some(q => q.who === reply.who && q.turn === reply.turn));
      assert.ok(deliveries.some(d => d.from === who && d.to !== who && d.text === reply.text));
    }
    const other = who === 'claude' ? 'codex' : 'claude';
    const incoming = deliveries.find(d => d.from === other && d.to === who && d.phase === 'independent-review');
    assert.ok(incoming);
    const followup = requests.find(q => q.who === who && q.turn > 2);
    assert.ok(followup.prompt.includes(incoming.text), 'Peer review must reach actual model input');
    assert.ok(followup.at >= incoming.at);
  }
  for (const d of deliveries) {
    assert.equal(d.nonce, complete.nonce);
    assert.ok(d.envelopeId && d.networkId);
  }
  return { verdict: 'PASS', directory, cliReplies: replies.length, receivedPeerMessages: deliveries.length, nonce: complete.nonce };
}
module.exports = { verify };
if (require.main === module) {
  try {
    const root = path.join(__dirname, '../docs/reviews');
    const target = process.argv[2] || fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory()).sort().map(n => path.join(root, n)).at(-1);
    console.log(JSON.stringify(verify(target), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
