# ADR 0009: Investigation workspace (T17)

Status: adopted, November 18, 2026. Local only. Runs on the synthetic case with in-memory adapters; nothing deployed.

## Decision

A local investigation workspace at `/` (the Integrity Challenge moves to `/challenge`). It covers the human side of the audit end to end, every action through the domain core:

| Area | What a person can do | Core operation |
|---|---|---|
| Evidence | List registered versions; read an exact version as plain text with its re-checked hash; record a custody transfer | `EvidenceService.list`, `read`; `CustodyService.recordTransfer` |
| Custody timeline | See every ledger entry, its hash and link, and a chain self-check; append a correction (the original line stays) | new `CaseReadService.timeline`; `appendCorrection` |
| Findings and drafts | Run the scripted agent pass; record a finding; promote an agent draft to the ledger | `createGatewayHandler` with the agent tools; `FindingService.record`; `ProposalService.promote` |
| Approvals and export | Request an export; approve or revoke as a different supervisor; export and see the independent verification | `ApprovalService`; `ExportService.exportCase`; `verifyExport` |

## Choices

- **Authorization stays in the core.** The API (`app/src/workflow.ts`) parses, builds a `RequestContext` for the person acting, calls one core operation and maps its `Result` to HTTP. Three read views had no authorized path, so they were added to the core as `CaseReadService` (timeline, drafts, approvals): `read_metadata`, humans only, audited, with tests for agent, outsider and anonymous denial. The agent's surface stays the five tools.
- **Identity is a local demo control, said plainly on the page.** You choose who you act as from the synthetic staff; there is no login. The core authorizes and audits each action as that person. A deployed version needs real authentication (Cognito, not built).
- **Browser-side protections:** per-launch session token on every data call (constant-time compare), Host must be `127.0.0.1` or `localhost` on our port (DNS rebinding), Origin must be this server, JSON only with a 64 KiB limit, strict CSP with no inline script or external resource, every value rendered with `textContent`, internal storage keys not exposed.
- **The agent pass is labeled as scripted everywhere.** It replays the seven legitimate Stage B calls through the Gateway handler. It is not a model and not evidence of Bedrock Managed Agents behavior (RB-1).
- **Checkpoints are a system process.** The server issues a signed checkpoint after each successful ledger change, standing in for a scheduled checkpoint authority; there is no user endpoint for it.
- **Dismissing an agent draft (T18, added November 18).** New core operation `dismiss_proposal` (`ProposalService.dismiss`): any human member of the case may dismiss a draft, a reason (1 to 2000 characters) is required, agents are refused (`DENIED_AGENT`), and a non-member gets `NOT_FOUND`. Dismissal is final. The draft is kept with `status: 'dismissed'` and `dismissal: { by, at, reason }`, stays listed for everyone, can never be promoted, and is audited (attempted and completed). It is not a ledger event: a draft was never part of the record, so the ledger does not change. The write is conditional on the version just read, so a dismissal and a promotion of the same draft cannot both succeed.
  - Why any member, not only roles that could promote the draft: an auditor's job includes rejecting agent claims they cannot act on (an auditor may not record transfers, but should be able to set aside a wrong transfer draft). The risk is that a member buries a correct draft; it is limited because the dismissal is visible to everyone with who and why, nothing is deleted, and the agent can propose again. Revisit if real users need dismissal restricted or reviewed.
- **Historical claims by a person (T18, added November 18).** A folded form above the custody timeline calls the existing core operation `CustodyService.recordHistoricalAssertion` (all case roles, humans only) through `POST /api/custody/assertion`; no new authorization. The claimed time, source clock, time zone and offset uncertainty are free text copied exactly as the source shows them, not a date picker: a date input would parse and convert the time, which is the error this case is about. Sources must be exact registered versions (1 to 10). The timeline now lists each claim's sources.
- **Vanilla JS and CSS, no framework.** Matches the challenge page, keeps the CSP simple and adds no dependency.

## Verification (November 18)

- `npm test`: 371/371, including 6 `CaseReadService` tests, 9 workflow API tests (session token, identity, every area, refusals for role, self-approval, outsider, changed payload, reused approval, guilt conclusion) and 2 server tests (wrong Host 421, other Origin 403, wrong content type 415, oversized body 413, bad JSON 400, wrong token 403).
- Browser, run by hand: transfer as investigator (#13), the same as auditor refused `DENIED_ROLE`, scripted pass, promote as investigator (#14), request, approval refused for the requester, approved by a supervisor, export VERIFIED and FRESH, correction as auditor (#15) with #13 unchanged and the chain intact, outsider sees only `DENIED_NOT_MEMBER`. Dark, light and 375 px widths; no horizontal page scroll; no script errors.
- Browser, automated (added later on November 18, T18): `npm run test:e2e`, Playwright 1.64.1 on Chromium, 7 tests in `app/e2e/workspace.spec.ts`. It repeats the walkthrough above, plus: outsider refusal on every tab, every version's reader text equal to the API's text, hostile markup typed into a transfer reason shown as inert text, keyboard tab navigation, no sideways scroll at 375 px, and the challenge page at 28 of 28. Any script error or CSP violation fails a test. Mutation-checked: an inline script in the page fails all 7; rendering timeline entries with `innerHTML` fails the hostile-text test (and CSP separately blocked the injected handler).
- Dismissal (T18): 4 core tests (refusals for agent, outsider, missing, blank, oversized and extra-field requests; dismissal kept, audited, ledger unchanged, not promotable, first dismissal stands; racing a dismissal against promotions, 5 rounds; a deterministic test where a promotion lands between the dismissal's read and write), 1 API test, 1 browser test. Mutation-checked: removing the draft-status check fails the first test; a retry-on-conflict that skips the status recheck fails the deterministic test. Screens checked in light and dark.
- Historical claim form (T18): 1 API test (stored exactly as entered, including a 12-hour time with no zone; refusals for no source, unregistered version, unknown subject, blank field, extra field, outsider; refusals append nothing) and 1 browser test (no source is refused on the page; claim appended as #13 and shown verbatim with its source; chain intact). Checked in light, dark and 375 px; fixed checkboxes shrinking beside long labels (also in the export form) and placeholders that looked like entered values.
- Contrast: the light-mode gold used for corrections and focus rings was 2.84:1; changed to `#7f5a00` (5.4:1 on paper, 4.7:1 on panels).

## Not done

- The reader test cannot catch an `innerHTML` regression in the evidence reader itself, because no seeded evidence contains markup; the hostile-text test covers the same rendering rule on the timeline. Dark mode and contrast are still checked by hand.
- The workspace does not show the security audit log; the core has no audited read operation for it yet.
