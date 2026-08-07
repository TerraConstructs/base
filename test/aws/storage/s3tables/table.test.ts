// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note -- see the identical notes in
// `../../../../src/aws/storage/s3tables/table.ts`.
//
// SCOPE REDUCTION (this PR): a few upstream test suites exercise surfaces that have no
// Terraform-native equivalent (see the `IcebergTransform`/`SchemaFieldProperty` TODO block in
// `table.ts`) and are therefore omitted here rather than ported and commented out (mirrors
// `table-bucket.test.ts`'s identical omission of `RequestMetricsStatus`/tagging coverage):
//   - `IcebergTransform`/`SortDirection`/`NullOrder` validation -- the types themselves are
//     commented out in `table.ts`.
//   - `icebergPartitionSpec`/`icebergSortOrder`/`tableProperties` (including the "partition spec
//     and sort order" describe block, and the "tableProperties validation" duplicate-key checks)
//     -- unsupported by `aws_s3tables_table`'s `metadata` block.
//   - `removalPolicy`-driven `DeletionPolicy` assertions -- `core.RemovalPolicy` is not ported.
//   - `ITaggableV2`/`TagManager` tagging coverage -- this repo has no CDK-style `TagManager`; any
//     `aws_s3tables_table` is tagged automatically by the repo-wide `GridTags` Aspect instead.

