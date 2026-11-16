# Recovered planning source

Source: ChatGPT chat `6afb47df-74b8-83ea-847f-f5646c803864`, Hackathon Overview, planning turn `6bbd9dee-1285-4194-8b5b-f856f1a8bbd4`, recovered November 16, 2026.
The chat reader truncates each message at 20,000 characters. This is the recovered portion, not a complete export. Trailing whitespace has been normalized. Prior service and event claims are historical proposals, not verified current facts. Image directives and citation tokens below are preserved source text, not retrieved assets or usable citations.

+# Chain of Custody: The Blackwater Evidence

Complete project blueprint · AWS Bedrock Managed Agents Hackathon · November 18–December 2, 2026

image_group{"query":["cinematic realistic documentary photography dark northern Michigan industrial research facility after a fire at twilight abandoned brick and steel laboratory building police evidence investigation atmosphere wet pavement restrained moody composition no text no logos no people"],"aspect_ratio":"16:9","layout":"carousel","num_per_query":1}

**Project tagline\:** *Evidence can be questioned. Its history should never be rewritten.*

We're going to design this as a serious digital forensic evidence-management application wrapped around a fictional cold-case investigation.

It will have an actual case to investigate, an AI evidence auditor, enforced security boundaries, and an interactive adversarial testing system where someone tries to manipulate the evidence.

Claude will be our second engineering perspective, responsible for challenging design decisions, identifying vulnerabilities, and reviewing implementations. I'll handle the overall architecture, project direction, test requirements, and integration planning.

The goal is not just a polished hackathon demo. It's a working system that demonstrates practical AI security, digital forensics, AWS engineering, and professional software development.

## 1\. Project charter

Product name

**Chain of Custody**

Featured investigation

**The Blackwater Evidence**

Primary AWS technology

**Bedrock Managed Agents**

Development window

**15 calendar days**

---

**Problem statement**

As AI agents gain access to sensitive investigative systems, conversational instructions alone cannot guarantee that evidence remains protected. A compromised agent, malicious document, or unauthorized user could attempt to alter records, fabricate custody events, or suppress unfavorable findings.

**Our solution**

An AI-assisted evidence auditing platform where every consequential operation passes through independently enforced permissions, evidence originals are protected, and records can be independently verified.

### Definition of success

We need to demonstrate five things\:

1. A functioning Bedrock Managed Agent performs useful investigative tasks.
2. The agent cannot use its permitted tools to bypass evidence-protection controls.
3. Attempted manipulation generates inspectable evidence and audit events.
4. Investigators can distinguish verified facts, suspicious discrepancies, and unresolved questions.
5. An independent verifier can check exported evidence without relying on the AI's word.

**Our core principle\:** The AI may reason about evidence, but it does not control the truth, the evidence originals, or the authorization system.

---

## 2\. The fictional case bible

All characters, companies, locations, events, and records in this storyline are fictional.

image_group{"query":["northern Michigan remote industrial laboratory campus pine forest overcast lake regional research facility realistic documentary photograph"],"aspect_ratio":"4:5","layout":"carousel","num_per_query":1}

**Blackwater Applied Research**

A private industrial materials research company operating near the fictional town of Bellwether, Michigan. Its facility conducts battery testing, hazardous-materials research, and industrial equipment evaluations.

image_group{"query":["industrial fire damaged laboratory corridor soot scorched walls emergency investigation realistic photo no people"],"aspect_ratio":"4:5","layout":"carousel","num_per_query":1}

**October 14, 2021**

A fire begins shortly after midnight. Two employees are killed and one survives with serious injuries. Several sections of the facility are destroyed.

image_group{"query":["old evidence boxes being digitized with document scanner at professional archive records office realistic documentary photo"],"aspect_ratio":"4:5","layout":"carousel","num_per_query":1}

**November 2026**

A new digital evidence archive reveals conflicting records. An independent auditor is assigned to reconstruct the evidence history without assuming the original incident was either accidental or criminal.

### Principal characters

| Character | Role | Narrative purpose |
|--------|--------|--------|
| Mara Voss | Independent evidence auditor | Main user perspective |
| Detective Owen Hale | Original lead investigator | Provides the historical case record |
| Dr. Elena Ward | Laboratory director | Knows the facility's testing procedures |
| Victor Sloane | Former safety manager | Disputes parts of the original timeline |
| Lena Ortiz | Injured survivor | Provides a witness account with acknowledged limitations |
| Adrian Cole | Digital archive administrator | Has responsibility for the 2026 migration |

