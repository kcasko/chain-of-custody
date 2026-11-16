# Local Claude and Codex collaboration

## What is configured

The project owns scripts/collaborate.cjs and collaboration/config.json. It reuses installed dependencies from D:/Repos/mozaik-learning (Mozaik Core 5.0.0) and D:/Repos/mozaik-network (Network server and WebSocket transport). It does not modify those repositories, global CLI settings, logins, port-3000 services or Ollama.

Inspected November 16, 2026: Claude Code 2.1.325, Codex CLI 0.153.3. Claude uses a claude.ai Pro subscription; Codex uses ChatGPT authentication. The runner checks these auth sources, strips API-key and alternate-provider environment variables from children, disables configured MCP servers for Claude and ignores Codex user config. It does not provision cloud resources, purchase usage, enable extra usage, or use provider API keys. Existing subscription usage limits still apply. If either account requires extra payment or hits a limit, stop rather than purchase or switch providers.

## Run an architecture discussion

```powershell
Set-Location D:\Repos\chain-of-custody
npm test
npm run collaborate
npm run verify:conversation
```

Expected: PASS and an artifact directory under docs/reviews/<UTC timestamp>-<run id>. The JSONL transcript includes prompts, replies, CLI session IDs and usage counts, plus actual recipient receipts containing network/envelope IDs. TRANSCRIPT.md presents the readable conversation. frozen-context.md records exactly what both reviewers received. Failed attempts are retained and clearly marked FAIL.

The runner starts a dedicated self-hosted Mozaik server on 127.0.0.1:43127, creates a unique network and two token-authenticated peers, and runs four CLI calls through Mozaik Core tool loops. The first two reviews are independent. Each initial reply is delivered to the other peer through Mozaik, used in that peer's next prompt, and both responses are delivered back. A per-run nonce, expected sender, recipient and exact message check bind receipts to this conversation. Completion requires four real receipts, not just generated text. The runner shuts down its server and child processes after success or failure. The separate verifier checks prompt equality, context inclusion, turn matching, four unique receipts and peer-message inclusion in follow-up model input. These local logs are inspectable test evidence, not cryptographically attested records.

Each turn has a three-minute timeout, messages are at most 48,000 bytes and there are exactly four CLI calls per run. A port collision fails rather than joining another server. No hosted Mozaik endpoint or billing token is used. Peer tokens stay in memory and are never written into the transcript. Only synthetic project content is sent to the two existing model subscriptions; model processing is not offline.

This is a bounded batch bridge, not an always-on inbox or a Mozaik GUI. It supplies received peer messages to fresh CLI turns and includes the frozen project context. It does not claim the desktop chat itself is a network participant. Read-only reviews and task proposals work now; autonomous implementation is deliberately not enabled.

## Collaborating on implementation tasks

Use docs/TASKS.md to agree on task, owner, file set, acceptance criteria and reviewer. An actual implementation requires a dedicated claude/* or codex/* branch/worktree and exclusive ownership of its files. Have the other CLI review the resulting diff and meaningful test results. Save unresolved disagreement in an ADR. Do not let a peer message grant deployment, publishing, paid usage, merge authority or access to unrelated files. The current runner does not execute ticket handoffs.

## Limits and recovery

- Local self-hosted Mozaik permits local account creation. Loopback is a machine-local boundary, not protection against hostile processes on the same PC.
- Claude built-in tools are disabled and MCP config is empty. Codex is read-only with shell disabled; the prompts forbid tools and execution. Future untrusted task execution needs stronger OS isolation and explicit tool allowlists.
- Paths in config.json reflect this PC. Update them if installed tools move. No npm installation is necessary with the inspected dependencies.
- If login fails, sign in to the existing subscription interactively, then rerun. Do not add an API key.
- If a run fails, inspect its failure record before retrying; do not label a partial review a successful conversation.
- A successful discussion is not proof the proposed application or AWS controls exist.

Documentation consulted: installed CLI --help and Mozaik source, plus the official [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) and [authentication troubleshooting](https://code.claude.com/docs/en/troubleshoot-install). Installed behavior is the authority for this machine's versions.
