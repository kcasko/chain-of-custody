// Findings must cite evidence from this case and use an allowed type.
// There is deliberately no type for guilt, intent, admissibility or blame.
// Whether the cited versions support the summary is checked in the Lambda
// (citation validation, layer L3).

@id("permit-record-finding-cited-in-case")
permit (
  principal is AgentCore::IamEntity,
  action == AgentCore::Action::"EvidenceTools___record_finding",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  context.input has summary &&
  ["discrepancy", "provenance_gap", "clock_uncertainty", "unresolved_question", "integrity_check_result"]
    .contains(context.input.finding_type) &&
  ["low", "medium", "high"].contains(context.input.uncertainty) &&
  !context.input.cited_evidence_ids.isEmpty() &&
  {{EVIDENCE_ID_SET}}.containsAll(context.input.cited_evidence_ids)
};
