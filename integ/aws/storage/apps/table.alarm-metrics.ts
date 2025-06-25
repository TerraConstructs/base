// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-dynamodb/test/integ.dynamodb.alarm-metrics.ts

import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { Duration, aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "bucket-notifications";

// import { IntegTest } from "@aws-cdk/integ-tests-alpha";

export class TestStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const table = new aws.storage.Table(this, "Table", {
      partitionKey: { name: "metric", type: aws.storage.AttributeType.STRING },
    });
    const metricTableThrottled = table.metricThrottledRequestsForOperations({
      operations: [aws.storage.Operation.PUT_ITEM, aws.storage.Operation.SCAN],
      period: Duration.minutes(1),
    });
    new aws.cloudwatch.Alarm(this, "TableThrottleAlarm", {
      metric: metricTableThrottled,
      evaluationPeriods: 1,
      threshold: 1,
    });
    const metricTableError = table.metricSystemErrorsForOperations({
      operations: [aws.storage.Operation.PUT_ITEM, aws.storage.Operation.SCAN],
      period: Duration.minutes(1),
    });
    new aws.cloudwatch.Alarm(this, "TableErrorAlarm", {
      metric: metricTableError,
      evaluationPeriods: 1,
      threshold: 1,
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
