// T02: authorization matrix, agent limits, fail-closed behavior and audit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, HUMAN_MATRIX, AGENT_CAPABILITIES, FORBIDDEN, type MembershipDirectory } from '../src/policy.ts';
import { guarded } from '../src/audit.ts';
import type { Operation, Role } from '../src/types.ts';
import { ok } from '../src/types.ts';
import { CASE, OTHER_CASE, USERS, AGENT, OTHER_AGENT, makeDirectory, human, agent, anonymous, deps } from './helpers.ts';

const dir = makeDirectory();
const OPS = Object.keys(HUMAN_MATRIX) as Operation[];
const ROLE_USER: Record<Role, string> = { investigator: USERS.investigator, auditor: USERS.auditor, supervisor: USERS.supervisor };

// The expected matrix, written out independently of policy.ts.
const EXPECTED: Record<Role, Operation[]> = {
  investigator: ['read_metadata', 'read_original', 'register_evidence', 'register_derivative', 'add_custody_event', 'record_historical_assertion', 'append_correction', 'record_finding', 'request_export', 'revoke_approval', 'promote_proposal', 'dismiss_proposal'],
  auditor: ['read_metadata', 'read_original', 'record_historical_assertion', 'append_correction', 'record_finding', 'request_export', 'revoke_approval', 'promote_proposal', 'dismiss_proposal'],
  supervisor: ['read_metadata', 'read_original', 'register_evidence', 'register_derivative', 'add_custody_event', 'record_historical_assertion', 'append_correction', 'record_finding', 'request_export', 'approve_request', 'revoke_approval', 'promote_proposal', 'dismiss_proposal', 'read_audit_log'],
};

test('every role x operation decision matches the written matrix', async () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    for (const op of OPS) {
      const r = await authorize(dir, human(ROLE_USER[role]), op, CASE);
      assert.equal(r.ok, EXPECTED[role].includes(op), `${role} ${op}`);
    }
  }
});

test('overwrite, delete history and role grants are denied for everyone, first', async () => {
  for (const op of ['overwrite_original', 'delete_history', 'grant_role'] as Operation[]) {
    assert.ok(FORBIDDEN.has(op));
    for (const ctx of [human(USERS.supervisor), human(USERS.investigator), agent()]) {
      const r = await authorize(dir, ctx, op, CASE);
      assert.equal(!r.ok && r.code, 'DENIED_FORBIDDEN_OPERATION');
    }
  }
});

test('the agent can only read and propose, only through the gateway, only for its bound case', async () => {
  for (const op of OPS) {
    const r = await authorize(dir, agent(), op, CASE);
    assert.equal(r.ok, AGENT_CAPABILITIES.has(op) && !FORBIDDEN.has(op), op);
  }
  assert.deepEqual([...AGENT_CAPABILITIES].sort(), ['create_proposal', 'read_metadata', 'read_original', 'record_finding']);
  const viaApi = await authorize(dir, agent(AGENT, 'api'), 'read_metadata', CASE);
  assert.equal(!viaApi.ok && viaApi.code, 'DENIED_AGENT');
  const wrongCase = await authorize(dir, agent(AGENT), 'read_metadata', OTHER_CASE);
  assert.equal(!wrongCase.ok && wrongCase.code, 'DENIED_NOT_MEMBER');
  const otherAgent = await authorize(dir, agent(OTHER_AGENT), 'read_original', CASE);
  assert.equal(!otherAgent.ok && otherAgent.code, 'DENIED_NOT_MEMBER');
  const unknownAgent = await authorize(dir, agent('ghost-agent'), 'read_metadata', CASE);
  assert.equal(!unknownAgent.ok && unknownAgent.code, 'DENIED_NOT_MEMBER');
});

test('the agent capability set is a strict subset of every human role (ADR 0003 decision 2)', () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    for (const op of AGENT_CAPABILITIES) if (op !== 'create_proposal') assert.ok(EXPECTED[role].includes(op), `${role} lacks ${op}`);
  }
});

test('no identity, non-member and cross-case requests are denied', async () => {
  const anon = await authorize(dir, anonymous(), 'read_metadata', CASE);
  assert.equal(!anon.ok && anon.code, 'DENIED_NO_IDENTITY');
  const outsider = await authorize(dir, human(USERS.outsider), 'read_metadata', CASE);
  assert.equal(!outsider.ok && outsider.code, 'DENIED_NOT_MEMBER');
  const crossCase = await authorize(dir, human(USERS.supervisor), 'read_original', OTHER_CASE);
  assert.equal(!crossCase.ok && crossCase.code, 'DENIED_NOT_MEMBER');
});

test('the role comes from the directory, never from anything the caller claims', async () => {
  // A spoofed principal object with extra claims is ignored: only userId is used.
  const ctx = { ...human(USERS.auditor), principal: { type: 'human' as const, userId: USERS.auditor, role: 'supervisor', admin: true } };
  const r = await authorize(dir, ctx, 'approve_request', CASE);
  assert.equal(!r.ok && r.code, 'DENIED_ROLE');
});

test('an unavailable directory denies (fail closed)', async () => {
  const broken: MembershipDirectory = { roleOf: async () => { throw new Error('down'); }, caseOfAgent: async () => { throw new Error('down'); } };
  for (const ctx of [human(USERS.supervisor), agent()]) {
    const r = await authorize(broken, ctx, 'read_metadata', CASE);
    assert.equal(!r.ok && r.code, 'DENIED_POLICY_UNAVAILABLE');
  }
});

test('guarded: denials are audited and the action never runs', async () => {
  const d = deps();
  let ran = false;
  const r = await guarded(d, human(USERS.auditor), 'register_evidence', CASE, async () => { ran = true; return ok(1); });
  assert.equal(r.ok, false);
  assert.equal(ran, false);
  assert.equal(!r.ok && r.auditPersisted, true);
  assert.deepEqual(d.audit.events.map((e) => [e.outcome, e.code]), [['denied', 'DENIED_ROLE']]);
});

test('guarded: an unavailable audit store blocks the action and does not claim the denial was saved (V13)', async () => {
  const d = deps();
  d.audit.available = false;
  let ran = false;
  const r = await guarded(d, human(USERS.supervisor), 'register_evidence', CASE, async () => { ran = true; return ok(1); });
  assert.equal(ran, false);
  assert.equal(!r.ok && r.code, 'DENIED_AUDIT_UNAVAILABLE');
  assert.equal(!r.ok && r.auditPersisted, false);
  assert.equal(d.audit.events.length, 0);
});

test('guarded: allowed actions record attempted then completed with request IDs', async () => {
  const d = deps();
  const ctx = human(USERS.supervisor);
  const r = await guarded(d, ctx, 'read_metadata', CASE, async () => ok('x'));
  assert.equal(r.ok, true);
  assert.deepEqual(d.audit.events.map((e) => e.outcome), ['attempted', 'completed']);
  assert.ok(d.audit.events.every((e) => e.requestId === ctx.requestId && e.principal === `human:${USERS.supervisor}`));
});

test('guarded: an exception inside the action is reported as a failure, not success', async () => {
  const d = deps();
  const r = await guarded(d, human(USERS.supervisor), 'read_metadata', CASE, async () => { throw new Error('boom'); });
  assert.equal(!r.ok && r.code, 'STORAGE_UNAVAILABLE');
  assert.deepEqual(d.audit.events.map((e) => e.outcome), ['attempted', 'failed']);
});
