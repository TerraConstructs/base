import {
  appautoscalingTarget,
  appautoscalingPolicy,
  appautoscalingScheduledAction,
  cloudwatchMetricAlarm,
  iamRole as AwsIamRoleResource, // Renamed to avoid conflict with local iam module
} from "@cdktf/provider-aws";
import { App, Lazy, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as iam from "../../../src/aws/iam";
import * as appscaling from "../../../src/aws/compute";
import * as cloudwatch from "../../../src/aws/cloudwatch";
import { Duration } from "../../../src/duration";
import { TimeZone } from "../../../src/time-zone";
import { createScalableTarget } from "./util";
import { Annotations, Template } from "../../assertions";

const environmentName = "TestEnv";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = { address: "http://localhost:3000" };

describe("scalable target", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "Default", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("test scalable target creation", () => {
    // WHEN
    new appscaling.ScalableTarget(stack, "Target", {
      serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
      scalableDimension: "test:TestCount",
      resourceId: "test:this/test",
      minCapacity: 1,
      maxCapacity: 20,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingTarget.AppautoscalingTarget,
      {
        service_namespace: "dynamodb",
        scalable_dimension: "test:TestCount",
        resource_id: "test:this/test",
        min_capacity: 1,
        max_capacity: 20,
      },
    );
  });

  test("validation does not fail when using Tokens", () => {
    // WHEN
    new appscaling.ScalableTarget(stack, "Target", {
      serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
      scalableDimension: "test:TestCount",
      resourceId: "test:this/test",
      minCapacity: Lazy.numberValue({ produce: () => 10 }),
      maxCapacity: Lazy.numberValue({ produce: () => 1 }),
    });

    // THEN: no exception
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingTarget.AppautoscalingTarget,
      {
        service_namespace: "dynamodb",
        scalable_dimension: "test:TestCount",
        resource_id: "test:this/test",
        min_capacity: 10,
        max_capacity: 1,
      },
    );
  });

  test("add scheduled scaling", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnSchedule("ScaleUp", {
      schedule: appscaling.Schedule.rate(Duration.minutes(1)),
      maxCapacity: 50,
      minCapacity: 1,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingScheduledAction.AppautoscalingScheduledAction,
      {
        name: "ScaleUp",
        service_namespace: "dynamodb",
        resource_id: "test:this/test",
        scalable_dimension: "test:TestCount",
        schedule: "rate(1 minute)",
        scalable_target_action: {
          max_capacity: "50",
          min_capacity: "1",
        },
      },
    );
  });

  test("set timezone in scaleOnSchedule()", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnSchedule("ScaleUp", {
      schedule: appscaling.Schedule.cron({
        hour: "8",
        day: "1",
      }),
      maxCapacity: 50,
      minCapacity: 1,
      timeZone: TimeZone.AMERICA_DENVER,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingScheduledAction.AppautoscalingScheduledAction,
      {
        name: "ScaleUp",
        schedule: "cron(* 8 1 * ? *)", // CDK cron default for minute is '*'
        timezone: "America/Denver",
        scalable_target_action: {
          max_capacity: "50",
          min_capacity: "1",
        },
      },
    );
  });

  test("scheduled scaling shows warning when minute is not defined in cron", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnSchedule("ScaleUp", {
      schedule: appscaling.Schedule.cron({
        hour: "8",
        day: "1",
      }),
      maxCapacity: 50,
      minCapacity: 1,
    });

    // THEN
    // Assuming the warning is associated with the ScalableTarget or the specific Schedule construct if it's a child.
    // The path might need adjustment based on actual construct hierarchy in TerraConstructs.
    Annotations.fromStack(stack).hasWarnings({
      constructPath: "Default/Target", // Path to the AppautoscalingScheduledAction
      message: expect.stringMatching(
        /cron: If you don't pass 'minute', by default the event runs every minute./,
      ),
    });
  });

  test("scheduled scaling shows no warning when minute is * in cron", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnSchedule("ScaleUp", {
      schedule: appscaling.Schedule.cron({
        hour: "8",
        day: "1",
        minute: "*",
      }),
      maxCapacity: 50,
      minCapacity: 1,
    });

    // THEN
    Annotations.fromStack(stack).hasNoWarnings({
      constructPath: "Default/Target/ScaleUp",
      message: expect.stringMatching(
        /cron: If you don't pass 'minute', by default the event runs every minute./,
      ),
    });
  });

  test("step scaling on MathExpression", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnMetric("Metric", {
      metric: new cloudwatch.MathExpression({
        expression: "a",
        usingMetrics: {
          a: new cloudwatch.Metric({
            namespace: "Test",
            metricName: "Metric",
          }),
        },
        // period: Duration.minutes(5), // Explicitly set to match CDK default if not on metric
      }),
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      scalingSteps: [
        { change: -1, lower: 0, upper: 49 },
        { change: 0, lower: 50, upper: 99 }, // This step is conceptual in CDK, actual alarms are for <49 and >100
        { change: 1, lower: 100 },
      ],
    });

    // THEN
    const template = Template.synth(stack);

    // Check CloudWatch Alarm for scaling IN (metric <= 49)
    template.toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "LessThanOrEqualToThreshold",
        evaluation_periods: 1,
        metric_query: [
          {
            expression: "a",
            id: "expr_1",
            return_data: true,
          },
          {
            id: "a",
            metric: {
              metric_name: "Metric",
              namespace: "Test",
              period: 300, // 5 minutes in seconds
              stat: "Average",
            },
            return_data: false,
          },
        ],
        threshold: 49,
        // alarm_actions should point to the scaling policy for scaling in
      },
    );

    // Check AppautoscalingPolicy for scaling IN
    template.toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "StepScaling",
        resource_id: "test:this/test",
        scalable_dimension: "test:TestCount",
        service_namespace: "dynamodb",
        step_scaling_policy_configuration: {
          adjustment_type: "ChangeInCapacity",
          step_adjustment: [
            { scaling_adjustment: -1, metric_interval_upper_bound: "0" },
          ],
          metric_aggregation_type: "Average", // Default
        },
        // name should contain "MetricLowerPolicy"
      },
    );

    // Check CloudWatch Alarm for scaling OUT (metric >= 100)
    template.toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "GreaterThanOrEqualToThreshold",
        evaluation_periods: 1,
        metric_query: [
          {
            expression: "a",
            id: "expr_1",
            return_data: true,
          },
          {
            id: "a",
            metric: {
              metric_name: "Metric",
              namespace: "Test",
              period: 300,
              stat: "Average",
            },
            return_data: false,
          },
        ],
        threshold: 100,
      },
    );

    // Check AppautoscalingPolicy for scaling OUT
    template.toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "StepScaling",
        resource_id: "test:this/test",
        scalable_dimension: "test:TestCount",
        service_namespace: "dynamodb",
        step_scaling_policy_configuration: {
          adjustment_type: "ChangeInCapacity",
          metric_aggregation_type: "Average",
          step_adjustment: [
            { scaling_adjustment: 1, metric_interval_lower_bound: "0" },
          ],
        },
        // name should contain "MetricUpperPolicy"
      },
    );
  });

  test("test service namespace enum", () => {
    expect(appscaling.ServiceNamespace.APPSTREAM).toEqual("appstream");
    expect(appscaling.ServiceNamespace.COMPREHEND).toEqual("comprehend");
    expect(appscaling.ServiceNamespace.CUSTOM_RESOURCE).toEqual(
      "custom-resource",
    );
    expect(appscaling.ServiceNamespace.DYNAMODB).toEqual("dynamodb");
    expect(appscaling.ServiceNamespace.EC2).toEqual("ec2");
    expect(appscaling.ServiceNamespace.ECS).toEqual("ecs");
    expect(appscaling.ServiceNamespace.ELASTIC_MAP_REDUCE).toEqual(
      "elasticmapreduce",
    );
    expect(appscaling.ServiceNamespace.LAMBDA).toEqual("lambda");
    expect(appscaling.ServiceNamespace.RDS).toEqual("rds");
    expect(appscaling.ServiceNamespace.SAGEMAKER).toEqual("sagemaker");
    expect(appscaling.ServiceNamespace.ELASTICACHE).toEqual("elasticache");
    expect(appscaling.ServiceNamespace.NEPTUNE).toEqual("neptune");
  });

  test("create scalable target with negative minCapacity throws error", () => {
    expect(() => {
      new appscaling.ScalableTarget(stack, "Target", {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        scalableDimension: "test:TestCount",
        resourceId: "test:this/test",
        minCapacity: -1,
        maxCapacity: 20,
      });
    }).toThrow("minCapacity cannot be negative, got: -1");
  });

  test("create scalable target with negative maxCapacity throws error", () => {
    expect(() => {
      new appscaling.ScalableTarget(stack, "Target", {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        scalableDimension: "test:TestCount",
        resourceId: "test:this/test",
        minCapacity: 1,
        maxCapacity: -1,
      });
    }).toThrow("maxCapacity cannot be negative, got: -1");
  });

  test("create scalable target with maxCapacity less than minCapacity throws error", () => {
    expect(() => {
      new appscaling.ScalableTarget(stack, "Target", {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        scalableDimension: "test:TestCount",
        resourceId: "test:this/test",
        minCapacity: 2,
        maxCapacity: 1,
      });
    }).toThrow("minCapacity (2) should be lower than maxCapacity (1)");
  });

  test("create scalable target with custom role", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("test.amazonaws.com"),
    });

    // WHEN
    new appscaling.ScalableTarget(stack, "Target", {
      serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
      scalableDimension: "test:TestCount",
      resourceId: "test:this/test",
      minCapacity: 1,
      maxCapacity: 20,
      role: role,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingTarget.AppautoscalingTarget,
      {
        service_namespace: "dynamodb",
        scalable_dimension: "test:TestCount",
        resource_id: "test:this/test",
        min_capacity: 1,
        max_capacity: 20,
        role_arn: stack.resolve(role.roleArn),
      },
    );
  });

  test("create scalable target without role (uses service-linked role)", () => {
    // WHEN
    new appscaling.ScalableTarget(stack, "ServiceLinkedTarget", {
      serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
      scalableDimension: "test:TestCount",
      resourceId: "test:this/test",
      minCapacity: 1,
      maxCapacity: 20,
      // No role provided - should use service-linked role
    });

    // THEN - role_arn should not be present, allowing Terraform to use service-linked roles
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      appautoscalingTarget.AppautoscalingTarget,
      {
        service_namespace: "dynamodb",
        scalable_dimension: "test:TestCount",
        resource_id: "test:this/test",
        min_capacity: 1,
        max_capacity: 20,
        // role_arn intentionally omitted to verify it's not present
      },
    );

    // Additional verification: role_arn should not be present at all
    template.not.toHaveResourceWithProperties(
      appautoscalingTarget.AppautoscalingTarget,
      {
        service_namespace: "dynamodb",
        scalable_dimension: "test:TestCount",
        resource_id: "test:this/test",
        role_arn: expect.anything(), // Should not have role_arn property
      },
    );
  });

  test("add scheduled scaling with neither of min/maxCapacity defined throws error", () => {
    const target = createScalableTarget(stack);
    expect(() => {
      target.scaleOnSchedule("ScaleUp", {
        schedule: appscaling.Schedule.rate(Duration.minutes(1)),
      });
    }).toThrow(
      /You must supply at least one of minCapacity or maxCapacity, got/,
    );
  });
});
