// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/parameter-group.ts

import { redshiftParameterGroup } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";

/**
 * A parameter group
 *
 * TODO: omitted — upstream also extends `aws_redshift.IClusterParameterGroupRef`, a
 * CloudFormation cross-stack "Reference" marker interface generated from the CFN resource spec.
 * TerraConstructs has no equivalent generated-reference layer (identical omission to
 * `IClusterParameterGroup` in `../docdb/parameter-group.ts`), so it is dropped —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/parameter-group.ts#L6-L13
 */
export interface IClusterParameterGroup extends IAwsConstruct {
  /**
   * The name of this parameter group
   */
  readonly clusterParameterGroupName: string;
}

/**
 * A new cluster or instance parameter group
 */
abstract class ClusterParameterGroupBase
  extends AwsConstructBase
  implements IClusterParameterGroup
{
  /**
   * The name of the parameter group
   */
  public abstract readonly clusterParameterGroupName: string;
}

/**
 * Properties for a parameter group
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `ClusterParameterGroupProps` does not — matching the base-idiom used
 * throughout this repo (e.g. `ClusterParameterGroupProps` in `../docdb/parameter-group.ts`) for
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
   * The name of the cluster parameter group
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream (CloudFormation always generates the
   * physical name from the logical id for `AWS::Redshift::ClusterParameterGroup`, which has no
   * `ParameterGroupName` property to accept an explicit name). The underlying
   * `aws_redshift_parameter_group` Terraform resource requires a `name` argument, so this repo
   * exposes it as an optional prop (mirroring `ClusterParameterGroupProps.dbClusterParameterGroupName`
   * in `../docdb/parameter-group.ts`) with a gridUUID-scoped generated default.
   *
   * @default - a gridUUID-scoped generated name
   */
  readonly clusterParameterGroupName?: string;

  /**
   * The parameters in this parameter group
   */
  readonly parameters: { [name: string]: string };
}

/**
 * A cluster parameter group
 *
 * @resource aws_redshift_parameter_group
 */
export class ClusterParameterGroup
  extends ClusterParameterGroupBase
  implements IClusterParameterGroup
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.redshift.ClusterParameterGroup";

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

  /**
   * The parameters in the parameter group
   */
  public readonly parameters: { [name: string]: string };

  /**
   * The underlying RedshiftParameterGroup
   */
  private readonly resource: redshiftParameterGroup.RedshiftParameterGroup;

  constructor(scope: Construct, id: string, props: ClusterParameterGroupProps) {
    super(scope, id, props);

    this.parameters = props.parameters;
    this.resource = new redshiftParameterGroup.RedshiftParameterGroup(
      this,
      "Resource",
      {
        // TERRACONSTRUCTS DEVIATION: see the naming-default note on
        // `ClusterParameterGroupProps.clusterParameterGroupName` above. Names are stored by
        // Redshift lowercased on the server side, so caller-supplied names are lowercased too
        // (guarded for unresolved tokens) — same shape as `ClusterSubnetGroup` in
        // `./subnet-group.ts` and `Cluster` in `./cluster.ts`.
        name: Token.isUnresolved(props.clusterParameterGroupName)
          ? (props.clusterParameterGroupName as string)
          : (
              props.clusterParameterGroupName ??
              this.stack.uniqueResourceName(this)
            ).toLowerCase(),
        description:
          props.description ||
          "Cluster parameter group for family redshift-1.0",
        family: "redshift-1.0",
        parameter: this.parseParameters(),
      },
    );

    this.clusterParameterGroupName = this.resource.name;
  }

  private parseParameters(): { name: string; value: string }[] {
    return Object.entries(this.parameters).map(([name, value]) => {
      return { name, value };
    });
  }

  /**
   * Adds a parameter to the parameter group
   *
   * @param name the parameter name
   * @param value the parameter name
   */
  public addParameter(name: string, value: string): void {
    const existingValue = Object.entries(this.parameters).find(
      ([key, _]) => key === name,
    )?.[1];
    if (existingValue === undefined) {
      this.parameters[name] = value;
      this.resource.putParameter(this.parseParameters());
    } else if (existingValue !== value) {
      throw new ValidationError(
        `The parameter group already contains the parameter "${name}", but with a different value (Given: ${value}, Existing: ${existingValue}).`,
        this,
      );
    }
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.clusterParameterGroupName,
      arn: this.resource.arn,
    };
  }
}
