# T14b inputs

Templates for the approved T14b run (plan: `docs/plans/2026-11-18-t14-real-aws-adapter-run.md`). `${ACCOUNT_ID}`, `${ADMIN_ROLE_ARN}`, `${ROLE_ARN}` and `${BUCKET}` are filled in at run time and never committed. The table definition is `tableDefinition()` in `adapters/aws/src/dynamo-store.ts`, plus Streams (NEW_AND_OLD_IMAGES) and tags.
