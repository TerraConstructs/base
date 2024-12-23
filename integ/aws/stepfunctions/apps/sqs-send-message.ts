// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/sqs/integ.send-message.ts
import { App, LocalBackend } from "cdktf";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sqs-send-message";

/*
 * Creates a state machine with a task state to send a message to an SQS
 * queue.
 *
 * When the state machine is executed, it will send a message to our
 * queue, which can subsequently be consumed.
 *
 * Stack verification steps:
 * The generated State Machine can be executed from the CLI (or Step Functions console)
 * and runs with an execution status of `Succeeded`.
 *
 * -- aws stepfunctions start-execution --state-machine-arn <state-machine-arn-from-output> provides execution arn
 * -- aws stepfunctions describe-execution --execution-arn <from previous command> returns a status of `Succeeded`
 * -- aws sqs receive-message --queue-url <queue-url-from-output> has a message of 'sending message over'
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
const queue = new aws.notify.Queue(stack, "show-me-the-messages", {
  registerOutputs: true,
  outputName: "queue",
});

const sendMessageTask = new aws.compute.tasks.SqsSendMessage(
  stack,
  "send message to sqs",
  {
    queue,
    messageBody: aws.compute.TaskInput.fromText("sending message over"),
  },
);

const finalStatus = new aws.compute.Pass(stack, "Final step");

const chain = aws.compute.Chain.start(sendMessageTask).next(finalStatus);

const sm = new aws.compute.StateMachine(stack, "StateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(chain),
  timeout: Duration.seconds(30),
  registerOutputs: true,
  outputName: "state_machine",
});

app.synth();
