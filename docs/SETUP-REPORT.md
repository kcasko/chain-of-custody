# Setup and verification report

Completed locally November 16, 2026.

Repository: D:/Repos/chain-of-custody, main branch, no remote. Preserved the recovered source plan and created project plan, case bible, architecture, security rules, test strategy, task board, shared agent instructions and architecture decisions.

## Executed verification

- `npm test` in this repository: 7 passed, 0 failed, including an actual installed Mozaik Core contract test without inference.
- `npm run typecheck` in D:/Repos/mozaik-learning: passed.
- `npm test` in D:/Repos/mozaik-learning: 84 passed, 0 failed. Its sources were not modified.
- `node scripts/collaborate.cjs`: successful real conversation using Claude Code 2.1.325 and Codex CLI 0.153.3 through local self-hosted Mozaik.
- `npm run verify:conversation`: PASS, 4 actual CLI replies, 4 received messages with unique Mozaik envelope IDs, matching frozen independent prompts, peer text in follow-up input, and matching run nonce.
- Successful artifacts: docs/reviews/2026-11-16T18-43-42-370Z-208e985c/.
- Dedicated 127.0.0.1:43127 listener count after shutdown: 0. Existing port-3000 services were not stopped or reconfigured.

## Resulting architecture decisions

ADR 0002 records the independent reviews and their disagreements. Major refinements: per-case ledger; distinct delegated agent identity; proposal-only restricted mutations; external checkpoint trust and explicit freshness limits; linked corrections; durable export recovery; honest audit-outage behavior; evaluator-truth isolation. Next proposed task is T00, verifier trust/canonicalization specification and synthetic tests.

## Boundaries and remaining work

The bridge runs bounded review conversations and task proposals. It is not an always-on inbox, desktop chat connection, GUI or autonomous implementation runner. The evidence application, fixtures, verifier and AWS integration are planned work. The reviews do not establish executed application security tests.

Two unsuccessful bridge attempts are retained as FAIL. The nested Mozaik tool-result envelope was corrected and checked against the installed library before the successful rerun. No partial attempt is counted as a successful conversation.

No deployment, publishing, remote repository creation, infrastructure provisioning, API-key model calls or paid-resource purchases occurred. CLI calls used existing subscription authentication and consume those plans' usage allowance. No billing settings were changed. Cloud capability/event verification remains a future documentation gate; paid integration requires separate authorization.

Original plan recovery is explicitly incomplete at 20,000 characters. Added design detail is distinguished from recovered narrative canon. No culprit, exact event timestamps or fabricated evidence hashes were invented.
