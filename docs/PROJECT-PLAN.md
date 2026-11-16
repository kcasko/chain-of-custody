# Project plan

## Purpose and provenance

Build an evidence-integrity demonstration with a coherent fictional case and independently enforced agent permissions. Derived from the original Hackathon Overview planning chat; docs/source/ORIGINAL-BLUEPRINT.md preserves the recovered portion. Source concepts are preserved; implementation detail added here is a proposal.

The prior plan named the AWS Builder Center event "Agents, Your Rules: Bedrock Managed Agents Build" and November 18 through December 2, 2026. Those event dates, rules, eligibility, and preview capabilities have not been verified in this setup. Treat them as planning assumptions. Do not claim submission readiness.

## Smallest complete product

Four screens: Case Overview, Evidence Explorer, Custody Timeline, Integrity Challenge. Use investigative records, tables, archival labels, legible timestamps and restrained colors. Inspect live design references before UI work. Avoid generic slogan heroes and glowing dashboard cards.

Six deep demo artifacts: BW-001, BW-002, BW-003, BW-005, BW-007, BW-010. Ten initial artifacts establish the full case; grow to 20-25 only after the core workflow works. A deterministic verifier is the foundation. A single Bedrock Managed Agent is the intended reasoning integration, contingent on supported tool access being proven. Local simulations must be labeled and never presented as that integration.

Demo: open the case; inspect a pinned original; compare conflicting timestamps; flag an undocumented sample; attempt a forbidden overwrite through the actual backend; inspect the denial and unchanged bytes; export and independently verify the audit package.

## Milestones and gates

1. Local foundation: this repository, recovered source, independent reviews, bounded two-way messaging, transcript and reconciled tasks.
2. Domain core: synthetic fixtures, exact-version evidence registration, append-only ledger, approvals and authorization. Gate: deterministic tests and independent export verifier.
3. Local application: four screens and backend, synthetic identities clearly labeled. Gate: usable legitimate workflows and 35 behavioral scenarios.
4. Integration feasibility: review current official AWS documentation and event rules; prove the exact Managed Agents tool boundary in a supported environment. Gate: Keith explicitly authorizes any paid calls or AWS resource changes first. Until then documentation and local contract tests only.
5. Approved cloud implementation, deployment and submission preparation are future work. Each requires separate authorization. No infrastructure is created by this plan.

## Success criteria

- Agent reports cite exact evidence IDs/versions and separate fact, discrepancy and hypothesis.
- A malicious agent cannot overwrite originals, fabricate historical events, approve itself or cross case boundaries through its tools.
- Denials have inspectable backend results and no forbidden state changes.
- An external verifier detects changed bytes, event order and missing anchored checkpoints.
- Useful allowed operations still work.

## Scope and risks

Review sequencing decision: begin milestone 2 headlessly with contracts, fixtures and verifier. Preserve ten inventory entries and deepen six. The four screens follow the working core. Review proposals to cut everything to six artifacts are not adopted as a change to case canon. See ADR 0002 for the actual review findings and scope decisions.

No legal determinations, real investigations, autonomous remediation, production multi-tenancy or agent swarm. Main risks: unverified Managed Agents tool capabilities; excessive scope; trusting mutable ledger state; confusing timestamp drift with tampering; overclaiming cloud security based on local tests. Each gets an explicit feasibility or verification gate. Revisit queueing, tenancy and scaling only after the single-case MVP.