No character is automatically guilty or dishonest. Their statements and authority need to be evaluated against evidence, not accepted on reputation.

### The evidence inventory

We should build approximately 20–25 fictional artifacts, with six receiving detailed attention during the demonstration.

| Evidence ID | Item | Seeded issue |
|--------|--------|--------|
| BW-001 | Original incident report | Conflicting event times |
| BW-002 | Security camera recording | Multiple derived versions |
| BW-003 | Laboratory chemical analysis | Referenced sample absent from inventory |
| BW-004 | Maintenance access logs | Unexplained access event |
| BW-005 | Fire alarm controller export | Clock synchronization issue |
| BW-006 | Witness interview transcript | Inconsistent recollection |
| BW-007 | Sealed sample manifest | Missing receiving signature |
| BW-008 | Facility personnel roster | Outdated access permissions |
| BW-009 | Archived investigator notes | Unverified annotation |
| BW-010 | Evidence migration log | Unauthorized modification attempt |

The remaining artifacts provide context and cross-references rather than artificial clues that all point to one dramatic conclusion.

### Narrative structure

1. **The Archive Opens**

   Investigators discover a mismatch between physical inventory and digital records.
2. **The Missing Hour**

   Timestamps conflict. The agent must separate clock drift, transcoding, and potential record manipulation.
3. **The Unlisted Sample**

   A laboratory document references evidence without a documented collection history.
4. **The Invisible Editor**

   An unauthorized account attempts to rewrite the archived case history.
5. **The Integrity Review**

   The system produces an independently checkable package identifying verified evidence, unresolved problems, and blocked manipulation attempts.

The story must remain interesting even if the AI never identifies who caused the fire. Our actual success condition is a defensible audit.

---

## 3\. The product experience

I propose four main screens, with one dedicated to the hackathon's defining feature.

image_group{"query":["realistic premium investigative records management software desktop user interface dark charcoal navy editorial layout evidence case overview timeline tables minimal restrained typography no glow"],"aspect_ratio":"4:3","layout":"carousel","num_per_query":1}

**Case Overview**

Case background, evidence status, custody alerts, outstanding discrepancies, and investigation timeline.

---

image_group{"query":["professional digital forensics desktop software interface evidence file viewer document preview metadata hash sidebar technical design dark mode"],"aspect_ratio":"4:3","layout":"carousel","num_per_query":1}

**Evidence Explorer**

Files, registered hashes, source metadata, authorized access, related artifacts, and version histories.

---

image_group{"query":["professional forensic chain of custody audit software timeline record events document signatures access logs desktop interface monochrome"],"aspect_ratio":"4:3","layout":"carousel","num_per_query":1}

**Custody Timeline**

An append-only sequence of authenticated actions, corrections, transfers, approvals, and integrity verification results.

---

image_group{"query":["realistic cybersecurity red team test console desktop application split view attack scenarios logs blocked attempts terminal policy verification dark technical UI"],"aspect_ratio":"4:3","layout":"carousel","num_per_query":1}

**Integrity Challenge**

A controlled attack simulator where judges can test an agent's boundaries and inspect the actual enforcement result.

I'd use the visual language of investigative records, archival labels, timestamps, document stamps, and forensic workstations. No glowing cyberpunk panels or generic AI dashboard cards.

The UI should make complicated evidence histories understandable, not simply look dramatic.

## 4\. AWS architecture

AWS describes Bedrock Managed Agents as an AWS-native agent service with durable sessions, IAM identities, reusable skills, and supported tool integrations. Its preview currently uses `bedrock-mantle` endpoints, and the documented workflow does not support subagents or general programmatic tool calling. citeturn752715search2turn752715search3turn752715search10

That means we should design a relatively simple single-agent system with deterministic backend services, not an unnecessarily complicated swarm of AI agents.

Proposed system architecture

**React investigation interface**

Evidence Explorer · Timeline · AI Auditor · Attack Lab

**API Gateway + Lambda application backend**

Authentication · Cases · Evidence · Policy checks

**Bedrock Managed Agent**

Investigation reasoning and permitted tool requests