import {
  dataAwsIamPolicyDocument,
  s3TablesTable,
  s3TablesTablePolicy,
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
let namespace: s3tables.Namespace;

beforeEach(() => {
  stack = testStack();
  const tableBucket = new s3tables.TableBucket(stack, "TestTableBucket", {
    tableBucketName: "test-table-bucket",
  });
  namespace = new s3tables.Namespace(stack, "TestNamespace", {
    namespaceName: "test_namespace",
    tableBucket,
  });
});

describe("Table", () => {
  describe("created with default properties", () => {
    const DEFAULT_PROPS: Omit<s3tables.TableProps, "namespace"> = {
      tableName: "example_table",
      openTableFormat: s3tables.OpenTableFormat.ICEBERG,
    };
    let table: s3tables.Table;

    beforeEach(() => {
      table = new s3tables.Table(stack, "ExampleTable", {
        ...DEFAULT_PROPS,
        namespace,
      });
    });

    test("creates a S3TablesTable resource", () => {
      new Template(stack).resourceCountIs(s3TablesTable.S3TablesTable, 1);
    });

    test("with name property", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(s3TablesTable.S3TablesTable, {
        name: DEFAULT_PROPS.tableName,
      });
    });

    test("with format property", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(s3TablesTable.S3TablesTable, {
        format: DEFAULT_PROPS.openTableFormat,
      });
    });

    test("returns true from addToResourcePolicy", () => {
      const result = table.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );

      expect(result.statementAdded).toBe(true);
      expect(result.policyDependable).toBe(table.tablePolicy);
    });
  });

  describe("created with all properties", () => {
    let table: s3tables.Table;

    beforeEach(() => {
      table = new s3tables.Table(stack, "ExampleTable", {
        tableName: "example_table",
        namespace,
        openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        compaction: {
          status: s3tables.Status.ENABLED,
          targetFileSizeMb: 128,
        },
        icebergMetadata: {
          icebergSchema: {
            schemaFieldList: [
              {
                name: "id",
                type: "int",
                required: true,
              },
              {
                name: "name",
                type: "string",
              },
            ],
          },
        },
        snapshotManagement: {
          maxSnapshotAgeHours: 24,
          minSnapshotsToKeep: 5,
          status: s3tables.Status.ENABLED,
        },
      });
    });

    test("creates a S3TablesTable resource", () => {
      table;
      new Template(stack).resourceCountIs(s3TablesTable.S3TablesTable, 1);
    });

    test("has all properties", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(s3TablesTable.S3TablesTable, {
        name: "example_table",
        format: s3tables.OpenTableFormat.ICEBERG,
        maintenance_configuration: {
          iceberg_compaction: {
            status: "enabled",
            settings: { target_file_size_mb: 128 },
          },
          iceberg_snapshot_management: {
            status: "enabled",
            settings: {
              max_snapshot_age_hours: 24,
              min_snapshots_to_keep: 5,
            },
          },
        },
        metadata: [
          {
            iceberg: [
              {
                schema: [
                  {
                    field: [
                      { name: "id", type: "int", required: true },
                      { name: "name", type: "string" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });

  // Regression coverage for `buildMaintenanceConfiguration()`: `compaction`/`snapshotManagement`
  // are independently optional (mirrors upstream `CfnTable`'s independent top-level properties),
  // but `aws_s3tables_table.maintenance_configuration` is a Terraform object-typed attribute whose
  // schema requires BOTH `iceberg_compaction`/`iceberg_snapshot_management` members to be present
  // -- and S3 Tables auto-populates server-side defaults for every unset maintenance value
  // (live-confirmed "Provider produced inconsistent result after apply" against planned nulls), so
  // whichever of `compaction`/`snapshotManagement` was not supplied is rendered with AWS's
  // documented defaults (compaction: enabled/512MB; snapshot management: enabled/120h/1) rather
  // than omitted or null-filled. These two cases (only one of `compaction`/`snapshotManagement`
  // supplied) exercise that defaults branch; the "created with all properties" suite above only
  // exercises the neither-or-both paths.
  describe("created with compaction only (no snapshotManagement)", () => {
    let table: s3tables.Table;

    beforeEach(() => {
      table = new s3tables.Table(stack, "ExampleTable", {
        tableName: "example_table",
        namespace,
        openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        compaction: {
          status: s3tables.Status.ENABLED,
          targetFileSizeMb: 128,
        },
      });
    });

    test("creates a S3TablesTable resource", () => {
      new Template(stack).resourceCountIs(s3TablesTable.S3TablesTable, 1);
    });

    test("renders iceberg_compaction and an AWS-defaults iceberg_snapshot_management in maintenance_configuration", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(s3TablesTable.S3TablesTable, {
        name: "example_table",
        maintenance_configuration: {
          iceberg_compaction: {
            status: "enabled",
            settings: { target_file_size_mb: 128 },
          },
          iceberg_snapshot_management: {
            status: "enabled",
            settings: {
              max_snapshot_age_hours: 120,
              min_snapshots_to_keep: 1,
            },
          },
        },
      });
    });
  });

  describe("created with snapshotManagement only (no compaction)", () => {
    let table: s3tables.Table;

    beforeEach(() => {
      table = new s3tables.Table(stack, "ExampleTable", {
        tableName: "example_table",
        namespace,
        openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        snapshotManagement: {
          maxSnapshotAgeHours: 24,
          minSnapshotsToKeep: 5,
          status: s3tables.Status.ENABLED,
        },
      });
    });

    test("creates a S3TablesTable resource", () => {
      new Template(stack).resourceCountIs(s3TablesTable.S3TablesTable, 1);
    });

    test("renders iceberg_snapshot_management and an AWS-defaults iceberg_compaction in maintenance_configuration", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(s3TablesTable.S3TablesTable, {
        name: "example_table",
        maintenance_configuration: {
          iceberg_compaction: {
            status: "enabled",
            settings: { target_file_size_mb: 512 },
          },
          iceberg_snapshot_management: {
            status: "enabled",
            settings: {
              max_snapshot_age_hours: 24,
              min_snapshots_to_keep: 5,
            },
          },
        },
      });
    });
  });

  describe("created with withoutMetadata property", () => {
    let table: s3tables.Table;

    beforeEach(() => {
      table = new s3tables.Table(stack, "ExampleTable", {
        tableName: "example_table",
        namespace,
        openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        withoutMetadata: true,
      });
    });

    // TERRACONSTRUCTS DEVIATION: `aws_s3tables_table` has no `without_metadata` attribute (unlike
    // upstream's `WithoutMetadata: "Yes"` CFN property) -- see the note on
    // `TableProps.withoutMetadata` in `../../../../src/aws/storage/s3tables/table.ts`. Omitting the
    // `metadata` block entirely is the provider-native equivalent.
    test("omits the metadata block", () => {
      const t = new Template(stack);
      const [tableResource] = t.resourceTypeArray(
        s3TablesTable.S3TablesTable,
      ) as { metadata?: unknown }[];
      table;
      expect(tableResource.metadata).toBeUndefined();
    });
  });

  describe("defined with resource policy", () => {
    let table: s3tables.Table;

    beforeEach(() => {
      table = new s3tables.Table(stack, "ExampleTable", {
        tableName: "example_table",
        namespace,
        openTableFormat: s3tables.OpenTableFormat.ICEBERG,
      });
      table.addToResourcePolicy(
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
      table.addToResourcePolicy(
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

  describe("import existing table with attributes", () => {
    const TABLE_ATTRS = {
      tableName: "example_table",
      tableArn: "arn:aws:s3tables:us-west-2:123456789012:table/example_table",
    };
    let table: s3tables.ITable;

    beforeEach(() => {
      table = s3tables.Table.fromTableAttributes(
        stack,
        "ImportedTable",
        TABLE_ATTRS,
      );
    });

    test("has the same name as it was imported with", () => {
      expect(table.tableName).toEqual(TABLE_ATTRS.tableName);
    });

    test("has the same ARN as it was imported with", () => {
      expect(table.tableArn).toEqual(TABLE_ATTRS.tableArn);
    });

    test("validates table name during import", () => {
      expect(() => {
        s3tables.Table.fromTableAttributes(stack, "InvalidImport", {
          tableName: "Invalid-Table",
          tableArn:
            "arn:aws:s3tables:us-west-2:123456789012:table/Invalid-Table",
        });
      }).toThrow(
        "Table name must only contain lowercase characters, numbers, and underscores (_)",
      );
    });

    test("creates resource with correct physical name", () => {
      expect(table.node.id).toBe("ImportedTable");
    });

    test("addToResourcePolicy does not add a policy", () => {
      const result = table.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["s3tables:*"],
          resources: ["*"],
        }),
      );

      expect(result.statementAdded).toEqual(false);
      expect(result.policyDependable).toBeUndefined();
      new Template(stack).resourceCountIs(
        s3TablesTablePolicy.S3TablesTablePolicy,
        0,
      );
    });
  });

  describe("validateTableName", () => {
    it("should accept valid table names", () => {
      const validNames = [
        "my_table_123",
        "test_table",
        "abc",
        "a".repeat(255),
        "123_table",
      ];

      validNames.forEach((name) => {
        expect(() => s3tables.Table.validateTableName(name)).not.toThrow();
      });
    });

    it("should skip validation for unresolved tokens", () => {
      const isUnresolved = Token.isUnresolved;
      Token.isUnresolved = jest.fn().mockReturnValue(true);
      expect(() =>
        s3tables.Table.validateTableName("unresolved"),
      ).not.toThrow();
      // Cleanup
      Token.isUnresolved = isUnresolved;
    });

    it("should reject table names that are too short", () => {
      expect(() => s3tables.Table.validateTableName("")).toThrow(
        /Table name must be at least 1/,
      );
    });

    it("should reject table names that are too long", () => {
      const longName = "a".repeat(256);
      expect(() => s3tables.Table.validateTableName(longName)).toThrow(
        /no more than 255 characters/,
      );
    });

    it("should reject table names with illegal characters", () => {
      const invalidNames = [
        "My-Table", // uppercase
        "table!123", // special character
        "table-123", // hyphen
      ];

      invalidNames.forEach((name) => {
        expect(() => s3tables.Table.validateTableName(name)).toThrow(
          /must only contain lowercase characters, numbers, and underscores/,
        );
      });
    });

    it("should reject table names that start with invalid characters", () => {
      const invalidNames = ["_table"];

      invalidNames.forEach((name) => {
        expect(() => s3tables.Table.validateTableName(name)).toThrow(
          /must start with a lowercase letter or number/,
        );
      });
    });

    it("should reject table names that end with invalid characters", () => {
      const invalidNames = ["table_"];

      invalidNames.forEach((name) => {
        expect(() => s3tables.Table.validateTableName(name)).toThrow(
          /must end with a lowercase letter or number/,
        );
      });
    });

    it("should include the invalid table name in the error message", () => {
      const invalidName = "Invalid-Table!";
      expect(() => s3tables.Table.validateTableName(invalidName)).toThrow(
        /Invalid-Table!/,
      );
    });
  });

  describe("table name validation through Table creation", () => {
    test("rejects table creation with invalid table name", () => {
      expect(() => {
        new s3tables.Table(stack, "TestTable", {
          tableName: "Invalid-Table",
          namespace,
          openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        });
      }).toThrow(
        "Table name must only contain lowercase characters, numbers, and underscores (_)",
      );
    });

    test("rejects table creation with empty table name", () => {
      expect(() => {
        new s3tables.Table(stack, "TestTable", {
          tableName: "",
          namespace,
          openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        });
      }).toThrow(
        "Table name must be at least 1 and no more than 255 characters",
      );
    });

    test("rejects table creation with table name starting with underscore", () => {
      expect(() => {
        new s3tables.Table(stack, "TestTable", {
          tableName: "_invalid",
          namespace,
          openTableFormat: s3tables.OpenTableFormat.ICEBERG,
        });
      }).toThrow("Table name must start with a lowercase letter or number");
    });
  });
});
