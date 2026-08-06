// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/parameter-group.ts

import { docdbClusterParameterGroup } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";

/**
 * A cluster parameter group
 *
 * TODO: omitted — upstream also extends `aws_docdb.IDBClusterParameterGroupRef`, a CloudFormation
 * cross-stack "Reference" marker interface generated from the CFN resource spec. TerraConstructs
 * has no equivalent generated-reference layer (identical omission to `IParameterGroup` in
 * `../rds/parameter-group.ts`), so `dbClusterParameterGroupRef` is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/parameter-group.ts#L12
 */
export interface IClusterParameterGroup extends IAwsConstruct {
  /**
   * The name of this parameter group
   */
  readonly parameterGroupName: string;
}

/**
 * A new cluster or instance parameter group
 */
abstract class ClusterParameterGroupBase
  extends AwsConstructBase
  implements IClusterParameterGroup
{
  /**
   * Imports a parameter group
   */
  public static fromParameterGroupName(
    scope: Construct,
    id: string,
    parameterGroupName: string,
  ): IClusterParameterGroup {
    class Import extends AwsConstructBase implements IClusterParameterGroup {
      public readonly parameterGroupName = parameterGroupName;
      public get outputs(): Record<string, any> {
        return { name: this.parameterGroupName };
      }
    }
    return new Import(scope, id);
  }

  /**
   * The name of the parameter group
   */
  public abstract readonly parameterGroupName: string;
}

/**
 * Properties for a cluster parameter group
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `ClusterParameterGroupProps` does not — matching the base-idiom used
 * throughout this repo (e.g. `ParameterGroupProps` in `../rds/parameter-group.ts`) for
 * cross-account/-region construct placement.
 */
export interface ClusterParameterGroupProps extends AwsConstructProps {
  /**
   * Description for this parameter group
   *
   * @default a CDK generated description
   */
  readonly description?: string;

  /**
   * Database family of this parameter group
   */
  readonly family: string;

  /**
   * The name of the cluster parameter group
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly dbClusterParameterGroupName?: string;

  /**
   * The parameters in this parameter group
   */
  readonly parameters: { [key: string]: string };
}

/**
 * A cluster parameter group
 *
 * @resource aws_docdb_cluster_parameter_group
 */
export class ClusterParameterGroup
  extends ClusterParameterGroupBase
  implements IClusterParameterGroup
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.docdb.ClusterParameterGroup";
  /**
   * The name of the parameter group
   */
  public readonly parameterGroupName: string;

  private readonly resource: docdbClusterParameterGroup.DocdbClusterParameterGroup;

  constructor(scope: Construct, id: string, props: ClusterParameterGroupProps) {
    super(scope, id, props);

    this.resource = new docdbClusterParameterGroup.DocdbClusterParameterGroup(
      this,
      "Resource",
      {
        // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name
        // from the logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName`
        // default instead (mirroring `ParameterGroup` in `../rds/parameter-group.ts`), lowercased
        // to match the DocumentDB/RDS-family server-side storage convention.
        name:
          props.dbClusterParameterGroupName ??
          this.stack.uniqueResourceName(this).toLowerCase(),
        description:
          props.description || `Cluster parameter group for ${props.family}`,
        family: props.family,
        parameter: Object.entries(props.parameters).map(([name, value]) => ({
          name,
          value,
        })),
      },
    );

    this.parameterGroupName = this.resource.name;
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.parameterGroupName,
      arn: this.resource.arn,
    };
  }
}
