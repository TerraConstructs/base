// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-policy.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import { s3TablesTableBucketPolicy } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as iam from "../../../../src/aws/iam";
import * as s3tables from "../../../../src/aws/storage/s3tables";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

function testStack(app?: App, stackId?: string): AwsStack {
  return new AwsStack(app ?? Testing.app(), stackId ?? "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

let stack: AwsStack;

beforeEach(() => {
  stack = testStack();
});

describe("TableBucketPolicy", () => {
  describe("created with default properties", () => {
    let tableBucketPolicy: s3tables.TableBucketPolicy;
    let tableBucket: s3tables.TableBucket;

    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(stack, "test-bucket", {
        tableBucketName: "test-bucket",
      });
      tableBucketPolicy = new s3tables.TableBucketPolicy(
        stack,
        "ExampleTableBucket",
        {
          tableBucket,
          resourcePolicy: new iam.PolicyDocument(stack, "ExamplePolicyDoc", {
            statement: [
              new iam.PolicyStatement({
                actions: ["s3tables:*"],
                resources: ["*"],
              }),
            ],
          }),
        },
      );
    });

    test("creates a S3TablesTableBucketPolicy resource", () => {
      tableBucketPolicy;
      new Template(stack).resourceCountIs(
        s3TablesTableBucketPolicy.S3TablesTableBucketPolicy,
        1,
      );
    });

    test("with tableBucketArn property", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucketPolicy.S3TablesTableBucketPolicy,
        {
          table_bucket_arn: stack.resolve(tableBucket.tableBucketArn),
        },
      );
    });

    test("bucket resourcePolicy contains statement", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucketPolicy.S3TablesTableBucketPolicy,
        {
          resource_policy: stack.resolve(tableBucketPolicy.document.json),
        },
      );
    });
  });

  describe("created without an explicit resourcePolicy", () => {
    // TERRACONSTRUCTS DEVIATION: not present upstream -- this repo's `iam.PolicyDocument` is a
    // Construct (see the note on `TableBucketPolicyProps.resourcePolicy` in
    // `../../../../src/aws/storage/s3tables/table-bucket-policy.ts`), so this exercises the
    // default-construction branch of `TableBucketPolicy`'s constructor.
    test("initializes an empty policy document", () => {
      const tableBucket = new s3tables.TableBucket(stack, "test-bucket", {
        tableBucketName: "test-bucket",
      });
      const tableBucketPolicy = new s3tables.TableBucketPolicy(
        stack,
        "ExampleTableBucket",
        { tableBucket },
      );

      expect(tableBucketPolicy.document.isEmpty).toBe(true);
    });
  });
});
