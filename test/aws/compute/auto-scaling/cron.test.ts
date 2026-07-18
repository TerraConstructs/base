// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/cron.test.ts

import { autoscalingSchedule } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("test utc cron, hour only", () => {
  expect(
    autoscaling.Schedule.cron({ hour: "18", minute: "0" }).expressionString,
  ).toEqual("0 18 * * *");
});

test("test utc cron, hour and minute", () => {
  expect(
    autoscaling.Schedule.cron({ hour: "18", minute: "24" }).expressionString,
  ).toEqual("24 18 * * *");
});

// Repo-specific: snapshot/synth coverage proving the cron expressionString
// actually lands on the mapped terraform resource (aws_autoscaling_schedule
// `recurrence`, per the aws-autoscaling mapping manifest) instead of only
// being asserted as a bare string.
describe("Schedule.cron synth", () => {
  test("cron expressionString synths as aws_autoscaling_schedule recurrence and matches snapshot", () => {
    // GIVEN
    const stack = getAwsStack();
    const schedule = autoscaling.Schedule.cron({ hour: "18", minute: "24" });

    // WHEN
    new autoscalingSchedule.AutoscalingSchedule(stack, "Schedule", {
      autoscalingGroupName: "my-asg",
      scheduledActionName: "my-scheduled-action",
      recurrence: schedule.expressionString,
      minSize: 1,
      maxSize: 5,
    });

    // THEN
    // CFN equivalent would have been:
    // Template.fromStack(stack).hasResourceProperties("AWS::AutoScaling::ScheduledAction", {
    //   Recurrence: "24 18 * * *",
    // });
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingSchedule.AutoscalingSchedule,
      {
        recurrence: "24 18 * * *",
      },
    );

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    gridBackendConfig,
  });
}
