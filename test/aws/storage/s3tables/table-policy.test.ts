// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-policy.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note -- see the identical notes in
// `../../../../src/aws/storage/s3tables/table-policy.ts`.

import {
  dataAwsIamPolicyDocument,
  s3TablesTablePolicy,
} from "@cdktn/provider-aws";
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

describe("TablePolicy", () => {
  describe("created with default properties", () => {
    let table: s3tables.Table;

    beforeEach(() => {
      const tableBucket = new s3tables.TableBucket(stack, "test-bucket", {
        tableBucketName: "test-bucket",
      });
      const namespace = new s3tables.Namespace(stack, "test-namespace", {
        tableBucket,
        namespaceName: "test_namespace",
      });
      table = new s3tables.Table(stack, "test-table", {
        tableName: "test_table",
        namespace,
        openTableFormat: s3tables.OpenTableFormat.ICEBERG,
      });
      new s3tables.TablePolicy(stack, "ExampleTablePolicy", {
        table,
        resourcePolicy: (() => {
          const doc = new iam.PolicyDocument(stack, "AccessPolicy");
          doc.addStatements(
            new iam.PolicyStatement({
              actions: ["s3tables:*"],
              resources: ["*"],
            }),
          );
          return doc;
        })(),
      });
    });

    test("creates a S3TablesTablePolicy resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTablePolicy.S3TablesTablePolicy,
        1,
      );
    });

    test("with name/namespace/tableBucketArn properties", () => {
      // TERRACONSTRUCTS DEVIATION: `aws_s3tables_table_policy` identifies its target table via
      // `name` + `namespace` + `table_bucket_arn` (not a bare `table_arn` like upstream's
      // `AWS::S3Tables::TablePolicy.TableARN`) -- see the note on `ITable.namespace` in
      // `../../../../src/aws/storage/s3tables/table.ts`.
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTablePolicy.S3TablesTablePolicy,
        {
          name: "test_table",
          namespace: "test_namespace",
          table_bucket_arn: stack.resolve(
            table.namespace!.tableBucket.tableBucketArn,
          ),
        },
      );
    });

    test("table resourcePolicy contains statement", () => {
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
  });

  describe("throws for imported tables", () => {
    // TERRACONSTRUCTS DEVIATION: not present upstream. `aws_s3tables_table_policy` has no
    // ARN-only addressing mode, so a `TablePolicy` cannot be built for a table imported via
    // `Table.fromTableAttributes` (which carries no `namespace`) -- see `TablePolicyProps.table`.
    test("rejects a table without a namespace", () => {
      const table = s3tables.Table.fromTableAttributes(stack, "Imported", {
        tableName: "example_table",
        tableArn: "arn:aws:s3tables:us-west-2:123456789012:table/example_table",
      });

      expect(
        () => new s3tables.TablePolicy(stack, "ExampleTablePolicy", { table }),
      ).toThrow(/must have been created via `new Table\(\.\.\.\)`/);
    });
  });
});
