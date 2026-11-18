// Storage verified in T14b plus the ledger archive from ADR 0008.
//
// Object Lock buckets are always RETAINed: CloudFormation cannot delete
// locked versions. Test-stage teardown follows docs/runbooks/infra.md
// (governance bypass by the break-glass principal), exactly as in T14b.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { CocConfig } from './config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

// Actions that would destroy or loosen protected objects. Denied to every
// principal except the break-glass role, whatever their IAM policies say.
const DESTRUCTIVE_S3 = [
  's3:DeleteObject', 's3:DeleteObjectVersion', 's3:PutObjectRetention', 's3:PutObjectLegalHold',
  's3:BypassGovernanceRetention', 's3:PutBucketVersioning', 's3:PutBucketObjectLockConfiguration',
];

// The DynamoDB actions T14b proved sufficient for the adapter, and the ones it proved denied.
export const WRITER_TABLE_ALLOW = ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'];
export const WRITER_TABLE_DENY = ['dynamodb:DeleteItem', 'dynamodb:UpdateItem', 'dynamodb:BatchWriteItem', 'dynamodb:DeleteTable', 'dynamodb:UpdateTable', 'dynamodb:PartiQLUpdate', 'dynamodb:PartiQLDelete'];

export class CocStorageStack extends cdk.Stack {
  readonly table: dynamodb.Table;
  readonly evidenceBucket: s3.Bucket;
  readonly archiveBucket: s3.Bucket;
  readonly writerPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, cfg: CocConfig, props?: cdk.StackProps) {
    super(scope, id, props);
    const prod = cfg.stage === 'prod';
    const retention = prod ? s3.ObjectLockRetention.compliance(cdk.Duration.days(cfg.objectLockDays)) : s3.ObjectLockRetention.governance(cdk.Duration.days(cfg.objectLockDays));

    // Exactly tableDefinition() in adapters/aws/src/dynamo-store.ts, plus the stream for the archive.
    this.table = new dynamodb.Table(this, 'Ledger', {
      tableName: `${cfg.prefix}-ledger`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      deletionProtection: prod,
      removalPolicy: prod ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const lockedBucket = (logicalId: string, name: string) => new s3.Bucket(this, logicalId, {
      bucketName: `${cfg.prefix}-${name}-${cfg.account}-${cfg.region}`,
      objectLockEnabled: true,
      objectLockDefaultRetention: retention,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const breakGlassOnly = { ArnNotLike: { 'aws:PrincipalArn': cfg.breakGlassPrincipalArn } };
    const protect = (bucket: s3.Bucket) => {
      bucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'CreateOnlyWithIfNoneMatch', effect: iam.Effect.DENY, principals: [new iam.AnyPrincipal()],
        actions: ['s3:PutObject'], resources: [bucket.arnForObjects('*')],
        conditions: { Null: { 's3:if-none-match': 'true' } },
      }));
      bucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'NoDeleteOrLoosenExceptBreakGlass', effect: iam.Effect.DENY, principals: [new iam.AnyPrincipal()],
        actions: DESTRUCTIVE_S3, resources: [bucket.bucketArn, bucket.arnForObjects('*')], conditions: breakGlassOnly,
      }));
    };

    this.evidenceBucket = lockedBucket('Evidence', 'evidence');
    protect(this.evidenceBucket);

    this.archiveBucket = lockedBucket('Archive', 'ledger-archive');
    protect(this.archiveBucket);

    // The archiver: the only principal that can write the archive.
    const archiverLogs = new logs.LogGroup(this, 'ArchiverLogs', {
      retention: prod ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_DAY,
      removalPolicy: prod ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    const archiver = new nodejs.NodejsFunction(this, 'Archiver', {
      entry: path.join(repoRoot, 'infra', 'lambda', 'archive.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: archiverLogs,
      environment: { ARCHIVE_BUCKET: this.archiveBucket.bucketName },
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      // Bundle the pinned SDK instead of whatever the runtime ships.
      bundling: { format: nodejs.OutputFormat.ESM, target: 'node22', externalModules: [], minify: false, sourceMap: false, banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    });
    archiver.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject', 's3:GetObject'], resources: [this.archiveBucket.arnForObjects('*')] }));
    archiver.addEventSource(new DynamoEventSource(this.table, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 100,
      bisectBatchOnError: true,
      reportBatchItemFailures: true,
      retryAttempts: -1, // never drop a record; a stuck record shows up as iterator age
    }));
    this.archiveBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'OnlyTheArchiverWrites', effect: iam.Effect.DENY, principals: [new iam.AnyPrincipal()],
      actions: ['s3:PutObject'], resources: [this.archiveBucket.arnForObjects('*')],
      conditions: { ArnNotEquals: { 'aws:PrincipalArn': archiver.role!.roleArn } },
    }));

    // Detection: tamper and conflict alarms from the archiver's log, and a
    // stalled archiver before the 24-hour stream retention runs out.
    const topic = new sns.Topic(this, 'IntegrityAlarms', { displayName: 'Chain of Custody integrity alarms', enforceSSL: true });
    if (cfg.alarmEmail) topic.addSubscription(new subs.EmailSubscription(cfg.alarmEmail));
    const tamperMetric = new logs.MetricFilter(this, 'TamperFilter', {
      logGroup: archiverLogs,
      filterPattern: logs.FilterPattern.any(logs.FilterPattern.stringValue('$.alarm', '=', 'APPEND_ONLY_TAMPER'), logs.FilterPattern.stringValue('$.alarm', '=', 'ARCHIVE_CONFLICT')),
      metricNamespace: 'ChainOfCustody',
      metricName: `${cfg.prefix}-ledger-integrity-alarms`,
      metricValue: '1',
      defaultValue: 0,
    }).metric({ statistic: 'Sum', period: cdk.Duration.minutes(1) });
    const alarms = [
      new cloudwatch.Alarm(this, 'LedgerTamperAlarm', { metric: tamperMetric, threshold: 1, evaluationPeriods: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, alarmDescription: 'An append-only ledger item was modified or removed, or an archive key conflicted (ADR 0008).' }),
      new cloudwatch.Alarm(this, 'ArchiverStalledAlarm', { metric: archiver.metric('IteratorAge', { statistic: 'Maximum', period: cdk.Duration.minutes(5) }), threshold: 60 * 60 * 1000, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, alarmDescription: 'Archiver is more than 1 hour behind the stream (records expire after 24 hours).' }),
      new cloudwatch.Alarm(this, 'ArchiverErrorsAlarm', { metric: archiver.metricErrors({ period: cdk.Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING }),
    ];
    for (const a of alarms) a.addAlarmAction(new actions.SnsAction(topic));

    // The application's storage permissions, exactly as verified in T14b.
    // Attached by the tool Lambda role when the real handler is deployed.
    this.writerPolicy = new iam.ManagedPolicy(this, 'LedgerWriterPolicy', {
      managedPolicyName: `${cfg.prefix}-ledger-writer`,
      description: 'Chain of Custody application storage access (T14b-verified). No delete, update in place, or batch write.',
      statements: [
        new iam.PolicyStatement({ sid: 'TableReadAndConditionalWrites', actions: WRITER_TABLE_ALLOW, resources: [this.table.tableArn] }),
        new iam.PolicyStatement({ sid: 'NeverDeleteOrRewriteInPlace', effect: iam.Effect.DENY, actions: WRITER_TABLE_DENY, resources: [this.table.tableArn] }),
        new iam.PolicyStatement({ sid: 'EvidenceWriteOnceReadVersion', actions: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion'], resources: [this.evidenceBucket.arnForObjects('*')] }),
      ],
    });

    new cdk.CfnOutput(this, 'LedgerTableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'EvidenceBucketName', { value: this.evidenceBucket.bucketName });
    new cdk.CfnOutput(this, 'ArchiveBucketName', { value: this.archiveBucket.bucketName });
    new cdk.CfnOutput(this, 'WriterPolicyArn', { value: this.writerPolicy.managedPolicyArn });
  }
}
