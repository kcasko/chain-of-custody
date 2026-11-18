// Read tools. Scoped to the evidence IDs of this one case.
// {{EVIDENCE_ID_SET}} is rendered from policy/case-scope.json.
// Exact-version checks (no "latest", registered version only) happen in the
// Lambda (layer L3); Cedar cannot see the registry.

@id("permit-list-evidence")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___list_evidence",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
);

@id("permit-read-evidence-version-in-case")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___read_evidence_version",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  context.input has version_id &&
  {{EVIDENCE_ID_SET}}.contains(context.input.evidence_id)
};

// Set size limits (2 to 4) are enforced by the tool schema and the Lambda.
// Cedar has no set-size operator.
@id("permit-compare-timestamps-in-case")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___compare_timestamps",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  !context.input.evidence_ids.isEmpty() &&
  {{EVIDENCE_ID_SET}}.containsAll(context.input.evidence_ids)
};
