// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/stepfunctions/integ.start-execution.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sfn-start-execution";
/*
 * Stack verification steps:
 * * aws stepfunctions start-execution --input '{"hello": "world"}' --state-machine-arn <StateMachineARN>
 * * aws stepfunctions describe-execution --execution-arn <execution-arn>
 * * The output here should contain `status: "SUCCEEDED"` and `output`: '"Output": { "hello": "world"},'
 */

class TestStack extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const child = new aws.compute.StateMachine(this, "Child", {
      definitionBody: aws.compute.DefinitionBody.fromChainable(
        new aws.compute.Pass(this, "Pass"),
      ),
    });

    const parent = new aws.compute.StateMachine(this, "Parent", {
      definitionBody: aws.compute.DefinitionBody.fromChainable(
        new aws.compute.tasks.StepFunctionsStartExecution(this, "Task", {
          stateMachine: child,
          input: aws.compute.TaskInput.fromObject({
            hello: aws.compute.JsonPath.stringAt("$.hello"),
          }),
          integrationPattern: aws.compute.IntegrationPattern.RUN_JOB,
        }),
      ),
      registerOutputs: true,
      outputName: "state_machine",
    });
  }
}

const app = new App({
  outdir,
});
const stack = new TestStack(app, stackName, {
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
