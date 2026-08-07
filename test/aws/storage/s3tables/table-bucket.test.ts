// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import {
  dataAwsIamPolicyDocument,
  s3TablesTableBucket,
  s3TablesTableBucketPolicy,
} from "@cdktn/provider-aws";
import { App, Testing, Token } from "cdktn";
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

describe("TableBucket", () => {
  describe("created with default properties", () => {
    const DEFAULT_PROPS: s3tables.TableBucketProps = {
      tableBucketName: "example-table-bucket",
    };
    let tableBucket: s3tables.TableBucket;

    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(
        stack,
        "ExampleTableBucket",
        DEFAULT_PROPS,
      );
    });

    test("creates a S3TablesTableBucket resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTableBucket.S3TablesTableBucket,
        1,
      );
    });

    test("with tableBucketName property", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucket.S3TablesTableBucket,
        {
          name: DEFAULT_PROPS.tableBucketName,
        },
      );
    });

    test("returns true from addToResourcePolicy", () => {
      const result = tableBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );

      expect(result.statementAdded).toBe(true);
    });
  });

  describe("created with unreferenced file removal properties", () => {
    const TABLE_BUCKET_PROPS: s3tables.TableBucketProps = {
      account: "0123456789012",
      region: "us-west-2",
      tableBucketName: "example-table-bucket",
      unreferencedFileRemoval: {
        noncurrentDays: 10,
        unreferencedDays: 10,
        status: s3tables.UnreferencedFileRemovalStatus.ENABLED,
      },
    };

    beforeEach(() => {
      new s3tables.TableBucket(stack, "ExampleTableBucket", TABLE_BUCKET_PROPS);
    });

    test("creates a S3TablesTableBucket resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTableBucket.S3TablesTableBucket,
        1,
      );
    });

    // TERRACONSTRUCTS DEVIATION: asserts the `maintenance_configuration.iceberg_unreferenced_file_removal`
    // nested block (see the note on `TableBucket.renderMaintenanceConfiguration` in
    // `../../../../src/aws/storage/s3tables/table-bucket.ts`) instead of upstream's top-level CFN
    // `UnreferencedFileRemoval` property. Note the field-name difference: `noncurrentDays` (upstream) ->
    // `non_current_days` (provider). Also note `status` is lower-cased at render time (provider/API
    // enum is `enabled`/`disabled`, unlike CFN's `Enabled`/`Disabled` that the public
    // `UnreferencedFileRemovalStatus` enum keeps for upstream fidelity).
    test("has maintenance_configuration properties", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucket.S3TablesTableBucket,
        {
          name: TABLE_BUCKET_PROPS.tableBucketName,
          maintenance_configuration: {
            iceberg_unreferenced_file_removal: {
              status: "enabled",
              settings: {
                non_current_days: 10,
                unreferenced_days: 10,
              },
            },
          },
        },
      );
    });
  });

  describe("defined with resource policy", () => {
    const DEFAULT_PROPS: s3tables.TableBucketProps = {
      tableBucketName: "example-table-bucket",
    };
    let tableBucket: s3tables.TableBucket;

    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(
        stack,
        "ExampleTableBucket",
        DEFAULT_PROPS,
      );
      tableBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );
    });

    test("resourcePolicy contains statement", () => {
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["s3tables:*"],
              effect: "Allow",
              resources: ["*"],
            },
          ],
        },
      );
    });

    test("calling multiple times appends statements", () => {
      tableBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3:*"],
          effect: iam.Effect.DENY,
          resources: ["*"],
        }),
      );
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["s3tables:*"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: ["s3:*"],
              effect: "Deny",
              resources: ["*"],
            },
          ],
        },
      );
    });
  });

  describe("import existing table bucket with name", () => {
    const BUCKET_PROPS = {
      tableBucketName: "example-table-bucket",
    };
    let tableBucket: s3tables.ITableBucket;

    beforeEach(() => {
      tableBucket = s3tables.TableBucket.fromTableBucketAttributes(
        stack,
        "ExampleTableBucket",
        BUCKET_PROPS,
      );
    });

    test("has the same name as it was imported with", () => {
      expect(tableBucket.tableBucketName).toEqual(BUCKET_PROPS.tableBucketName);
      tableBucket.grantRead(new iam.ServicePrincipal(""), "*");
    });

    test("renders the correct ARN for Example Resource", () => {
      const arn = stack.resolve(tableBucket.tableBucketArn);
      expect(arn).toEqual(
        `arn:\${data.aws_partition.Partitition.partition}:s3tables:us-east-1:\${data.aws_caller_identity.CallerIdentity.account_id}:bucket/${BUCKET_PROPS.tableBucketName}`,
      );
    });

    test("returns false from addToResourcePolicy", () => {
      const result = tableBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );

      expect(result.statementAdded).toEqual(false);
    });
  });

  describe("import existing table bucket with arn", () => {
    const BUCKET_NAME = "test-bucket";
    const ACCOUNT_ID = "123456789012";
    const REGION = "us-west-2";
    const BUCKET_ARN = `arn:aws:s3tables:${REGION}:${ACCOUNT_ID}:bucket/${BUCKET_NAME}`;
    let tableBucket: s3tables.ITableBucket;

    beforeEach(() => {
      tableBucket = s3tables.TableBucket.fromTableBucketArn(
        stack,
        "ExampleTableBucket",
        BUCKET_ARN,
      );
    });

    test("has the same name as it was imported with", () => {
      expect(tableBucket.tableBucketName).toEqual(BUCKET_NAME);
    });

    test("has the same region as it was imported with", () => {
      expect(tableBucket.region).toEqual(REGION);
    });

    test("has the same account as it was imported with", () => {
      expect(tableBucket.account).toEqual(ACCOUNT_ID);
    });

    test("returns false from addToResourcePolicy", () => {
      const result = tableBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );

      expect(result.statementAdded).toEqual(false);
    });
  });

  describe("import existing table bucket with name, region and account", () => {
    const BUCKET_PROPS = {
      tableBucketName: "example-table-bucket",
      region: "us-east-2",
      account: "123456789012",
    };
    let tableBucket: s3tables.ITableBucket;

    beforeEach(() => {
      tableBucket = s3tables.TableBucket.fromTableBucketAttributes(
        stack,
        "ExampleTableBucket",
        BUCKET_PROPS,
      );
    });

    test("has the same name as it was imported with", () => {
      expect(tableBucket.tableBucketName).toEqual(BUCKET_PROPS.tableBucketName);
    });

    test("has the same account as it was imported with", () => {
      expect(tableBucket.account).toEqual(BUCKET_PROPS.account);
    });

    test("has the same region as it was imported with", () => {
      expect(tableBucket.region).toEqual(BUCKET_PROPS.region);
    });

    test("renders the correct ARN for Example Resource", () => {
      const arn = stack.resolve(tableBucket.tableBucketArn);
      expect(arn).toEqual(
        `arn:\${data.aws_partition.Partitition.partition}:s3tables:${BUCKET_PROPS.region}:${BUCKET_PROPS.account}:bucket/${BUCKET_PROPS.tableBucketName}`,
      );
    });

    test("returns false from addToResourcePolicy", () => {
      const result = tableBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );

      expect(result.statementAdded).toEqual(false);
      new Template(stack).resourceCountIs(
        s3TablesTableBucketPolicy.S3TablesTableBucketPolicy,
        0,
      );
    });
  });

  describe("validateUnreferencedFileRemoval", () => {
    it("should not throw error when unreferencedFileRemovalProperty is undefined", () => {
      expect(() =>
        s3tables.TableBucket.validateUnreferencedFileRemoval(undefined),
      ).not.toThrow();
    });

    it("should not throw error for valid property values", () => {
      const validProperty = {
        noncurrentDays: 1,
        unreferencedDays: 1,
        status: s3tables.UnreferencedFileRemovalStatus.ENABLED,
      };
      expect(() =>
        s3tables.TableBucket.validateUnreferencedFileRemoval(validProperty),
      ).not.toThrow();
    });

    it("should throw error when noncurrentDays is less than 1", () => {
      const invalidProperty = {
        noncurrentDays: 0,
        unreferencedDays: 1,
        status: s3tables.UnreferencedFileRemovalStatus.ENABLED,
      };
      expect(() =>
        s3tables.TableBucket.validateUnreferencedFileRemoval(invalidProperty),
      ).toThrow(/noncurrentDays must be at least 1/);
    });

    it("should throw error when unreferencedDays is less than 1", () => {
      const invalidProperty = {
        noncurrentDays: 1,
        unreferencedDays: 0,
        status: s3tables.UnreferencedFileRemovalStatus.ENABLED,
      };
      expect(() =>
        s3tables.TableBucket.validateUnreferencedFileRemoval(invalidProperty),
      ).toThrow(/unreferencedDays must be at least 1/);
    });

    it("should not throw error when optional fields are undefined", () => {
      const partialProperty = {};
      expect(() =>
        s3tables.TableBucket.validateUnreferencedFileRemoval(partialProperty),
      ).not.toThrow();
    });

    // TERRACONSTRUCTS DEVIATION: pins a known upstream bug, kept verbatim for byte-closeness (see
    // the TODO(alpha-tracker) comment on `validateUnreferencedFileRemoval`'s `unreferencedDays`
    // branch in `../../../../src/aws/storage/s3tables/table-bucket.ts`) --
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/table-bucket.ts#L571-L578
    // The whole-number check for `unreferencedDays` actually re-checks `noncurrentDays`, so a
    // whole-number `unreferencedDays` supplied without `noncurrentDays` always (incorrectly)
    // throws, since `Number.isInteger(undefined) === false`.
    it("(pins upstream bug) throws when only unreferencedDays is provided, even though it's a whole number", () => {
      const property = {
        unreferencedDays: 5,
      };
      expect(() =>
        s3tables.TableBucket.validateUnreferencedFileRemoval(property),
      ).toThrow(/unreferencedDays must be a whole number/);
    });
  });

  describe("validateBucketName", () => {
    it("should accept valid bucket names", () => {
      const validNames = [
        "my-bucket-123",
        "test-bucket",
        "abc",
        "a".repeat(63),
        "123-bucket",
      ];

      validNames.forEach((name) => {
        expect(() =>
          s3tables.TableBucket.validateTableBucketName(name),
        ).not.toThrow();
      });
    });

    it("should skip validation for unresolved tokens", () => {
      const isUnresolved = Token.isUnresolved;
      Token.isUnresolved = jest.fn().mockReturnValue(true);
      expect(() =>
        s3tables.TableBucket.validateTableBucketName("unresolved"),
      ).not.toThrow();
      // Cleanup
      Token.isUnresolved = isUnresolved;
    });

    it("should skip validation for undefined name", () => {
      expect(() =>
        s3tables.TableBucket.validateTableBucketName(undefined),
      ).not.toThrow();
    });

    it("should reject bucket names that are too short", () => {
      expect(() => s3tables.TableBucket.validateTableBucketName("XX")).toThrow(
        /Bucket name must be at least 3/,
      );
    });

    it("should reject bucket names that are too long", () => {
      const longName = "a".repeat(64);
      expect(() =>
        s3tables.TableBucket.validateTableBucketName(longName),
      ).toThrow(/no more than 63 characters/);
    });

    it("should reject bucket names with illegal characters", () => {
      const invalidNames = [
        "My-Bucket", // uppercase
        "bucket!123", // special character
        "bucket.123", // period
        "bucket_123", // underscore
      ];

      invalidNames.forEach((name) => {
        expect(() =>
          s3tables.TableBucket.validateTableBucketName(name),
        ).toThrow(
          /must only contain lowercase characters, numbers, and hyphens/,
        );
      });
    });

    it("should reject bucket names that start with invalid characters", () => {
      const invalidNames = ["-bucket", ".bucket"];

      invalidNames.forEach((name) => {
        expect(() =>
          s3tables.TableBucket.validateTableBucketName(name),
        ).toThrow(/must start with a lowercase letter or number/);
      });
    });

    it("should reject bucket names that end with invalid characters", () => {
      const invalidNames = ["bucket-", "bucket."];

      invalidNames.forEach((name) => {
        expect(() =>
          s3tables.TableBucket.validateTableBucketName(name),
        ).toThrow(/must end with a lowercase letter or number/);
      });
    });

    it("should include the invalid bucket name in the error message", () => {
      const invalidName = "Invalid-Bucket!";
      expect(() =>
        s3tables.TableBucket.validateTableBucketName(invalidName),
      ).toThrow(/Invalid-Bucket!/);
    });

    it("should handle empty bucket names", () => {
      expect(() => s3tables.TableBucket.validateTableBucketName("")).toThrow(
        /Bucket name must be at least 3/,
      );
    });
  });
});
