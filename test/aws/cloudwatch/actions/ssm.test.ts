// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-cloudwatch-actions/test/ssm.test.ts

import { cloudwatchMetricAlarm } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as actions from "../../../../src/aws/cloudwatch/actions";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const arnPrefix = (service: string = "ssm", region: string = "") =>
  `arn:\${data.aws_partition.Partitition.partition}:${service}:${region}:\${data.aws_caller_identity.CallerIdentity.account_id}`;

describe("SSM Actions", () => {
  let app: App;
  let stack: AwsStack;
  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("can use ssm with critical severity and performance category as alarm action", () => {
    // GIVEN
    const alarm = new cloudwatch.Alarm(stack, "Alarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS",
        metricName: "Test",
      }),
      evaluationPeriods: 3,
      threshold: 100,
    });

    // WHEN
    alarm.addAlarmAction(
      new actions.SsmAction(
        actions.OpsItemSeverity.CRITICAL,
        actions.OpsItemCategory.PERFORMANCE,
      ),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        alarm_actions: [
          `${arnPrefix("ssm", "us-east-1")}:opsitem:1#CATEGORY=Performance`,
        ],
      },
    );
  });

  test("can use ssm with medium severity and no category as alarm action", () => {
    // GIVEN
    const alarm = new cloudwatch.Alarm(stack, "Alarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS",
        metricName: "Test",
      }),
      evaluationPeriods: 3,
      threshold: 100,
    });

    // WHEN
    alarm.addAlarmAction(new actions.SsmAction(actions.OpsItemSeverity.MEDIUM));

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        alarm_actions: [`${arnPrefix("ssm", "us-east-1")}:opsitem:3`],
      },
    );
  });

  test("can use SSM Incident as alarm action", () => {
    // GIVEN
    const alarm = new cloudwatch.Alarm(stack, "Alarm", {
      metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test" }),
      evaluationPeriods: 3,
      threshold: 100,
    });

    // WHEN
    const responsePlanName = "ResponsePlanName";
    alarm.addAlarmAction(new actions.SsmIncidentAction(responsePlanName));

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        alarm_actions: [
          `${arnPrefix("ssm-incidents", "")}:response-plan/ResponsePlanName`,
        ],
      },
    );
  });
});
