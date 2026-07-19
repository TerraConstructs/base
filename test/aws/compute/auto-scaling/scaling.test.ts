// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/scaling.test.ts

import { autoscalingPolicy, cloudwatchMetricAlarm } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import {
  AmazonLinuxImage,
  ApplicationLoadBalancer,
  InstanceClass,
  InstanceSize,
  InstanceType,
  Vpc,
} from "../../../../src/aws/compute";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import { parseTargetGroupFullName } from "../../../../src/aws/compute/lb-shared/util";
import { Duration } from "../../../../src/duration";
import { Annotations, Template } from "../../../assertions";

describe("scaling", () => {
  describe("target tracking policies", () => {
    test("cpu utilization", () => {
      // GIVEN
      const stack = newStack();
      const fixture = new ASGFixture(stack, "Fixture");

      // WHEN
      fixture.asg.scaleOnCpuUtilization("ScaleCpu", {
        targetUtilizationPercent: 30,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingPolicy.AutoscalingPolicy,
        {
          policy_type: "TargetTrackingScaling",
          target_tracking_configuration: {
            predefined_metric_specification: {
              predefined_metric_type: "ASGAverageCPUUtilization",
            },
            target_value: 30,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
      //   PolicyType: 'TargetTrackingScaling',
      //   TargetTrackingConfiguration: {
      //     PredefinedMetricSpecification: { PredefinedMetricType: 'ASGAverageCPUUtilization' },
      //     TargetValue: 30,
      //   },
      // });
    });

    test("network ingress", () => {
      // GIVEN
      const stack = newStack();
      const fixture = new ASGFixture(stack, "Fixture");

      // WHEN
      fixture.asg.scaleOnIncomingBytes("ScaleNetwork", {
        targetBytesPerSecond: 100,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingPolicy.AutoscalingPolicy,
        {
          policy_type: "TargetTrackingScaling",
          target_tracking_configuration: {
            predefined_metric_specification: {
              predefined_metric_type: "ASGAverageNetworkIn",
            },
            target_value: 100,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
      //   PolicyType: 'TargetTrackingScaling',
      //   TargetTrackingConfiguration: {
      //     PredefinedMetricSpecification: { PredefinedMetricType: 'ASGAverageNetworkIn' },
      //     TargetValue: 100,
      //   },
      // });
    });

    test("network egress", () => {
      // GIVEN
      const stack = newStack();
      const fixture = new ASGFixture(stack, "Fixture");

      // WHEN
      fixture.asg.scaleOnOutgoingBytes("ScaleNetwork", {
        targetBytesPerSecond: 100,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingPolicy.AutoscalingPolicy,
        {
          policy_type: "TargetTrackingScaling",
          target_tracking_configuration: {
            predefined_metric_specification: {
              predefined_metric_type: "ASGAverageNetworkOut",
            },
            target_value: 100,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
      //   PolicyType: 'TargetTrackingScaling',
      //   TargetTrackingConfiguration: {
      //     PredefinedMetricSpecification: { PredefinedMetricType: 'ASGAverageNetworkOut' },
      //     TargetValue: 100,
      //   },
      // });
    });

    test("request count per second", () => {
      // GIVEN
      const stack = newStack();
      const fixture = new ASGFixture(stack, "Fixture");
      const alb = new ApplicationLoadBalancer(stack, "ALB", {
        vpc: fixture.vpc,
      });
      const listener = alb.addListener("Listener", { port: 80 });
      const targetGroup = listener.addTargets("Targets", {
        port: 80,
        targets: [fixture.asg],
      });

      // WHEN
      fixture.asg.scaleOnRequestCount("ScaleRequest", {
        targetRequestsPerSecond: 10,
      });

      // THEN
      // Terraform deviation: the CFN Fn::Split/Fn::Select/Fn::GetAtt/Fn::Join
      // expression upstream asserts against has no Terraform-JSON equivalent -
      // `resourceLabel` is instead built (see
      // AutoScalingGroupBase.scaleOnRequestCount in
      // src/aws/compute/auto-scaling/auto-scaling-group.ts) from the same
      // `firstLoadBalancerFullName`/`parseTargetGroupFullName` helpers the
      // production code uses, then resolved the same way the synthesized
      // template resolves it.
      const expectedResourceLabel = stack.resolve(
        `${targetGroup.firstLoadBalancerFullName}/${parseTargetGroupFullName(targetGroup.targetGroupArn)}`,
      );

      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingPolicy.AutoscalingPolicy,
        {
          policy_type: "TargetTrackingScaling",
          target_tracking_configuration: {
            target_value: 600,
            predefined_metric_specification: {
              predefined_metric_type: "ALBRequestCountPerTarget",
              resource_label: expectedResourceLabel,
            },
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
      //   PolicyType: 'TargetTrackingScaling',
      //   TargetTrackingConfiguration: {
      //     TargetValue: 600,
      //     PredefinedMetricSpecification: {
      //       PredefinedMetricType: 'ALBRequestCountPerTarget',
      //       ResourceLabel: { 'Fn::Join': [...] },
      //     },
      //   },
      // });
    });

    test("request count per minute", () => {
      // GIVEN
      const stack = newStack();
      const fixture = new ASGFixture(stack, "Fixture");
      const alb = new ApplicationLoadBalancer(stack, "ALB", {
        vpc: fixture.vpc,
      });
      const listener = alb.addListener("Listener", { port: 80 });
      const targetGroup = listener.addTargets("Targets", {
        port: 80,
        targets: [fixture.asg],
      });

      // WHEN
      fixture.asg.scaleOnRequestCount("ScaleRequest", {
        targetRequestsPerMinute: 10,
      });

      // THEN
      const expectedResourceLabel = stack.resolve(
        `${targetGroup.firstLoadBalancerFullName}/${parseTargetGroupFullName(targetGroup.targetGroupArn)}`,
      );

      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingPolicy.AutoscalingPolicy,
        {
          policy_type: "TargetTrackingScaling",
          target_tracking_configuration: {
            target_value: 10,
            predefined_metric_specification: {
              predefined_metric_type: "ALBRequestCountPerTarget",
              resource_label: expectedResourceLabel,
            },
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
      //   PolicyType: 'TargetTrackingScaling',
      //   TargetTrackingConfiguration: {
      //     TargetValue: 10,
      //     PredefinedMetricSpecification: {
      //       PredefinedMetricType: 'ALBRequestCountPerTarget',
      //       ResourceLabel: { 'Fn::Join': [...] },
      //     },
      //   },
      // });
    });

    test("custom metric", () => {
      // GIVEN
      const stack = newStack();
      const fixture = new ASGFixture(stack, "Fixture");

      // WHEN
      fixture.asg.scaleToTrackMetric("Metric", {
        metric: new cloudwatch.Metric({
          metricName: "Henk",
          namespace: "Test",
          dimensionsMap: {
            Mustache: "Bushy",
          },
        }),
        targetValue: 2,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingPolicy.AutoscalingPolicy,
        {
          policy_type: "TargetTrackingScaling",
          target_tracking_configuration: {
            customized_metric_specification: {
              metric_dimension: [{ name: "Mustache", value: "Bushy" }],
              metric_name: "Henk",
              namespace: "Test",
              statistic: "Average",
            },
            target_value: 2,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
      //   PolicyType: 'TargetTrackingScaling',
      //   TargetTrackingConfiguration: {
      //     CustomizedMetricSpecification: {
      //       Dimensions: [{ Name: 'Mustache', Value: 'Bushy' }],
      //       MetricName: 'Henk',
      //       Namespace: 'Test',
      //       Statistic: 'Average',
      //     },
      //     TargetValue: 2,
      //   },
      // });
    });
  });

  test("setting cooldown on step scaling is ineffective", () => {
    // GIVEN
    const stack = newStack();
    const vpc = new Vpc(stack, "Vpc");
    const autoScalingGroup = new autoscaling.AutoScalingGroup(stack, "ASG", {
      minCapacity: 1,
      maxCapacity: 100,
      instanceType: new InstanceType("t-1000.macro"),
      machineImage: new AmazonLinuxImage(),
      vpc,
    });
    new autoscaling.StepScalingAction(stack, "Action", {
      autoScalingGroup,
      cooldown: Duration.days(1),
    });

    // THEN
    // Terraform deviation: unlike CloudFormation's CfnScalingPolicy (which
    // still writes an ineffective `Cooldown` property for StepScaling-type
    // policies), StepScalingAction never passes `cooldown` through to the
    // underlying aws_autoscaling_policy resource at all - see
    // src/aws/compute/auto-scaling/step-scaling-action.ts. Only the warning
    // annotation is preserved from the upstream behavior.
    Annotations.fromStack(stack).hasWarnings({
      constructPath: "Default/Action",
      message: expect.stringMatching(
        /'Cooldown' is valid only if the policy type is SimpleScaling\. Default to ignore the values set\./,
      ),
    });
    // expect(() => Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
    //   CoolDown: undefined,
    // })).toThrow(/Template has 1 resources with type AWS::AutoScaling::ScalingPolicy, but none match as expected/);

    const policies = Template.resourceObjects(
      stack,
      autoscalingPolicy.AutoscalingPolicy,
    );
    const [policy] = Object.values(policies) as any[];
    expect(policy.cooldown).toBeUndefined();
  });

  test("step scaling", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    // WHEN
    const policy = fixture.asg.scaleOnMetric("Metric", {
      metric: new cloudwatch.Metric({
        metricName: "Legs",
        namespace: "Henk",
        dimensionsMap: { Mustache: "Bushy" },
      }),
      estimatedInstanceWarmup: Duration.seconds(150),
      // Adjust the number of legs to be closer to 2
      scalingSteps: [
        { lower: 0, upper: 2, change: +1 },
        { lower: 3, upper: 5, change: -1 },
        { lower: 5, change: -2 }, // Must work harder to remove legs
      ],
    });

    // THEN: scaling in policy
    // Terraform deviation: `step_adjustment` is populated via a lazily
    // produced list (see StepScalingAction.addAdjustment in
    // src/aws/compute/auto-scaling/step-scaling-action.ts) rather than the
    // resource's regular attribute mapping, so the entries keep their
    // camelCase field names in the synthesized JSON instead of being
    // snake_cased like the surrounding resource properties.
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingPolicy.AutoscalingPolicy,
      {
        metric_aggregation_type: "Average",
        policy_type: "StepScaling",
        step_adjustment: [
          {
            metricIntervalLowerBound: "0",
            metricIntervalUpperBound: "2",
            scalingAdjustment: -1,
          },
          {
            metricIntervalLowerBound: "2",
            scalingAdjustment: -2,
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
    //   MetricAggregationType: 'Average',
    //   PolicyType: 'StepScaling',
    //   StepAdjustments: [
    //     { MetricIntervalLowerBound: 0, MetricIntervalUpperBound: 2, ScalingAdjustment: -1 },
    //     { MetricIntervalLowerBound: 2, ScalingAdjustment: -2 },
    //   ],
    // });

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "GreaterThanOrEqualToThreshold",
        threshold: 3,
        alarm_actions: [stack.resolve(policy.upperAction!.scalingPolicyArn)],
        alarm_description: "Upper threshold scaling alarm",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
    //   ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    //   Threshold: 3,
    //   AlarmActions: [{ Ref: 'FixtureASGMetricUpperPolicyC464CAFB' }],
    //   AlarmDescription: 'Upper threshold scaling alarm',
    // });

    // THEN: scaling out policy
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingPolicy.AutoscalingPolicy,
      {
        metric_aggregation_type: "Average",
        policy_type: "StepScaling",
        estimated_instance_warmup: 150,
        step_adjustment: [
          {
            metricIntervalUpperBound: "0",
            scalingAdjustment: 1,
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
    //   MetricAggregationType: 'Average',
    //   PolicyType: 'StepScaling',
    //   EstimatedInstanceWarmup: 150,
    //   StepAdjustments: [{ MetricIntervalUpperBound: 0, ScalingAdjustment: 1 }],
    // });

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "LessThanOrEqualToThreshold",
        threshold: 2,
        alarm_actions: [stack.resolve(policy.lowerAction!.scalingPolicyArn)],
        alarm_description: "Lower threshold scaling alarm",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
    //   ComparisonOperator: 'LessThanOrEqualToThreshold',
    //   Threshold: 2,
    //   AlarmActions: [{ Ref: 'FixtureASGMetricLowerPolicy4A1CDE42' }],
    //   AlarmDescription: 'Lower threshold scaling alarm',
    // });
  });
});

test("step scaling from percentile metric", () => {
  // GIVEN
  const stack = newStack();
  const fixture = new ASGFixture(stack, "Fixture");

  // WHEN
  fixture.asg.scaleOnMetric("Tracking", {
    metric: new cloudwatch.Metric({
      namespace: "Test",
      metricName: "Metric",
      statistic: "p99",
    }),
    scalingSteps: [
      { upper: 0, change: -1 },
      { lower: 100, change: +1 },
      { lower: 500, change: +5 },
    ],
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    autoscalingPolicy.AutoscalingPolicy,
    {
      policy_type: "StepScaling",
      metric_aggregation_type: "Average",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
  //   PolicyType: 'StepScaling',
  //   MetricAggregationType: 'Average',
  // });

  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      comparison_operator: "GreaterThanOrEqualToThreshold",
      evaluation_periods: 1,
      extended_statistic: "p99",
      metric_name: "Metric",
      namespace: "Test",
      threshold: 100,
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
  //   ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  //   EvaluationPeriods: 1,
  //   AlarmActions: [{ Ref: 'FixtureASGTrackingUpperPolicy27D4301F' }],
  //   ExtendedStatistic: 'p99',
  //   MetricName: 'Metric',
  //   Namespace: 'Test',
  //   Threshold: 100,
  // });
});

test("step scaling with adjustmentType by default", () => {
  // GIVEN
  const stack = newStack();
  const fixture = new ASGFixture(stack, "Fixture");

  // WHEN
  fixture.asg.scaleOnMetric("Tracking", {
    metric: new cloudwatch.Metric({
      namespace: "Test",
      metricName: "Metric",
      statistic: "p99",
    }),
    scalingSteps: [
      { upper: 0, change: -1 },
      { lower: 100, change: +1 },
      { lower: 500, change: +5 },
    ],
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    autoscalingPolicy.AutoscalingPolicy,
    {
      policy_type: "StepScaling",
      adjustment_type: "ChangeInCapacity",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
  //   PolicyType: 'StepScaling',
  //   AdjustmentType: 'ChangeInCapacity',
  // });
});

test("step scaling with evaluation period configured", () => {
  // GIVEN
  const stack = newStack();
  const fixture = new ASGFixture(stack, "Fixture");

  // WHEN
  fixture.asg.scaleOnMetric("Tracking", {
    metric: new cloudwatch.Metric({
      namespace: "Test",
      metricName: "Metric",
      statistic: "p99",
    }),
    scalingSteps: [
      { upper: 0, change: -1 },
      { lower: 100, change: +1 },
      { lower: 500, change: +5 },
    ],
    evaluationPeriods: 10,
    metricAggregationType: autoscaling.MetricAggregationType.MAXIMUM,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    autoscalingPolicy.AutoscalingPolicy,
    {
      policy_type: "StepScaling",
      metric_aggregation_type: "Maximum",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
  //   PolicyType: 'StepScaling',
  //   MetricAggregationType: 'Maximum',
  // });

  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      comparison_operator: "GreaterThanOrEqualToThreshold",
      evaluation_periods: 10,
      extended_statistic: "p99",
      metric_name: "Metric",
      namespace: "Test",
      threshold: 100,
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
  //   ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  //   EvaluationPeriods: 10,
  //   ExtendedStatistic: 'p99',
  //   MetricName: 'Metric',
  //   Namespace: 'Test',
  //   Threshold: 100,
  // });
});

test("step scaling with invalid evaluation period throws error", () => {
  // GIVEN
  const stack = newStack();
  const fixture = new ASGFixture(stack, "Fixture");

  // THEN
  expect(() => {
    fixture.asg.scaleOnMetric("Tracking", {
      metric: new cloudwatch.Metric({
        namespace: "Test",
        metricName: "Metric",
        statistic: "p99",
      }),
      scalingSteps: [
        { upper: 0, change: -1 },
        { lower: 100, change: +1 },
        { lower: 500, change: +5 },
      ],
      evaluationPeriods: 0,
      metricAggregationType: autoscaling.MetricAggregationType.MAXIMUM,
    });
  }).toThrow(/evaluationPeriods cannot be less than 1, got: 0/);
});

describe("datapointsToAlarm", () => {
  test("step scaling with evaluation period and data points to alarm configured", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    // WHEN
    fixture.asg.scaleOnMetric("Tracking", {
      metric: new cloudwatch.Metric({
        namespace: "Test",
        metricName: "Metric",
        statistic: "p99",
      }),
      scalingSteps: [
        { upper: 0, change: -1 },
        { lower: 100, change: +1 },
        { lower: 500, change: +5 },
      ],
      evaluationPeriods: 10,
      datapointsToAlarm: 10,
      metricAggregationType: autoscaling.MetricAggregationType.MAXIMUM,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingPolicy.AutoscalingPolicy,
      {
        policy_type: "StepScaling",
        metric_aggregation_type: "Maximum",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScalingPolicy', {
    //   PolicyType: 'StepScaling',
    //   MetricAggregationType: 'Maximum',
    // });

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "GreaterThanOrEqualToThreshold",
        evaluation_periods: 10,
        datapoints_to_alarm: 10,
        extended_statistic: "p99",
        metric_name: "Metric",
        namespace: "Test",
        threshold: 100,
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
    //   ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    //   EvaluationPeriods: 10,
    //   DatapointsToAlarm: 10,
    //   ExtendedStatistic: 'p99',
    //   MetricName: 'Metric',
    //   Namespace: 'Test',
    //   Threshold: 100,
    // });
  });

  test("step scaling with invalid datapointsToAlarm throws error", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    // THEN
    expect(() => {
      fixture.asg.scaleOnMetric("Tracking", {
        metric: new cloudwatch.Metric({
          namespace: "Test",
          metricName: "Metric",
          statistic: "p99",
        }),
        scalingSteps: [
          { upper: 0, change: -1 },
          { lower: 100, change: +1 },
          { lower: 500, change: +5 },
        ],
        evaluationPeriods: 10,
        datapointsToAlarm: 0,
        metricAggregationType: autoscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow(/datapointsToAlarm cannot be less than 1, got: 0/);
  });

  test("step scaling with datapointsToAlarm is greater than evaluationPeriods throws error", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    // THEN
    expect(() => {
      fixture.asg.scaleOnMetric("Tracking", {
        metric: new cloudwatch.Metric({
          namespace: "Test",
          metricName: "Metric",
          statistic: "p99",
        }),
        scalingSteps: [
          { upper: 0, change: -1 },
          { lower: 100, change: +1 },
          { lower: 500, change: +5 },
        ],
        evaluationPeriods: 10,
        datapointsToAlarm: 15,
        metricAggregationType: autoscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow(
      /datapointsToAlarm must be less than or equal to evaluationPeriods, got datapointsToAlarm: 15, evaluationPeriods: 10/,
    );
  });

  test("step scaling with datapointsToAlarm without evaluationPeriods throws error", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    // THEN
    expect(() => {
      fixture.asg.scaleOnMetric("Tracking", {
        metric: new cloudwatch.Metric({
          namespace: "Test",
          metricName: "Metric",
          statistic: "p99",
        }),
        scalingSteps: [
          { upper: 0, change: -1 },
          { lower: 100, change: +1 },
          { lower: 500, change: +5 },
        ],
        datapointsToAlarm: 15,
        metricAggregationType: autoscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow(/evaluationPeriods must be set if datapointsToAlarm is set/);
  });
});

describe("step-scaling-policy scalingSteps length validation checks", () => {
  test("scalingSteps must have at least 2 steps", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    expect(() => {
      fixture.asg.scaleOnMetric("Metric", {
        metric: new cloudwatch.Metric({
          metricName: "Legs",
          namespace: "Henk",
          dimensionsMap: { Mustache: "Bushy" },
        }),
        estimatedInstanceWarmup: Duration.seconds(150),
        // only one scaling step throws an error.
        scalingSteps: [{ lower: 0, upper: 2, change: +1 }],
      });
    }).toThrow(/must supply at least 2/);
  });

  test("scalingSteps has a maximum of 40 steps", () => {
    // GIVEN
    const stack = newStack();
    const fixture = new ASGFixture(stack, "Fixture");

    const numSteps = 41;
    const messagesPerTask = 20;
    let steps: autoscaling.ScalingInterval[] = [];

    for (let i = 0; i < numSteps; ++i) {
      const step: autoscaling.ScalingInterval = {
        lower: i * messagesPerTask,
        upper: i * (messagesPerTask + 1) - 1,
        change: i + 1,
      };
      steps.push(step);
    }

    expect(() => {
      fixture.asg.scaleOnMetric("Metric", {
        metric: new cloudwatch.Metric({
          metricName: "Legs",
          namespace: "Henk",
          dimensionsMap: { Mustache: "Bushy" },
        }),
        estimatedInstanceWarmup: Duration.seconds(150),
        scalingSteps: steps,
      });
    }).toThrow("'scalingSteps' can have at most 40 steps, got 41");
  });
});

function newStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app);
}

class ASGFixture extends Construct {
  public readonly vpc: Vpc;
  public readonly asg: autoscaling.AutoScalingGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new Vpc(this, "VPC");
    this.asg = new autoscaling.AutoScalingGroup(this, "ASG", {
      vpc: this.vpc,
      instanceType: InstanceType.of(InstanceClass.M4, InstanceSize.MICRO),
      machineImage: new AmazonLinuxImage(),
    });
  }
}
