// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster-ref.ts

import type { IClusterEngine } from "./cluster-engine";
import type { Endpoint } from "./endpoint";
// TODO: omitted — upstream also imports `DatabaseProxy`/`DatabaseProxyOptions` from `./proxy` for
// `IDatabaseCluster.addProxy()` below. `./proxy` is not ported in this repo yet — it lands in a
// later PR (RDS PR 2e), matching the existing barrel deferral in `./index.ts` —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster-ref.ts#L3
import { IAwsConstruct } from "../../aws-construct";
import * as ec2 from "../../compute";
import * as secretsmanager from "../../encryption";
import * as iam from "../../iam";

/**
 * Create a clustered database with a given number of instances.
 *
 * TODO: omitted — upstream also extends `aws_rds.IDBClusterRef`, a CloudFormation cross-stack
 * "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
 * equivalent generated-reference layer (identical omission to `dbInstanceRef`/`IDBInstanceRef` on
 * `IDatabaseInstance` in `./instance.ts` — see the TODO there), so `dbClusterRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster-ref.ts#L13
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
   * The immutable identifier for the cluster; for example: cluster-ABCD1234EFGH5678IJKL90MNOP.
   *
   * This AWS Region-unique identifier is used in things like IAM authentication policies.
   */
  readonly clusterResourceIdentifier: string;

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
   * The engine of this Cluster.
   * May be not known for imported Clusters if it wasn't provided explicitly.
   */
  readonly engine?: IClusterEngine;

  /**
   * The ARN of the database cluster
   */
  readonly clusterArn: string;

  // TODO: omitted — upstream also declares `addProxy(id, options): DatabaseProxy` here. `DatabaseProxy`
  // (and the `./proxy` module it lives in) is not ported in this repo yet — it lands in a later PR
  // (RDS PR 2e), matching the existing barrel deferral in `./index.ts` —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/cluster-ref.ts#L60-L62
  // addProxy(id: string, options: DatabaseProxyOptions): DatabaseProxy;

  /**
   * Grant the given identity connection access to the Cluster.
   *
   * @param grantee the Principal to grant the permissions to
   * @param dbUser the name of the database user to allow connecting
   *
   */
  grantConnect(grantee: iam.IGrantable, dbUser: string): iam.Grant;

  /**
   * Grant the given identity to access to the Data API.
   *
   * @param grantee The principal to grant access to
   */
  grantDataApiAccess(grantee: iam.IGrantable): iam.Grant;
}

/**
 * Properties that describe an existing cluster instance
 */
export interface DatabaseClusterAttributes {
  /**
   * Identifier for the cluster
   */
  readonly clusterIdentifier: string;

  /**
   * The immutable identifier for the cluster; for example: cluster-ABCD1234EFGH5678IJKL90MNOP.
   *
   * This AWS Region-unique identifier is used to grant access to the cluster.
   *
   * @default none
   */
  readonly clusterResourceIdentifier?: string;

  /**
   * The database port
   *
   * @default - none
   */
  readonly port?: number;

  /**
   * The security groups of the database cluster
   *
   * @default - no security groups
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * Identifier for the instances
   *
   * @default - no instance identifiers
   */
  readonly instanceIdentifiers?: string[];

  /**
   * Cluster endpoint address
   *
   * @default - no endpoint address
   */
  readonly clusterEndpointAddress?: string;

  /**
   * Reader endpoint address
   *
   * @default - no reader address
   */
  readonly readerEndpointAddress?: string;

  /**
   * Endpoint addresses of individual instances
   *
   * @default - no instance endpoints
   */
  readonly instanceEndpointAddresses?: string[];

  /**
   * The engine of the existing Cluster.
   *
   * @default - the imported Cluster's engine is unknown
   */
  readonly engine?: IClusterEngine;

  /**
   * The secret attached to the database cluster
   *
   * @default - the imported Cluster's secret is unknown
   */
  readonly secret?: secretsmanager.ISecret;

  /**
   * Whether the Data API for the cluster is enabled.
   *
   * @default false
   */
  readonly dataApiEnabled?: boolean;
}
