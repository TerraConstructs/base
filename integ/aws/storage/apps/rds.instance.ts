// Live test for the storage.rds DatabaseInstance L2 (RDS PR 2c): a real
// Postgres db.t3.micro deployed through the ported construct in an isolated
// VPC, with credentials auto-generated into a DatabaseSecret and attached via
// the TerraConstructs attach() protocol -- the deployed secret must end up
// carrying engine/host/port/dbname/dbInstanceIdentifier merged in by
// `DatabaseInstanceBase.asSecretAttachmentTarget()` (the shipped reference
// implementation replacing the TEST-ONLY adapters in integ/aws/encryption).
//
// NOTE: the auto-generated DatabaseSecret has a deterministic name and no
// recovery-window override -- a re-run within 30 days of destroy needs
// `aws secretsmanager delete-secret --force-delete-without-recovery` first.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "rds.instance";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g44444444-4444",
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

const instance = new aws.storage.rds.DatabaseInstance(stack, "Database", {
  engine: aws.storage.rds.DatabaseInstanceEngine.postgres({
    version: aws.storage.rds.PostgresEngineVersion.VER_16,
  }),
  instanceType: aws.compute.InstanceType.of(
    aws.compute.InstanceClass.BURSTABLE3,
    aws.compute.InstanceSize.MICRO,
  ),
  vpc,
  vpcSubnets: { subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED },
  credentials: aws.storage.rds.Credentials.fromGeneratedSecret("dbadmin"),
  databaseName: "appdb",
  allocatedStorage: 20,
  backupRetention: Duration.days(0),
  multiAz: false,
  // Terraform-native replacement for upstream removalPolicy (see the
  // TERRACONSTRUCTS DEVIATION on the props): allow clean destroy.
  skipFinalSnapshot: true,
});

new TerraformOutput(stack, "instance_identifier", {
  value: instance.instanceIdentifier,
  staticId: true,
});
new TerraformOutput(stack, "instance_endpoint_address", {
  value: instance.instanceEndpoint.hostname,
  staticId: true,
});
new TerraformOutput(stack, "secret_arn", {
  value: instance.secret!.secretArn,
  staticId: true,
});

app.synth();
