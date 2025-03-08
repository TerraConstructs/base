// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/trust-store-revocation.test.ts

import { lbTrustStoreRevocation as tfTrustStoreRevocation } from "@cdktf/provider-aws";
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

test("Trust Store Revocation with all properties", () => {
  // GIVEN
  const bucket = new s3.Bucket(stack, "Bucket");

  const trustStore = new elbv2.TrustStore(stack, "TrustStore", {
    bucket,
    key: "dummy.pem",
  });

  // WHEN
  new elbv2.TrustStoreRevocation(stack, "Revocation", {
    trustStore,
    revocationContents: [
      {
        revocationType: elbv2.RevocationType.CRL,
        bucket,
        key: "crl.pem",
        version: "test-version",
      },
    ],
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    tfTrustStoreRevocation.LbTrustStoreRevocation,
    {
      trust_store_arn: stack.resolve(trustStore.trustStoreArn),
      // RevocationType: "CRL",  // not supported by TF
      revocations_s3_bucket: stack.resolve(bucket.bucketName),
      revocations_s3_key: "crl.pem",
      revocations_s3_object_version: "test-version",
    },
  );
});

test("Trust Store Revocation with required properties", () => {
  // GIVEN
  const bucket = new s3.Bucket(stack, "Bucket");

  const trustStore = new elbv2.TrustStore(stack, "TrustStore", {
    bucket,
    key: "dummy.pem",
  });

  // WHEN
  new elbv2.TrustStoreRevocation(stack, "Revocation", {
    trustStore,
    revocationContents: [
      {
        bucket,
        key: "crl.pem",
      },
    ],
  });

  // THEN
  Template.synth(stack).not.toHaveResourceWithProperties(
    tfTrustStoreRevocation.LbTrustStoreRevocation,
    {
      trust_store_arn: stack.resolve(trustStore.trustStoreArn),
      // RevocationType: expect.anything(), // not supported by TF
      revocations_s3_bucket: stack.resolve(bucket.bucketName),
      revocations_s3_key: "crl.pem",
      revocations_s3_object_version: expect.anything(), // should not be present
    },
  );
});
