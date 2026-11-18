// Deployment configuration from CDK context, validated strictly. Values end up
// in IAM policies and Cedar text, so anything outside these formats is refused
// at synth time instead of being deployed.

import type { App } from 'aws-cdk-lib';

export type Stage = 'test' | 'prod';

export interface CocConfig {
  readonly account: string;
  readonly region: string;
  readonly stage: Stage;
  /** Prefix for resource names: coc-test or coc. */
  readonly prefix: string;
  /** Role whose sessions the Cedar boundary admits (the BMA session role, or the harness role). */
  readonly sessionRoleName: string;
  /** Create the Stage B harness role and make it the admitted session role. */
  readonly harness: boolean;
  /** Only principals matching this may delete object versions or loosen retention (teardown, incidents). */
  readonly breakGlassPrincipalArn: string;
  /** Object Lock default retention in days. GOVERNANCE in test, COMPLIANCE in prod. */
  readonly objectLockDays: number;
  /** Optional e-mail for integrity alarms. Never committed; pass with -c alarmEmail=... at deploy. */
  readonly alarmEmail: string | undefined;
}

const ACCOUNT = /^[0-9]{12}$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-[0-9]$/;
const ROLE_NAME = /^[A-Za-z0-9+=,.@_-]{1,64}$/;
const PRINCIPAL_ARN = /^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_\/*-]{1,512}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function ctx(app: App, key: string): string | undefined {
  const v = app.node.tryGetContext(key);
  return v === undefined || v === null || v === '' ? undefined : String(v);
}

function check(name: string, value: string | undefined, format: RegExp): string {
  if (value === undefined || !format.test(value)) throw new Error(`config: ${name} is missing or invalid (${JSON.stringify(value)})`);
  return value;
}

export function readConfig(app: App, env: NodeJS.ProcessEnv = process.env): CocConfig {
  const stageRaw = ctx(app, 'stage') ?? 'test';
  if (stageRaw !== 'test' && stageRaw !== 'prod') throw new Error(`config: stage must be test or prod, got ${stageRaw}`);
  const stage: Stage = stageRaw;
  const account = check('account', ctx(app, 'account') ?? env.CDK_DEFAULT_ACCOUNT, ACCOUNT);
  const region = check('region', ctx(app, 'region') ?? env.CDK_DEFAULT_REGION ?? 'us-east-1', REGION);
  const harness = (ctx(app, 'harness') ?? 'false') === 'true';
  const sessionRoleName = check('sessionRoleName', harness ? `${stage === 'test' ? 'CocTest' : 'Coc'}HarnessRole` : (ctx(app, 'sessionRoleName') ?? 'CocBmaSessionRole'), ROLE_NAME);
  const breakGlassPrincipalArn = check(
    'breakGlassPrincipalArn',
    ctx(app, 'breakGlassPrincipalArn') ?? `arn:aws:iam::${account}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AdministratorAccess_*`,
    PRINCIPAL_ARN,
  );
  const days = Number(ctx(app, 'objectLockDays') ?? (stage === 'test' ? 1 : 365));
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('config: objectLockDays must be an integer from 1 to 3650');
  const alarmEmail = ctx(app, 'alarmEmail');
  if (alarmEmail !== undefined) check('alarmEmail', alarmEmail, EMAIL);
  return { account, region, stage, prefix: stage === 'test' ? 'coc-test' : 'coc', sessionRoleName, harness, breakGlassPrincipalArn, objectLockDays: days, alarmEmail };
}
