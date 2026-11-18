# ADR 0006: Agent tools on the domain core

Status: adopted, November 18, 2026. Local only; nothing deployed. Built while Bedrock Managed Agents access is blocked (RB-1), so the agent's tools are real the moment access arrives.

## Decision

The five Gateway tools are implemented on the domain core (`core/src/agent-tools.ts`), reached through a Gateway Lambda adapter (`core/src/gateway-handler.ts`). The Stage B stub (`harness/lambda/`) stays as the Stage B record but is no longer the target design.

| Tool | Core operation |
|---|---|
| `list_evidence` | `EvidenceService.list` (read_metadata) |
| `read_evidence_version` | `EvidenceService.read` (read_original, exact version, hash re-checked); content returned as labeled untrusted data, capped at 256 KiB |
| `compare_timestamps` | Registered versions plus `ProvenanceSource` (clock, timezone, raw times, uncertainty) matched by content SHA-256; decides nothing |
| `record_finding` | `FindingService.record` (new `record_finding` operation; humans and agent) |
| `propose_custody_event` | `ProposalService.create`, translated into the exact domain input a human can promote |

## Changes made to existing contracts

1. **`propose_custody_event` schema extended.** A proposal made with the old schema could never be promoted: transfers lacked `version_id`, `from`, `to`; historical assertions lacked pinned source versions, `timezone` and `offset_uncertainty`; corrections lacked the exact `corrects_hash`. All are optional fields, required per kind by the Cedar permits, the Stage B stub and the core. `source_evidence_ids` lost `uniqueItems` because it is now parallel to `source_version_ids`. Five new Cedar deny cases cover each missing field. **Live revalidation pending:** these policy changes pass local strict validation but have not been loaded into a real AgentCore policy engine since Stage B.
2. **New operation `record_finding`** for all case roles and the agent (SECURITY-RULES: audit reports are "scoped and validated"). The agent capability set is still a strict subset of every human role.
3. **New append-only table `findings`.**

## Rules enforced in the core, not left to the model

- Closed tool schemas (patterns, enums, limits, no unknown fields). Refusals at this layer are written to the security audit log as `tool_call` with the Gateway request ID; arguments are never recorded.
- Findings must cite registered evidence and may not conclude guilt, intent, blame or admissibility (`FORBIDDEN_CONCLUSIONS`, whole-word, case-insensitive). Deliberately strict: some neutral phrasings ("no evidence of sabotage") are refused and must be rephrased.
- Proposals are drafts; promotion re-validates everything for the promoting human (a proposal with a wrong correction hash is stored but cannot be promoted).
- The handler fails closed without the Gateway's `EvidenceTools___<tool>` client context.

## Trust boundary

The Gateway does not pass the caller's identity to the Lambda (Stage B finding). Agent ID and case ID are deployment configuration, valid only while the Lambda's sole invoker is the Gateway role and the Gateway admits only the BMA session role. The handler validates both at construction.

## Verification

- `core/test/agent-tools.test.ts`: all 24 Stage B scenarios replayed against the core alone (no Gateway, no Cedar): the 7 legitimate calls succeed, all 17 attacks are refused, and the ledger is unchanged. An end-to-end run (agent lists, reads the planted-instruction file as data, compares clocks, records a finding, proposes; a human promotes; export verifies as `VERIFIED`).
- Mutation check: removing the closed-schema check, the conclusion rule, the gateway target check, the citation check or the refusal audit each fails at least one test.
- `npm test`: 280/280.

## Not yet done

- DynamoDB and S3 adapters, so the handler can run in Lambda with durable state. Until then the handler is exercised in-process only.
- Bundling the core for Lambda (Node 22 runtime) and redeploying the Gateway with the extended schema; needs approval.
