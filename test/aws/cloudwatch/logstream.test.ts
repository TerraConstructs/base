// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-logs/test/logstream.test.ts

import { cloudwatchLogStream } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { LogGroup, LogStream } from "../../../src/aws/cloudwatch";
import { Template } from "../../assertions";

describe("log stream", () => {
  test("simple instantiation", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);

    // WHEN
    const logGroup = new LogGroup(stack, "LogGroup");

    new LogStream(stack, "Stream", {
      logGroup,
    });

    // THEN
    Template.synth(stack).toHaveResource(
      cloudwatchLogStream.CloudwatchLogStream,
    );
  });
});
