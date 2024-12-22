// https://github.com/aws/aws-cdk/blob/9604c62ebc9759e07abda426ec3bb644d8e58807/packages/aws-cdk-lib/aws-cloudwatch-actions/lib/ec2.ts

import { cloudwatchMetricAlarm } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec } from "../../../../src/aws";
import { Alarm, Metric } from "../../../../src/aws/cloudwatch";
import {
  Ec2Action,
  Ec2InstanceAction,
} from "../../../../src/aws/cloudwatch/actions";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("can use instance reboot as alarm action", () => {
  // GIVEN
  const app = Testing.app();
  const stack = new AwsSpec(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const alarm = new Alarm(stack, "Alarm", {
    metric: new Metric({
      namespace: "AWS/EC2",
      metricName: "StatusCheckFailed",
      dimensionsMap: {
        InstanceId: "i-03cb889aaaafffeee",
      },
    }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  alarm.addAlarmAction(new Ec2Action(Ec2InstanceAction.REBOOT));

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      alarm_actions: [
        "arn:${data.aws_partition.Partitition.partition}:automate:us-east-1:ec2:reboot",
      ],
    },
  );
});
