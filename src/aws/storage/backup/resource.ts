// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/resource.ts

import { Construct } from "constructs";
import { AwsStack } from "../../aws-stack";
import type * as compute from "../../compute";
import type * as rds from "../rds";
import type { ITable } from "../shared";

/**
 * An operation that is applied to a key-value pair
 */
export enum TagOperation {
  /**
   * StringEquals
   */
  STRING_EQUALS = "STRINGEQUALS",

  /**
   * Dummy member
   */
  DUMMY = "dummy",
}

/**
 * A tag condition
 */
export interface TagCondition {
  /**
   * The key in a key-value pair.
   *
   * For example, in `"ec2:ResourceTag/Department": "accounting"`,
   * `ec2:ResourceTag/Department` is the key.
   */
  readonly key: string;

  /**
   * An operation that is applied to a key-value pair used to filter
   * resources in a selection.
   *
   * @default STRING_EQUALS
   */
  readonly operation?: TagOperation;

  /**
   * The value in a key-value pair.
   *
   * For example, in `"ec2:ResourceTag/Department": "accounting"`,
   * `accounting` is the value.
   */
  readonly value: string;
}

/**
 * A resource to backup
 */
export class BackupResource {
  /**
   * Adds all supported resources in a construct
   *
   * @param construct The construct containing resources to backup
   */
  public static fromConstruct(construct: Construct) {
    return new BackupResource(undefined, undefined, construct);
  }

  /**
   * A DynamoDB table
   */
  public static fromDynamoDbTable(table: ITable) {
    return BackupResource.fromArn(table.tableArn);
  }

  /**
   * An EC2 instance
   */
  public static fromEc2Instance(instance: compute.IInstance) {
    // TERRACONSTRUCTS DEVIATION: unlike `fromRdsDatabaseInstance`/`fromRdsDatabaseCluster` below,
    // `compute.IInstance` (`../../compute/instance.ts`) does not expose a pre-formatted
    // `instanceArn` -- it is built here the same way upstream builds it, via `formatArn`.
    return BackupResource.fromArn(
      AwsStack.ofAwsConstruct(instance).formatArn({
        service: "ec2",
        resource: "instance",
        resourceName: instance.instanceId,
      }),
    );
  }

  // TODO: omitted -- upstream's `fromEfsFileSystem(fileSystem: efs.IFileSystem)`. EFS
  // (`aws-efs`) has not been ported to this repo yet (no `storage/efs` module exists), so there
  // is no `IFileSystem`-equivalent type to accept here -- identical omission to the EFS-shaped
  // gaps documented in `./backupable-resources-collector.ts` --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/resource.ts#L84

  /**
   * A RDS database instance
   */
  public static fromRdsDatabaseInstance(instance: rds.IDatabaseInstance) {
    return BackupResource.fromArn(instance.instanceArn);
  }

  /**
   * A RDS database cluster
   */
  public static fromRdsDatabaseCluster(cluster: rds.IDatabaseCluster) {
    // TERRACONSTRUCTS DEVIATION: upstream hand-builds the ARN via `Stack.formatArn` with
    // COLON_RESOURCE_NAME (`arn:...:rds:...:cluster:<identifier>`); this repo's
    // `rds.IDatabaseCluster.clusterArn` already renders that exact shape, so the manual
    // reconstruction is unnecessary and the emitted ARN is byte-identical.
    return BackupResource.fromArn(cluster.clusterArn);
  }

  /**
   * An Aurora database instance
   */
  public static fromRdsServerlessCluster(cluster: rds.IServerlessCluster) {
    // TERRACONSTRUCTS DEVIATION: same `clusterArn` substitution as `fromRdsDatabaseCluster` above.
    return BackupResource.fromArn(cluster.clusterArn);
  }

  /**
   * A list of ARNs or match patterns such as
   * `arn:aws:ec2:us-east-1:123456789012:volume/*`
   */
  public static fromArn(arn: string) {
    return new BackupResource(arn);
  }

  /**
   * A tag condition
   */
  public static fromTag(key: string, value: string, operation?: TagOperation) {
    return new BackupResource(undefined, {
      key,
      value,
      operation,
    });
  }

  /**
   * A resource
   */
  public readonly resource?: string;

  /**
   * A condition on a tag
   */
  public readonly tagCondition?: TagCondition;

  /**
   * A construct
   */
  public readonly construct?: Construct;

  constructor(
    resource?: string,
    tagCondition?: TagCondition,
    construct?: Construct,
  ) {
    this.resource = resource;
    this.tagCondition = tagCondition;
    this.construct = construct;
  }
}
