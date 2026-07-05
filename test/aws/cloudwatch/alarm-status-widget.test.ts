// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-cloudwatch/test/alarm-status-widget.test.ts

import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  Metric,
  Alarm,
  AlarmStatusWidget,
  AlarmStatusWidgetSortBy,
  AlarmState,
} from "../../../src/aws/cloudwatch";

describe("Alarm Status Widget", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
  });

  test("alarm status widget", () => {
    // GIVEN
    const metric = new Metric({ namespace: "CDK", metricName: "Test" });
    const alarm = new Alarm(stack, "Alarm", {
      metric,
      threshold: 1,
      evaluationPeriods: 1,
    });

    // WHEN
    const widget = new AlarmStatusWidget(stack, {
      alarms: [alarm],
    });

    // THEN
    expect(stack.resolve(widget.toJson())).toEqual([
      {
        type: "alarm",
        width: 6,
        height: 3,
        properties: {
          title: "Alarm Status",
          alarms: [stack.resolve(alarm.alarmArn)],
        },
      },
    ]);
  });
  test("alarm status widget custom props", () => {
    // GIVEN
    const metric = new Metric({ namespace: "CDK", metricName: "Test" });
    const alarm = new Alarm(stack, "Alarm", {
      metric,
      threshold: 1,
      evaluationPeriods: 1,
    });

    // WHEN
    const widget = new AlarmStatusWidget(stack, {
      alarms: [alarm],
      sortBy: AlarmStatusWidgetSortBy.STATE_UPDATED_TIMESTAMP,
      states: [AlarmState.ALARM],
    });

    // THEN
    expect(stack.resolve(widget.toJson())).toEqual([
      {
        type: "alarm",
        width: 6,
        height: 3,
        properties: {
          title: "Alarm Status",
          alarms: [stack.resolve(alarm.alarmArn)],
          sortBy: "stateUpdatedTimestamp",
          states: ["ALARM"],
        },
      },
    ]);
  });
});
