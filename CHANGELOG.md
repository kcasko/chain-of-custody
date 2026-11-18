# Changelog

## 2026-11-18

- T07: verified event window and brief from the official event page (rules still unpublished).
- Added BMA feasibility research from official AWS docs, with open spike questions Q1-Q6.
- Adopted ADR 0003 (approved by Keith): Gateway + Cedar + Lambda tool boundary, agent as its own case-bound principal (amends ADR 0002), hostile execution environment, storage-level append-only enforcement, 14-day P0/P1/P2 scope.
- Added BMA-specific threats B1-B7 and residual risks R1-R3 to the security rules. Added tasks T07b, T09, T10.
- T10: five agent tool definitions and Cedar policies (`policy/`), deny by default with session-role and gateway boundary forbids. 128 policy tests covering permitted, denied, escalation, prompt injection, approval bypass and missing-field cases, each run typed and untyped. ADR 0004 records decisions and what remains for the Lambda layer and T09. Added dev dependency `@cedar-policy/cedar-wasm` 4.14.0 (exact pin).
- T09 plan prepared (not executed): staged spike with gates, exact resources, cost estimate (about $3 typical, about $12 worst case), $15 budget safeguards and same-day teardown. Found that GPT-5.6 Luna bills as AWS Marketplace usage, so service-filtered budgets must name it explicitly.
- T09 run: stopped at gate G1. The account gets HTTP 401 "Bedrock Managed Agents is not available for this account" in all three preview regions, and GPT-5.6 Luna is not entitled (gpt-oss-20b works with the same credentials). Created two free budgets and two narrow IAM roles; nothing billable. Found that the official exec-server example passes the operator's AWS profile to the agent's shell. Report and access-request drafts in docs/research/2026-11-18-t09-spike-report.md.
- T09 Stage B (approved): real AgentCore Gateway + Policy (ENFORCE) + stub tool Lambda, with a test-harness role standing in for BMA. 29/29 live scenarios pass twice, verified against Lambda logs; 17/17 exec-environment isolation checks passed while the gateway existed (committed post-teardown rerun: 16/16, gateway probe skipped); all Stage B resources torn down the same day. Not evidence of BMA compatibility.
- Policies changed to satisfy the real engine (resource constraints in forbid heads, IamEntity-scoped tool forbids, exact principal match because AgentCore strips the session name). ADR 0004 updated: undeclared tool arguments reach the target in production, so the Lambda's closed-schema validation is mandatory.
- Added `harness/` (stub Lambda with independent validation, replaceable `AgentToolClient`, live runner, exec-environment check) and `tests/harness.test.cjs`. `npm test`: 150/150. Added threats B8 and B9. Access requests rewritten with Stage B findings in docs/plans/2026-11-18-bma-access-requests.md.

## 2026-11-16

- Initialized local Chain of Custody planning repository.
- Recovered original Blackwater planning context with truncation and verification caveats.
- Added project plan, case bible, proposed architecture, security rules, test strategy and task board.
- Added local bounded Mozaik/Claude/Codex review integration and verification artifacts.
