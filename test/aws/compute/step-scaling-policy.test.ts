import {
  appautoscalingPolicy,
  // appautoscalingTarget,
  cloudwatchMetricAlarm,
} from "@cdktf/provider-aws";
import { Testing, App } from "cdktf";
import * as fc from "fast-check";
import "cdktf/lib/testing/adapters/jest";
import { arbitrary_input_intervals, createScalableTarget } from "./util";
import { Template } from "../../assertions";
import { Metric } from "../../../src/aws/cloudwatch";
import { AwsStack } from "../../../src/aws";
// import { Duration } from "../../../src/duration";
import * as appscaling from "../../../src/aws/compute";

const environmentName = "TestEnv";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const defaultGridBackendConfig = { address: "http://localhost:3000" };

describe("step scaling policy", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig: defaultGridBackendConfig,
    });
  });

  test("alarm thresholds are valid numbers", () => {
    fc.assert(
      fc.property(arbitrary_input_intervals(), (intervals) => {
        const template = setupStepScaling(intervals);

        const lowerThreshold = template.lowerThreshold;
        const upperThreshold = template.upperThreshold;

        return reportFalse(
          (lowerThreshold === undefined ||
            (lowerThreshold > 0 && lowerThreshold !== Infinity)) &&
            (upperThreshold === undefined ||
              (upperThreshold > 0 && upperThreshold !== Infinity)),
          lowerThreshold,
          upperThreshold,
        );
      }),
    );
  });

  test("generated step intervals are valid intervals", () => {
    fc.assert(
      fc.property(arbitrary_input_intervals(), (intervals) => {
        const template = setupStepScaling(intervals);
        const steps = template.allStepsAbsolute();

        return reportFalse(
          steps.every((step) => {
            return (
              step.MetricIntervalLowerBound! < step.MetricIntervalUpperBound!
            );
          }),
          steps,
          "template",
          JSON.stringify(template, undefined, 2),
        );
      }),
    );
  });

  test("generated step intervals are nonoverlapping", () => {
    fc.assert(
      fc.property(arbitrary_input_intervals(), (intervals) => {
        const template = setupStepScaling(intervals);
        const steps = template.allStepsAbsolute();

        for (let i = 0; i < steps.length; i++) {
          const compareTo = steps.slice(i + 1);
          if (compareTo.some((x) => overlaps(steps[i], x))) {
            return reportFalse(false, steps);
          }
        }

        return true;
      }),
      { verbose: true },
    );
  });

  test("all template intervals occur in input array", () => {
    fc.assert(
      fc.property(arbitrary_input_intervals(), (intervals) => {
        const template = setupStepScaling(intervals);
        const steps = template.allStepsAbsolute();

        return steps.every((step) => {
          return reportFalse(
            intervals.find((interval) => {
              const acceptableLowerBounds =
                step.MetricIntervalLowerBound === -Infinity
                  ? [undefined, 0]
                  : [undefined, step.MetricIntervalLowerBound];
              const acceptableUpperBounds =
                step.MetricIntervalUpperBound === Infinity
                  ? [undefined, Infinity]
                  : [undefined, step.MetricIntervalUpperBound];

              return (
                acceptableLowerBounds.includes(interval.lower) &&
                acceptableUpperBounds.includes(interval.upper)
              );
            }) !== undefined,
            step,
            intervals,
          );
        });
      }),
    );
  });

  test("lower alarm uses lower policy", () => {
    fc.assert(
      fc.property(arbitrary_input_intervals(), (intervals) => {
        const template = setupStepScaling(intervals);
        const alarm = template.lowerAlarm;
        fc.pre(alarm !== undefined);

        return reportFalse(
          alarm.alarm_actions?.some((actionArn: string) =>
            // verify some action Arn contains a ref to the lower Policy
            actionArn.includes(template.lowerPolicyLogicalName),
          ),
          alarm,
        );
      }),
    );
  });

  test("upper alarm uses upper policy", () => {
    fc.assert(
      fc.property(arbitrary_input_intervals(), (intervals) => {
        const template = setupStepScaling(intervals);
        const alarm = template.upperAlarm;
        fc.pre(alarm !== undefined);

        return reportFalse(
          alarm.alarm_actions?.some((actionArn: string) =>
            // verify some action Arn contains a ref to the lower Policy
            actionArn.includes(template.upperPolicyLogicalName),
          ),
          alarm,
        );
      }),
    );
  });

  test("test step scaling on metric", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnMetric("Tracking", {
      metric: new Metric({ namespace: "Test", metricName: "Metric" }),
      scalingSteps: [
        { upper: 0, change: -1 },
        { lower: 100, change: +1 },
        { lower: 500, change: +5 },
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "StepScaling",
        resource_id: stack.resolve(target.resourceId),
        step_scaling_policy_configuration: {
          adjustment_type: "ChangeInCapacity",
          metric_aggregation_type: "Average",
          step_adjustment: [
            {
              metric_interval_upper_bound: "0", // String in TF provider for bounds
              scaling_adjustment: -1,
            },
          ],
        },
      },
    );
  });

  test("step scaling from percentile metric", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnMetric("Tracking", {
      metric: new Metric({
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
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "StepScaling",
        step_scaling_policy_configuration: expect.objectContaining({
          adjustment_type: "ChangeInCapacity",
          metric_aggregation_type: "Average",
        }),
      },
    );
    t.expect.toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "GreaterThanOrEqualToThreshold",
        evaluation_periods: 1,
        // alarm_actions: [stack.resolve(policy.upperPolicy.arn)], // Need to get the policy ARN
        extended_statistic: "p99",
        metric_name: "Metric",
        namespace: "Test",
        threshold: 100,
      },
    );
  });

  test("step scaling with evaluation period configured", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnMetric("Tracking", {
      metric: new Metric({
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
      metricAggregationType: appscaling.MetricAggregationType.MAXIMUM,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "StepScaling",
        step_scaling_policy_configuration: expect.objectContaining({
          adjustment_type: "ChangeInCapacity",
          metric_aggregation_type: "Maximum",
        }),
      },
    );
    t.expect.toHaveResourceWithProperties(
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
  });

  test("step scaling with invalid evaluation period throws error", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // THEN
    expect(() => {
      target.scaleOnMetric("Tracking", {
        metric: new Metric({
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
        metricAggregationType: appscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow(/evaluationPeriods cannot be less than 1, got: 0/);
  });

  test("step scaling with evaluation period & data points to alarm configured", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // WHEN
    target.scaleOnMetric("Tracking", {
      metric: new Metric({
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
      datapointsToAlarm: 6,
      metricAggregationType: appscaling.MetricAggregationType.MAXIMUM,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "StepScaling",
        step_scaling_policy_configuration: expect.objectContaining({
          adjustment_type: "ChangeInCapacity",
          metric_aggregation_type: "Maximum",
        }),
      },
    );
    t.expect.toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        comparison_operator: "GreaterThanOrEqualToThreshold",
        evaluation_periods: 10,
        datapoints_to_alarm: 6,
        extended_statistic: "p99",
        metric_name: "Metric",
        namespace: "Test",
        threshold: 100,
      },
    );
  });

  test("step scaling with invalid datapointsToAlarm throws error", () => {
    const target = createScalableTarget(stack);

    expect(() => {
      target.scaleOnMetric("Tracking", {
        metric: new Metric({
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
        metricAggregationType: appscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow("datapointsToAlarm cannot be less than 1, got: 0");
  });

  test("step scaling with datapointsToAlarm is greater than evaluationPeriods throws error", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // THEN
    expect(() => {
      target.scaleOnMetric("Tracking", {
        metric: new Metric({
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
        metricAggregationType: appscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow(
      /datapointsToAlarm must be less than or equal to evaluationPeriods, got datapointsToAlarm: 15, evaluationPeriods: 10/,
    );
  });

  test("step scaling with datapointsToAlarm without evaluationPeriods throws error", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    // THEN
    expect(() => {
      target.scaleOnMetric("Tracking", {
        metric: new Metric({
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
        metricAggregationType: appscaling.MetricAggregationType.MAXIMUM,
      });
    }).toThrow(/evaluationPeriods must be set if datapointsToAlarm is set/);
  });

  test("scalingSteps must have at least 2 steps", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    expect(() => {
      target.scaleOnMetric("Tracking", {
        metric: new Metric({ namespace: "Test", metricName: "Metric" }),
        scalingSteps: [{ lower: 0, upper: 2, change: +1 }],
      });
    }).toThrow(/must supply at least 2/);
  });

  test("scalingSteps has a maximum of 40 steps", () => {
    // GIVEN
    const target = createScalableTarget(stack);

    const numSteps = 41;
    const messagesPerTask = 20;
    const steps: appscaling.ScalingInterval[] = [];

    for (let i = 0; i < numSteps; ++i) {
      const step: appscaling.ScalingInterval = {
        lower: i * messagesPerTask,
        upper: i * (messagesPerTask + 1) - 1,
        change: i + 1,
      };
      steps.push(step);
    }

    expect(() => {
      target.scaleOnMetric("Tracking", {
        metric: new Metric({ namespace: "Test", metricName: "Metric" }),
        scalingSteps: steps,
      });
    }).toThrow("'scalingSteps' can have at most 40 steps, got 41");
  });
});

/**
 * Synthesize the given step scaling setup to a template
 */
function setupStepScaling(intervals: appscaling.ScalingInterval[]) {
  const stack = new AwsStack(Testing.app(), "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig: defaultGridBackendConfig,
  });
  const target = createScalableTarget(stack);

  target.scaleOnMetric("ScaleInterval", {
    metric: new Metric({ namespace: "Test", metricName: "Success" }),
    scalingSteps: intervals,
  });

  return new ScalingStackTemplate(new Template(stack));
}

interface TemplateStep {
  MetricIntervalLowerBound?: number;
  MetricIntervalUpperBound?: number;
  ScalingAdjustment: number;
}

class ScalingStackTemplate {
  public readonly lowerPolicy?: any;
  public readonly upperPolicy?: any;
  public readonly lowerAlarm?: any;
  public readonly upperAlarm?: any;

  public readonly lowerPolicyLogicalName =
    "Target_ScaleInterval_LowerPolicy_6F26D597";
  public readonly upperPolicyLogicalName =
    "Target_ScaleInterval_UpperPolicy_7C751132";

  constructor(private readonly template: Template) {
    const policies = this.template.resourcesByType(
      appautoscalingPolicy.AppautoscalingPolicy,
    );
    const alarms = this.template.resourcesByType(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    );

    this.lowerPolicy = policies[this.lowerPolicyLogicalName];
    this.upperPolicy = policies[this.upperPolicyLogicalName];
    this.lowerAlarm = alarms["Target_ScaleInterval_LowerAlarm_4B5CE869"];
    this.upperAlarm = alarms["Target_ScaleInterval_UpperAlarm_69FD1BBB"];
  }

  public get lowerThreshold(): number | undefined {
    return this.lowerAlarm?.threshold;
  }

  public get upperThreshold(): number | undefined {
    return this.upperAlarm?.threshold;
  }

  public get lowerSteps(): TemplateStep[] | undefined {
    return this.lowerPolicy?.step_scaling_policy_configuration?.step_adjustment?.map(
      (s: any) => ({
        MetricIntervalLowerBound:
          s.metric_interval_lower_bound !== undefined
            ? parseFloat(s.metric_interval_lower_bound)
            : undefined,
        MetricIntervalUpperBound:
          s.metric_interval_upper_bound !== undefined
            ? parseFloat(s.metric_interval_upper_bound)
            : undefined,
        ScalingAdjustment: s.scaling_adjustment,
      }),
    );
  }

  public get upperSteps(): TemplateStep[] | undefined {
    return this.upperPolicy?.step_scaling_policy_configuration?.step_adjustment?.map(
      (s: any) => ({
        MetricIntervalLowerBound:
          s.metric_interval_lower_bound !== undefined
            ? parseFloat(s.metric_interval_lower_bound)
            : undefined,
        MetricIntervalUpperBound:
          s.metric_interval_upper_bound !== undefined
            ? parseFloat(s.metric_interval_upper_bound)
            : undefined,
        ScalingAdjustment: s.scaling_adjustment,
      }),
    );
  }

  public allStepsAbsolute(): TemplateStep[] {
    const ret = new Array<TemplateStep>();
    const lowerThreshold = this.lowerThreshold;
    if (lowerThreshold !== undefined && this.lowerSteps) {
      ret.push(...this.lowerSteps!.map((x) => makeAbsolute(lowerThreshold, x)));
    }

    const upperThreshold = this.upperThreshold;
    if (upperThreshold !== undefined && this.upperSteps) {
      ret.push(...this.upperSteps!.map((x) => makeAbsolute(upperThreshold, x)));
    }

    return ret;
  }
}

function makeAbsolute(threshold: number, step: TemplateStep): TemplateStep {
  return concrete({
    MetricIntervalLowerBound: apply(
      step.MetricIntervalLowerBound,
      (x) => x + threshold,
    ),
    MetricIntervalUpperBound: apply(
      step.MetricIntervalUpperBound,
      (x) => x + threshold,
    ),
    ScalingAdjustment: step.ScalingAdjustment,
  });
}

function overlaps(a: TemplateStep, b: TemplateStep): boolean {
  return (
    a.MetricIntervalLowerBound! < b.MetricIntervalUpperBound! &&
    a.MetricIntervalUpperBound! > b.MetricIntervalLowerBound!
  );
}

function concrete(step: TemplateStep): TemplateStep {
  return {
    MetricIntervalLowerBound: ifUndefined(
      step.MetricIntervalLowerBound,
      -Infinity,
    ),
    MetricIntervalUpperBound: ifUndefined(
      step.MetricIntervalUpperBound,
      Infinity,
    ),
    ScalingAdjustment: step.ScalingAdjustment,
  };
}

function ifUndefined<T>(x: T | undefined, def: T): T {
  return x !== undefined ? x : def;
}

function apply<T, U>(
  x: T | undefined,
  f: (x: T) => U | undefined,
): U | undefined {
  if (x === undefined) {
    return undefined;
  }
  return f(x);
}

/**
 * Helper function to print variables in case of a failing property check
 */
function reportFalse(cond: boolean, ...repr: any[]): boolean {
  if (!cond) {
     
    console.error("PROPERTY FAILS ON:", ...repr.map((r) => JSON.stringify(r)));
  }
  return cond;
}
