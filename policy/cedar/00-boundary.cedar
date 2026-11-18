// Boundary rules. These apply to every tool, including tools added later.
// Cedar is deny by default; these forbids also block anything a future,
// overly broad permit might allow. `is` and `==` cannot error, so these
// forbids are never skipped.
//
// AgentCore loads these two with IGNORE_ALL_FINDINGS: its analyzer reports a
// deliberate boundary as "Overly Restrictive". All other policies load with
// FAIL_ON_ANY_FINDINGS. See ADR 0004 (Stage B update).

// Only the agent's BMA session role may call tools. Any other IAM role,
// account, or an OAuth user (for example one claiming "supervisor") is denied.
// AgentCore presents an assumed role as its ARN with the session name removed
// (arn:aws:sts::<acct>:assumed-role/<role>), so this is an exact match with no
// wildcard: prefix tricks like "<role>Admin" cannot match.
@id("boundary-session-role-only")
forbid (principal, action, resource is AgentCore::Gateway)
unless {
  principal is AgentCore::IamEntity &&
  principal.id == "arn:aws:sts::{{ACCOUNT_ID}}:assumed-role/{{SESSION_ROLE_NAME}}"
};

// Only our one Gateway. Blocks reuse of these policies on another Gateway.
@id("boundary-this-gateway-only")
forbid (principal, action, resource is AgentCore::Gateway)
unless {
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
};
