// https://github.com/aws/aws-cdk/blob/4f8aae50884b9238b3e0862874bcca6daea72a31/packages/aws-cdk-lib/aws-logs/test/metricfilter.test.ts

import { cloudwatchLogMetricFilter } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec } from "../../../src/aws";
import {
  FilterPattern,
  LogGroup,
  MetricFilter,
  Metric,
  Unit,
} from "../../../src/aws/cloudwatch";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const region = "us-east-1";
const providerConfig = { region };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("metric filter", () => {
  let app: App;
  let stack: AwsSpec;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsSpec(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Spec props to match AWS CDK cross account support
      // account: "1234",
    });
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
        region, // in TerraConstructs the region is known and passed as a prop to the stack
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
        region, // in TerraConstructs the region is known and passed as a prop to the stack
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
