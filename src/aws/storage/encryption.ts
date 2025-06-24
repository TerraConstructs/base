import { Construct } from "constructs";
import { dynamodbTable } from "@cdktf/provider-aws";
import { TableEncryption } from "./shared";
import * as kms from "../encryption";
import { AwsStack } from "../aws-stack";
import { Token } from "cdktf";

/**
 * Custom error for validation failures.
 */
class ValidationError extends Error {
  constructor(message: string, _scope?: Construct) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Represents server-side encryption for a DynamoDB table, adapted for TerraConstructs.
 * This class helps configure the `serverSideEncryption` property for a primary `DynamodbTable`
 * and the `kmsKeyArn` for its replicas when defining a global table.
 */
export abstract class TableEncryptionV2 {
  /**
   * Configure server-side encryption using a DynamoDB owned key.
   */
  public static dynamoOwnedKey(): TableEncryptionV2 {
    return new (class extends TableEncryptionV2 {
      constructor() {
        super(TableEncryption.DEFAULT);
      }
      public getTableSseConfiguration():
        | dynamodbTable.DynamodbTableServerSideEncryption
        | undefined {
        return { enabled: false };
      }
      public getReplicaKmsKeyArn(
        _replicaRegion: string,
        _scopeForStackLookup: Construct,
      ): string | undefined {
        // For DYNAMO_OWNED, replicas also use DynamoDB owned keys by default.
        // The kmsKeyArn in the replica block should be undefined.
        return undefined;
      }
    })();
  }

  /**
   * Configure server-side encryption using an AWS managed key.
   */
  public static awsManagedKey(): TableEncryptionV2 {
    return new (class extends TableEncryptionV2 {
      constructor() {
        super(TableEncryption.AWS_MANAGED);
      }
      public getTableSseConfiguration():
        | dynamodbTable.DynamodbTableServerSideEncryption
        | undefined {
        // enabled: true without kmsKeyArn means AWS_MANAGED_KMS_KEY (alias/aws/dynamodb)
        return { enabled: true };
      }
      public getReplicaKmsKeyArn(
        _replicaRegion: string,
        _scopeForStackLookup: Construct,
      ): string | undefined {
        // For AWS_MANAGED, replicas also use AWS managed keys by default.
        // The kmsKeyArn in the replica block should be undefined to use the default AWS managed key for that replica region.
        return undefined;
      }
    })();
  }

  /**
   * Configure server-side encryption using customer managed keys.
   *
   * @param tableKey The KMS key for the primary table (table in the current stack's region).
   * @param replicaKeyArns An object containing the ARN of the KMS key to use for each replica table in other regions.
   * @param scopeForValidation Optional scope, used for validating that `replicaKeyArns` does not contain the primary stack's region key.
   */
  public static customerManagedKey(
    tableKey: kms.IKey,
    replicaKeyArns: { [region: string]: string } = {},
    scopeForValidation?: Construct,
  ): TableEncryptionV2 {
    if (scopeForValidation) {
      const stackRegion = AwsStack.ofAwsConstruct(scopeForValidation).region;
      if (
        !Token.isUnresolved(stackRegion) &&
        replicaKeyArns.hasOwnProperty(stackRegion)
      ) {
        throw new ValidationError(
          `KMS key for deployment region ${stackRegion} (primary table region) cannot be defined in 'replicaKeyArns'. It should be provided via 'tableKey'.`,
          scopeForValidation,
        );
      }
    }

    return new (class extends TableEncryptionV2 {
      constructor() {
        super(TableEncryption.CUSTOMER_MANAGED, tableKey, replicaKeyArns);
      }

      public getTableSseConfiguration():
        | dynamodbTable.DynamodbTableServerSideEncryption
        | undefined {
        if (!this.tableKey) {
          // This should ideally be caught by TypeScript if tableKey is not optional for CUSTOMER_MANAGED
          throw new Error(
            "Table key (tableKey) is required for CUSTOMER_MANAGED encryption.",
          );
        }
        return { enabled: true, kmsKeyArn: this.tableKey.keyArn };
      }

      public getReplicaKmsKeyArn(
        replicaRegion: string,
        scopeForStackLookup: Construct,
      ): string | undefined {
        // This method provides the kmsKeyArn for a replica in a region *other than* the primary stack's region.
        // The primary stack's region is where the main DynamodbTable resource is defined.

        // Validate that the current stack's region key is not in replicaKeyArns (redundant if done in factory, but good for safety)
        const stackRegion = AwsStack.ofAwsConstruct(scopeForStackLookup).region;
        if (
          !Token.isUnresolved(stackRegion) &&
          this.replicaKeyArns &&
          this.replicaKeyArns.hasOwnProperty(stackRegion)
        ) {
          throw new ValidationError(
            `KMS key for deployment region ${stackRegion} (primary table region) cannot be defined in 'replicaKeyArns'. It is derived from 'tableKey'.`,
            scopeForStackLookup,
          );
        }

        if (
          this.replicaKeyArns &&
          this.replicaKeyArns.hasOwnProperty(replicaRegion)
        ) {
          return this.replicaKeyArns[replicaRegion];
        }

        // If a replica is being defined for 'replicaRegion' using CUSTOMER_MANAGED encryption type,
        // and it's not the primary region, its key must be in replicaKeyArns.
        throw new ValidationError(
          `Customer-managed KMS key for replica region ${replicaRegion} was not found in 'replicaKeyArns'.`,
          scopeForStackLookup,
        );
      }
    })();
  }

  protected constructor(
    public readonly type: TableEncryption,
    public readonly tableKey?: kms.IKey,
    public readonly replicaKeyArns?: { [region: string]: string },
  ) {}

  /**
   * Get the Server-Side Encryption (SSE) configuration for the primary DynamoDB table.
   * This is used for the `serverSideEncryption` block of the `DynamodbTable` resource.
   */
  public abstract getTableSseConfiguration():
    | dynamodbTable.DynamodbTableServerSideEncryption
    | undefined;

  /**
   * Get the KMS Key ARN for a given replica region.
   * This is used to populate the `kmsKeyArn` field within the `replica` block of a `DynamodbTable` resource.
   * This method assumes `replicaRegion` is for a secondary replica (not the primary table's region).
   * @param replicaRegion The AWS region of the replica.
   * @param scopeForStackLookup A construct within the stack, used to determine the primary stack's region for validation.
   */
  public abstract getReplicaKmsKeyArn(
    replicaRegion: string,
    scopeForStackLookup: Construct,
  ): string | undefined;
}
