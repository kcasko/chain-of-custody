// CDK app. Synth only needs an account ID (context or CDK_DEFAULT_ACCOUNT);
// it never calls AWS. Deploying is a separate, approved step (docs/runbooks/infra.md).

import * as cdk from 'aws-cdk-lib';
import { readConfig } from '../lib/config.ts';
import { CocGatewayStack } from '../lib/gateway-stack.ts';
import { CocStorageStack } from '../lib/storage-stack.ts';

export function buildApp(app = new cdk.App()) {
  const cfg = readConfig(app);
  const env = { account: cfg.account, region: cfg.region };
  const stack = cfg.stage === 'test' ? 'CocTest' : 'Coc';
  const storage = new CocStorageStack(app, `${stack}Storage`, cfg, { env, terminationProtection: cfg.stage === 'prod' });
  const gateway = new CocGatewayStack(app, `${stack}Gateway`, cfg, { env, terminationProtection: cfg.stage === 'prod' });
  for (const s of [storage, gateway]) {
    cdk.Tags.of(s).add('Project', 'chain-of-custody');
    cdk.Tags.of(s).add('Stage', cfg.stage);
    cdk.Tags.of(s).add('ManagedBy', 'cdk');
  }
  return { app, cfg, storage, gateway };
}

if (import.meta.main) buildApp().app.synth();
