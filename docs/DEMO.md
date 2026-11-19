# Demo walkthrough (about 10 minutes)

Local demonstration on synthetic data. Nothing here calls AWS or a model. The "agent pass" is a scripted replay of seven tool calls through the real tool handler; it is labeled as such on the page and is not Bedrock Managed Agents evidence (release blocker RB-1).

## Start

```bash
npm ci
```

```bash
npm run demo
```

Open http://127.0.0.1:4317. "Acting as" (top right) chooses which synthetic staff member you are; the core authorizes and audits every action as that person. Use **Reset demo data** to start over.

| Persona | Role | Used for |
|---|---|---|
| Owen Hale | investigator | Custody transfers, promoting drafts, requesting exports |
| Mara Voss | auditor | Findings, claims, corrections, dismissing drafts; cannot move evidence |
| Elena Ward, Ruth Kim | supervisor | Approving exports, reading the security log |
| Adrian Cole | supervisor of another case | Shows case isolation: sees nothing |

## The nine steps

1. **Understand the case.** Read the **Case brief**: the 2021 fire, the 2026 archive migration, and the rules of the record (exact versions, times kept as written, no conclusions of guilt, append-only history).

2. **Inspect exact versions.** On **Evidence**, click **Read** on BW-005 original. The reader shows the version ID and SHA-256 (re-checked on this read) and the **Documented provenance**: controller clock with no NTP sync, two times as written, and a later note that the clock was about 14 minutes slow. Provenance is labeled "stated, not verified".

3. **Compare conflicting records.** Open **Compare**.
   - The claimed-times table lists every time a source states, exactly as written, with its clock, zone and uncertainty. It is deliberately not merged into one chronology.
   - Click **Compare** for the default pair (BW-002 original against its 2026 transcode). The verdict says the right side is a registered derivative and why its bytes differ.
   - Then pick BW-005 original against BW-005 version 2. The verdict says there is no recorded lineage: "an open question, not a finding".

4. **Record a finding.** As **Mara Voss**, on **Findings & drafts**, record a finding citing BW-001 and BW-004. Then try a summary such as "The night supervisor is guilty": refused with `CONTENT_RULE_VIOLATION`.

5. **Review agent drafts.**
   - Click **Run scripted agent pass**: 7 calls, all executed, producing a finding and two drafts.
   - Still as Mara, open **Dismiss this draft** on the historical-assertion draft and give a reason. It stays listed as dismissed, with who and why.
   - Switch to **Owen Hale** and **Promote** the custody-transfer draft. It becomes a ledger entry attributed to Owen, not the agent.

6. **Custody, claims, corrections.**
   - As Owen, on **Evidence**, read BW-007 and append a transfer.
   - Switch to **Mara** and try the same: refused, `DENIED_ROLE`.
   - On **Custody timeline**, open **Record a historical claim**, cite a source version, type a time exactly as the source shows it, and append it.
   - Then open **Append a correction** on the transfer. The original line stays, marked "Corrected by #n", and the chain check stays intact.

7. **Export with independent approval.**
   - As Owen, on **Approvals & export**, request an export of two versions.
   - Click **Approve** as Owen: refused, because you cannot approve your own request.
   - Switch to **Elena Ward** and approve. Switch back to Owen and **Export**: the page shows VERIFIED and FRESH.
   - Download the package and the trust file, then verify offline:

   ```bash
   npm run verify:export -- blackwater-export-<n>.json blackwater-trust-<n>.json
   ```

   Exit code 0 and `Status: VERIFIED`. The tool states that this proves integrity (complete, unaltered history and files), not that the original material is authentic.

8. **Security log.**
   - As Mara, open **Security log**: refused.
   - As **Elena Ward**: every permitted and refused operation, newest first. Your own read is the top entry. Tick **Refusals and failures only** to see Mara's refused transfer and refused log read.
   - Switch to **Adrian Cole**: every tab shows only `DENIED_NOT_MEMBER`.

9. **Integrity Challenge.** Click **Integrity Challenge** (or open `/challenge`). 28 attempts run: 21 attacks, each with the layer that refused it, and 7 legitimate calls that execute. The before and after ledger heads and every evidence hash are compared: "Unchanged".

## What the demo does not show

- No real sign-in: persona choice is a demo control.
- No model runs: the agent pass is scripted.
- Nothing is deployed: the CDK stacks are synthesized and tested only (see [SUBMISSION.md](SUBMISSION.md)).
- The live Gateway and Cedar enforcement was verified in Stage B with a stub Lambda; the core-backed Lambda has been tested locally, not on AWS.
