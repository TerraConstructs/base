// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/cluster-ref.ts

import type { Endpoint } from "./endpoint";
import { IAwsConstruct } from "../../aws-construct";
import * as ec2 from "../../compute";
import * as secretsmanager from "../../encryption";

/**
 * Create a clustered database with a given number of instances.
 *
 * TODO: omitted — upstream also extends `aws_docdb.IDBClusterRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (identical omission to `dbClusterRef` on `IDatabaseCluster`
 * in `../rds/cluster-ref.ts` — see the TODO there), so `dbClusterRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/cluster-ref.ts#L10
 */
export interface IDatabaseCluster
  extends IAwsConstruct,
    ec2.IConnectable,
    secretsmanager.ISecretAttachmentTarget {
  /**
   * Identifier of the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * Identifiers of the replicas
   */
  readonly instanceIdentifiers: string[];

  /**
   * The endpoint to use for read/write operations
   */
  readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  readonly clusterReadEndpoint: Endpoint;

  /**
   * Endpoints which address each individual replica.
   */
  readonly instanceEndpoints: Endpoint[];

  /**
   * The security group for this database cluster
   */
  readonly securityGroupId: string;
}

/**
 * Properties that describe an existing cluster instance
 */
export interface DatabaseClusterAttributes {
  /**
   * The database port
   *
   * @default - none
   */
  readonly port?: number;

  /**
   * The security group of the database cluster
   *
   * @default - no security groups
   */
  readonly securityGroup?: ec2.ISecurityGroup;

  /**
   * Identifier for the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * Identifier for the instances
   *
   * @default - no instance identifiers
   */
  readonly instanceIdentifiers?: string[];

  /**
   * Cluster endpoint address
   *
   * @default - no cluster endpoint address
   */
  readonly clusterEndpointAddress?: string;

  /**
   * Reader endpoint address
   *
   * @default - no reader endpoint address
   */
  readonly readerEndpointAddress?: string;

  /**
   * Endpoint addresses of individual instances
   *
   * @default - no instance endpoint addresses
   */
  readonly instanceEndpointAddresses?: string[];
}
