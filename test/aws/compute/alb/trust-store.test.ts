// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/trust-store.test.ts

import { lbTrustStore as tfTrustStore } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as elbv2 from "../../../../src/aws/compute";
import * as s3 from "../../../../src/aws/storage";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let app: App;
let stack: AwsStack;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

test("Trust Store with all properties", () => {
  // GIVEN
  const bucket = new s3.Bucket(stack, "Bucket");

  // WHEN
  new elbv2.TrustStore(stack, "TrustStore", {
    trustStoreName: "MyTrustStore",
    bucket,
    key: "dummy.pem",
    version: "test-version",
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    tfTrustStore.LbTrustStore,
    {
      ca_certificates_bundle_s3_bucket: stack.resolve(bucket.bucketName),
      ca_certificates_bundle_s3_key: "dummy.pem",
      ca_certificates_bundle_s3_object_version: "test-version",
      name: "MyTrustStore",
    },
  );
});

test("Trust Store with required properties", () => {
  // GIVEN
  const bucket = new s3.Bucket(stack, "Bucket");

  // WHEN
  new elbv2.TrustStore(stack, "TrustStore", {
    bucket,
    key: "dummy.pem",
  });

  // THEN
  Template.synth(stack).not.toHaveResourceWithProperties(
    tfTrustStore.LbTrustStore,
    {
      ca_certificates_bundle_s3_bucket: stack.resolve(bucket.bucketName),
      ca_certificates_bundle_s3_key: "dummy.pem",
      ca_certificates_bundle_s3_object_version: expect.anything(),
      name: "TestStackTrustStore678C86C4",
    },
  );
});

test.each(["", "a".repeat(33)])(
  "Throw an error when trustStoreName length is invalid, trustStoreName: %s",
  (trustStoreName) => {
    // GIVEN
    const bucket = new s3.Bucket(stack, "Bucket");

    // WHEN
    expect(() => {
      new elbv2.TrustStore(stack, "TrustStore", {
        bucket,
        key: "dummy.pem",
        trustStoreName,
      });
    }).toThrow(
      `trustStoreName '${trustStoreName}' must be 1-32 characters long.`,
    );
  },
);

test.each(["-test", "test-", "$test"])(
  "Throw an error when trustStoreName has invalid patten, trustStoreName: %s",
  (trustStoreName) => {
    // GIVEN
    const bucket = new s3.Bucket(stack, "Bucket");

    // WHEN
    expect(() => {
      new elbv2.TrustStore(stack, "TrustStore", {
        bucket,
        key: "dummy.pem",
        trustStoreName,
      });
    }).toThrow(
      `trustStoreName '${trustStoreName}' must contain only alphanumeric characters and hyphens, and cannot begin or end with a hyphen.`,
    );
  },
);
