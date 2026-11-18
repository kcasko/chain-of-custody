# AWS adapters

`DynamoStore` (TransactionalStore) and `S3ObjectStore` (ObjectStore) for the domain core. Decisions and limits: [ADR 0007](../../docs/adr/0007-aws-storage-adapters.md).

## Tests

`npm test` runs them. The DynamoDB tests need DynamoDB Local and Java 17 or newer; without them they are reported as skipped, with the reason.

Install DynamoDB Local (free, official AWS download, about 50 MB) into the git-ignored `.local/` folder:

```bash
mkdir -p .local/dynamodb-local && cd .local/dynamodb-local && curl -sSfLO https://d1ni2b6xgvw0s0.cloudfront.net/v3.x/dynamodb_local_latest.zip && curl -sSfLO https://d1ni2b6xgvw0s0.cloudfront.net/v3.x/dynamodb_local_latest.zip.sha256 && sha256sum -c dynamodb_local_latest.zip.sha256 && unzip -q dynamodb_local_latest.zip
```

The tests find Java 17+ from `DYNAMODB_LOCAL_JAVA`, `JAVA_HOME` or `PATH`, start DynamoDB Local in memory on a random port, and stop it afterwards. To use an instance you started yourself, set `DYNAMODB_ENDPOINT`. The tests always use fake credentials, never your AWS profile.

The S3 tests need nothing extra: they run the real AWS SDK client with its network layer replaced by an in-memory versioned bucket. They prove the requests and error handling, not S3 itself.