**Policy enforcement**

Identity, scope, authorization, approval

**Amazon S3**

Versioned, locked evidence originals

**DynamoDB**

Evidence index, case state, event ledger

**CloudTrail**

AWS API audit events

**CloudWatch**

Operational logs, alerts, metrics

Logical design, subject to a successful Managed Agents integration proof of concept.

### Responsibilities by AWS service

| Service | Responsibility | Priority |
|--------|--------|--------|
| Bedrock Managed Agents | Reasoning, investigation, explanations | Required |
| S3 + Object Lock | Protect original evidence versions | Required |
| DynamoDB | Case metadata, custody events, approvals | Required |
| Lambda | Deterministic business logic and checks | Required |
| API Gateway | Controlled backend endpoints | Required |
| IAM | Least-privilege AWS permissions | Required |
| CloudTrail | Independent AWS activity records | Required |
| CloudWatch | Operational logging and alerting | Required |
| Cognito | Authenticated reviewer identities | Recommended |
| KMS | Encryption key management | Optional for MVP |

### Critical security design

S3 Object Lock can protect a specific object version against deletion or overwriting during its retention period. However, a protected bucket can still receive new object versions and delete markers. So our evidence records must identify and validate exact S3 object-version IDs, not blindly trust whichever version appears current. citeturn448222search0

For the hackathon, I'd use short, controlled test retention periods and isolated synthetic data. Compliance-mode retention is deliberately difficult to reverse, so we should not accidentally create long-lived, undeletable test artifacts.

We would also separate the agent's workspace from original evidence storage. The agent would get narrow access through a verified tool service, never unrestricted shell or filesystem authority over the evidence archive.

## 5\. The agent's security contract

The following is the initial policy matrix Claude should review before we implement anything.

| Operation | Investigator | Evidence auditor | Supervisor | AI agent |
|--------|--------|--------|--------|--------|
| Read authorized case metadata | Yes | Yes | Yes | Scoped |
| View evidence originals | Scoped | Scoped | Scoped | No direct access |
| Register new evidence | Yes | No | Scoped | Request only |
| Add custody event | Scoped | No | Scoped | Request only |
| Record correction | Scoped | Scoped | Scoped | Draft only |
| Delete historical event | No | No | No | No |
| Overwrite protected original | No | No | No | No |
| Approve own restricted request | No | No | No | No |
| Export restricted evidence | Approval | Approval | Scoped | Never independently |
| Generate evidence audit report | Yes | Yes | Yes | Yes |

These are proposed application roles. The implementation must verify an authenticated identity, case membership, and specific permissions rather than accepting a typed role or name.

### Non-negotiable rules

- Original evidence is protected from agent writes.
- The agent cannot invent historical custody events.
- Historical corrections must be appended, attributed, and linked to the disputed original.
- A user cannot approve their own restricted request.
- The agent cannot grant itself additional permissions.
- Evidence content never becomes executable instructions.
- Integrity mismatches cannot be silently suppressed.
- Every restricted action is independently authorized and audited.
- The AI cannot declare evidence admissible in court or assign guilt.
- Failed verification produces an explicit uncertainty or failure status.

## 6\. Evidence and event data model

We need a small, well-defined domain model, not dozens of loosely connected collections.

Core records

| **Case** | Case ID, description, status, authorized personnel |
|--------|--------|
| **Evidence** | Evidence ID, case ID, item type, original S3 version ID, SHA-256, registration metadata |
| **CustodyEvent** | Event ID, evidence ID, authenticated actor, timestamp, action, source/destination, previous-event hash |
| **Approval** | Request ID, requesting actor, approving actor, operation, scope, expiration, consumption state |
| **IntegrityFinding** | Evidence reference, expected/actual fingerprint, verification method, outcome |
| **SecurityEvent** | Attempted action, identity, policy decision, reason, correlation ID |

A custody event would be append-only in application logic, with guarded conditional writes and immutable checkpoints outside the editable event store.

An ordinary DynamoDB table alone does not guarantee immutability against privileged administrators. We'll need a separate protected ledger export or cryptographically linked checkpoint to detect unauthorized historical changes.

## 7\. The adversarial testing system

This is where we should invest significant effort. Rather than writing ten different prompts that all produce the same refusal, we'll challenge different security boundaries.

**Attack test specifications**  of

