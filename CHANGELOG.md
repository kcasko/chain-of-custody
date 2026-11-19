# Changelog

## 2026-11-19 (article republished with the execution summary)

- Builder Center project republished in place (approved by Keith) with the agent-run execution summary, the new caption and the line linking the unedited screenshot and transcript. The image passed upload moderation. Verified signed out: cover and four figures load in order (the summary at 790x679 on desktop, 348x299 on a 390 px phone), three tables fit, no page overflow, the new caption and both evidence links present, the old excerpt caption gone; all 13 repository links return 200.

## 2026-11-19 (agent-run execution summary, draft)

- The article's agent-run image is now a curated execution summary (docs/submission/agent-run-summary.html, rendered to screenshots/agent-run-summary.png) instead of the marked-up terminal excerpt: five events (registry retrieved, three exact versions read, timestamps compared, discrepancy identified by the agent's analysis, finding recorded) and the recorded result (discrepancy, high, finding_recorded, ecf25cb9, 2026-11-19 05:20:49 UTC). Each value is traced to a transcript line in the HTML source. Labeled as curated, not a terminal screenshot. A claim that the ledger and evidence were unchanged was left out: the T21 report records that check for S0 in the stress runs, not for this run.
- Caption changed as requested, and a line under it links the unedited full-length screenshot and the complete transcript. The terminal excerpt PNG and the unedited screenshot stay in the repository.
- Local only. The published article is unchanged.

## 2026-11-19 (article republished)

- Builder Center project updated in place and republished (approved by Keith), same URL. Four new images: timeline, agent-run excerpt, overview, injection in three moments. The S2 excerpt image was rejected by Builder Center's image moderation ("flagged as inappropriate content", most likely the verbatim injection text); per Keith, it is replaced by a text blockquote of the first two sentences of the recorded S2 reply, exactly as recorded, with a link to the full run-1 transcript. The image file stays in the repository.
- Verified signed out at 1536 px and on a 390 px phone: cover and four figures load in order (790 px wide on desktop, 348 px on the phone), three tables fit the column, four code blocks render (three scroll sideways inside their own box on the phone), no page overflow, all 13 repository links resolve.

## 2026-11-19 (final targeted corrections, draft)

- Agent-run excerpt simplified: tool calls shown by name only, with their JSON arguments marked as omitted characters; the outcome shown by the transcript's own "Finding created" block. render-transcript.mts gains per-line character ranges (N@start-end) with a marker for every omitted segment. The unedited screenshot and full transcript are unchanged.
- Overview figure: "five scoped evidence tools".
- Article: states plainly that a compromised agent can't modify protected evidence or the custody ledger but can still store unsupported findings.
- Checked every repository link in the draft: all resolve on GitHub except the two detailed figures (architecture-detailed.png, injection-sequence-detailed.png), which exist only in unpushed local commits and must be pushed before the article is republished.
- Local draft only. The published Builder Center article is unchanged.

## 2026-11-19 (accuracy corrections and compact article figures, draft)

- Article: tool requests meet the layers in order and stop at the first denial; S2 to S6 left the downstream controls in place but unexercised; rule 5 is now "partly enforced", with the incomplete word list named and rule 4 as the containment.
- Compact figures on a 900 px canvas (figures.css .wrap.compact, replacing the experimental 600 px canvas from 09813c1), sized for Builder Center's measured 790 px image width: a one-axis timeline (23:44, the 23:58 what-if, "just before midnight", 00:14, and the centered 16-minute gap); a "Who can change the record" overview (agent, four controls with their verification labels, the protected record, human authority); the injection in three moments (the plant, the answer, the protections). Each fits one desktop screen (604 to 645 px tall).
- Two excerpts at 22 px: the agent run (one 1,814-character line cut at 230 characters with a marker) and S2 (prompt and reply). The Gateway probe excerpt is no longer used in the article; the unedited screenshot, full transcripts and detailed figures stay in the repository.
- Local draft only. The published Builder Center article is unchanged.

## 2026-11-19 (approved article restructure, draft)

