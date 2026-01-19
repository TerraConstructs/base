// Integration test for EventBridge Rule with custom event bus and Lambda target
// Regression test for: https://github.com/TerraConstructs/base/pull/89

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

/**
 * The standard nodejs runtime used for integration tests.
 */
export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "eventbridge-rule-lambda";

class EventBridgeRuleLambdaStack extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    // Create a custom event bus (not default)
    const eventBus = new aws.notify.EventBus(this, "CustomEventBus", {
      eventBusName: "custom-event-bus",
      registerOutputs: true,
      outputName: "event_bus",
    });

    // Create a Lambda function that will be triggered by the rule
    const targetFunction = new aws.compute.LambdaFunction(
      this,
      "TargetFunction",
      {
        handler: "index.handler",
        runtime: STANDARD_NODEJS_RUNTIME,
        code: aws.compute.Code.fromInline(
          `exports.handler = ${handler.toString()}`,
        ),
        registerOutputs: true,
        outputName: "target_function",
      },
    );

    // Create a rule on the custom event bus with a Lambda target
    // This tests the bug where the event bus name was not set on the target
    const rule = new aws.notify.Rule(this, "TestRule", {
      eventBus: eventBus,
      eventPattern: {
        source: ["custom.source"],
        detailType: ["Custom Event"],
      },
      targets: [new aws.notify.targets.LambdaFunction(targetFunction)],
      registerOutputs: true,
      outputName: "rule",
    });

    // Also test with fromEventBusName pattern (another common use case)
    const importedEventBus = aws.notify.EventBus.fromEventBusName(
      this,
      "ImportedEventBus",
      eventBus.eventBusName,
    );

    const importedBusFunction = new aws.compute.LambdaFunction(
      this,
      "ImportedBusFunction",
      {
        handler: "index.handler",
        runtime: STANDARD_NODEJS_RUNTIME,
        code: aws.compute.Code.fromInline(
          `exports.handler = ${handler.toString()}`,
        ),
        registerOutputs: true,
        outputName: "imported_bus_function",
      },
    );

    const importedBusRule = new aws.notify.Rule(this, "ImportedBusRule", {
      eventBus: importedEventBus,
      eventPattern: {
        source: ["imported.source"],
        detailType: ["Imported Event"],
      },
      targets: [new aws.notify.targets.LambdaFunction(importedBusFunction)],
      registerOutputs: true,
      outputName: "imported_bus_rule",
    });
  }
}

const app = new App({
  outdir,
});
const stack = new EventBridgeRuleLambdaStack(app, stackName, {
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

function handler(event: any, _context: any, callback: any) {
  /* eslint-disable no-console */
  console.log("====================================================");
  console.log("EventBridge event received:");
  console.log(JSON.stringify(event, undefined, 2));
  console.log("====================================================");
  return callback(undefined, event);
}
