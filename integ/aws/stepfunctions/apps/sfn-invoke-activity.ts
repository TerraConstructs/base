// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/stepfunctions/integ.invoke-activity.ts
import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sfn-invoke-activity";

/*
 * Creates a state machine with a job poller sample project
 * https://docs.aws.amazon.com/step-functions/latest/dg/sample-project-job-poller.html
 *
 * Stack verification steps:
 * The generated State Machine can be executed from the CLI (or Step Functions console)
 * and runs with an execution status of `Running`.
 *
 * An external process can call the state machine to send a heartbeat or response before it times out.
 *
 * -- aws stepfunctions start-execution --state-machine-arn <state-machine-arn-from-output> provides execution arn
 * -- aws stepfunctions describe-execution --execution-arn <state-machine-arn-from-output> returns a status of `Running`
 */
class InvokeActivityStack extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const submitJobActivity = new aws.compute.Activity(this, "SubmitJob", {
      registerOutputs: true,
      outputName: "submit_job_activity",
    });
    const checkJobActivity = new aws.compute.Activity(this, "CheckJob", {
      registerOutputs: true,
      outputName: "check_job_activity",
    });

    const submitJob = new aws.compute.tasks.StepFunctionsInvokeActivity(
      this,
      "Submit Job",
      {
        activity: submitJobActivity,
        resultPath: "$.guid",
      },
    );
    const waitX = new aws.compute.Wait(this, "Wait X Seconds", {
      time: aws.compute.WaitTime.secondsPath("$.wait_time"),
    });
    const getStatus = new aws.compute.tasks.StepFunctionsInvokeActivity(
      this,
      "Get Job Status",
      {
        activity: checkJobActivity,
        inputPath: "$.guid",
        resultPath: "$.status",
      },
    );
    const isComplete = new aws.compute.Choice(this, "Job Complete?");
    const jobFailed = new aws.compute.Fail(this, "Job Failed", {
      cause: "AWS Batch Job Failed",
      error: "DescribeJob returned FAILED",
    });
    const finalStatus = new aws.compute.tasks.StepFunctionsInvokeActivity(
      this,
      "Get Final Job Status",
      {
        activity: checkJobActivity,
        parameters: {
          "input.$": "$",
          stringArgument: "inital-task",
          numberArgument: 123,
          booleanArgument: true,
          arrayArgument: ["a", "b", "c"],
          jsonPath: aws.compute.JsonPath.stringAt("$.status"),
        },
      },
    );

    new aws.compute.StateMachine(this, "StateMachine", {
      definitionBody: aws.compute.DefinitionBody.fromChainable(
        aws.compute.Chain.start(submitJob)
          .next(waitX)
          .next(getStatus)
          .next(
            isComplete
              .when(
                aws.compute.Condition.stringEquals("$.status", "FAILED"),
                jobFailed,
              )
              .when(
                aws.compute.Condition.stringEquals("$.status", "SUCCEEDED"),
                finalStatus,
              )
              .otherwise(waitX),
          ),
      ),
      timeout: Duration.seconds(300),
      registerOutputs: true,
      outputName: "state_machine",
    });
  }
}

const app = new App({
  outdir,
});
const stack = new InvokeActivityStack(app, stackName, {
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
