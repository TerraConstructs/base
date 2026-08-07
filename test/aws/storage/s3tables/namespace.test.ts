// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/namespace.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note -- see the identical notes in
// `../../../../src/aws/storage/s3tables/namespace.ts`.

import { s3TablesNamespace } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
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

describe("Namespace", () => {
  describe("created with default properties", () => {
    let namespace: s3tables.Namespace;
    let tableBucket: s3tables.TableBucket;

    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(stack, "test-bucket", {
        tableBucketName: "test-bucket",
      });
      namespace = new s3tables.Namespace(stack, "ExampleNamespace", {
        namespaceName: "test_namespace",
        tableBucket,
      });
    });

    test("creates a S3TablesNamespace resource", () => {
      namespace;
      new Template(stack).resourceCountIs(
        s3TablesNamespace.S3TablesNamespace,
        1,
      );
    });

    test("with tableBucketArn property", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesNamespace.S3TablesNamespace,
        {
          namespace: "test_namespace",
          table_bucket_arn: stack.resolve(tableBucket.tableBucketArn),
        },
      );
    });
  });

  describe("namespace name validation", () => {
    let tableBucket: s3tables.TableBucket;

    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(stack, "test-bucket", {
        tableBucketName: "test-bucket",
      });
    });

    describe("valid names", () => {
      test("accepts lowercase letters and numbers", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test1", {
              namespaceName: "abc123",
              tableBucket,
            }),
        ).not.toThrow();
      });

      test("accepts underscores", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test2", {
              namespaceName: "test_namespace",
              tableBucket,
            }),
        ).not.toThrow();
      });

      test("accepts single character", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test3", {
              namespaceName: "a",
              tableBucket,
            }),
        ).not.toThrow();
      });

      test("accepts 255 character name", () => {
        const longName = "a".repeat(255);
        expect(
          () =>
            new s3tables.Namespace(stack, "test4", {
              namespaceName: longName,
              tableBucket,
            }),
        ).not.toThrow();
      });
    });

    describe("invalid names", () => {
      test("rejects empty string", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test1", {
              namespaceName: "",
              tableBucket,
            }),
        ).toThrow(
          "Namespace name must be at least 1 and no more than 255 characters",
        );
      });

      test("rejects names longer than 255 characters", () => {
        const longName = "a".repeat(256);
        expect(
          () =>
            new s3tables.Namespace(stack, "test2", {
              namespaceName: longName,
              tableBucket,
            }),
        ).toThrow(
          "Namespace name must be at least 1 and no more than 255 characters",
        );
      });

      test("rejects uppercase letters", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test3", {
              namespaceName: "TestNamespace",
              tableBucket,
            }),
        ).toThrow(
          "Namespace name must only contain lowercase characters, numbers, and underscores (_)",
        );
      });

      test("rejects special characters", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test4", {
              namespaceName: "test-namespace",
              tableBucket,
            }),
        ).toThrow(
          "Namespace name must only contain lowercase characters, numbers, and underscores (_)",
        );
      });

      test("rejects starting with underscore", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test5", {
              namespaceName: "_test",
              tableBucket,
            }),
        ).toThrow(
          "Namespace name must start with a lowercase letter or number",
        );
      });

      test("rejects ending with underscore", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test6", {
              namespaceName: "test_",
              tableBucket,
            }),
        ).toThrow("Namespace name must end with a lowercase letter or number");
      });

      test("rejects names starting with aws", () => {
        expect(
          () =>
            new s3tables.Namespace(stack, "test7", {
              namespaceName: "awstest",
              tableBucket,
            }),
        ).toThrow("Namespace name must not start with reserved prefix 'aws'");
      });
    });
  });

  describe("import existing namespace with attributes", () => {
    let tableBucket: s3tables.TableBucket;
    let importedNamespace: s3tables.INamespace;

    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(stack, "ImportBucket", {
        tableBucketName: "import-bucket",
      });
      importedNamespace = s3tables.Namespace.fromNamespaceAttributes(
        stack,
        "ImportedNamespace",
        {
          namespaceName: "imported_namespace",
          tableBucket,
        },
      );
    });

    test("has the same name as it was imported with", () => {
      expect(importedNamespace.namespaceName).toBe("imported_namespace");
    });

    test("has the same table bucket as it was imported with", () => {
      expect(importedNamespace.tableBucket).toBe(tableBucket);
    });

    test("creates resource with correct construct id", () => {
      expect(importedNamespace.node.id).toBe("ImportedNamespace");
    });
  });
});
