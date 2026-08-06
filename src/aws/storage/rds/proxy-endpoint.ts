// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/proxy-endpoint.ts

import { dbProxyEndpoint } from "@cdktn/provider-aws";
import type { Construct } from "constructs";
import type { IDatabaseProxy } from "./proxy";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";

/**
 * A DB proxy endpoint.
 *
 * TODO: omitted — upstream also extends `aws_rds.IDBProxyEndpointRef`, a CloudFormation
 * cross-stack "Reference" marker interface generated from the CFN resource spec. TerraConstructs
 * has no equivalent generated-reference layer (identical omission to `dbProxyRef` on
 * `IDatabaseProxy` in `./proxy.ts` — see the TODO there), so `dbProxyEndpointRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/proxy-endpoint.ts#L14
 */
export interface IDatabaseProxyEndpoint extends IAwsConstruct {
  /**
   * DB Proxy Endpoint Name
   *
   * @attribute
   */
  readonly dbProxyEndpointName: string;

  /**
   * DB Proxy Endpoint ARN
   *
   * @attribute
   */
  readonly dbProxyEndpointArn: string;

  /**
   * Endpoint
   *
   * @attribute
   */
  readonly endpoint: string;
}

/**
 * Options for a new DatabaseProxyEndpoint
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `DatabaseProxyEndpointOptions` does not — matching the base-idiom used
 * throughout this repo (e.g. `DatabaseProxyOptions` in `./proxy.ts`) for cross-account/-region
 * construct placement.
 */
export interface DatabaseProxyEndpointOptions extends AwsConstructProps {
  /**
   * The name of the DB proxy endpoint
   *
   * @default - a CDK generated name
   */
  readonly dbProxyEndpointName?: string;

  /**
   * The VPC of the DB proxy endpoint.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The VPC security groups to associate with the new proxy endpoint.
   *
   * @default - Default security group for the VPC
   */
  readonly securityGroups?: ec2.ISecurityGroup[];

  /**
   * The subnets of DB proxy endpoint.
   *
   * @default - the VPC default strategy if not specified.
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * A value that indicates whether the DB proxy endpoint can be used for read/write or read-only operations.
   *
   * @default - ProxyEndpointTargetRole.READ_WRITE
   */
  readonly targetRole?: ProxyEndpointTargetRole;
}

/**
 * Construction properties for a DatabaseProxyEndpoint
 *
 * TERRACONSTRUCTS DEVIATION: `dbProxy` is typed as `IDatabaseProxy` (this repo's own interface)
 * rather than upstream's `aws_rds.IDBProxyRef` — the generated cross-stack "Reference" marker
 * layer isn't ported here (see the TODO on `IDatabaseProxyEndpoint` above and on `IDatabaseProxy`
 * in `./proxy.ts`), so the concrete L2 interface is used directly instead.
 */
export interface DatabaseProxyEndpointProps
  extends DatabaseProxyEndpointOptions {
  /**
   * The DB proxy associated with the DB proxy endpoint.
   */
  readonly dbProxy: IDatabaseProxy;
}

/**
 * Properties that describe an existing DB Proxy Endpoint
 */
export interface DatabaseProxyEndpointAttributes {
  /**
   * DB Proxy Endpoint Name
   */
  readonly dbProxyEndpointName: string;

  /**
   * DB Proxy Endpoint ARN
   */
  readonly dbProxyEndpointArn: string;

  /**
   * The endpoint that you can use to connect to the DB proxy
   */
  readonly endpoint: string;
}

/**
 * A value that indicates whether the DB proxy endpoint can be used for read/write or read-only operations.
 */
export enum ProxyEndpointTargetRole {
  /**
   * The proxy endpoint can be used for both read and write operations.
   */
  READ_WRITE = "READ_WRITE",

  /**
   * The proxy endpoint can be used only for read operations.
   */
  READ_ONLY = "READ_ONLY",
}

/**
 * Represents an RDS Database Proxy Endpoint.
 */
