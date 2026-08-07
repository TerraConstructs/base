// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/backupable-resources-collector.ts

import {
  dbInstance,
  dynamodbTable,
  ebsVolume,
  instance as ec2Instance,
  rdsCluster,
} from "@cdktn/provider-aws";
import { IAspect } from "cdktn";
import { IConstruct } from "constructs";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";

/**
 * TERRACONSTRUCTS DEVIATION: upstream walks the construct tree matching CloudFormation L1 types
 * (`efs.CfnFileSystem`, `dynamodb.CfnTable`, `ec2.CfnInstance`, `ec2.CfnVolume`,
 * `rds.CfnDBInstance`, `rds.CfnDBCluster`) via an `Aspect`. This repo has no CFN layer, so
 * matching is done against the Terraform L1 resource classes from `@cdktn/provider-aws` instead
 * (`dynamodbTable.DynamodbTable`, `instance.Instance`, `ebsVolume.EbsVolume`,
 * `dbInstance.DbInstance`, `rdsCluster.RdsCluster`).
 *
 * `rds.CfnDBInstance`'s "only add an ARN if this instance is not an Aurora cluster member"
 * (`!dbInstance.dbClusterIdentifier`) guard has no Terraform equivalent to port: Aurora cluster
 * member instances are provisioned via the entirely separate `aws_rds_cluster_instance` resource
 * (`rdsClusterInstance.RdsClusterInstance`, used by `../rds/cluster.ts`) rather than
 * `aws_db_instance` -- every `dbInstance.DbInstance` in the tree is by construction a standalone
 * instance, matching `../rds/instance.ts`'s `DatabaseInstance`. `aws_rds_cluster_instance` itself
 * is intentionally not matched here, mirroring upstream not emitting a separate ARN per cluster
 * member (the cluster-level ARN from `rdsCluster.RdsCluster` already covers the whole cluster).
 *
 * TODO: omitted -- upstream also matches `efs.CfnFileSystem`. EFS (`aws-efs`) has not been ported
 * to this repo yet (no `storage/efs` module exists) -- see the identical omission on
 * `BackupResource.fromEfsFileSystem` in `./resource.ts` --
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/backupable-resources-collector.ts#L9-L14
 */
export class BackupableResourcesCollector implements IAspect {
  public readonly resources: string[] = [];

  public visit(node: IConstruct) {
    if (node instanceof dynamodbTable.DynamodbTable) {
      this.resources.push(
        AwsStack.ofAwsConstruct(node).formatArn({
          service: "dynamodb",
          resource: "table",
          resourceName: node.id,
        }),
      );
    }

    if (node instanceof ec2Instance.Instance) {
      this.resources.push(
        AwsStack.ofAwsConstruct(node).formatArn({
          service: "ec2",
          resource: "instance",
          resourceName: node.id,
        }),
      );
    }

    if (node instanceof ebsVolume.EbsVolume) {
      this.resources.push(
        AwsStack.ofAwsConstruct(node).formatArn({
          service: "ec2",
          resource: "volume",
          resourceName: node.id,
        }),
      );
    }

    if (node instanceof dbInstance.DbInstance) {
      this.resources.push(
        AwsStack.ofAwsConstruct(node).formatArn({
          service: "rds",
          resource: "db",
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          // TERRACONSTRUCTS DEVIATION: `aws_db_instance.id` is the RDS DBI resource ID
          // (`db-ABCDEFGHIJK...`) in terraform-provider-aws v5+, not the DB instance
          // identifier -- the identifier moved to the separate `identifier` attribute. Use
          // `.identifier` here to match `../rds/instance.ts`'s `DatabaseInstance.instanceArn`
          // (see `resourceName: instanceIdentifier` there), keeping both ARN-derivation paths
          // consistent. https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance
          resourceName: node.identifier,
        }),
      );
    }

    if (node instanceof rdsCluster.RdsCluster) {
      this.resources.push(
        AwsStack.ofAwsConstruct(node).formatArn({
          service: "rds",
          resource: "cluster",
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          resourceName: node.id,
        }),
      );
    }
  }
}
