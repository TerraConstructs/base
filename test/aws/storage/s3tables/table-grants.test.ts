// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-grants.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note -- see the identical notes in
// `../../../../src/aws/storage/s3tables/table.ts`.

import {
  dataAwsIamPolicyDocument,
  iamRolePolicy,
  s3TablesTablePolicy,
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

let stack: AwsStack;

beforeEach(() => {
  stack = testStack();
});

describe("Table grant methods", () => {
  const PRINCIPAL = "s3.amazonaws.com";
  const EXISTING_ROLE_ARN = "arn:aws:iam::123456789012:role/existing-role";

  let table: s3tables.Table;
  let role: iam.Role;
  let importedRole: iam.IRole;
  let user: iam.User;

  beforeEach(() => {
    const tableBucket = new s3tables.TableBucket(stack, "TestTableBucket", {
      tableBucketName: "test-table-bucket",
    });
    const namespace = new s3tables.Namespace(stack, "TestNamespace", {
      tableBucket,
      namespaceName: "test_namespace",
    });
    table = new s3tables.Table(stack, "TestTable", {
      tableName: "test_table",
      namespace,
      openTableFormat: s3tables.OpenTableFormat.ICEBERG,
    });
    role = new iam.Role(stack, "TestRole", {
      assumedBy: new iam.ServicePrincipal("sample"),
    });
    user = new iam.User(stack, "TestUser");
    importedRole = iam.Role.fromRoleArn(
      stack,
      "ImportedRole",
      EXISTING_ROLE_ARN,
    );
  });

  describe("grantRead", () => {
    it("provides read permissions to the table", () => {
      table.grantRead(new iam.ServicePrincipal(PRINCIPAL));
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_ACCESS,
              effect: "Allow",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    stack.resolve(
                      iam.ServicePrincipal.servicePrincipalName(PRINCIPAL),
                    ),
                  ],
                },
              ],
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
    });

    it("creates IAM policies for a role", () => {
      table.grantRead(role);
      const t = new Template(stack);
      t.resourceCountIs(iamRolePolicy.IamRolePolicy, 1);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_ACCESS,
              effect: "Allow",
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });

    it("creates IAM policies for a user", () => {
      table.grantRead(user);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_ACCESS,
              effect: "Allow",
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });

    it("creates IAM policies for an imported role", () => {
      table.grantRead(importedRole);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
    });
  });

  describe("grantWrite", () => {
    it("provides write permissions to the table", () => {
      table.grantWrite(new iam.ServicePrincipal(PRINCIPAL));
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_WRITE_ACCESS,
              effect: "Allow",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    stack.resolve(
                      iam.ServicePrincipal.servicePrincipalName(PRINCIPAL),
                    ),
                  ],
                },
              ],
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
    });

    it("creates IAM policies for a role", () => {
      table.grantWrite(role);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_WRITE_ACCESS,
              effect: "Allow",
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });

    it("creates IAM policies for a user", () => {
      table.grantWrite(user);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_WRITE_ACCESS,
              effect: "Allow",
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });

    it("creates IAM policies for an imported role", () => {
      table.grantWrite(importedRole);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_WRITE_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
    });
  });

  describe("grantReadWrite", () => {
    it("provides read & write permissions to the table", () => {
      table.grantReadWrite(new iam.ServicePrincipal(PRINCIPAL));
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_WRITE_ACCESS,
              effect: "Allow",
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    stack.resolve(
                      iam.ServicePrincipal.servicePrincipalName(PRINCIPAL),
                    ),
                  ],
                },
              ],
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
    });

    it("creates IAM policies for a role", () => {
      table.grantReadWrite(role);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_WRITE_ACCESS,
              effect: "Allow",
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });

    it("creates IAM policies for a user", () => {
      table.grantReadWrite(user);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_WRITE_ACCESS,
              effect: "Allow",
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });

    it("creates IAM policies for an imported role", () => {
      table.grantReadWrite(importedRole);
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: perms.TABLE_READ_WRITE_ACCESS,
              effect: "Allow",
              principals: [{ type: "AWS", identifiers: [EXISTING_ROLE_ARN] }],
              resources: [stack.resolve(table.tableArn)],
            },
          ],
        },
      );
    });
  });

  // Regression coverage: `TableProps.account` (inherited from `AwsConstructProps`, not present on
  // upstream `TableProps`) must NOT be forwarded to `super()` in `Table`'s constructor -- see the
  // note on the constructor in `../../../../src/aws/storage/s3tables/table.ts`. Forwarding it would
  // give `table.env.account` a resolved literal value that diverges from a same-stack, no-explicit-
  // account role's still-token `principalAccount`, defeating `Grant.addToPrincipalOrResource`'s
  // same-account short-circuit (`../../../../src/aws/iam/grant.ts`) and spuriously attaching a
  // resource policy for what is, at deploy time, actually the same account.
  describe("grant same-account short-circuit with an explicit TableProps.account", () => {
    it("does not create a resource policy for a same-stack role", () => {
      const tableBucket = new s3tables.TableBucket(stack, "ExplicitAcctBkt", {
        tableBucketName: "explicit-acct-bucket",
      });
      const namespace = new s3tables.Namespace(stack, "ExplicitAcctNs", {
        tableBucket,
        namespaceName: "explicit_acct_namespace",
      });
      const explicitAccountTable = new s3tables.Table(
        stack,
        "ExplicitAcctTable",
        {
          tableName: "explicit_acct_table",
          namespace,
          openTableFormat: s3tables.OpenTableFormat.ICEBERG,
          account: "111111111111",
        },
      );

      explicitAccountTable.grantRead(role);

      const t = new Template(stack);
      t.resourceCountIs(s3TablesTablePolicy.S3TablesTablePolicy, 0);
    });
  });
});
