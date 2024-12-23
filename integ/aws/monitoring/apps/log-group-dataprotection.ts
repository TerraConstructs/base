// https://github.com/aws/aws-cdk/blob/81cde0e2e1f83f80273d14724d5518cc20dc5a80/packages/@aws-cdk-testing/framework-integ/test/aws-logs/test/integ.log-group.ts

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "log-group-dataprotection";

class LogGroupIntegStack extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    var audit = new aws.cloudwatch.LogGroup(this, "LogGroupLambdaAudit");

    var bucket = new aws.storage.Bucket(this, "audit-bucket-id", {
      registerOutputs: true,
      outputName: "bucket",
    });

    const dataProtectionPolicy = new aws.cloudwatch.DataProtectionPolicy({
      name: "policy-name",
      description: "policy description",
      identifiers: [
        aws.cloudwatch.DataIdentifier.DRIVERSLICENSE_US,
        new aws.cloudwatch.DataIdentifier("EmailAddress"),
        new aws.cloudwatch.CustomDataIdentifier(
          "EmployeeId",
          "EmployeeId-\\d{9}",
        ),
      ],
      logGroupAuditDestination: audit,
      s3BucketAuditDestination: bucket,
    });

    new aws.cloudwatch.LogGroup(this, "LogGroupLambda", {
      dataProtectionPolicy: dataProtectionPolicy,
      registerOutputs: true,
      outputName: "log_group",
    });
  }
}

const app = new App({
  outdir,
});

const stack = new LogGroupIntegStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
