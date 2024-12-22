// https://github.com/aws/aws-cdk/blob/18fbd6d5a1a3069b0fc1356d87e534a75239e668/packages/aws-cdk-lib/aws-kinesis/test/resource-policy.test.ts

import {
  kinesisResourcePolicy,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec } from "../../../src/aws";
import * as iam from "../../../src/aws/iam";
import { Stream } from "../../../src/aws/notify/kinesis-stream";
import { ResourcePolicy } from "../../../src/aws/notify/resource-policy";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("Kinesis resource policy", () => {
  let app: App;
  let spec: AwsSpec;

  beforeEach(() => {
    app = Testing.app();
    spec = new AwsSpec(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("create resource policy", () => {
    // GIVEN
    const stream = new Stream(spec, "Stream", {});

    // WHEN
    const policyDocument = new iam.PolicyDocument(spec, "PolicyDocument", {
      assignSids: true,
      statement: [
        new iam.PolicyStatement({
          actions: ["kinesis:GetRecords"],
          principals: [new iam.AnyPrincipal()],
          resources: [stream.streamArn],
        }),
      ],
    });

    new ResourcePolicy(spec, "ResourcePolicy", {
      stream,
      policyDocument,
    });

    // THEN
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
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
    expect(synthesized).toHaveResourceWithProperties(
      kinesisResourcePolicy.KinesisResourcePolicy,
      {
        policy: "${data.aws_iam_policy_document.PolicyDocument_5B97F349.json}",
        resource_arn: "${aws_kinesis_stream.Stream_790BDEE4.arn}",
      },
    );
    // Template.fromStack(spec).hasResourceProperties(
    //   "AWS::Kinesis::ResourcePolicy",
    //   {
    //     ResourcePolicy: {
    //       Version: "2012-10-17",
    //       Statement: [
    //         {
    //           Sid: "0",
    //           Action: "kinesis:GetRecords",
    //           Effect: "Allow",
    //           Principal: { AWS: "*" },
    //           Resource: spec.resolve(stream.streamArn),
    //         },
    //       ],
    //     },
    //   },
    // );
  });
});
