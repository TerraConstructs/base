// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-dynamodb/test/encryption.test.ts

import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { IKey, Key } from "../../../src/aws/encryption";
import { TableEncryptionV2 } from "../../../src/aws/storage/encryption";
import { TableEncryption } from "../../../src/aws/storage/shared";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const defaultRegion = "us-west-2";
const providerConfig = { region: defaultRegion };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

function createStack(region: string = defaultRegion): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "Stack", {
    environmentName,
    gridUUID,
    providerConfig: { ...providerConfig, region },
    gridBackendConfig,
  });
}

describe("dynamo owned key", () => {
  // GIVEN
  let encryption: TableEncryptionV2;
  beforeEach(() => {
    encryption = TableEncryptionV2.dynamoOwnedKey();
  });

  test("type is DEFAULT and tableKey is undefined", () => {
    // WHEN / THEN
    expect(encryption.getTableSseConfiguration()).toEqual({
      enabled: false,
    });
  });

  test("replicaKeyArns is undefined", () => {
    // WHEN / THEN
    // CDK's _renderReplicaSseSpecification() returning undefined implies no specific replica keys.
    expect(encryption.replicaKeyArns).toBeUndefined();
  });

  test("encryption type is DEFAULT (AWS_OWNED)", () => {
    // WHEN / THEN
    expect(encryption.type).toEqual(TableEncryption.DEFAULT);
  });

  test("table key is undefined", () => {
    // WHEN / THEN
    expect(encryption.tableKey).toBeUndefined();
  });

  test("replica key ARNs are undefined", () => {
    // WHEN / THEN
    expect(encryption.replicaKeyArns).toBeUndefined();
  });
});

describe("aws managed key", () => {
  // GIVEN
  let encryption: TableEncryptionV2;
  beforeEach(() => {
    encryption = TableEncryptionV2.awsManagedKey();
  });

  test("type is AWS_MANAGED and tableKey is undefined", () => {
    // WHEN / THEN
    // CDK's _renderSseSpecification() returning { sseEnabled: true, sseType: 'KMS' } implies AWS_MANAGED encryption.
    expect(encryption.type).toEqual(TableEncryption.AWS_MANAGED);
    expect(encryption.tableKey).toBeUndefined();
  });

  test("replicaKeyArns is undefined", () => {
    // WHEN / THEN
    // CDK's _renderReplicaSseSpecification() returning undefined implies no specific replica keys.
    expect(encryption.replicaKeyArns).toBeUndefined();
  });

  test("encryption type is AWS_MANAGED", () => {
    // WHEN / THEN
    expect(encryption.type).toEqual(TableEncryption.AWS_MANAGED);
  });

  test("table key is undefined", () => {
    // WHEN / THEN
    expect(encryption.tableKey).toBeUndefined();
  });

  test("replica key ARNs are undefined", () => {
    // WHEN / THEN
    expect(encryption.replicaKeyArns).toBeUndefined();
  });
});

describe("customer managed keys", () => {
  // GIVEN
  let encryption: TableEncryptionV2;
  let stack: AwsStack;
  let tableKey: IKey;
  let replicaKeyArns: { [region: string]: string };

  beforeEach(() => {
    stack = createStack("us-west-2");
    tableKey = new Key(stack, "key");
    replicaKeyArns = {
      "us-east-1":
        "arn:aws:kms:us-east-1:123456789012:key/g24efbna-az9b-42ro-m3bp-cq249l94fca6",
      "us-east-2":
        "arn:aws:kms:us-east-2:123456789012:key/g24efbna-az9b-42ro-m3bp-cq249l94fca6",
    };
    encryption = TableEncryptionV2.customerManagedKey(tableKey, replicaKeyArns);
  });

  test("type is CUSTOMER_MANAGED and tableKey is set", () => {
    // WHEN / THEN
    // CDK's _renderSseSpecification() returning { sseEnabled: true, sseType: 'KMS' } implies CUSTOMER_MANAGED with a key.
    expect(encryption.type).toEqual(TableEncryption.CUSTOMER_MANAGED);
    expect(encryption.tableKey).toBe(tableKey);
  });

  test("tableKey is used for replicas in the deployment region", () => {
    // This is implied by tableKey being set and replicaKeyArns not containing the deployment region.
    // The CDK's _renderReplicaSseSpecification(stack, stack.region) returning { kmsMasterKeyId: tableKey.keyArn }
    // means the tableKey is the source of truth for its own region.
    expect(encryption.tableKey?.keyArn).toEqual(tableKey.keyArn);
    expect(encryption.replicaKeyArns?.[stack.region]).toBeUndefined();
  });

  test("replicaKeyArns provides keys for other replica regions", () => {
    // This checks the direct accessibility of replicaKeyArns for a specific region.
    // CDK's _renderReplicaSseSpecification(stack, 'us-east-1') returning a specific KMS ID from replicaKeyArns.
    expect(encryption.replicaKeyArns?.["us-east-1"]).toEqual(
      "arn:aws:kms:us-east-1:123456789012:key/g24efbna-az9b-42ro-m3bp-cq249l94fca6",
    );
  });

  test("encryption type is CUSTOMER_MANAGED", () => {
    // WHEN / THEN
    expect(encryption.type).toEqual(TableEncryption.CUSTOMER_MANAGED);
  });

  test("can get the table key", () => {
    // WHEN / THEN
    expect(encryption.tableKey?.keyArn).toEqual(tableKey.keyArn);
  });

  test("can get replica key ARNs", () => {
    // WHEN / THEN
    expect(encryption.replicaKeyArns).toEqual({
      "us-east-1":
        "arn:aws:kms:us-east-1:123456789012:key/g24efbna-az9b-42ro-m3bp-cq249l94fca6",
      "us-east-2":
        "arn:aws:kms:us-east-2:123456789012:key/g24efbna-az9b-42ro-m3bp-cq249l94fca6",
    });
  });

  // Test for constructor validation if replicaKeyArns contains deployment region key
  test("customerManagedKey throws if deployment region is defined in replica key ARNs", () => {
    const currentRegion = stack.region;
    const invalidReplicaKeyArns = {
      ...replicaKeyArns,
      [currentRegion]:
        "arn:aws:kms:us-west-2:123456789012:key/g24efbna-az9b-42ro-m3bp-cq249l94fca6",
    };

    // WHEN / THEN
    expect(() => {
      TableEncryptionV2.customerManagedKey(
        tableKey,
        invalidReplicaKeyArns,
        stack,
      );
    }).toThrow(
      `KMS key for deployment region ${currentRegion} (primary table region) cannot be defined in 'replicaKeyArns'. It should be provided via 'tableKey'.`,
    );
  });

  // The following CDK tests for _renderReplicaSseSpecification throwing in certain scenarios
  // (region agnostic stack, region not in replicaKeyArns) are related to how the TableV2 construct
  // *uses* the TableEncryptionV2 object, rather than the TableEncryptionV2 object itself,
  // as the TC TableEncryptionV2 declaration does not expose a similar rendering method.
  // These would be more appropriate as integration tests for TableV2.
});
