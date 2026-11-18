# ADR 0004: Agent tools and Cedar authorization policy (T10)

Status: adopted, November 18, 2026. Local only. Nothing is deployed. Builds on ADR 0003.

## Files

| File | Purpose |
|---|---|
| `policy/tools/evidence-tools.json` | The five tool definitions (MCP name, description, JSON inputSchema) for the Gateway Lambda target |
| `policy/case-scope.json` | The one case and its ten evidence IDs. Rendered into the policies |
| `policy/agentcore.cedarschema` | Local model of the Cedar schema AgentCore derives from the tool schemas |
| `policy/cedar/*.cedar` | The policies, with `{{ACCOUNT_ID}}`, `{{SESSION_ROLE_NAME}}`, `{{GATEWAY_ARN}}`, `{{EVIDENCE_ID_SET}}` placeholders |
| `policy/lib.cjs` | Render (with strict placeholder formats), validate (strict), authorize (fail closed) |
| `tests/policy.test.cjs` | 128 tests |

Engine: `@cedar-policy/cedar-wasm` 4.14.0 (official Cedar, Apache-2.0, Cedar language 4.6), pinned exact as a dev dependency. 4.14.1 is a broken release (npm marks it deprecated). 4.15.0 was two days old, too new to adopt.

## The five tools

| Tool | Does | Cedar rule |
|---|---|---|
| `list_evidence` | Lists the case's evidence and registered versions | Session role on this Gateway |
| `read_evidence_version` | Reads one exact registered version | Evidence ID in case; `version_id` present |
| `compare_timestamps` | Compares raw times and clocks across 2 to 4 items | Non-empty, all IDs in case |
| `record_finding` | Records a cited finding | Allowed type (no guilt/admissibility types exist), allowed uncertainty, non-empty citations all in case |
| `propose_custody_event` | Creates a **draft** only | `transfer`: evidence in case. `historical_assertion`: also cites in-case sources plus raw time and source clock. `correction`: also targets a sequence of at least 1 |

No tool takes a case, actor, role, scope, token or approval argument (enforced by a test). No tool can approve, promote, overwrite, delete, export or grant (enforced by a test).

## Decisions

1. **Deny by default, then boundary forbids.** Two forbids cover every action, including tools added later. Only the BMA session role may call tools (`principal.id like "arn:aws:sts::<account>:assumed-role/<role>/*"`; the `/` blocks `<role>Admin`). Only our Gateway ARN is accepted. A test proves these win over a mistaken `permit (principal, action, resource)`.
2. **Requirements live in permit conditions.** In Cedar, a policy that errors is skipped. A skipped permit grants nothing (safe). A skipped forbid blocks nothing (unsafe). So each permit lists every requirement, including `has` for required fields it doesn't otherwise read. Forbids are backup only, and every attribute they read is guarded by `has` first.
3. **Two layers for provenance, each tested alone.** Fabricated history and out-of-case sources are blocked by the permits *and* by forbids. Tests run the permits with the forbids removed, and the forbids against an allow-all permit, so neither layer can quietly regress behind the other.
4. **Every decision test runs typed and untyped.** Typed mirrors AgentCore typing `context.input` from the tool schemas. Untyped proves the policy text denies on its own. Untyped mode found a real gap during development (calls missing `version_id`, `summary` or `reason` were allowed). Fixed with explicit `has` checks.
5. **Case scope is policy, not a parameter.** The ten evidence IDs are rendered from `case-scope.json`. Adding evidence is a reviewed policy change.
6. **Placeholders cannot inject logic.** Render rejects values outside strict formats (12-digit account, IAM role name characters, exact Gateway ARN shape). A `*`, quote or `);` is refused, which is tested.
7. **Policies validate strictly with zero warnings,** matching AgentCore's `FAIL_ON_ANY_FINDINGS`.

## What Cedar cannot do here (belongs to the Lambda, layer L3)

| Rule | Why not Cedar |
|---|---|
| Reject unknown extra fields (`actor`, `approved`, `case_id`, ...) | Strict validation flags `context.input has actor` on an undeclared field as an "impossible policy", which `FAIL_ON_ANY_FINDINGS` would reject. Handled by `additionalProperties: false` plus Lambda validation. Tests prove such fields are rejected when typed and **inert** when untyped: no policy reads them, so they cannot change a decision. |
| Version ID is a real registered version, never "latest" | Cedar cannot see the registry |
| Set sizes (2 to 4 IDs), string lengths | Cedar has no size or length operators |
| Finding summary is supported by cited content; no guilt language in free text | Needs content checks |
| Evidence text is untrusted | Lambda returns it as data. The model reading it is outside any policy |

## Test coverage (`npm test`: 135 pass, 0 fail, including 7 existing collaboration tests)

- Permitted: 8 legitimate calls, allowed in both modes (so "deny everything" cannot pass).
- Denied: 9 plain denials.
- Privilege escalation: 11, including other roles, prefix trick, other account, IAM user, OAuth "supervisor", other Gateway, case-folding and Unicode lookalike IDs, path to evaluator truth, guilt and admissibility finding types.
- Prompt injection: 11 tool calls a planted instruction would induce (overwrite, delete, nonexistent tools, fabricated history, out-of-case sources). These test the deterministic boundary for a *compromised* model. They do not test whether the model resists injection; that needs the live agent (T09 onward).
- Approval bypass: 6 (approve, promote and consume tools; `approval`/`promote` event kinds; the human approver role calling agent tools).
- B4 missing fields: every required field of every tool omitted in turn.
- Injected fields: 6 identity and approval fields.
- Structure: strict validation, unique IDs, render injection, tool surface, Cedar/tool schema sync, permit scoping.

Mutation check (run by hand, not automated): seven deliberate policy breakages, including removing the role boundary, the gateway boundary, a finding-type allowlist, provenance requirements, an `isEmpty` check, a `has` guard and a source-scope check. Each one made at least one test fail. Two early survivors exposed missing tests, which were added.

## Unverified until T09 (the real engine)

- AgentCore's actual schema: entity attribute names (`IamEntity.id`), whether arrays map to `Set<String>` and integers to `Long`, and whether `@id` annotations are accepted.
- Whether the Gateway rejects undeclared tool arguments before Cedar sees them.
- Whether the principal ARN BMA presents matches `assumed-role/<SessionRole>/*`.
- AgentCore's Cedar version supports `isEmpty()` (Cedar language 4.6 locally).

If any of these differ, T09 adjusts the schema/policies and this test suite, not the security rules.
