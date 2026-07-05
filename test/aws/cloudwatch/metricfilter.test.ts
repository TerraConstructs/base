// https://github.com/aws/aws-cdk/blob/4f8aae50884b9238b3e0862874bcca6daea72a31/packages/aws-cdk-lib/aws-logs/test/metricfilter.test.ts

import { cloudwatchLogMetricFilter } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  FilterPattern,
  LogGroup,
  MetricFilter,
  Metric,
  Unit,
} from "../../../src/aws/cloudwatch";
import { Template } from "../../assertions";

describe("metric filter", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
  });

  test("trivial instantiation", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    new MetricFilter(stack, "Subscription", {
      logGroup,
      metricNamespace: "AWS/Test",
      metricName: "Latency",
      filterName: "FooBazBar",
      metricValue: "$.latency",
      filterPattern: FilterPattern.exists("$.latency"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogMetricFilter.CloudwatchLogMetricFilter,
      {
        log_group_name: stack.resolve(logGroup.logGroupName),
        pattern: '{ $.latency = "*" }',
        metric_transformation: {
          namespace: "AWS/Test",
          name: "Latency",
          value: "$.latency",
        },
        name: "FooBazBar",
      },
      // {
      //   MetricTransformations: [
      //     {
      //       MetricNamespace: "AWS/Test",
      //       MetricName: "Latency",
      //       MetricValue: "$.latency",
      //     },
      //   ],
      //   FilterPattern: '{ $.latency = "*" }',
      //   LogGroupName: { Ref: "LogGroupF5B46931" },
      //   FilterName: "FooBazBar",
      // },
    );
  });

  test("with dimensions", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    new MetricFilter(stack, "Subscription", {
      logGroup,
      metricNamespace: "AWS/Test",
      metricName: "Latency",
      metricValue: "$.latency",
      filterPattern: FilterPattern.exists("$.latency"),
      dimensions: {
        Foo: "Bar",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogMetricFilter.CloudwatchLogMetricFilter,
      {
        log_group_name: stack.resolve(logGroup.logGroupName),
        pattern: '{ $.latency = "*" }',
        metric_transformation: {
          namespace: "AWS/Test",
          name: "Latency",
          value: "$.latency",
          dimensions: {
            Foo: "Bar",
          },
        },
      },
    );
    // .hasResourceProperties("AWS::Logs::MetricFilter", {
    //   MetricTransformations: [
    //     {
    //       MetricNamespace: "AWS/Test",
    //       MetricName: "Latency",
    //       MetricValue: "$.latency",
    //       Dimensions: [
    //         {
    //           Key: "Foo",
    //           Value: "Bar",
    //         },
    //       ],
    //     },
    //   ],
    //   FilterPattern: '{ $.latency = "*" }',
    //   LogGroupName: { Ref: "LogGroupF5B46931" },
    // });
  });

  test("should throw with more than 3 dimensions", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    expect(
      () =>
        new MetricFilter(stack, "Subscription", {
          logGroup,
          metricNamespace: "AWS/Test",
          metricName: "Latency",
          metricValue: "$.latency",
          filterPattern: FilterPattern.exists("$.latency"),
          dimensions: {
            Foo: "Bar",
            Bar: "Baz",
            Baz: "Qux",
            Qux: "Quux",
          },
        }),
    ).toThrow(
      /MetricFilter only supports a maximum of 3 dimensions but received/,
    );
  });

  test("metric filter exposes metric", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    const mf = new MetricFilter(stack, "Subscription", {
      logGroup,
      metricNamespace: "AWS/Test",
      metricName: "Latency",
      metricValue: "$.latency",
      filterPattern: FilterPattern.exists("$.latency"),
    });

    const metric = mf.metric();

    // THEN
    expect(metric).toEqual(
      new Metric({
        metricName: "Latency",
        namespace: "AWS/Test",
        statistic: "avg",
      }),
    );
  });

  test("metric filter exposes metric with custom statistic", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    const mf = new MetricFilter(stack, "Subscription", {
      logGroup,
      metricNamespace: "AWS/Test",
      metricName: "Latency",
      metricValue: "$.latency",
      filterPattern: FilterPattern.exists("$.latency"),
    });

    const metric = mf.metric({ statistic: "maximum" });

    // THEN
    expect(metric).toEqual(
      new Metric({
        metricName: "Latency",
        namespace: "AWS/Test",
        statistic: "maximum",
      }),
    );
  });

  test("with unit", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    new MetricFilter(stack, "Subscription", {
      logGroup,
      metricNamespace: "AWS/Test",
      metricName: "Latency",
      metricValue: "$.latency",
      filterPattern: FilterPattern.exists("$.latency"),
      dimensions: {
        Foo: "Bar",
      },
      unit: Unit.MILLISECONDS,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogMetricFilter.CloudwatchLogMetricFilter,
      {
        log_group_name: stack.resolve(logGroup.logGroupName),
        pattern: '{ $.latency = "*" }',
        metric_transformation: {
          namespace: "AWS/Test",
          name: "Latency",
          value: "$.latency",
          dimensions: {
            Foo: "Bar",
          },
          unit: "Milliseconds",
        },
      },
    );
    // .hasResourceProperties("AWS::Logs::MetricFilter", {
    //   MetricTransformations: [
    //     {
    //       MetricNamespace: "AWS/Test",
    //       MetricName: "Latency",
    //       MetricValue: "$.latency",
    //       Dimensions: [
    //         {
    //           Key: "Foo",
    //           Value: "Bar",
    //         },
    //       ],
    //       Unit: "Milliseconds",
    //     },
    //   ],
    //   FilterPattern: '{ $.latency = "*" }',
    //   LogGroupName: { Ref: "LogGroupF5B46931" },
    // });
  });

  test("with no unit", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    new MetricFilter(stack, "Subscription", {
      logGroup,
      metricNamespace: "AWS/Test",
      metricName: "Latency",
      metricValue: "$.latency",
      filterPattern: FilterPattern.exists("$.latency"),
      dimensions: {
        Foo: "Bar",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogMetricFilter.CloudwatchLogMetricFilter,
      {
        log_group_name: stack.resolve(logGroup.logGroupName),
        pattern: '{ $.latency = "*" }',
        metric_transformation: {
          namespace: "AWS/Test",
          name: "Latency",
          value: "$.latency",
          dimensions: {
            Foo: "Bar",
          },
        },
      },
    );
    // .hasResourceProperties("AWS::Logs::MetricFilter", {
    //   MetricTransformations: [
    //     {
    //       MetricNamespace: "AWS/Test",
    //       MetricName: "Latency",
    //       MetricValue: "$.latency",
    //       Dimensions: [
    //         {
    //           Key: "Foo",
    //           Value: "Bar",
    //         },
    //       ],
    //     },
    //   ],
    //   FilterPattern: '{ $.latency = "*" }',
    //   LogGroupName: { Ref: "LogGroupF5B46931" },
    // });
  });
});
