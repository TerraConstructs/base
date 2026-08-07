// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/lib/parameter-group.ts

import {
  neptuneClusterParameterGroup,
  neptuneParameterGroup,
} from "@cdktn/provider-aws";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";

/**
 * The DB parameter group family that a DB parameter group is compatible with
 */
export class ParameterGroupFamily {
  /**
   * Family used by Neptune engine versions before 1.2.0.0
   */
  public static readonly NEPTUNE_1 = new ParameterGroupFamily("neptune1");
  /**
   * Family used by Neptune engine versions 1.2.0.0 and later
   */
  public static readonly NEPTUNE_1_2 = new ParameterGroupFamily("neptune1.2");
  /**
   * Family used by Neptune engine versions 1.3.0.0 and later
   */
  public static readonly NEPTUNE_1_3 = new ParameterGroupFamily("neptune1.3");
  /**
   * Family used by Neptune engine versions 1.4.0.0 and later
   */
  public static readonly NEPTUNE_1_4 = new ParameterGroupFamily("neptune1.4");

  /**
   * Constructor for specifying a custom parameter group family
   * @param family the family of the parameter group Neptune
   */
  public constructor(public readonly family: string) {}
}

/**
 * Properties for a parameter group
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `ParameterGroupPropsBase` does not — matching the base-idiom used throughout
 * this repo (e.g. `ClusterParameterGroupProps` in `../docdb/parameter-group.ts`) for
 * cross-account/-region construct placement.
 */
interface ParameterGroupPropsBase extends AwsConstructProps {
  /**
   * Description for this parameter group
   *
   * @default a generated description
   */
  readonly description?: string;

  /**
   * The parameters in this parameter group
   */
  readonly parameters: { [key: string]: string };

  /**
   * Parameter group family
   *
   * @default - NEPTUNE_1
   */
  readonly family?: ParameterGroupFamily;
}

/**
 * Marker class for cluster parameter group
 */
export interface ClusterParameterGroupProps extends ParameterGroupPropsBase {
  /**
   * The name of the parameter group
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly clusterParameterGroupName?: string;
}

/**
 * Marker class for cluster parameter group
 */
export interface ParameterGroupProps extends ParameterGroupPropsBase {
  /**
   * The name of the parameter group
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly parameterGroupName?: string;
}

/**
 * A parameter group
 *
 * TODO: omitted — upstream also extends `aws_neptune.IDBClusterParameterGroupRef`-equivalent
 * generated-reference typing is not applicable here (neptune-alpha's `IResource`-only interface
 * has no such marker to begin with); this note mirrors the identical omission pattern used
 * elsewhere in this repo for cross-stack CloudFormation "Reference" marker interfaces (e.g.
 * `IClusterParameterGroup` in `../docdb/parameter-group.ts`) so future re-diffs know the gap is
 * intentional and not a missed port.
 */
export interface IClusterParameterGroup extends IAwsConstruct {
  /**
   * The name of this parameter group
   */
  readonly clusterParameterGroupName: string;
}

/**
 * A cluster parameter group
 *
 * @resource aws_neptune_cluster_parameter_group
 */
export class ClusterParameterGroup
  extends AwsConstructBase
  implements IClusterParameterGroup
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.neptune.ClusterParameterGroup";

  /**
   * Imports a parameter group
   */
  public static fromClusterParameterGroupName(
    scope: Construct,
    id: string,
    clusterParameterGroupName: string,
  ): IClusterParameterGroup {
    class Import extends AwsConstructBase implements IClusterParameterGroup {
      public readonly clusterParameterGroupName = clusterParameterGroupName;
      public get outputs(): Record<string, any> {
        return { name: this.clusterParameterGroupName };
      }
    }
    return new Import(scope, id);
  }

  /**
   * The name of the parameter group
   */
  public readonly clusterParameterGroupName: string;

  private readonly resource: neptuneClusterParameterGroup.NeptuneClusterParameterGroup;

  constructor(scope: Construct, id: string, props: ClusterParameterGroupProps) {
    super(scope, id, props);

    this.resource =
      new neptuneClusterParameterGroup.NeptuneClusterParameterGroup(
        this,
        "Resource",
        {
          // TERRACONSTRUCTS DEVIATION: when unnamed, upstream lets CloudFormation generate a name
          // from the logical id; the repo invariant is a gridUUID-scoped `uniqueResourceName`
          // default instead (mirroring `ClusterParameterGroup` in `../docdb/parameter-group.ts`),
          // lowercased to match the Neptune/RDS-family server-side storage convention.
          name:
            props.clusterParameterGroupName ??
            this.stack.uniqueResourceName(this).toLowerCase(),
          description:
            props.description ||
            "Cluster parameter group for neptune db cluster",
          family: (props.family ?? ParameterGroupFamily.NEPTUNE_1).family,
          parameter: Object.entries(props.parameters).map(([name, value]) => ({
            name,
            value,
          })),
        },
      );

    this.clusterParameterGroupName = this.resource.name;
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.clusterParameterGroupName,
      arn: this.resource.arn,
    };
  }
}

/**
 * A parameter group
 */
export interface IParameterGroup extends IAwsConstruct {
  /**
   * The name of this parameter group
   */
  readonly parameterGroupName: string;
}

/**
 * DB parameter group
 *
 * @resource aws_neptune_parameter_group
 */
export class ParameterGroup
  extends AwsConstructBase
  implements IParameterGroup
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.neptune.ParameterGroup";

  /**
   * Imports a parameter group
   */
  public static fromParameterGroupName(
    scope: Construct,
    id: string,
    parameterGroupName: string,
  ): IParameterGroup {
    class Import extends AwsConstructBase implements IParameterGroup {
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
  public readonly parameterGroupName: string;

  private readonly resource: neptuneParameterGroup.NeptuneParameterGroup;

  constructor(scope: Construct, id: string, props: ParameterGroupProps) {
    super(scope, id, props);

    this.resource = new neptuneParameterGroup.NeptuneParameterGroup(
      this,
      "Resource",
      {
        // TERRACONSTRUCTS DEVIATION: see the identical naming-default note on
        // `ClusterParameterGroup` above.
        name:
          props.parameterGroupName ??
          this.stack.uniqueResourceName(this).toLowerCase(),
        description:
          props.description ||
          "Instance parameter group for neptune db instances",
        family: (props.family ?? ParameterGroupFamily.NEPTUNE_1).family,
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
