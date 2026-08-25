// Live test for the storage.elasticache ServerlessCache L2 (alpha port):
// mirrors upstream integ.serverless-cache.ts -- a real Valkey 8 serverless
// cache with an IamUser + UserGroup, KMS key, security group, backup settings
// and cache usage limits. Validates the full aws_elasticache_serverless_cache
// mapping plus user/user-group wiring against live AWS.
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/integ.serverless-cache.ts
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Size } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "elasticache.serverless-cache";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g00000000-0000",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const vpc = new aws.compute.Vpc(stack, "Vpc", {
  maxAzs: 2,
  natGateways: 0,
  subnetConfiguration: [
    {
      name: "isolated",
      subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED,
      cidrMask: 24,
    },
  ],
});

const key = new aws.encryption.Key(stack, "Key", {});
const securityGroup = new aws.compute.SecurityGroup(stack, "SecurityGroup", {
  vpc,
});

const user = new aws.storage.elasticache.IamUser(stack, "User", {
  userId: "cacheuser",
  accessControl: aws.storage.elasticache.AccessControl.fromAccessString(
    "on ~* +@all",
  ),
});
const userGroup = new aws.storage.elasticache.UserGroup(stack, "UserGroup", {
  users: [user],
  userGroupName: "usergroup",
});

const cache = new aws.storage.elasticache.ServerlessCache(stack, "Cache", {
  description: "Serverless cache",
  vpc,
  engine: aws.storage.elasticache.CacheEngine.VALKEY_8,
  serverlessCacheName: "serverlesscache",
  kmsKey: key,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  securityGroups: [securityGroup],
  userGroup,
  backup: {
    backupRetentionLimit: 2,
    backupNameBeforeDeletion: "last-snapshot-name",
  },
  cacheUsageLimits: {
    dataStorageMinimumSize: Size.gibibytes(1),
    dataStorageMaximumSize: Size.gibibytes(1),
    requestRateLimitMinimum: 1_000,
    requestRateLimitMaximum: 2_000,
  },
});

const clientSG = new aws.compute.SecurityGroup(stack, "ClientSG", { vpc });
clientSG.connections.allowToDefaultPort(cache);

new TerraformOutput(stack, "cache_name", {
  value: cache.serverlessCacheName,
  staticId: true,
});
new TerraformOutput(stack, "user_id", {
  value: user.userId,
  staticId: true,
});
new TerraformOutput(stack, "user_group_id", {
  value: userGroup.userGroupName,
  staticId: true,
});

app.synth();
