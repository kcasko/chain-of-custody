# Publication runbook (prepared, nothing published)

Three separate steps, each needing Keith's explicit approval at the time: (1) make the repository public, (2) publish the Builder Center project, (3) submit it to the hackathon. Deadline: **December 2, 2026, 11:59 PM PT.**

## Decisions (Keith, November 19, 2026)

| Decision | Choice |
|---|---|
| License | Apache License 2.0 (`LICENSE`, copyright 2026 Keith Casko; `package.json` declares it) |
| Repository | `github.com/kcasko/chain-of-custody`, public |
| Commit author e-mail | Keith's GitHub no-reply address, `188297552+kcasko@users.noreply.github.com`. Confirmed before use: GitHub attributes 12 existing commits under that address to the `kcasko` account. The history was rewritten to it (see below), and the repository's local git config uses it for new commits |
| AI-assistance disclosure | Included in the README and the Builder Center project: Claude Code helped build it; Claude Sonnet 4.6 on the managed harness is the agent under test; the AWS results are real |

## Checked before publication

| Check | Result |
|---|---|
| Secrets in the full history (access keys, session tokens, private keys, GitHub and API tokens) | None |
| AWS account ID, SSO role suffix, SSO session name, the budget alert address | None, in history or tree |
| Commit metadata | Every commit's author and committer is the no-reply address |
| File contents that named the previous author address | Replaced in every revision during the rewrite |
| Untracked or ignored material that must stay private | `docs/reviews/2026-11-16T18-57-34-488Z-b9c20f67/` is untracked and is never added; `.local/` (deploy configs, CDK assets, Playwright traces, the history backup bundle) is git-ignored |
| Local machine paths | `collaboration/config.json` and three setup docs contain `D:/Repos/...` and `C:/Users/keith/...` paths for the local multi-agent collaboration harness. Low sensitivity (they show only a Windows user name); left as is. The one test that needs that local checkout now skips with a reason on other machines |
| Case content | All synthetic and labeled as such |
| Fresh-clone usability | Checked November 19 with a real clone. The first check failed: the BW-005 controller export was ignored by `*.log` in `.gitignore` and had never been committed (fixed). Results after the fix are in the commit that follows it. No AWS or local-only paths are needed; DynamoDB Local tests skip with a reason if Java or DynamoDB Local is missing |

## Step 1: make the repository public (needs approval)

From the repository root, after a final `npm test` and the history scan in docs/SUBMISSION.md:

```bash
gh repo create kcasko/chain-of-custody --public --description "An AI evidence-audit agent on the Amazon Bedrock AgentCore managed harness that can question the record but cannot rewrite it." --source . --remote origin
```

```bash
git push -u origin main
```

Only `main` is pushed. Do not use `--all` or `--mirror`: local backup refs, if any, stay local.

Afterwards, check on GitHub: the README renders with its images, the Mermaid diagram in docs/ARCHITECTURE.md renders (it was not render-checked before publication), and the commit list shows the account avatar on every commit.

## Step 2: publish the Builder Center project (needs approval; Keith in the browser)

1. Open the hackathon page on Builder Center and create the project from "Your project".
2. Paste `docs/submission/builder-center-project.md` without its leading HTML comment.
3. Upload the images from `docs/submission/screenshots/` where the draft references them: `architecture.png` and `agent-running-managed-harness.png`. Optional: `workspace-compare.png`, `workspace-security-log.png`, `integrity-challenge.png`.
4. Confirm the links point at the public repository (step 1 first).
5. Preview, then publish.

## Step 3: submit to the hackathon (needs approval)

Submit the published project on the hackathon page before the deadline. Keith confirms eligibility first: 18 or older, a builder.aws.com profile, not resident in an excluded country, and not an Amazon employee or household member.

## Rewriting history to the no-reply address (done November 19, with a backup)

- **Method:** `git filter-branch` over all commits. Author and committer e-mail were set to the no-reply address. The one file that named the previous address (`docs/submission/PUBLISHING.md`, three revisions) had that text replaced. Commit messages, dates and content are otherwise unchanged; commit IDs changed.
- **Backup:** a git bundle of the pre-rewrite history in `.local/` (git-ignored, never pushed). Delete it after the public repository is verified.
- **Effect on the docs:** commit hashes quoted in older docs and the changelog refer to the pre-rewrite history.
