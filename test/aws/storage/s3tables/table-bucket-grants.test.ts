// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-grants.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import {
  dataAwsIamPolicyDocument,
  s3TablesTableBucketPolicy,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as iam from "../../../../src/aws/iam";
import * as s3tables from "../../../../src/aws/storage/s3tables";
import * as perms from "../../../../src/aws/storage/s3tables/permissions";
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

const PRINCIPAL = "s3.amazonaws.com";
const TABLE_UUID = "example-table-uuid";
const EXISTING_ROLE_ARN = "arn:aws:iam::123456789012:role/existing-role";

// Upstream `RESOURCES_WITH_TABLE_ARN` (getResourcesWithTablesArn(TABLE_UUID)), adapted to this
// repo's `aws_iam_policy_document` rendering: `TableBucketBase.getTableArn()`
// (`../../../../src/aws/storage/s3tables/table-bucket.ts`) builds
// `${tableBucketArn}/table/${tableId}` by plain string interpolation rather than upstream's
// `Fn::Join` CFN intrinsic.
const getResourcesWithTableArn = (
  bucket: s3tables.TableBucket,
  tableId: string,
) => [
  stack.resolve(bucket.tableBucketArn),
  `${stack.resolve(bucket.tableBucketArn)}/table/${tableId}`,
];

let stack: AwsStack;
let tableBucket: s3tables.TableBucket;
let role: iam.Role;
let importedRole: iam.IRole;
let user: iam.User;

beforeEach(() => {
  stack = testStack();
  tableBucket = new s3tables.TableBucket(stack, "ExampleTableBucket", {
    tableBucketName: "example-table-bucket",
  });
  role = new iam.Role(stack, "TestRole", {
    assumedBy: new iam.ServicePrincipal("sample"),
  });
  user = new iam.User(stack, "TestUser");
  importedRole = iam.Role.fromRoleArn(stack, "ImportedRole", EXISTING_ROLE_ARN);
});

describe("Access grant methods", () => {
  describe("grantRead", () => {
    it("provides read and list permissions to the bucket", () => {
      tableBucket.grantRead(new iam.ServicePrincipal(PRINCIPAL), TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });

    // Upstream `provides read and list permissions for a specific table` -- upstream ports this
    // as a literal duplicate of the "to the bucket" test above (same `TABLE_UUID` tableId, same
    // assertion), see
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-grants.test.ts
    it("provides read and list permissions for a specific table", () => {
      tableBucket.grantRead(new iam.ServicePrincipal(PRINCIPAL), TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });

    it("creates IAM policies for a role", () => {
      tableBucket.grantRead(role, TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
      t.resourceCountIs(s3TablesTableBucketPolicy.S3TablesTableBucketPolicy, 0);
    });

    it("creates IAM policies for a user", () => {
      tableBucket.grantRead(user, TABLE_UUID);
      const t = new Template(stack);
      t.resourceCountIs(s3TablesTableBucketPolicy.S3TablesTableBucketPolicy, 0);
    });

    it("creates IAM policies for an imported role", () => {
      tableBucket.grantRead(importedRole, TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });
  });

  describe("grantWrite", () => {
    it("provides write permissions to the bucket", () => {
      tableBucket.grantWrite(new iam.ServicePrincipal(PRINCIPAL), TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_WRITE_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });

    // Upstream `provides write permissions for a specific table` -- literal duplicate of the "to
    // the bucket" test above, see
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-grants.test.ts
    it("provides write permissions for a specific table", () => {
      tableBucket.grantWrite(new iam.ServicePrincipal(PRINCIPAL), TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_WRITE_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });

    it("creates IAM policies for a role", () => {
      tableBucket.grantWrite(role, TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_WRITE_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
      t.resourceCountIs(s3TablesTableBucketPolicy.S3TablesTableBucketPolicy, 0);
    });

    it("creates IAM policies for a user", () => {
      tableBucket.grantWrite(user, TABLE_UUID);
      const t = new Template(stack);
      t.resourceCountIs(s3TablesTableBucketPolicy.S3TablesTableBucketPolicy, 0);
    });

    it("creates IAM policies for an imported role", () => {
      tableBucket.grantWrite(importedRole, TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_WRITE_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });
  });

  describe("grantReadWrite", () => {
    it("provides read & write permissions to the bucket", () => {
      tableBucket.grantReadWrite(
        new iam.ServicePrincipal(PRINCIPAL),
        TABLE_UUID,
      );
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_WRITE_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });

    // Upstream `provides read & write permissions for a specific table` -- literal duplicate of
    // the "to the bucket" test above, see
    // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-grants.test.ts
    it("provides read & write permissions for a specific table", () => {
      tableBucket.grantReadWrite(
        new iam.ServicePrincipal(PRINCIPAL),
        TABLE_UUID,
      );
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_WRITE_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });

    it("creates IAM policies for a role", () => {
      tableBucket.grantReadWrite(role, TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_WRITE_ACCESS,
              effect: "Allow",
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
      t.resourceCountIs(s3TablesTableBucketPolicy.S3TablesTableBucketPolicy, 0);
    });

    it("creates IAM policies for a user", () => {
      tableBucket.grantReadWrite(user, TABLE_UUID);
      const t = new Template(stack);
      t.resourceCountIs(s3TablesTableBucketPolicy.S3TablesTableBucketPolicy, 0);
    });

    it("creates IAM policies for an imported role", () => {
      tableBucket.grantReadWrite(importedRole, TABLE_UUID);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_WRITE_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
              resources: getResourcesWithTableArn(tableBucket, TABLE_UUID),
            }),
          ],
        },
      );
    });
  });

  describe("Multiple permissions on same bucket", () => {
    it("permissions are isolated per principal", () => {
      const accountPrincipal = new iam.AccountPrincipal("123456789012");
      const servicePrincipal = new iam.ServicePrincipal(PRINCIPAL);
      tableBucket.grantRead(accountPrincipal, "table1");
      tableBucket.grantWrite(importedRole, "table2");
      tableBucket.grantRead(servicePrincipal, "table3");

      const statement = new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ["s3tables:DeleteTable"],
        principals: [new iam.ServicePrincipal("backup.amazonaws.com")],
        resources: ["*"],
      });
      tableBucket.addToResourcePolicy(statement);

      // tableBucketPolicy should have 4 different statements: one per grantRead/grantWrite call
      // that targets a principal without a synchronously-known matching account (see the
      // TERRACONSTRUCTS DEVIATION note on `../table-bucket-encryption.test.ts`'s
      // `creates X IAM policies for a role` tests -- `AccountPrincipal`/`ServicePrincipal` always
      // take this path, `importedRole` because it's genuinely cross-account here), plus the
      // explicit `addToResourcePolicy` deny statement.
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_ACCESS,
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: [
                    "arn:${data.aws_partition.Partitition.partition}:iam::123456789012:root",
                  ],
                },
              ],
            }),
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_WRITE_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
            }),
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_READ_ACCESS,
              effect: "Allow",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_s3.name}",
                  ],
                },
              ],
            }),
            expect.objectContaining({
              actions: ["s3tables:DeleteTable"],
              effect: "Deny",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_backup.name}",
                  ],
                },
              ],
            }),
          ],
        },
      );

      // Imported role's own identity policy should have write access to table2
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            expect.objectContaining({
              actions: perms.TABLE_BUCKET_WRITE_ACCESS,
              effect: "Allow",
            }),
          ],
        },
      );
    });
  });
});