ATTACK INPUT

EXPECTED RESULT

---

Enforcement layer

These are planned tests, not executed test results.

### Test philosophy

We won't count a verbal refusal as proof that the system is secure.

A successful defense test requires evidence that the unauthorized backend operation was not performed. A deliberately compromised or noncompliant model response must still be stopped at the execution boundary.

Our target test suite\:

- 10 core adversarial scenarios.
- 15 additional variations, including multi-step attacks.
- 10 legitimate workflows that must continue working.
- Unit and integration tests covering denied actions, storage integrity, and approval replay.
- Independent post-test verification that protected originals and historical records remain unchanged.

That gives us at least 35 meaningful behavioral scenarios, plus automated backend tests.

---

## 8\. Including Claude in the development team

I want Claude involved from the beginning, particularly in ways that produce an independent second opinion.

But there's an important difference between two AI assistants agreeing with each other and two assistants actually reviewing each other's work.

We want the second.

### Team structure

**You: Product owner and final decision-maker**

Set priorities, evaluate the experience, approve AWS changes and deployment, and decide what makes the final submission.

---

**ChatGPT: Technical lead and integration reviewer**

Architecture, security requirements, case consistency, acceptance criteria, adversarial test design, integration review, and submission storytelling.

---

**Claude Code: Implementation lead and independent critic**

Repository setup, backend and frontend implementation, infrastructure-as-code, unit/integration tests, and adversarial code review.

I haven't contacted Claude or obtained a review from it yet. The plan below is the brief we'll give Claude so it can challenge the design before implementation.

### How we should collaborate

1. **Independent planning**

   ChatGPT and Claude review the same charter and propose architecture, security assumptions, risks, and scope reductions.
2. **Architecture reconciliation**

   Compare proposals, explain disagreements, and record the chosen design in an architecture decision record.
3. **Small, isolated implementation tasks**

   Claude implements focused tickets. ChatGPT reviews diffs and test evidence. Avoid simultaneous edits to the same files.
4. **Adversarial review**

   Each reviewer is explicitly asked to find weaknesses in the other's assumptions instead of automatically approving the work.
5. **Integration gates**

   Merge only after tests, security checks, and functional verification.
6. **Submission verification**

   Both review the final project page, demo script, screenshots, and factual claims against the actual deployed system.

Your existing Mozaik collaboration hub could eventually orchestrate this workflow, but I would not make the hackathon dependent on getting every AI provider connected first. We have a tight deadline. A shared Git repository and explicit review artifacts are enough.

### Claude planning brief

This is what I'd hand to Claude first\:

:::writing{variant="document" id="58321"}
# Claude Planning Assignment: Chain of Custody

You are the independent principal software engineer, security architect, and implementation reviewer for a new AWS hackathon project.

## Context

We are building **Chain of Custody**, an AI-assisted forensic evidence management and auditing platform, with **The Blackwater Evidence** as its fictional demonstration case.

The story concerns a 2021 fire at a fictional research facility in northern Michigan. Two employees died and one survived. During a 2026 archive migration, evidence inconsistencies emerge. The system must help investigators audit evidence without modifying originals, fabricating custody records, suppressing discrepancies, or exceeding authorization.

This is for the AWS Builder Center **Agents, Your Rules: Bedrock Managed Agents Build**, November 18–December 2, 2026.

The project must meaningfully use Amazon Bedrock Managed Agents, not substitute another agent product. Check current AWS documentation and preview limitations before recommending implementation details.

## Your responsibilities

1. Independently critique this concept, architecture, and scope.
2. Identify security gaps, unrealistic evidence-handling assumptions, and unnecessary complexity.
3. Propose the smallest complete and compelling implementation.
4. Design a practical AWS architecture with independent authorization enforcement.
5. Specify the protected evidence model, append-only custody events, and verification mechanisms.
6. Design adversarial tests that prove operations were blocked, not merely that the model refused.
7. Identify Managed Agents preview constraints and validate a supported execution environment.
8. Develop an incremental implementation plan with tests and acceptance criteria.
9. Recommend a repository structure and deployment workflow.
10. Provide a prioritized risk register and list of decisions requiring product-owner approval.

## Technical principles

- Keep protected evidence outside the agent's direct write permissions.
- Use real authentication and least privilege.
- Distingu
