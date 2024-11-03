// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/lambda/integ.invoke.payload.only.ts
import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "lambda-invoke-payload-only";

/*
 * Creates a state machine with a task state to invoke a Lambda function
 * The state machine creates a couple of Lambdas that pass results forward
 * and into a Choice state that validates the output.
 *
 * Stack verification steps:
 * The generated State Machine can be executed from the CLI (or Step Functions console)
 * and runs with an execution status of `Succeeded`.
 *
 * -- aws stepfunctions start-execution --state-machine-arn <state-machine-arn-from-output> provides execution arn
 * -- aws stepfunctions describe-execution --execution-arn <state-machine-arn-from-output> returns a status of `Succeeded`
 */

const app = new App({
  outdir,
});
const spec = new aws.AwsSpec(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(spec, {
  path: `${stackName}.tfstate`,
});

const submitJob = new aws.compute.tasks.LambdaInvoke(spec, "Invoke Handler", {
  lambdaFunction: new aws.compute.NodejsFunction(spec, "submitJobLambda", {
    path: path.join(__dirname, "handlers", "hello-world-status", "index.ts"),
  }),
  payloadResponseOnly: true,
});

const checkJobState = new aws.compute.tasks.LambdaInvoke(
  spec,
  "Check the job state",
  {
    lambdaFunction: new aws.compute.NodejsFunction(
      spec,
      "checkJobStateLambda",
      {
        path: path.join(
          __dirname,
          "handlers",
          "check-job-state-200",
          "index.ts",
        ),
      },
    ),
    payloadResponseOnly: true,
  },
);

const isComplete = new aws.compute.Choice(spec, "Job Complete?");
const jobFailed = new aws.compute.Fail(spec, "Job Failed", {
  cause: "Job Failed",
  error: "Received a status that was not 200",
});
const finalStatus = new aws.compute.Pass(spec, "Final step");

const chain = aws.compute.Chain.start(submitJob)
  .next(checkJobState)
  .next(
    isComplete
      .when(aws.compute.Condition.stringEquals("$.status", "FAILED"), jobFailed)
      .when(
        aws.compute.Condition.stringEquals("$.status", "SUCCEEDED"),
        finalStatus,
      ),
  );

const sm = new aws.compute.StateMachine(spec, "StateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(chain),
  timeout: Duration.seconds(30),
  registerOutputs: true,
  outputName: "state_machine",
});

app.synth();