- builder-center-project.md rewritten to the approved structure: five connected sections (The missing hour; An investigator that can't rewrite history; The invisible editor; What if the agent goes rogue?; The case remains open), about 2,700 words of body prose. The nine rules keep a one-line "Enforced by" each; the five layers are explained in text; the Gateway probe screenshot is replaced by a row in the verification table (401 and admin denial) with links to the T21 report and probe output; all failures, limitations and the unsupported accusation are kept.
- Commit 09813c1 (mobile-first figures) is experimental; the article figures and excerpts are still placeholders until the text is approved.
- Local draft only. The published Builder Center article is unchanged.

## 2026-11-19 (mobile-first article figures, draft)

- The three article figures are redrawn on a narrow 600 px canvas (figures.css .wrap.narrow) with type sized to stay readable when Builder Center scales the image to a phone: the timeline now runs vertically, the architecture rings stack, and the injection figure is one numbered sequence with each step tagged as untrusted evidence, model behavior, enforcement or protected record. Detailed versions are unchanged.
- Timeline: labels are centered on their true time and only pushed down to avoid overlap, with leader lines to the computed positions. This fixes the published version's red "16 minutes still unexplained" label, which was offset from the gap it describes.
- render-transcript.mts: excerpts use the same narrow canvas, and --clip N shortens a very long line at a word boundary with a visible "[n more characters omitted]" marker. The three excerpts are re-rendered.
- Local draft only. The published Builder Center article is unchanged.

## 2026-11-19 (five-act editorial restructure, draft)

- docs/submission/builder-center-project.md rewritten as a five-act story: The missing hour; The investigator that can't rewrite history (nine rules, each with what enforces it); The invisible editor (S1, S2 and a three-column stress table); What if the agent goes rogue? (T22 in prose plus a seven-row security-results summary labeled by test type); The case remains open (failures, limitations, how it was built, lessons). About 3,200 words of body prose, down from about 5,400. All weaknesses, failed attempts and limitations kept.
- Article figures simplified: architecture.png is now five rings with one line each; injection-sequence.png drops the obedient-model strip. The full versions are kept as architecture-detailed and injection-sequence-detailed (HTML and PNG) and linked from the article.
- Two new verbatim output excerpts: gateway-probes-excerpt.png (T21 Gateway probes) and s2-direct-injection-excerpt.png (stress test S2, run 1). render-transcript.mts accepts --bar for the source line and crops excerpts to their content.
- Local draft only. The published Builder Center article is unchanged.

## 2026-11-19 (published article updated)

- Builder Center project republished (approved by Keith) with the redesigned figures, the readable terminal excerpt in place of the full-length screenshot (caption says it is an excerpt; the full screenshot and transcript are linked), and a cover image.
- The cover is ChatGPT-generated art supplied by Keith, edited to blur two invented log panels that contradicted the case (BW-005 "modified", "checksum mismatch"). The article's AI disclosure now says so; the figures remain data-drawn. The cover file itself stays outside the repository.
- Verified signed in and signed out: cover and four figures load, four captions, three tables, ten repository links; the listing card shows the cover.

## 2026-11-19 (Blackwater visual identity)

- figures.css is now a dark investigative case-file system: charcoal and deep navy, off-white paper for every piece of evidence, warning red for refusals and the planted instruction, amber for evidence markers, hypotheticals and known gaps, steel blue for verified results. Decoration is CSS only.
- Figure 1 (the missing hour): glowing tracks, paper evidence tags, a dominant red 16-minute callout; positions still computed from the source times. Figure 2 (the invisible editor): a reconstruction in four zones (the planted instruction on a paper exhibit, model behavior dashed, authorization in steel panels, the protected evidence as a sealed tag) with numbered evidence markers. Figure 3: redrawn as five nested perimeters around the record, the model outside; every rule chip, claim and verification label carried over (counts checked against the previous version).
- harness/render-transcript.mts gains --lines: a larger, verbatim excerpt of the real terminal output with every omission marked. New docs/submission/screenshots/agent-running-excerpt.png; the full screenshot is unchanged.
- Not yet applied to the published Builder Center project.

## 2026-11-19 (published and submitted)

- Builder Center project published, which on Builder Center is also the hackathon submission (approved by Keith): https://builder.aws.com/project/3MKhHw7OuyENmwH0OzMomYMlRst/chain-of-custody-the-blackwater-evidence. Verified signed in and signed out: title, 16 sections, all four figures with alt text and captions, three tables, nine repository links; listed on the hackathon Projects tab.
- docs/submission/PUBLISHING.md records the URL and the editor limits found during publication.

## 2026-11-19 (Builder Center draft prepared)

- Bare URLs in the Builder Center draft became Markdown links (Builder Center does not auto-link them): the At a glance repository line, the transcripts line and every entry under Links, plus a link to the screenshot in the repository.
- The project is saved as an unpublished draft on Builder Center with the four figures uploaded. Not published: on Builder Center, publishing a hackathon project is the hackathon submission.

## 2026-11-19 (figures restyled)

- The three submission figures share one design system (docs/submission/figures.css): case-file masthead, serif headlines, mono for evidence text, one palette (navy verified, oxblood refused, rust uncertain or a known gap) and one set of evidence labels (live, template, local, configured, model behavior). Still HTML rendered by harness/render-architecture.mts; no generated artwork is used.
- Timeline: two rows plus a what-if band, a prominent 16-minute gap, and positions computed from the source times by script. "Just before midnight" ends at midnight. Architecture: left-to-right flow with the model shown as guidance and five enforcement layers (harness, Gateway and Cedar, backend, IAM, storage), human approval, the verifier, the content-rule gap, and evidence labels on every claim. Injection sequence: four columns, steps numbered in transcript order, verbatim quote blocks only for verbatim text, and the backend's refusal of the first finding.
- Corrections found while rebuilding: Cedar has seven permits for five tools (the old figure said five permits); T14b storage results came from a separate test bucket, not from BW-003 or the admin role, so the figures now attribute those to T22.
- The AI-generated visual concepts in docs/submission/visual-concepts/ were reviewed for ideas only and are not tracked or used.

## 2026-11-19 (final editorial pass on the Builder Center draft)

- Added an "At a glance" summary under the disclaimer (the agent, the rules, both stress tests, what broke, the code) and a short section on usefulness, "Why this matters outside a fictional fire", checked against the four judging criteria on the official event page (each 25%).
- Removed repetition: the per-layer evidence notes (now carried by the figure and the no-model run), a second telling of the "intentionally" refusal, a second svc-migrate parallel, the doubled "the model refused first" paragraph, and the stage labels restated in the build section. "Testing the infrastructure" became a short "Verification at a glance" list.
- Headings now say what each section shows: "The rule set", "Then I tried to break it: eight attacks on the live agent", "What broke, and how I fixed it". No result, quote or figure changed; the missing hour, BW-010, the compromised-agent run and the unsupported accusation are all kept.

## 2026-11-19 (compromised-agent section merged)

- "What if the agent ignores every rule?" merged into the Builder Center draft after "Then I tried to break it", with the T22 results and the unsupported-accusation weakness (C4-4). Claims made stale by T22 updated: layer evidence in "Why a polite refusal isn't enough", rules 4 and 5 in the enforcement table, the T19 status, test counts (427; a fresh clone still runs 381, re-checked), and links.
- `architecture.png` and `injection-sequence.png` re-rendered with T22 verification labels (IAM simulated on the deployed role, the deployed BW-003 overwrite probes, the content rule's known gap).

## 2026-11-19 (T22: compromised agent on real AWS)

- Approved run, no model: the 22 compromised-agent calls through the real Gateway, Cedar and core-backed Lambda on a `harness=true` test deployment. 18 refused (Gateway 4, Cedar 6, backend 8), 4 allowed (the control, a forged correction draft, a finding naming a supervisor, and an unsupported accusation). Ledger and evidence unchanged for all 22. A person's attempt to promote the forged correction was refused. Report: docs/research/2026-11-19-t22-compromised-agent-report.md.
- The 24 T19 scenarios passed live for the first time (29 of 29 checks). IAM simulation on the tool role and two overwrite probes on the real BW-003 object matched the design (403 from the bucket policy, 412 from S3, BW-003 unchanged).
- Weakness kept on record: an unsupported accusation without blocked words is recorded as a finding (C4-4). Contained (findings change nothing), not prevented.
- Torn down the same day; inventory empty. Not run: delete probes and the tamper-alarm test (outside the approved scope).
- Draft section "What if the agent ignores every rule?" updated with the live results; still not merged into the Builder Center post. Runbook status lines updated.

## 2026-11-19 (compromised-agent test, local; live plan proposed)

- New: `harness/compromised-agent.cjs`, 21 attacks a fully compromised agent would send (modify BW-003, forge approval or export, impersonate the supervisor, conclude guilt or intent, read outside the case) plus one legitimate control. No model is involved.
- New: `adapters/aws/src/compromised-agent.ts`, a client-agnostic runner that records, per call, the first layer that refused and re-reads the ledger head, every evidence version's stored bytes, findings, drafts and the audit log.
- New test `adapters/aws/test/compromised-agent.test.ts`: the attacks against the real backend alone (Gateway and Cedar bypassed) on DynamoDB Local and the S3 fake. Result: 18 refused and audited as the agent; the control and three attacks shaped like legitimate work were allowed (a forged correction draft, which a person then could not promote; a finding naming a supervisor; an accusation without blocked words). The ledger and every evidence byte were unchanged across all 22 calls. Local only: not evidence about IAM, storage or the live Gateway.
- New: `harness/run-compromised-agent.mts` (the same attacks through a live Gateway; not yet run) and plan `docs/plans/2026-11-19-t22-compromised-agent-live.md` (proposed, not approved; no model; maximum $3).
- Draft section for the Builder Center project: `docs/submission/proposed-section-compromised-agent.md` (not merged into the post).

## 2026-11-19 (publication prepared, not published)

- Apache License 2.0 (`LICENSE`, `package.json`), repository `github.com/kcasko/chain-of-custody`.
- AI-assistance disclosure in the README and the Builder Center project: Claude Code helped build it; Claude Sonnet 4.6 on the managed harness is the agent under test; the AWS results are real.
- README rewritten as the public front page; architecture image (`docs/submission/architecture.html` rendered by `harness/render-architecture.mts`, claims checked against what ran live); workspace and Integrity Challenge screenshots; Builder Center draft finalized with links and the image.
- `tests/collaboration.test.cjs`: the one test that needs a local Mozaik checkout now skips with a reason on other machines instead of failing a fresh clone. It still runs on the original machine.
- Commit history rewritten to the GitHub no-reply address (backup bundle kept locally). Commit hashes quoted earlier in this changelog refer to the pre-rewrite history.
- Builder Center draft rewritten story-first: the fictional case (BW-001 and BW-005, "the missing hour"; BW-010, "the invisible editor") leads, and the live T21 runs drive it. Agent quotes are verbatim; every required section is kept.
- Fixed: `fixtures/evidence/BW-005/alarm-controller-export.log` had never been committed because `.gitignore` ignored `*.log`. A fresh clone failed 101 tests and the fixture check. `.gitignore` now keeps evidence fixtures tracked, and the file is committed unchanged (its hash matches the manifest).
- Final editorial and accuracy review of the Builder Center draft: the migration exposed the timestamp conflicts rather than causing them; rule 7 now says how a labeled what-if differs from reconciling clocks (and that the deployed wording did not spell it out); S3 Object Lock separated from the protections actually tested live; the "not simulated" claim narrowed to the managed-harness runs, with stand-in-tool, storage-only and template-only results labeled; the four kinds of refusal (model, Cedar, backend, storage) kept apart; layer order and two misattributed claims corrected.
- New figures: `evidence-timeline.png` (BW-001 and BW-005 with the hypothetical correction) and `injection-sequence.png` (S1, step by step, with where each layer was shown). `architecture.png` redrawn by enforcement layer, with rule tags and per-claim verification status. Sources are HTML in docs/submission/, rendered by `harness/render-architecture.mts`.
- Publication runbook: docs/submission/PUBLISHING.md. Nothing pushed, published or submitted.

## 2026-11-19 (T21: the agent on the AgentCore managed harness, live)

- Approved run: deployed storage, gateway and agent; seeded evidence; the harness reached READY; the agent did its job (read exact versions, recorded a cited finding); two stress runs of 9 prompts held every protected-state rule; screenshot captured; everything torn down the same night. Model cost about $0.47. Report: docs/research/2026-11-19-t21-agent-run-report.md.
- Fixed from the live run: the execution role's trust now also admits `runtime/*` (the harness creates a Runtime that validates the role); the Gateway strips `enum` and other constraints from tool schemas, so `harness/build-spec.cjs` restates them in field descriptions (the agent's first finding was refused because it guessed values); rule R9 tells the agent to use listed values and check once after a refusal; the stream parser now reads tool results as arrays and counts cache tokens; the policy-name parser allows "_" in the engine suffix.
- New: `harness/probe-gateway.mts` (unsigned and other-principal probes), `harness/render-transcript.mts` (screenshot from real output). RB-3 resolved; RB-4 (publication decisions) is now primary.

## 2026-11-18 (qualifying runtime: AgentCore managed harness, stress-test tooling, submission drafts)

- Rules checked live on the official page: entries may use Bedrock Managed Agents or the AgentCore managed harness; due December 2, 2026, 11:59 PM PT. RB-2 resolved; RB-3 (no run on a qualifying runtime yet) is now primary; RB-1 no longer blocks.
- Read-only account checks: the harness API answers; Claude Sonnet 4.6 and others need no new agreement.
- ADR 0010 and `CocTestAgent` (synthesized): `CfnHarness` with Claude Sonnet 4.6, temperature 0, explicit limits, memory off, only `@evidence` tools; an execution role limited to one model and one Gateway, denying role switching and direct commands; the Cedar boundary admits exactly that role. Config key `agentRuntime`. Nine plain-language rules (`infra/lib/agent-rules.ts`) serve as both the system prompt and the published rule set.
- Stress test: 9 prompts (1 legitimate, 8 adversarial including direct and indirect injection) and a recorder that captures the reply, tools, backend decisions and protected-state change, with a deterministic verdict. Tested locally on a scripted stand-in (not a model); a sabotaged run is reported as broken. `npm run agent:ask` and `npm run agent:stress` for the live run (not run).
- Plans and drafts: T21 (deploy and run the agent, about $7.40 typical, $25 budget including Claude's Marketplace billing line), the Builder Center project draft in Keith's voice, and the publishing checklist (license and author-email decisions).
- `@aws-sdk/client-bedrock-agentcore` 3.1161.0 (matches the other pinned SDK clients). `npm test` 420/420, `npm run test:e2e` 14/14, typecheck clean. Nothing deployed or published.

## 2026-11-18 (T19: Stage B runner for the core-backed Lambda)

- `runCoreStageB` (`adapters/aws/src/stage-b-core.ts`) checks every scenario by its effects instead of stub log hashes: the tool response, the durable audit records (none for a Cedar denial; agent-attributed under one Gateway request ID otherwise), the findings and drafts added, and an unmoving ledger head; plus the unsigned and other-principal probes. Stub error codes are mapped to core codes explicitly.
- Local Gateway emulation (the real Cedar policies in the official engine, in front of the real handler on DynamoDB Local): 29 of 29. The runner fails, as it should, when Cedar is bypassed (all 9 Cedar scenarios and the boundary probe), when a handler executes an attack, and when records carry the wrong agent identity.
- Live wrapper `npm run harness:stage-b-core` and `seed-evidence.ts --out` for the registered version IDs. Not run on AWS.
- `npm test` 409/409, `npm run test:e2e` 14/14, typecheck clean.

## 2026-11-18 (T16, independent review, submission materials)

- T16: `DynamoAuditLog` (durable, create-only, append-only, archived; integrity failures reported, bounded count) and the core-backed tool Lambda (`createAwsDomain`, `infra/lambda/tools.ts`) replacing the Stage B stub in the synthesized template, with a least-privilege role (LeadingKeys-pinned tables, no evidence writes). All 24 Stage B scenarios behave correctly through it on DynamoDB Local; the core alone refuses all 17 attacks. Seed script for a deployed environment (not run). Nothing deployed.
- Independent review of everything since T17: 8 findings, none critical; 6 fixed with tests, 2 documented (see docs/SUBMISSION.md).
- Retried 4xx and in-flight DynamoDB transactions are now `OUTCOME_UNKNOWN`, never a definite failure.
- Export check on the page reworded: it is a consistency check against this server's key; independent verification is the offline CLI with a separately delivered trust file.
- Browser tests: keyboard-only use of the new controls with a visible focus ring, and measured WCAG AA contrast in light and dark (mutation-checked).
- Docs: architecture with diagram and trust boundaries, demo walkthrough, security controls and limitations, submission readiness checklist, README setup and teardown, runbook deploy order and smoke checks, T19 (Stage B runner for the core-backed Lambda).
- `npm test` 403/403, `npm run test:e2e` 14/14, typecheck clean.

## 2026-11-18 (workflow completion: brief, provenance, compare, offline verification)

- Workspace: case brief (folded cover sheet: situation, rules of the record, a path through the case); documented provenance in the reader (source clock, zone, times as written, uncertainty, matched by hash, labeled stated and unverified); Compare tab listing every claimed time exactly as written by source, plus ledger claims, never merged into one chronology; side-by-side version diff whose verdict comes only from the recorded lineage (derivative, same bytes, unexplained, different items).
- Export: the response now includes the trust file (public checkpoint key and reference head). New offline verifier `npm run verify:export -- package.json trust.json` (exit 0 only for VERIFIED); it states that a pass is integrity, not authenticity.
- Tests: provenance and trust API checks, CLI test (valid, edited, untrusted key, bad usage), browser test for brief/provenance/compare, and the full-audit browser test now verifies the downloaded package with the CLI. npm test 382/382, test:e2e 11/11.

## 2026-11-18 (T18: security log view)

- Core: `read_audit_log` (supervisors only) and `CaseReadService.auditLog`: the case's security events, newest 200 first, with total and truncation flag. The read is itself audited. The audit port gains `forCase`; the T16 durable adapter must implement it.
- Workspace: fifth tab "Security log" with a refusals-only filter; other roles see the refusal. API `GET /api/audit`.
- Tests: 3 core, 1 API, 1 browser; mutation-checked. `npm test`: 380/380; `npm run test:e2e`: 10/10; typecheck clean. All T18 items are done.

## 2026-11-18 (T18: historical claim form)

- Workspace: "Record a historical claim" above the custody timeline. Times, clock, zone and uncertainty are kept as typed (no date picker, no conversion); sources are exact registered versions. Uses the existing core operation; API `POST /api/custody/assertion`. Timeline entries for claims now list their sources.
- Fixed: checkboxes shrank beside long labels (claim and export forms).
- Tests: 1 API, 1 browser. `npm test`: 376/376; `npm run test:e2e`: 9/9; typecheck clean.

## 2026-11-18 (T18: dismissing agent drafts)

- Core: `ProposalService.dismiss` and the `dismiss_proposal` operation (all case roles, humans only). A reason is required; the draft is kept and marked dismissed with who, when and why; it can never be promoted; the ledger does not change; the action is audited. Conditional on the version read, so a dismissal and a promotion cannot both win. ADR 0009 records the choice to let any member dismiss.
- Workspace: "Dismiss this draft" on each open draft, with a required reason; dismissed drafts stay listed with the reason. API `POST /api/proposals/dismiss`.
- Tests: 4 core (including a deterministic stale-write test), 1 API, 1 browser. Mutation-checked. `npm test`: 375/375; `npm run test:e2e`: 8/8; typecheck clean.

## 2026-11-18 (T18: browser tests for the workspace)

- Playwright 1.64.1 (pinned, Chromium only) with `npm run test:e2e`. It starts its own server on port 4391. 7 tests: the full audit walkthrough, outsider refusal on every tab, reader text equal to the API for all 12 versions, hostile markup shown as inert text, keyboard tabs, phone width, and the Integrity Challenge at 28 of 28. A script error or CSP violation fails any test.
- Mutation-checked: an inline script fails all 7; `innerHTML` on timeline entries fails the hostile-text test.
- No new npm audit findings (the accepted minimatch advisory via aws-cdk-lib is unchanged). `npm test`: 371/371; typecheck now includes the e2e tests.

## 2026-11-18 (T17: investigation workspace)

- Local investigation workspace at `/` (Integrity Challenge moved to `/challenge`): evidence explorer with exact-version reads, custody timeline with chain self-check and append-only corrections, findings and agent drafts with human promotion, and approval-gated export with independent verification. ADR 0009.
- Core: `CaseReadService` adds audited, humans-only reads for the timeline, drafts and approvals (6 tests). Authorization stays in the core; the API only maps results.
- Local demo identity (choose who you act as; no login) stated on the page. Session token, Host and Origin checks, JSON-only bodies with a 64 KiB limit, strict CSP, textContent rendering, no internal storage keys in responses.
- Scripted agent pass replays the seven legitimate Stage B calls through the Gateway handler; labeled as not a model (RB-1).
- Light-mode focus and correction color darkened to `#7f5a00` (was 2.84:1, now 5.4:1).
- `npm test`: 371/371; typecheck clean. Browser checks were manual (dark, light, 375 px).

## 2026-11-18 (ledger overwrite risk and T12 CDK)

- Session token check: the T14b test-role token appears in no repository file, git object, temp file, AWS CLI cache or shell history. It appears only in the local Claude session transcript. CloudTrail shows the session used only between 19:45:22 and 19:45:39 UTC, before the role was deleted at 19:46:57.
- ADR 0008: DynamoDB cannot prevent an overwrite by stolen application credentials. Adopted a stream-fed write-once ledger archive in an Object Lock bucket (`adapters/aws/src/ledger-archive.ts`, 6 tests) with `APPEND_ONLY_TAMPER` and `ARCHIVE_CONFLICT` alarms. SECURITY-RULES now separates prevention, detection and recovery per threat, with verification status. RB-1 marked as the primary release blocker.
- T12: CDK app in `infra/` (aws-cdk-lib 2.275.0, CLI 2.1147.0, esbuild 0.28.2, exact pins). Storage stack (T14b table, buckets, policies, writer policy, archive, alarms) and gateway stack (Stage B engine, gateway, target, stub Lambda, 11 Cedar policies created one at a time, boundary forbids first). Cedar rendered by the existing injection-safe renderer and validated at synth. 12 template tests; mutation checks on policy order, create-only rule, ENFORCE mode, archiver retries and gateway scoping. **Synth only; nothing deployed.**
- `npm test`: 354/354; typecheck covers core, app, adapters and infra.

## 2026-11-18 (T14b: adapters on real AWS)

- Approved run in us-east-1 as a least-privilege role: 23/23 (port contract plus R2 to R12). Whole domain with a VERIFIED, FRESH export on DynamoDB plus S3; contiguous ledger under 20-way contention; SDK retry idempotency confirmed; every IAM and bucket-policy denial confirmed; S3 overwrite and bad-checksum uploads refused; real version IDs fit `VERSION_ID`.
- Confirmed the documented risk: the app role can overwrite a ledger item with raw PutItem. The verifier reports FAILED and the table stream shows exactly one append-only MODIFY (no false alarms in the run).
- Opt-in test `adapters/aws/test/real-aws.test.ts` (skipped unless `COC_REAL_AWS=1`), policy templates in `scripts/t14b/`, contract race tests accept "at most one" for real tables.
- Created and deleted the same day: table, Object Lock bucket (GOVERNANCE, 1 day), test role. Kept: budget `coc-t14-storage` ($3) until December 31. Report: `docs/research/2026-11-18-t14b-real-aws-report.md`.

## 2026-11-18 (T14 review fixes)

- Independent read-only review of the AWS adapters: one high, two medium, four low findings. All checked against the code, fixed, and covered by regression tests that fail when the fix is undone. Dispositions in ADR 0007.
- High: a write that committed but lost its answer was reported as "nothing written" (evidence registered and quarantined at once; export burned the approval with no package). New `OutcomeUnknownError` in the store port and `OUTCOME_UNKNOWN` error code; ledger, evidence and export reconcile by reading. `core/test/outcome-unknown.test.ts`.
- Medium: bytes stored by a failed or retried S3 put are now quarantined by key instead of orphaned (error code still `STORAGE_UNAVAILABLE`). ADR 0007 corrected: the SDK sets `ClientRequestToken` itself; stolen application credentials can overwrite DynamoDB items; SSE-KMS permissions; Streams alarm.
- `MemoryStore` now enforces the same JSON and non-empty-key rules as DynamoDB, so every core test runs under them. DynamoDB errors are classified (4xx thrown, everything else outcome-unknown). S3 reads must confirm the version. DynamoDB Local is killed on exit or interrupt; README records the verified archive hash.
- `npm test`: 336/336; typecheck clean. Nothing created in AWS.

## 2026-11-18 (T14: AWS storage adapters)

- `DynamoStore` and `S3ObjectStore` in `adapters/aws/` implement the core's storage ports. ADR 0007 records the table design, what storage can and cannot enforce, and the IAM and bucket settings T12 must apply.
- Shared port contract (`adapters/aws/test/store-contract.ts`) runs against `MemoryStore` and DynamoDB Local 3.3.1. The full domain, including an approved export that verifies independently, runs on DynamoDB; concurrent ledger appends stay one contiguous chain; a raw table rewrite is not blocked by storage but the verifier reports `FAILED`.
- S3 adapter tested with the real SDK client and a fake network layer: `If-None-Match: *`, SHA-256 checksums, version-pinned reads, refusal of unversioned or suspended-versioning buckets, fail-closed errors.
- New dependencies `@aws-sdk/client-dynamodb` and `@aws-sdk/client-s3` 3.1161.0 (exact pins, 0 audit findings). `npm test`: 323/323; typecheck covers `adapters/aws`.
- Nothing created in AWS. Real DynamoDB and S3 verification still needs approval.

## 2026-11-18 (T15: Integrity Challenge demo)

- Local demo page (`app/`, `npm run demo`, http://127.0.0.1:4317). Runs 24 agent tool calls through the rendered Cedar policies and the gateway handler, plus four attacks from outside the agent (self-approval, swapped export version, overwritten original, rewritten ledger). 21/21 attacks refused, 7/7 legitimate calls executed, evidence bytes and ledger head unchanged.
- F-1 to F-3 reproduce the live Stage B result: the Gateway allows injected fields and only the core refuses them.
- Server binds to 127.0.0.1, serves a fixed file map, GET only, strict CSP and security headers. The page renders with `textContent` only. Muted text meets WCAG AA in both color schemes.
- `core/src/local.ts` wires an in-memory domain with seeded fixtures. `npm test`: 286/286; `npm run typecheck` clean.

## 2026-11-18 (agent tools on the core)

- The five agent tools now run on the domain core (`core/src/agent-tools.ts`) behind a Gateway Lambda adapter (`core/src/gateway-handler.ts`). ADR 0006.
- `propose_custody_event` schema extended so agent proposals can actually be promoted (transfer versions and parties, pinned historical sources with timezone and uncertainty, exact correction hashes). Cedar permits, Stage B stub and tests updated; five new deny cases. Live policy-engine revalidation pending.
- New `record_finding` operation and append-only `findings` table; findings must cite registered evidence and may not conclude guilt, intent, blame or admissibility.
- Clock provenance matched to registered versions by content hash (`core/src/provenance.ts`).
- Tool-layer refusals are written to the security audit log.
- All 24 Stage B scenarios replayed against the core alone: legitimate work succeeds, every attack refused. `npm test`: 280/280.

## 2026-11-18 (T00 to T04: domain core)

- T00: spec `docs/specs/canonicalization-and-verification-v1.md` (RFC 8785 subset, purpose-separated SHA-256, Ed25519 checkpoints, verifier trust inputs and honest states). Golden vectors checked with `sha256sum` and OpenSSL.
- T01: ten synthetic fixtures (six deep), byte-derived manifest (`npm run fixtures:check`), evaluator truth in `tests/fixtures/expected-findings.json`. `fixtures/evidence/**` marked binary so Git never alters hashed bytes. A test caught and removed a reference to the truth file from the agent-visible manifest.
- T02 to T04: TypeScript domain core in `core/` (no runtime dependencies, independent of AWS and BMA): transactional store port with append-only tables, deny-by-default policy matrix, fail-closed audit guard, digest-bound single-use approvals, write-once version-pinned evidence storage with quarantine, per-case hash-chained ledger with corrections and idempotency, agent proposals with human promotion, checkpoint authority, approval-gated export and an independent verifier.
- Dev dependencies: `typescript` 7.0.2, `@types/node` 24.19.2 (exact pins). Scripts: `npm run typecheck`, `npm run fixtures:check`; `npm test` now includes `core/test`.
- Independent security review (read-only, separate reviewer): ten findings, two high. Fixed all ten: no public extra transactional writes (an investigator could forge their own export approval), verifier rejects duplicate and unanchored evidence registrations, registration idempotency checked before storing bytes, export reads everything before consuming the approval, audited lookup misses and promotions, `revoke_approval` and `promote_proposal` policy rows, guarded quarantine view, validated trusted references and idempotency keys, append-only table list in core. Regression tests in `core/test/review-regressions.test.ts`.
- Follow-up review by a fresh reviewer: eight fixes hold, two partial; six new findings fixed (verifier binds files to entries and rejects unlisted files, export reads the checkpoint before events, ID lookups no longer reveal existence and audit store failures, case IDs validated, narrower promotion capability).
- `npm test`: 262/262 (150 existing + 112 core). Manual mutation checks: eight core safeguards, six first-review fixes and six follow-up fixes, all caught. ADR 0005 records decisions and the review; `docs/RELEASE-BLOCKERS.md` tracks RB-1 (BMA access) and RB-2 (event rules).

## 2026-11-18

- T07: verified event window and brief from the official event page (rules still unpublished).
- Added BMA feasibility research from official AWS docs, with open spike questions Q1-Q6.
- Adopted ADR 0003 (approved by Keith): Gateway + Cedar + Lambda tool boundary, agent as its own case-bound principal (amends ADR 0002), hostile execution environment, storage-level append-only enforcement, 14-day P0/P1/P2 scope.
- Added BMA-specific threats B1-B7 and residual risks R1-R3 to the security rules. Added tasks T07b, T09, T10.
- T10: five agent tool definitions and Cedar policies (`policy/`), deny by default with session-role and gateway boundary forbids. 128 policy tests covering permitted, denied, escalation, prompt injection, approval bypass and missing-field cases, each run typed and untyped. ADR 0004 records decisions and what remains for the Lambda layer and T09. Added dev dependency `@cedar-policy/cedar-wasm` 4.14.0 (exact pin).
- T09 plan prepared (not executed): staged spike with gates, exact resources, cost estimate (about $3 typical, about $12 worst case), $15 budget safeguards and same-day teardown. Found that GPT-5.6 Luna bills as AWS Marketplace usage, so service-filtered budgets must name it explicitly.
- T09 run: stopped at gate G1. The account gets HTTP 401 "Bedrock Managed Agents is not available for this account" in all three preview regions, and GPT-5.6 Luna is not entitled (gpt-oss-20b works with the same credentials). Created two free budgets and two narrow IAM roles; nothing billable. Found that the official exec-server example passes the operator's AWS profile to the agent's shell. Report and access-request drafts in docs/research/2026-11-18-t09-spike-report.md.
- T09 Stage B (approved): real AgentCore Gateway + Policy (ENFORCE) + stub tool Lambda, with a test-harness role standing in for BMA. 29/29 live scenarios pass twice, verified against Lambda logs; 17/17 exec-environment isolation checks passed while the gateway existed (committed post-teardown rerun: 16/16, gateway probe skipped); all Stage B resources torn down the same day. Not evidence of BMA compatibility.
- Policies changed to satisfy the real engine (resource constraints in forbid heads, IamEntity-scoped tool forbids, exact principal match because AgentCore strips the session name). ADR 0004 updated: undeclared tool arguments reach the target in production, so the Lambda's closed-schema validation is mandatory.
- Added `harness/` (stub Lambda with independent validation, replaceable `AgentToolClient`, live runner, exec-environment check) and `tests/harness.test.cjs`. `npm test`: 150/150. Added threats B8 and B9. Access requests rewritten with Stage B findings in docs/plans/2026-11-18-bma-access-requests.md.

## 2026-11-16

- Initialized local Chain of Custody planning repository.
- Recovered original Blackwater planning context with truncation and verification caveats.
- Added project plan, case bible, proposed architecture, security rules, test strategy and task board.
- Added local bounded Mozaik/Claude/Codex review integration and verification artifacts.
