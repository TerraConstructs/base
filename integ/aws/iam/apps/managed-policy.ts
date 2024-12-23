// ref: https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-iam/test/integ.managed-policy.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "managed-policy";

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

const policy = new aws.iam.ManagedPolicy(stack, "OneManagedPolicy", {
  managedPolicyName: "Default",
  description: "My Policy",
  path: "/some/path/",
  registerOutputs: true,
});
policy.addStatements(
  new aws.iam.PolicyStatement({
    resources: ["*"],
    actions: ["sqs:SendMessage"],
  }),
);

const role = new aws.iam.Role(stack, "Role", {
  assumedBy: new aws.iam.AccountRootPrincipal(),
  registerOutputs: true,
});
role.grantAssumeRole(policy.grantPrincipal);
policy.attachToRole(role);

const policy2 = new aws.iam.ManagedPolicy(stack, "TwoManagedPolicy", {
  registerOutputs: true,
});
policy2.addStatements(
  new aws.iam.PolicyStatement({
    resources: ["*"],
    actions: ["lambda:InvokeFunction"],
  }),
);

const policy3 = aws.iam.ManagedPolicy.fromAwsManagedPolicyName(
  stack,
  "SecurityAudit",
  "SecurityAudit",
);
// NOTE: Don't mix role.addManagedPolicy
// and policy.attachToRole See JSDoc.
policy3.attachToRole(role);

aws.iam.Grant.addToPrincipal({
  actions: ["iam:*"],
  resourceArns: [role.roleArn],
  grantee: policy2,
});

app.synth();
