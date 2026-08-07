// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-encryption.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import {
  dataAwsIamPolicyDocument,
  kmsKey,
  s3TablesTableBucket,
  s3TablesTableBucketPolicy,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as encryption from "../../../../src/aws/encryption";
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

const TABLE_BUCKET_NAME = "example-table-bucket";
const TABLE_UUID = "example-table-uuid";
const EXISTING_ROLE_ARN = "arn:aws:iam::123456789012:role/existing-role";

// Upstream `RESOURCES_WITH_TABLE_ARN`/`RESOURCES_WITH_WILDCARD`
// (getResourcesWithTablesArn(TABLE_UUID) / getResourcesWithTablesArn('*')), adapted to this
// repo's `aws_iam_policy_document` rendering: `TableBucketBase.getTableArn()`
// (`../../../../src/aws/storage/s3tables/table-bucket.ts`) builds
// `${tableBucketArn}/table/${tableId}` by plain string interpolation rather than upstream's
// `Fn::Join` CFN intrinsic.
const getResourcesWithTableArn = (
  stack: AwsStack,
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
let userKey: encryption.IKey;

beforeEach(() => {
  stack = testStack();
  role = new iam.Role(stack, "TestRole", {
    assumedBy: new iam.ServicePrincipal("sample"),
  });
  user = new iam.User(stack, "TestUser");
  importedRole = iam.Role.fromRoleArn(stack, "ImportedRole", EXISTING_ROLE_ARN);
});

describe("TableBucket with encryption", () => {
  /**
   * Templatizes grant tests across different test suites.
   *
   * @param withKMS whether to test for KMS policies
   */
  const grantTests = ({ withKMS }: { withKMS: boolean }) => {
    enum GrantType {
      READ = "read",
      WRITE = "write",
      READ_WRITE = "read & write",
    }

    const grantPermissions = (
      bucket: s3tables.TableBucket,
      grantType: GrantType,
      principal: iam.IGrantable,
      tableId: string,
    ) => {
      switch (grantType) {
        case GrantType.READ:
          bucket.grantRead(principal, tableId);
          return;
        case GrantType.WRITE:
          bucket.grantWrite(principal, tableId);
          return;
        case GrantType.READ_WRITE:
          bucket.grantReadWrite(principal, tableId);
      }
    };

    interface TestCase {
      category: string;
      grantType: GrantType;
      actions: string[];
      keyActions: string[];
    }

    const testCases: TestCase[] = [
      {
        category: "grantRead",
        grantType: GrantType.READ,
        actions: perms.TABLE_BUCKET_READ_ACCESS,
        keyActions: perms.KEY_READ_ACCESS,
      },
      {
        category: "grantWrite",
        grantType: GrantType.WRITE,
        actions: perms.TABLE_BUCKET_WRITE_ACCESS,
        keyActions: perms.KEY_WRITE_ACCESS,
      },
      {
        category: "grantReadWrite",
        grantType: GrantType.READ_WRITE,
        actions: perms.TABLE_BUCKET_READ_WRITE_ACCESS,
        keyActions: perms.KEY_READ_WRITE_ACCESS,
      },
    ];

    testCases.forEach(({ category, grantType, actions, keyActions }) => {
      describe(category, () => {
        const verifyKeyPolicies = () => {
          if (withKMS) {
            const t = new Template(stack);
            t.expect.toHaveDataSourceWithProperties(
              dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
              {
                statement: expect.arrayContaining([
                  expect.objectContaining({
                    actions: keyActions,
                    effect: "Allow",
                    resources: ["*"],
                  }),
                ]),
              },
            );
          }
        };

        it(`provides ${grantType} permissions to the bucket ${withKMS && "and key"}`, () => {
          grantPermissions(
            tableBucket,
            grantType,
            new iam.ServicePrincipal("s3.amazonaws.com"),
            "*",
          );
          const t = new Template(stack);
          t.expect.toHaveDataSourceWithProperties(
            dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
            {
              statement: [
                expect.objectContaining({
                  actions,
                  effect: "Allow",
                  resources: getResourcesWithTableArn(stack, tableBucket, "*"),
                }),
              ],
            },
          );
          verifyKeyPolicies();
        });

        // Upstream `provides ${grantType} permissions for a specific table ${withKMS && 'and
        // key'}` -- unlike `../table-bucket-grants.test.ts`'s same-named test (a literal upstream
        // duplicate of its "to the bucket" sibling), this one differs meaningfully: it grants
        // against a concrete `TABLE_UUID` tableId rather than the wildcard `"*"` above, so it's the
        // only place in this suite that pins the per-table ARN suffix
        // (`TableBucketBase.getTableArn()`) alongside KMS-key grants. See
        // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/table-bucket-encryption.test.ts
        it(`provides ${grantType} permissions for a specific table ${withKMS && "and key"}`, () => {
          grantPermissions(
            tableBucket,
            grantType,
            new iam.ServicePrincipal("s3.amazonaws.com"),
            TABLE_UUID,
          );
          const t = new Template(stack);
          t.expect.toHaveDataSourceWithProperties(
            dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
            {
              statement: [
                expect.objectContaining({
                  actions,
                  effect: "Allow",
                  resources: getResourcesWithTableArn(
                    stack,
                    tableBucket,
                    TABLE_UUID,
                  ),
                }),
              ],
            },
          );
          verifyKeyPolicies();
        });

        it(`creates ${grantType} IAM policies for a role ${withKMS && "and key"}`, () => {
          grantPermissions(tableBucket, grantType, role, TABLE_UUID);
          const t = new Template(stack);
          // TERRACONSTRUCTS DEVIATION: upstream renders the identity policy and the KMS key grant
          // as separate `AWS::IAM::Policy` statements (CFN groups all inline-policy statements for
          // a principal under one resource anyway). This repo's `Grant.addToPrincipalOrResource`
          // (`../../iam/grant.ts`) instead accumulates BOTH the table-bucket actions and (when
          // `withKMS`) the KMS key actions onto the SAME `aws_iam_policy_document` backing the
          // role's single default inline policy -- both grant calls target the same
          // `role.addToPrincipalPolicy` sink.
          const expectedStatements: any[] = [
            expect.objectContaining({
              actions,
              effect: "Allow",
              resources: getResourcesWithTableArn(
                stack,
                tableBucket,
                TABLE_UUID,
              ),
            }),
          ];
          if (withKMS) {
            expectedStatements.push(
              expect.objectContaining({ actions: keyActions, effect: "Allow" }),
            );
          }
          t.expect.toHaveDataSourceWithProperties(
            dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
            {
              statement: expectedStatements,
            },
          );
          t.resourceCountIs(
            s3TablesTableBucketPolicy.S3TablesTableBucketPolicy,
            0,
          );
        });

        it(`creates ${grantType} IAM policies for a user ${withKMS && "and key"}`, () => {
          grantPermissions(tableBucket, grantType, user, TABLE_UUID);
          const t = new Template(stack);
          t.resourceCountIs(
            s3TablesTableBucketPolicy.S3TablesTableBucketPolicy,
            0,
          );
        });

        it(`creates ${grantType} IAM policies for an imported role ${withKMS && "and key"}`, () => {
          grantPermissions(tableBucket, grantType, importedRole, TABLE_UUID);
          const t = new Template(stack);
          t.expect.toHaveDataSourceWithProperties(
            dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
            {
              statement: [
                expect.objectContaining({
                  actions,
                  effect: "Allow",
                  principals: [
                    {
                      type: "AWS",
                      identifiers: [EXISTING_ROLE_ARN],
                    },
                  ],
                  resources: getResourcesWithTableArn(
                    stack,
                    tableBucket,
                    TABLE_UUID,
                  ),
                }),
              ],
            },
          );
        });
      });
    });
  };

  describe("with encryptionType undefined and encryptionKey provided", () => {
    beforeEach(() => {
      userKey = new encryption.Key(stack, "ExampleKey", {});
      tableBucket = new s3tables.TableBucket(stack, "ExampleTableBucket", {
        account: "0123456789012",
        region: "us-west-2",
        tableBucketName: TABLE_BUCKET_NAME,
        encryptionKey: userKey,
      });
    });

    it("creates a S3TablesTableBucket resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTableBucket.S3TablesTableBucket,
        1,
      );
    });

    it("has encryption configuration", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucket.S3TablesTableBucket,
        {
          name: TABLE_BUCKET_NAME,
          encryption_configuration: {
            kms_key_arn: stack.resolve(userKey.keyArn),
            sse_algorithm: "aws:kms",
          },
        },
      );
    });

    grantTests({ withKMS: true });
  });

  describe("with encryptionType KMS and no encryptionKey provided", () => {
    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(stack, "ExampleTableBucket", {
        account: "0123456789012",
        region: "us-west-2",
        tableBucketName: TABLE_BUCKET_NAME,
        encryption: s3tables.TableBucketEncryption.KMS,
      });
    });

    it("creates a S3TablesTableBucket resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTableBucket.S3TablesTableBucket,
        1,
      );
    });

    it("creates a KmsKey resource", () => {
      new Template(stack).resourceCountIs(kmsKey.KmsKey, 1);
    });

    it("has encryption configuration", () => {
      const t = new Template(stack);
      // NOTE: `kms_key_arn` also present (auto-created key) but intentionally not asserted here --
      // `expect.objectContaining` is required at this nesting level because the underlying jest
      // matcher (`jestPassEvaluation` in `cdktn/lib/testing/adapters/jest.js`) only partial-matches
      // the TOP-level properties object; nested plain objects require an exact key-set match.
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucket.S3TablesTableBucket,
        {
          name: TABLE_BUCKET_NAME,
          encryption_configuration: expect.objectContaining({
            sse_algorithm: "aws:kms",
          }),
        },
      );
    });

    it("key allowlists S3Tables maintenance SP", () => {
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            expect.objectContaining({
              sid: "AllowS3TablesMaintenanceAccess",
              actions: ["kms:GenerateDataKey", "kms:Decrypt"],
              effect: "Allow",
              resources: ["*"],
              // NOTE: `allowTablesMaintenanceAccessToKey()` uses `this.stack.region`/`.account`
              // (matches upstream's own `this.stack.region`/`.account` verbatim), NOT the table
              // bucket's own `env` -- so this resolves against the stack's default env, not the
              // `account`/`region` passed to `TableBucketProps` above.
              condition: [
                {
                  test: "StringLike",
                  variable: "kms:EncryptionContext:aws:s3:arn",
                  values: [
                    `arn:\${data.aws_partition.Partitition.partition}:s3tables:us-east-1:\${data.aws_caller_identity.CallerIdentity.account_id}:bucket/${TABLE_BUCKET_NAME}/*`,
                  ],
                },
              ],
            }),
          ]),
        },
      );
    });

    grantTests({ withKMS: true });
  });

  describe("with encryptionType KMS and user-defined encryptionKey", () => {
    beforeEach(() => {
      userKey = new encryption.Key(stack, "ExampleKey", {});
      tableBucket = new s3tables.TableBucket(stack, "ExampleTableBucket", {
        account: "0123456789012",
        region: "us-west-2",
        tableBucketName: TABLE_BUCKET_NAME,
        encryption: s3tables.TableBucketEncryption.KMS,
        encryptionKey: userKey,
      });
    });

    it("creates a S3TablesTableBucket resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTableBucket.S3TablesTableBucket,
        1,
      );
    });

    it("has encryption configuration", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucket.S3TablesTableBucket,
        {
          name: TABLE_BUCKET_NAME,
          encryption_configuration: {
            kms_key_arn: stack.resolve(userKey.keyArn),
            sse_algorithm: "aws:kms",
          },
        },
      );
    });

    grantTests({ withKMS: true });
  });

  describe("with encryptionType S3_MANAGED and no encryptionKey provided", () => {
    beforeEach(() => {
      tableBucket = new s3tables.TableBucket(stack, "ExampleTableBucket", {
        account: "0123456789012",
        region: "us-west-2",
        tableBucketName: TABLE_BUCKET_NAME,
        encryption: s3tables.TableBucketEncryption.S3_MANAGED,
      });
    });

    it("creates a S3TablesTableBucket resource", () => {
      new Template(stack).resourceCountIs(
        s3TablesTableBucket.S3TablesTableBucket,
        1,
      );
    });

    it("has encryption configuration", () => {
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3TablesTableBucket.S3TablesTableBucket,
        {
          name: TABLE_BUCKET_NAME,
          encryption_configuration: {
            sse_algorithm: "AES256",
            // TERRACONSTRUCTS DEVIATION: `kms_key_arn` explicitly rendered as `null` (not simply
            // omitted) -- `encryption_configuration` is a Terraform framework
            // `schema.ObjectAttribute`, whose members must all be present in the rendered config;
            // see the DEVIATION note on `TableBucket.parseEncryption()`'s S3_MANAGED branch.
            kms_key_arn: null,
          },
        },
      );
    });

    grantTests({ withKMS: false });
  });

  describe("with encryptionType S3_MANAGED and user-defined encryptionKey", () => {
    it("throws a validation error in the constructor", () => {
      userKey = new encryption.Key(stack, "ExampleKey", {});
      expect(
        () =>
          new s3tables.TableBucket(stack, "ExampleTableBucket", {
            account: "0123456789012",
            region: "us-west-2",
            tableBucketName: TABLE_BUCKET_NAME,
            encryption: s3tables.TableBucketEncryption.S3_MANAGED,
            encryptionKey: userKey,
          }),
      ).toThrow();
    });
  });
});
