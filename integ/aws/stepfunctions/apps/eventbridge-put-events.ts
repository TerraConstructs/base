// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/@aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/eventbridge/integ.put-events.ts
import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "eventbridge-put-events";

/*
 * Stack verification steps :
 * * aws stepfunctions start-execution --state-machine-arn <deployed state machine arn> : should return execution arn
 * * aws stepfunctions describe-execution --execution-arn <execution-arn generated before> : should return status as SUCCEEDED
 */

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

const eventBus = new aws.notify.EventBus(stack, "EventBus", {
  eventBusName: "MyEventBus1",
});

const putEventsTask = new aws.compute.tasks.EventBridgePutEvents(
  stack,
  "Put Custom Events",
  {
    entries: [
      {
        // Entry with no event bus specified
        detail: aws.compute.TaskInput.fromObject({
          Message: "Hello from Step Functions!",
        }),
        detailType: "MessageFromStepFunctions",
        source: "step.functions",
      },
      {
        // Entry with EventBus provided as object
        detail: aws.compute.TaskInput.fromObject({
          Message: "Hello from Step Functions!",
        }),
        eventBus,
        detailType: "MessageFromStepFunctions",
        source: "step.functions",
      },
    ],
  },
);

new aws.compute.StateMachine(stack, "StateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(putEventsTask),
  timeout: Duration.seconds(30),
  registerOutputs: true,
  outputName: "state_machine",
});

app.synth();
