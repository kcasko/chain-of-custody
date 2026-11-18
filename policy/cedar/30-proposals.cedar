// Custody proposals are DRAFTS. Allowing one here never changes the ledger.
// Promotion is a human-only operation in the application API, with an
// independent approver. No tool exists for approve, promote, overwrite or delete.
//
// Requirements are written as permit conditions on purpose: if a field is
// missing, the condition errors, the permit is skipped, and the call is denied.
// (A forbid that errors is skipped too, which would ALLOW. See threat B4.)
// Every permit also checks `has` for each required field it does not otherwise
// read, so a call missing one is denied even if the engine skips type checks.

@id("permit-propose-transfer")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___propose_custody_event",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  context.input has reason &&
  context.input.event_kind == "transfer" &&
  {{EVIDENCE_ID_SET}}.contains(context.input.evidence_id)
};

// A past event claimed by a document must cite that document and keep its raw
// time and source clock. This is how the agent records history without
// fabricating a contemporaneous custody event.
@id("permit-propose-historical-assertion-with-source")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___propose_custody_event",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  context.input has reason &&
  context.input.event_kind == "historical_assertion" &&
  {{EVIDENCE_ID_SET}}.contains(context.input.evidence_id) &&
  context.input has source_evidence_ids &&
  !context.input.source_evidence_ids.isEmpty() &&
  {{EVIDENCE_ID_SET}}.containsAll(context.input.source_evidence_ids) &&
  context.input has claimed_time_raw &&
  context.input has source_clock
};

// A correction references an earlier ledger sequence. It appends; it never edits.
@id("permit-propose-correction-with-target")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___propose_custody_event",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  context.input has reason &&
  context.input.event_kind == "correction" &&
  {{EVIDENCE_ID_SET}}.contains(context.input.evidence_id) &&
  context.input has corrects_sequence &&
  context.input.corrects_sequence >= 1
};

// Defense in depth: hold even if a future permit is written too broadly.
// Every attribute read is guarded by `has` first, so these cannot error and be
// skipped. (Do not add guards for unrelated fields: that would let a call
// escape the forbid by omitting them.)
@id("forbid-historical-assertion-without-provenance")
forbid (
  principal,
  action == AgentCore::Action::"EvidenceTools___propose_custody_event",
  resource
)
when {
  context.input has event_kind &&
  context.input.event_kind == "historical_assertion" &&
  !(context.input has source_evidence_ids &&
    context.input has claimed_time_raw &&
    context.input has source_clock)
};

@id("forbid-proposal-sources-outside-case")
forbid (
  principal,
  action == AgentCore::Action::"EvidenceTools___propose_custody_event",
  resource
)
when {
  context.input has source_evidence_ids &&
  !{{EVIDENCE_ID_SET}}.containsAll(context.input.source_evidence_ids)
};
