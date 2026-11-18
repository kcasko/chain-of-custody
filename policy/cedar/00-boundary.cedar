// Boundary rules. These apply to every tool, including tools added later.
// Cedar is deny by default; these forbids also block anything a future,
// overly broad permit might allow. `is` and `like` cannot error, so these
// forbids are never skipped.

// Only the agent's BMA session role may call tools. Any other IAM role,
// account, or an OAuth user (for example one claiming "supervisor") is denied.
// The "/" after the role name stops prefix tricks like "<role>Admin".
@id("boundary-session-role-only")
forbid (principal, action, resource)
unless {
  principal is AgentCore::IamEntity &&
  principal.id like "arn:aws:sts::{{ACCOUNT_ID}}:assumed-role/{{SESSION_ROLE_NAME}}/*"
};

// Only our one Gateway. Blocks reuse of these policies on another Gateway.
@id("boundary-this-gateway-only")
forbid (principal, action, resource)
unless {
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
};
