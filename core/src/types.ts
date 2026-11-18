// Domain types. Independent of AWS, Bedrock Managed Agents and transport.

export type Role = 'investigator' | 'auditor' | 'supervisor';

export interface HumanPrincipal { readonly type: 'human'; readonly userId: string }
export interface AgentPrincipal { readonly type: 'agent'; readonly agentId: string }
export type Principal = HumanPrincipal | AgentPrincipal;

// Built by the server from a verified session (or, for the agent, from the
// Gateway's verified IAM principal). Never built from request bodies.
export interface RequestContext {
  readonly principal: Principal | null;
  readonly channel: 'api' | 'gateway';
  readonly requestId: string;
  readonly now: Date;
}

export type Operation =
  | 'read_metadata'
  | 'read_original'
  | 'register_evidence'
  | 'register_derivative'
  | 'add_custody_event'
  | 'record_historical_assertion'
  | 'append_correction'
  | 'request_export'
  | 'approve_request'
  | 'revoke_approval'
  | 'record_finding'
  | 'create_proposal'
  | 'promote_proposal'
  | 'overwrite_original'
  | 'delete_history'
  | 'grant_role';

export type ErrorCode =
  | 'DENIED_NO_IDENTITY'
  | 'DENIED_NOT_MEMBER'
  | 'DENIED_ROLE'
  | 'DENIED_AGENT'
  | 'DENIED_FORBIDDEN_OPERATION'
  | 'DENIED_SELF_APPROVAL'
  | 'DENIED_APPROVAL_INVALID'
  | 'DENIED_AUDIT_UNAVAILABLE'
  | 'DENIED_POLICY_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'EVIDENCE_VERSION_MISSING'
  | 'INTEGRITY_FAILURE'
  | 'CONTENT_RULE_VIOLATION'
  | 'UNKNOWN_TOOL'
  | 'LEDGER_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'STORAGE_UNAVAILABLE'
  | 'REGISTRATION_FAILED';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string; readonly auditPersisted?: boolean };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: ErrorCode, detail: string, auditPersisted?: boolean): Result<T> =>
  auditPersisted === undefined ? { ok: false, code, detail } : { ok: false, code, detail, auditPersisted };

export interface EvidenceRef { readonly evidenceId: string; readonly versionId: string }

// Ledger -------------------------------------------------------------------

export interface ActorRecord { readonly type: 'human'; readonly userId: string; readonly role: Role }

export interface EvidenceRegisteredBody {
  readonly evidenceId: string;
  readonly versionId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly size: number;
  readonly mediaType: string;
  readonly derivedFrom: { readonly versionId: string; readonly transformation: string } | null;
}
export interface CustodyTransferBody { readonly evidenceId: string; readonly versionId: string; readonly from: string; readonly to: string; readonly reason: string }
export interface HistoricalAssertionBody {
  readonly evidenceId: string;
  readonly sources: readonly EvidenceRef[];
  readonly statement: string;
  readonly claimedTimeRaw: string;
  readonly sourceClock: string;
  readonly timezone: string;
  readonly offsetUncertainty: string;
}
export interface CorrectionBody { readonly targetSequence: number; readonly targetHash: string; readonly reason: string }

export type EventDraft =
  | { readonly kind: 'evidence_registered'; readonly body: EvidenceRegisteredBody }
  | { readonly kind: 'custody_transfer'; readonly body: CustodyTransferBody }
  | { readonly kind: 'historical_assertion'; readonly body: HistoricalAssertionBody }
  | { readonly kind: 'correction'; readonly body: CorrectionBody };

export type CustodyEvent = EventDraft & {
  readonly schema: 'coc/custody-event/v1';
  readonly caseId: string;
  readonly sequence: number;
  readonly prevHash: string;
  readonly recordedAt: string;
  readonly actor: ActorRecord;
  readonly approvalId: string | null;
  readonly eventHash: string;
};

export interface SignedCheckpoint {
  readonly body: {
    readonly schema: 'coc/checkpoint/v1';
    readonly caseId: string;
    readonly sequence: number;
    readonly headHash: string;
    readonly issuedAt: string;
    readonly keyId: string;
  };
  readonly signatureHex: string;
}