abstract class DatabaseProxyEndpointBase
  extends AwsConstructBase
  implements IDatabaseProxyEndpoint
{
  public abstract readonly dbProxyEndpointName: string;
  public abstract readonly dbProxyEndpointArn: string;
  public abstract readonly endpoint: string;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseProxyBase`/`DatabaseInstanceBase`/`SubnetGroup`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      dbProxyEndpointName: this.dbProxyEndpointName,
      dbProxyEndpointArn: this.dbProxyEndpointArn,
      endpoint: this.endpoint,
    };
  }

  // TODO: omitted — see the TODO on `IDatabaseProxyEndpoint` above; upstream's `dbProxyEndpointRef`
  // getter (returning `aws_rds.DBProxyEndpointReference`) has no equivalent generated-reference
  // type in this repo.
  // public get dbProxyEndpointRef(): aws_rds.DBProxyEndpointReference {
  //   return {
  //     dbProxyEndpointName: this.dbProxyEndpointName,
  //     dbProxyEndpointArn: this.dbProxyEndpointArn,
  //   };
  // }
}

/**
 * RDS Database Proxy Endpoint
 *
 * @resource aws_db_proxy_endpoint
 */
export class DatabaseProxyEndpoint extends DatabaseProxyEndpointBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.DatabaseProxyEndpoint";

  /**
   * Import an existing database proxy endpoint.
   */
  public static fromDatabaseProxyEndpointAttributes(
    scope: Construct,
    id: string,
    attrs: DatabaseProxyEndpointAttributes,
  ): IDatabaseProxyEndpoint {
    class Import extends DatabaseProxyEndpointBase {
      public readonly dbProxyEndpointName = attrs.dbProxyEndpointName;
      public readonly dbProxyEndpointArn = attrs.dbProxyEndpointArn;
      public readonly endpoint = attrs.endpoint;
    }
    return new Import(scope, id);
  }

  /**
   * DB Proxy Endpoint Name
   *
   * @attribute
   */
  public readonly dbProxyEndpointName: string;

  /**
   * DB Proxy Endpoint ARN
   *
   * @attribute
   */
  public readonly dbProxyEndpointArn: string;

  /**
   * The endpoint that you can use to connect to the DB proxy
   *
   * @attribute
   */
  public readonly endpoint: string;

  /**
   * The underlying `aws_db_proxy_endpoint` L1.
   */
  public readonly resource: dbProxyEndpoint.DbProxyEndpoint;

  constructor(scope: Construct, id: string, props: DatabaseProxyEndpointProps) {
    super(scope, id, props);

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a gridUUID-scoped
    // `uniqueResourceName` default instead of relying on CloudFormation's Ref-based logical-id
    // naming (which this repo has no equivalent of) -- same idiom as `DatabaseProxy` in
    // `./proxy.ts`. `name` is a REQUIRED, non-computed argument on the Terraform
    // `aws_db_proxy_endpoint` resource (see
    // `node_modules/@cdktn/provider-aws/lib/db-proxy-endpoint/index.d.ts`), unlike
    // CloudFormation's `AWS::RDS::DBProxyEndpoint` (which auto-generates a name when
    // `DBProxyEndpointName` is omitted), so a synth-time default must always be computed.
    // Lowercased for the same provider-side validation as `aws_db_proxy.name`
    // (lowercase alphanumeric + hyphens only) — see the note in ./proxy.ts.
    const physicalName =
      props.dbProxyEndpointName ??
      this.stack.uniqueResourceName(this, { maxLength: 60 }).toLowerCase();

    const vpcSubnetIds = props.vpc.selectSubnets(props.vpcSubnets).subnetIds;
    if (vpcSubnetIds.length < 2) {
      throw new ValidationError(
        `\`subnets\` requires at least 2 subnets, got ${vpcSubnetIds.length}`,
        this,
      );
    }

    if (props.securityGroups && props.securityGroups.length == 0) {
      throw new ValidationError(
        "`securityGroups` must be undefined or a non-empty array.",
        this,
      );
    }

    this.resource = new dbProxyEndpoint.DbProxyEndpoint(this, "Resource", {
      dbProxyEndpointName: physicalName,
      dbProxyName: props.dbProxy.dbProxyName,
      vpcSubnetIds,
      vpcSecurityGroupIds: props.securityGroups?.map((e) => e.securityGroupId),
      targetRole: props.targetRole,
    });

    this.dbProxyEndpointName = this.resource.dbProxyEndpointName;
    this.dbProxyEndpointArn = this.resource.arn;
    this.endpoint = this.resource.endpoint;
  }
}
