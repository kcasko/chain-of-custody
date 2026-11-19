// Every table the domain uses, and which must be append-only. A production
// store adapter must be configured with APPEND_ONLY_TABLES exactly.

export const TABLES = {
  events: 'events',
  heads: 'heads',
  idempotency: 'idempotency',
  approvals: 'approvals',
  proposals: 'proposals',
  checkpoints: 'checkpoints',
  exports: 'exports',
  quarantine: 'quarantine',
  findings: 'findings',
  // Security audit records (adapters/aws/src/dynamo-audit.ts). The in-memory
  // log does not use the store; the durable one shares the physical table.
  audit: 'audit',
} as const;

export const APPEND_ONLY_TABLES: readonly string[] = Object.freeze([
  TABLES.events,
  TABLES.idempotency,
  TABLES.checkpoints,
  TABLES.exports,
  TABLES.quarantine,
  TABLES.findings,
  TABLES.audit,
]);
