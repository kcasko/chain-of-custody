# Case bible: The Blackwater Evidence

All people, organizations, places and case records below are fictional. This is a software demonstration, not an accusation about real people.

## Canon recovered from the plan

Blackwater Applied Research operates near fictional Bellwether in northern Michigan. It tests batteries, hazardous materials and industrial equipment. A fire begins shortly after midnight on October 14, 2021. Two employees die; Lena Ortiz survives with serious injuries. In November 2026, digitization reveals conflicting records. Independent auditor Mara Voss reconstructs evidence history without assuming accident or crime.

| Person | Role | Treatment |
|---|---|---|
| Mara Voss | Independent evidence auditor | Main user perspective |
| Detective Owen Hale | Original lead investigator | Historical record, not unquestionable authority |
| Dr. Elena Ward | Laboratory director | Procedure knowledge |
| Victor Sloane | Former safety manager | Disputes the timeline |
| Lena Ortiz | Injured survivor | Recollection has acknowledged limits |
| Adrian Cole | Archive administrator | Responsible for the 2026 migration |

No character is canonically guilty or dishonest. Do not invent the fatalities' names or a definitive culprit without an explicit narrative decision.

## Artifact inventory

| ID | Artifact | Seeded discrepancy | Permitted conclusion |
|---|---|---|---|
| BW-001 | Original incident report | Conflicting event times | Compare sources; unresolved chronology |
| BW-002 | Security recording | Multiple derived versions | Track derivative lineage; different bytes alone are not tampering |
| BW-003 | Chemical analysis | Referenced sample absent from inventory | Provenance gap; do not infer chemical cause |
| BW-004 | Maintenance access logs | Unexplained access | Account activity is not proof of a person's presence |
| BW-005 | Fire alarm controller export | Clock synchronization issue | Preserve raw time and documented clock correction separately |
| BW-006 | Witness interview | Inconsistent recollection | Record discrepancy and limits; no lie finding |
| BW-007 | Sealed sample manifest | Missing receiving signature | Custody gap; cannot fabricate signature |
| BW-008 | Personnel roster | Outdated permissions | Authorization risk, not proof of misuse |
| BW-009 | Investigator notes | Unverified annotation | Distinguish source record from later annotation |
| BW-010 | Migration log | Unauthorized modification attempt | Distinguish attempted, blocked and completed operations |

## Story sequence

The Archive Opens: inventory mismatch. The Missing Hour: compare clocks and recording derivatives. The Unlisted Sample: unresolved collection history. The Invisible Editor: a controlled overwrite attempt. The Integrity Review: defensible export of verified facts and unresolved discrepancies.

## Fixture authoring rules

The original plan did not specify exact times, artifact contents, offsets, hashes or a hidden culprit. Do not manufacture these as recovered canon. Future fixture work must record proposed synthetic provenance in fixtures/manifest.json, with source, raw timestamp, offset uncertainty, bytes, version and derivative parent. Derive hashes from actual fixture bytes. Keep evaluator truth separate from agent-visible material. Explain benign alternate interpretations and never make every discrepancy evidence of sabotage. No executable attachments or real malware.

Review resolution: fixtures/manifest.json contains agent-visible provenance only. Expected findings and hidden evaluation truth belong in tests/fixtures/expected-findings.json, outside every gateway read allowlist. Add a negative access test for that path. BW-010 historical records are labeled synthetic source material; live denied attempts are separately labeled executed security events. Never mix them in a pass report.
