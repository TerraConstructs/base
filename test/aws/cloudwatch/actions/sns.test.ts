// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-cloudwatch-actions/test/sns.test.ts

import { cloudwatchMetricAlarm } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as actions from "../../../../src/aws/cloudwatch/actions";
import * as sns from "../../../../src/aws/notify";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("can use topic as alarm action", () => {
  // GIVEN
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const topic = new sns.Topic(stack, "Topic");
  const alarm = new cloudwatch.Alarm(stack, "Alarm", {
    metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Henk" }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  alarm.addAlarmAction(new actions.SnsAction(topic));

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      alarm_actions: [stack.resolve(topic.topicArn)],
    },
  );
});
