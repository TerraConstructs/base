import {
  dbSubnetGroup,
  elasticacheSubnetGroup,
  // docdbSubnetGroup, // not needed, rds and docdb share subnet groups
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AwsBeaconBase, AwsBeaconProps, IAwsBeacon } from "../beacon";
import { ISubnet } from "./subnet";

export enum SubnetGroupType {
  /**
   * RDS and DocDb SubnetGroup
   */
  DB = "DB",
  /**
   * ElastiCache SubnetGroup
   */
  ELASTICACHE = "ELASTICACHE",
}

export interface SubnetGroupProps extends AwsBeaconProps {
  readonly subnets: ISubnet[];
  readonly tags?: Record<string, string>;
}

export interface ISubnetGroup extends IAwsBeacon {
  readonly type: SubnetGroupType;
  readonly arn: string;
  readonly subnets: ISubnet[];
}

export abstract class BaseSubnetGroup
  extends AwsBeaconBase
  implements ISubnetGroup
{
  public readonly type: SubnetGroupType;
  public readonly tags?: Record<string, string>;

  private readonly _subnets: ISubnet[];
  public get subnets(): ISubnet[] {
    return this._subnets;
  }
  public abstract get arn(): string;
  public get outputs(): Record<string, any> {
    return {
      type: this.type,
      arn: this.arn,
      subnets: this.subnets.map((subnet) => subnet.outputs),
    };
  }

  constructor(
    scope: Construct,
    id: string,
    type: SubnetGroupType,
    props: SubnetGroupProps,
  ) {
    super(scope, id, props);
    this.type = type;
    this.tags = props.tags;
    this._subnets = props.subnets;
  }
}

export class DbSubnetGroup extends BaseSubnetGroup {
  public readonly resource: dbSubnetGroup.DbSubnetGroup;
  public get arn(): string {
    return this.resource.arn;
  }
  constructor(scope: Construct, id: string, props: SubnetGroupProps) {
    super(scope, id, SubnetGroupType.DB, props);
    this.resource = new dbSubnetGroup.DbSubnetGroup(this, "Resource", {
      name: this.gridUUID,
      subnetIds: this.subnets.map((subnet) => subnet.subnetId),
      tags: this.tags,
    });
  }
}

export class ElastiCacheSubnetGroup extends BaseSubnetGroup {
  public readonly resource: elasticacheSubnetGroup.ElasticacheSubnetGroup;
  public get arn(): string {
    return this.resource.arn;
  }
  constructor(scope: Construct, id: string, props: SubnetGroupProps) {
    super(scope, id, SubnetGroupType.ELASTICACHE, props);
    this.resource = new elasticacheSubnetGroup.ElasticacheSubnetGroup(
      this,
      "Resource",
      {
        name: this.gridUUID,
        subnetIds: this.subnets.map((subnet) => subnet.subnetId),
        tags: this.tags,
      },
    );
  }
}
