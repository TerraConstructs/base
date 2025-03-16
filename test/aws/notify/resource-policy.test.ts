// https://github.com/aws/aws-cdk/blob/18fbd6d5a1a3069b0fc1356d87e534a75239e668/packages/aws-cdk-lib/aws-kinesis/test/resource-policy.test.ts

import {
  kinesisResourcePolicy,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as iam from "../../../src/aws/iam";
import { Stream } from "../../../src/aws/notify/kinesis-stream";
import { ResourcePolicy } from "../../../src/aws/notify/resource-policy";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("Kinesis resource policy", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("create resource policy", () => {
    // GIVEN
    const stream = new Stream(stack, "Stream", {});

    // WHEN
    const policyDocument = new iam.PolicyDocument(stack, "PolicyDocument", {
      assignSids: true,
      statement: [
        new iam.PolicyStatement({
          actions: ["kinesis:GetRecords"],
          principals: [new iam.AnyPrincipal()],
          resources: [stream.streamArn],
        }),
      ],
    });

    new ResourcePolicy(stack, "ResourcePolicy", {
      stream,
      policyDocument,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kinesis:GetRecords"],
            effect: "Allow",
            principals: [
              {
                identifiers: ["*"],
                type: "AWS",
              },
            ],
            resources: ["${aws_kinesis_stream.Stream_790BDEE4.arn}"],
            sid: "0",
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(
      kinesisResourcePolicy.KinesisResourcePolicy,
      {
        policy: "${data.aws_iam_policy_document.PolicyDocument_5B97F349.json}",
        resource_arn: "${aws_kinesis_stream.Stream_790BDEE4.arn}",
      },
    );
  });
});
