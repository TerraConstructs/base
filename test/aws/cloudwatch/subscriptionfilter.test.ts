// https://github.com/aws/aws-cdk/blob/0e95bf0032f1beada8a1806724ef241613c3b41d/packages/aws-cdk-lib/aws-logs/test/subscriptionfilter.test.ts

import { cloudwatchLogSubscriptionFilter } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec } from "../../../src/aws";
import {
  Distribution,
  FilterPattern,
  ILogGroup,
  ILogSubscriptionDestination,
  LogGroup,
  SubscriptionFilter,
} from "../../../src/aws/cloudwatch";
import { KinesisDestination } from "../../../src/aws/cloudwatch/log-destinations";
import { Stream } from "../../../src/aws/notify";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const region = "us-east-1";
const providerConfig = { region };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("subscription filter", () => {
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
    new SubscriptionFilter(stack, "Subscription", {
      logGroup,
      destination: new FakeDestination(),
      filterPattern: FilterPattern.literal("some pattern"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        destination_arn: "arn:bogus",
        filter_pattern: "some pattern",
        log_group_name: stack.resolve(logGroup.logGroupName),
      },
    );
  });

  test("specifying custom name", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    new SubscriptionFilter(stack, "Subscription", {
      logGroup,
      destination: new FakeDestination(),
      filterPattern: FilterPattern.literal("some pattern"),
      filterName: "CustomSubscriptionFilterName",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        destination_arn: "arn:bogus",
        filter_pattern: "some pattern",
        log_group_name: stack.resolve(logGroup.logGroupName),
        name: "CustomSubscriptionFilterName",
      },
    );
  });

  test("subscription filter with KinesisDestination can have distribution set.", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    const stream = new Stream(stack, "Stream");

    // WHEN
    new SubscriptionFilter(stack, "Subscription", {
      logGroup,
      destination: new KinesisDestination(stream),
      filterPattern: FilterPattern.literal("some pattern"),
      filterName: "CustomSubscriptionFilterName",
      distribution: Distribution.RANDOM,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        distribution: "Random",
      },
    );
  });

  test("subscription filter with non-KinesisDestination can not have distribution set.", () => {
    const logGroup = new LogGroup(stack, "LogGroup");

    expect(() => {
      new SubscriptionFilter(stack, "Subscription", {
        logGroup,
        destination: new FakeDestination(),
        filterPattern: FilterPattern.literal("some pattern"),
        filterName: "CustomSubscriptionFilterName",
        distribution: Distribution.RANDOM,
      });
    }).toThrow(
      "distribution property can only be used with KinesisDestination.",
    );
  });
});

class FakeDestination implements ILogSubscriptionDestination {
  public bind(_scope: Construct, _sourceLogGroup: ILogGroup) {
    return {
      arn: "arn:bogus",
    };
  }
}
