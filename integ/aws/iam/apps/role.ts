// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-iam/test/integ.role.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "role";

const app = new App({
  outdir,
});
const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const role = new aws.iam.Role(stack, "TestRole", {
  assumedBy: new aws.iam.ServicePrincipal("sqs.amazonaws.com"),
  registerOutputs: true,
});

role.addToPolicy(
  new aws.iam.PolicyStatement({
    resources: ["*"],
    actions: ["sqs:SendMessage"],
  }),
);

const policy = new aws.iam.Policy(stack, "HelloPolicy", {
  policyName: "Default",
});
policy.addStatements(
  new aws.iam.PolicyStatement({ actions: ["ec2:*"], resources: ["*"] }),
);
policy.attachToRole(role);

// Idempotent with imported roles, see https://github.com/aws/aws-cdk/issues/28101
const importedRole = aws.iam.Role.fromRoleArn(
  stack,
  "TestImportedRole",
  role.roleArn, // importedRole ARN == role ARN, Should not create attachment!
);
policy.attachToRole(importedRole);

// Role with an external ID
new aws.iam.Role(stack, "TestRole2", {
  assumedBy: new aws.iam.AccountRootPrincipal(),
  externalIds: ["supply-me"],
  registerOutputs: true,
});

// Role with an org
new aws.iam.Role(stack, "TestRole3", {
  assumedBy: new aws.iam.OrganizationPrincipal("o-1234"),
  registerOutputs: true,
});

app.synth();
