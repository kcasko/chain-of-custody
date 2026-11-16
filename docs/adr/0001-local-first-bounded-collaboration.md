# ADR 0001: Local-first foundation and bounded peer review

Status: adopted for repository setup, November 16, 2026.

Reuse installed Mozaik Network and Mozaik Core rather than create another messaging service. A repository-owned runner starts a dedicated loopback server, uses real Mozaik WebSocket envelopes and token-authenticated peers, and dispatches bounded Mozaik Core tool loops to installed CLI adapters. Existing subscription auth only; no API-key or cloud-metering fallback. Existing Mozaik/Ollama services and global CLI settings stay unchanged.

Each CLI independently reviews the same frozen documents. Only then are reviews sent over Mozaik to the other peer for responses. CLI output is conversation data; it cannot execute commands or grant implementation authority. Save prompts, replies, delivery metadata and final pass/fail state. Four CLI turns are enough for the initial two-way review; never auto-loop indefinitely.

Trade-off: the harness is a supervised batch bridge, not an always-on interactive channel or GUI. Explicit runs make cost controls and termination inspectable. Local absolute dependency paths are checked and configurable; no installation occurs. Later implementation collaboration uses ticket ownership and isolated branches, with tests and separate review before merging.
