// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-logs/test/logstream.test.ts

import { cloudwatchLogStream } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec } from "../../../src/aws";
import { LogGroup, LogStream } from "../../../src/aws/cloudwatch";
import { Template } from "../../assertions";

const gridUUID = "123e4567-e89b-12d3";

describe("log stream", () => {
  test("simple instantiation", () => {
    // GIVEN
    const app = Testing.app();
    const spec = new AwsSpec(app, `TestSpec`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });

    // WHEN
    const logGroup = new LogGroup(spec, "LogGroup");

    new LogStream(spec, "Stream", {
      logGroup,
    });

    // THEN
    Template.synth(spec).toHaveResource(
      cloudwatchLogStream.CloudwatchLogStream,
    );
  });
});