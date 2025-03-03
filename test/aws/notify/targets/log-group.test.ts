// https://github.com/aws/aws-cdk/blob/2813eb26c5ae7457591897fd898438019af8ea65/packages/aws-cdk-lib/aws-events-targets/test/logs/log-group.test.ts

import {
  cloudwatchEventTarget,
  dataAwsIamPolicyDocument,
  cloudwatchEventRule,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Duration } from "../../../../src//duration";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as logs from "../../../../src/aws/cloudwatch";
import * as notify from "../../../../src/aws/notify/";
import * as targets from "../../../../src/aws/notify/targets";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const region = "us-east-1";
const providerConfig = { region };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("log group", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props to match AWS CDK cross account support
      // account: "1234",
    });
  });
  test("use log group as an event rule target", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule1.addTarget(new targets.CloudWatchLogGroup(logGroup));

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        schedule_expression: "rate(1 minute)",
        state: "ENABLED",
      },
    );
    template.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:${data.aws_partition.Partitition.partition}:logs:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:log-group:${aws_cloudwatch_log_group.MyLogGroup_5C0DAD85.name}",
      },
    );
    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_events.name}",
                ],
                type: "Service",
              },
            ],
            resources: [
              "${aws_cloudwatch_log_group.MyLogGroup_5C0DAD85.arn}:*",
            ],
          },
        ],
      },
    );

    // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::Join": [
    //           "",
    //           [
    //             // ...
    //             {
    //               Ref: "MyLogGroup5C0DAD85",
    //             },
    //           ],
    //         ],
    //       },
    //       Id: "Target0",
    //     },
    //   ],
    // });
  });

  // TODO: This is deprecated in AWS CDK
  test("use log group as an event rule target with rule target input", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule1.addTarget(
      new targets.CloudWatchLogGroup(logGroup, {
        event: notify.RuleTargetInput.fromObject({
          message: notify.EventField.fromPath("$"),
        }),
      }),
    );

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      /CloudWatchLogGroup targets only support input templates in the format/,
    );
  });

  // TODO: This is deprecated in AWS CDK
  test("cannot use both logEvent and event", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    // THEN
    expect(() => {
      rule1.addTarget(
        new targets.CloudWatchLogGroup(logGroup, {
          event: notify.RuleTargetInput.fromObject({
            message: notify.EventField.fromPath("$"),
          }),
          logEvent: targets.LogGroupTargetInput.fromObject(),
        }),
      );
    }).toThrow(/Only one of "event" or "logEvent" can be specified/);
  });

  test("logEvent with defaults", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule1.addTarget(
      new targets.CloudWatchLogGroup(logGroup, {
        logEvent: targets.LogGroupTargetInput.fromObject(),
      }),
    );

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        schedule_expression: "rate(1 minute)",
        state: "ENABLED",
      },
    );
    template.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:${data.aws_partition.Partitition.partition}:logs:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:log-group:${aws_cloudwatch_log_group.MyLogGroup_5C0DAD85.name}",
        input_transformer: {
          input_paths: {
            time: "$.time",
            "detail-type": "$.detail-type",
          },
          input_template: '{"timestamp":<time>,"message":<detail-type>}',
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::Join": [
    //           "",
    //           [
    //             // ...
    //             {
    //               Ref: "MyLogGroup5C0DAD85",
    //             },
    //           ],
    //         ],
    //       },
    //       Id: "Target0",
    //       InputTransformer: {
    //         InputPathsMap: {
    //           time: "$.time",
    //           "detail-type": "$.detail-type",
    //         },
    //         InputTemplate: '{"timestamp":<time>,"message":<detail-type>}',
    //       },
    //     },
    //   ],
    // });
  });

  // // Custom Resource no longer needed?
  // test("can set install latest AWS SDK value to false", () => {
  //   // GIVEN
  //   const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
  //     logGroupName: "/aws/events/MyLogGroup",
  //   });
  //   const rule1 = new notify.Rule(stack, "Rule", {
  //     schedule: notify.Schedule.rate(Duration.minutes(1)),
  //   });

  //   // WHEN
  //   rule1.addTarget(
  //     new targets.CloudWatchLogGroup(logGroup, {
  //       installLatestAwsSdk: false,
  //     }),
  //   );

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "Custom::CloudwatchLogResourcePolicy",
  //     {
  //       InstallLatestAwsSdk: false,
  //     },
  //   );
  // });

  // // Custom Resource no longer needed?
  // test("default install latest AWS SDK is true", () => {
  //   // GIVEN
  //   const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
  //     logGroupName: "/aws/events/MyLogGroup",
  //   });
  //   const rule1 = new notify.Rule(stack, "Rule", {
  //     schedule: notify.Schedule.rate(Duration.minutes(1)),
  //   });

  //   // WHEN
  //   rule1.addTarget(new targets.CloudWatchLogGroup(logGroup));

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "Custom::CloudwatchLogResourcePolicy",
  //     {
  //       InstallLatestAwsSdk: true,
  //     },
  //   );
  // });

  test("can use logEvent", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule1.addTarget(
      new targets.CloudWatchLogGroup(logGroup, {
        logEvent: targets.LogGroupTargetInput.fromObject({
          timestamp: notify.EventField.time,
          message: notify.EventField.fromPath("$"),
        }),
      }),
    );

    // THEN

    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        schedule_expression: "rate(1 minute)",
        state: "ENABLED",
      },
    );
    template.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:${data.aws_partition.Partitition.partition}:logs:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:log-group:${aws_cloudwatch_log_group.MyLogGroup_5C0DAD85.name}",
        input_transformer: {
          input_paths: {
            time: "$.time",
            f2: "$",
          },
          input_template: '{"timestamp":<time>,"message":<f2>}',
        },
      },
    );
    // .hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::Join": [
    //           "",
    //           [
    //             // ...
    //             {
    //               Ref: "MyLogGroup5C0DAD85",
    //             },
    //           ],
    //         ],
    //       },
    //       Id: "Target0",
    //       InputTransformer: {
    //         InputPathsMap: {
    //           time: "$.time",
    //           f2: "$",
    //         },
    //         InputTemplate: '{"timestamp":<time>,"message":<f2>}',
    //       },
    //     },
    //   ],
    // });
  });

  // TODO: This is deprecated in AWS CDK
  test("specifying retry policy and dead letter queue", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    const queue = new notify.Queue(stack, "Queue");

    // WHEN
    rule1.addTarget(
      new targets.CloudWatchLogGroup(logGroup, {
        event: notify.RuleTargetInput.fromObject({
          timestamp: notify.EventField.time,
          message: notify.EventField.fromPath("$"),
        }),
        retryAttempts: 2,
        maxEventAge: Duration.hours(2),
        deadLetterQueue: queue,
      }),
    );

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        schedule_expression: "rate(1 minute)",
        state: "ENABLED",
      },
    );
    template.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:${data.aws_partition.Partitition.partition}:logs:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:log-group:${aws_cloudwatch_log_group.MyLogGroup_5C0DAD85.name}",
        dead_letter_config: {
          arn: stack.resolve(queue.queueArn),
        },
        input_transformer: {
          input_paths: {
            time: "$.time",
            f2: "$",
          },
          input_template: '{"timestamp":<time>,"message":<f2>}',
        },
        retry_policy: {
          maximum_event_age_in_seconds: 7200,
          maximum_retry_attempts: 2,
        },
      },
    );
    // .hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::Join": [
    //           "",
    //           [
    //             // ..
    //             {
    //               Ref: "MyLogGroup5C0DAD85",
    //             },
    //           ],
    //         ],
    //       },
    //       DeadLetterConfig: {
    //         Arn: {
    //           "Fn::GetAtt": ["Queue4A7E3555", "Arn"],
    //         },
    //       },
    //       Id: "Target0",
    //       InputTransformer: {
    //         InputPathsMap: {
    //           time: "$.time",
    //           f2: "$",
    //         },
    //         InputTemplate: '{"timestamp":<time>,"message":<f2>}',
    //       },
    //       RetryPolicy: {
    //         MaximumEventAgeInSeconds: 7200,
    //         MaximumRetryAttempts: 2,
    //       },
    //     },
    //   ],
    // });
  });

  // TODO: This is deprecated in AWS CDK
  test("specifying retry policy with 0 retryAttempts", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });
    const rule1 = new notify.Rule(stack, "Rule", {
      schedule: notify.Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule1.addTarget(
      new targets.CloudWatchLogGroup(logGroup, {
        event: notify.RuleTargetInput.fromObject({
          timestamp: notify.EventField.time,
          message: notify.EventField.fromPath("$"),
        }),
        retryAttempts: 0,
      }),
    );

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        schedule_expression: "rate(1 minute)",
        state: "ENABLED",
      },
    );
    template.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:${data.aws_partition.Partitition.partition}:logs:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:log-group:${aws_cloudwatch_log_group.MyLogGroup_5C0DAD85.name}",
        input_transformer: {
          input_paths: {
            time: "$.time",
            f2: "$",
          },
          input_template: '{"timestamp":<time>,"message":<f2>}',
        },
        retry_policy: {
          maximum_retry_attempts: 0,
        },
      },
    );

    // .hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::Join": [
    //           "",
    //           [
    //             // ..
    //             {
    //               Ref: "MyLogGroup5C0DAD85",
    //             },
    //           ],
    //         ],
    //       },
    //       Id: "Target0",
    //       InputTransformer: {
    //         InputPathsMap: {
    //           time: "$.time",
    //           f2: "$",
    //         },
    //         InputTemplate: '{"timestamp":<time>,"message":<f2>}',
    //       },
    //       RetryPolicy: {
    //         MaximumRetryAttempts: 0,
    //       },
    //     },
    //   ],
    // });
  });

  test("metricIncomingLogEvents", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });

    expect(stack.resolve(logGroup.metricIncomingLogEvents())).toEqual({
      period: {
        amount: 5,
        unit: { label: "minutes", inMillis: 60000, isoLabel: "M" },
      },
      region,
      namespace: "AWS/Logs",
      metricName: "IncomingLogs",
      statistic: "Sum",
    });
  });

  test("metricIncomingLogEvents with MetricOptions props", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });

    expect(
      stack.resolve(
        logGroup.metricIncomingLogEvents({
          period: Duration.hours(10),
          label: "MyMetric",
        }),
      ),
    ).toEqual({
      period: {
        amount: 10,
        unit: { label: "hours", inMillis: 3600000, isoLabel: "H" },
      },
      region,
      namespace: "AWS/Logs",
      metricName: "IncomingLogs",
      statistic: "Sum",
      label: "MyMetric",
    });
  });

  test("metricIncomingBytes", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });

    expect(stack.resolve(logGroup.metricIncomingBytes())).toEqual({
      period: {
        amount: 5,
        unit: { label: "minutes", inMillis: 60000, isoLabel: "M" },
      },
      region,
      namespace: "AWS/Logs",
      metricName: "IncomingBytes",
      statistic: "Sum",
    });
  });

  test("metricIncomingBytes with MetricOptions props", () => {
    // GIVEN
    const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
      logGroupName: "/aws/events/MyLogGroup",
    });

    expect(
      stack.resolve(
        logGroup.metricIncomingBytes({
          period: Duration.minutes(15),
          statistic: "Sum",
        }),
      ),
    ).toEqual({
      period: {
        amount: 15,
        unit: { label: "minutes", inMillis: 60000, isoLabel: "M" },
      },
      region,
      namespace: "AWS/Logs",
      metricName: "IncomingBytes",
      statistic: "Sum",
    });
  });
});
