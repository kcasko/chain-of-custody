# Tool inspection

Date: November 16, 2026. No credentials copied into this report.

| Component | Observed | Use / constraint |
|---|---|---|
| D:/Repos/mozaik-learning | Existing synthetic-data experiments; not a Git working tree | Reuse installed Mozaik Core; preserve sources |
| Mozaik Core | @mozaik-ai/core 5.0.0 | createAgent/createLoop/setBreakpoint/advanceLoop; tool results serialize to strings |
| Existing validation | Typecheck passed; 84 tests passed | No source modifications |
| D:/Repos/mozaik-network | Existing self-hosted Network code and installed dependencies | Dedicated local server; no hosted account/key |
| Existing services | Loopback listeners on ::1:3000 and 127.0.0.1:3000 | Left running and unchanged |
| Claude Code | 2.1.325 at C:/Users/keith/.local/bin/claude.exe | claude.ai subscription auth; restricted print reviews |
| Codex CLI | 0.153.3 via existing npm installation | ChatGPT auth; ephemeral, read-only, user config ignored |

The original source plan was recovered from the existing Hackathon Overview chat. Its long blueprint is truncated at the chat reader's 20,000-character limit; the saved source explicitly says so. The case canon and architecture recovered within that limit are sufficient for this foundation. AWS preview capabilities and event claims remain unverified, rather than silently treating the earlier plan as current documentation.
