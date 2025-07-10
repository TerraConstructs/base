import { cloudwatchMetricAlarm } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as actions from "../../../../src/aws/cloudwatch/actions";
import * as appscaling from "../../../../src/aws/compute";
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
  const scalingTarget = new appscaling.ScalableTarget(stack, "Target", {
    minCapacity: 1,
    maxCapacity: 100,
    resourceId: "asdf",
    scalableDimension: "height",
    serviceNamespace: appscaling.ServiceNamespace.CUSTOM_RESOURCE,
  });
  const action = new appscaling.StepScalingAction(stack, "Action", {
    scalingTarget,
  });
  const alarm = new cloudwatch.Alarm(stack, "Alarm", {
    metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Henk" }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  alarm.addAlarmAction(new actions.ApplicationScalingAction(action));

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      alarm_actions: [stack.resolve(action.scalingPolicyArn)],
    },
  );
});
