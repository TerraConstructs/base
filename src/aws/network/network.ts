import { IResolvable } from "cdktf";
import { ISubnet } from "./subnet";
import { ISubnetGroup } from "./subnet-group";
import { IAwsConstruct } from "../";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface NetworkOutputs {
  /**
   * AWS VpcId of the network
   */
  readonly vpcId: string;
  /**
   * List of public subnets
   */
  readonly publicSubnetIds: string[];
  /**
   * List of private subnets
   */
  readonly privateSubnetIds: string[];
  /**
   * List of data subnets
   */
  readonly dataSubnetIds: string[];
  /**
   * Db Subnet Group if enabled
   */
  readonly dbSubnetGroup?: string | IResolvable;
  /**
   * ElastiCache Subnet Group if enabled
   */
  readonly elastiCacheSubnetGroup?: string | IResolvable;
  /**
   * Arn of the service discovery namespace
   */
  readonly serviceDiscoveryNamespaceName: string;
}

export interface INetwork extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly networkOutputs: NetworkOutputs;
  /**
   * The VPC ID of the network
   */
  readonly vpcId: string;
  /**
   * The Public Subnets of the network
   */
  readonly publicSubnets: ISubnet[];
  /**
   * The Private Subnets of the network
   */
  readonly privateSubnets: ISubnet[];
  /**
   * The Data Subnets of the network
   */
  readonly dataSubnets: ISubnet[];
  /**
   * The Service Discovery Private DNS Namespace
   */
  readonly serviceDiscoveryNamespaceArn: string;
  /**
   * The Db Subnet Group if enabled.
   */
  readonly dbSubnetGroup?: ISubnetGroup;
  /**
   * The ElastiCache Subnet Group if enabled.
   */
  readonly elastiCacheSubnetGroup?: ISubnetGroup;
  /**
   * Adds a Subnet Group for RDS and DocDb clusters
   */
  enableDbSubnetGroup(): void;
  /**
   * Adds a Subnet Group for ElastiCache clusters
   */
  enableElastiCacheSubnetGroup(): void;
}
