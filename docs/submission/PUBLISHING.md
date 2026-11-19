# Publishing checklist (prepared, nothing published)

The rules require a public code repository under an OSI-approved license (or a public demo), a written project on AWS Builder Center, and at least one screenshot of the agent running. Nothing below has been done. Each step needs Keith's explicit approval.

## Checked already (November 18, 2026)

| Check | Result |
|---|---|
| Secrets in the full git history (all 25 commits): access-key and session-token patterns | None |
| AWS account IDs in history | None. The only 12-digit numbers are test placeholders (`111111111111`, `000000000000`, `999988887777`, AWS's documented example `111122223333`) and sequence-padded test keys |
| The budget alert e-mail address | Not in the repository or its history |
| Untracked material that must stay private | `docs/reviews/2026-11-16T18-57-34-488Z-b9c20f67/` is untracked and stays out; `.local/` (deploy config, CDK assets, Playwright traces) is git-ignored |
| Case content | All synthetic, labeled as such in every fixture and on every page |
| Third-party content | No copied text, trademarks or media beyond AWS service names used descriptively |

## Decisions for Keith

1. **License.** Both are OSI-approved:
   - **Apache-2.0 (recommended):** includes an explicit patent grant and is common for AWS-adjacent code;
   - **MIT:** shorter, with no patent language.

   The copyright line would read "Copyright 2026 Keith Casko".
2. **Commit author e-mail.** All 25 commits carry `the previous author address`, and a public repository exposes it.
   - **Keep it:** nothing to do.
   - **Replace it with a GitHub no-reply address:** this rewrites history on a fresh branch before the first push. It's destructive to commit IDs, so it needs your explicit go-ahead, and it changes every commit hash cited in the docs.
3. **Repository host and name**, for example `github.com/<you>/chain-of-custody`, public.
4. **Builder Center write-up:** edit `docs/submission/builder-center-project.md` and decide the AI-assistance disclosure marked EDITOR.
5. **Which screenshot:** the terminal stream from `npm run agent:ask`, the harness in the AgentCore console, or both. Account IDs must be cropped or blurred.

## Steps after approval (in order)

1. Add `LICENSE` and a license line in the README.
2. If you chose it, rewrite the author e-mail on a new branch, then rerun the history scan.
3. Run T21 (the agent and the stress test). Fill the write-up's placeholders from the generated report only.
4. Re-run the secret and account-ID scan on the final tree and history.
5. Create the public repository and push. **Keith's approval for this exact step.**
6. Publish the Builder Center project with the repository link and screenshot. **Keith's approval.**
7. Submit it to the hackathon before December 2, 2026, 11:59 PM PT. **Keith's approval.**
