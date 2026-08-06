// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/parameter-group.ts

import {
  dbParameterGroup,
  rdsClusterParameterGroup,
} from "@cdktn/provider-aws";
import { Lazy } from "cdktn";
import { Construct } from "constructs";
import { IEngine } from "./engine";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";

/**
 * Options for `IParameterGroup.bindToCluster`.
 * Empty for now, but can be extended later.
 */
export interface ParameterGroupClusterBindOptions {}

/**
 * The type returned from `IParameterGroup.bindToCluster`.
 */
export interface ParameterGroupClusterConfig {
  /** The name of this parameter group. */
  readonly parameterGroupName: string;
}

/**
 * Options for `IParameterGroup.bindToInstance`.
 * Empty for now, but can be extended later.
 */
export interface ParameterGroupInstanceBindOptions {}

/**
 * The type returned from `IParameterGroup.bindToInstance`.
 */
export interface ParameterGroupInstanceConfig {
  /** The name of this parameter group. */
  readonly parameterGroupName: string;
}

/**
 * A parameter group.
 * Represents both a cluster parameter group,
 * and an instance parameter group.
 */
export interface IParameterGroup extends IAwsConstruct {
  /**
   * Method called when this Parameter Group is used when defining a database cluster.
   */
  bindToCluster(
    options: ParameterGroupClusterBindOptions,
  ): ParameterGroupClusterConfig;

  /**
   * Method called when this Parameter Group is used when defining a database instance.
   */
  bindToInstance(
    options: ParameterGroupInstanceBindOptions,
  ): ParameterGroupInstanceConfig;

  /**
   * Adds a parameter to this group.
   * If this is an imported parameter group,
   * this method does nothing.
   *
   * @returns true if the parameter was actually added
   *   (i.e., this ParameterGroup is not imported),
   *   false otherwise
   */
  addParameter(key: string, value: string): boolean;

  // TODO: omitted — upstream also extends `aws_rds.IDBParameterGroupRef` and
  // `aws_rds.IDBClusterParameterGroupRef`, CloudFormation cross-stack "Reference" marker
  // interfaces generated from the CFN resource spec. TerraConstructs has no equivalent
  // generated-reference layer, so `dbParameterGroupRef`/`dbClusterParameterGroupRef` are dropped —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/parameter-group.ts#L49
}

/**
 * Properties for a parameter group
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps`, which upstream's `ParameterGroupProps`
 * does not — matching the base-idiom used throughout this repo (e.g. `SecurityGroupProps`,
 * `QueueProps`, `TableProps`) for cross-account/-region construct placement.
 */
export interface ParameterGroupProps extends AwsConstructProps {
  /**
   * The database engine for this parameter group.
   */
  readonly engine: IEngine;

  /**
   * The name of this parameter group.
   *
   * @default - Terraform/AWS-generated name
   */
  readonly name?: string;

  /**
   * Description for this parameter group
   *
   * @default a generated description
   */
  readonly description?: string;

  /**
   * The parameters in this parameter group
   *
   * @default - None
   */
  readonly parameters?: { [key: string]: string };

  // TERRACONSTRUCTS DEVIATION: upstream also exposes `removalPolicy` here (default
  // RemovalPolicy.DESTROY), applied to whichever of the instance/cluster Cfn resources get
  // created. `core.RemovalPolicy` is not ported in this repo (see `notify/queue.ts` and
  // `encryption/secret.ts` for the same omission), so it is dropped here too. Note that only
  // `aws_db_parameter_group` supports a `skip_destroy` argument that a future `removalPolicy`
  // port could honestly map RETAIN onto — see the (commented out) call site in
  // `createInstanceParameterGroup` below. `aws_rds_cluster_parameter_group` has no such
  // argument, so RETAIN can never be honored for the cluster parameter group.
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * A parameter group.
 * Represents both a cluster parameter group (aws_rds_cluster_parameter_group),
 * and an instance parameter group (aws_db_parameter_group).
 *
 * @resource aws_db_parameter_group
 */
export class ParameterGroup
  extends AwsConstructBase
  implements IParameterGroup
{
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.ParameterGroup";

  /**
   * Imports a parameter group
   */
  public static fromParameterGroupName(
    scope: Construct,
    id: string,
    parameterGroupName: string,
  ): IParameterGroup {
    class Import extends AwsConstructBase implements IParameterGroup {
      public bindToCluster(
        _options: ParameterGroupClusterBindOptions,
      ): ParameterGroupClusterConfig {
        return { parameterGroupName };
      }

      public bindToInstance(
        _options: ParameterGroupInstanceBindOptions,
      ): ParameterGroupInstanceConfig {
        return { parameterGroupName };
      }

      public addParameter(_key: string, _value: string): boolean {
        return false;
      }

      // TODO: omitted — see IParameterGroup ref note above —
      // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/parameter-group.ts#L142-L152
      public get outputs(): Record<string, any> {
        return { name: parameterGroupName };
      }
    }

    return new Import(scope, id);
  }

  /**
   * Creates a standalone instance parameter group.
   *
   * This method allows you to explicitly create a parameter group
   * without binding it to a database instance.
   *
   * @returns instance parameter group (aws_db_parameter_group)
   */
  public static forInstance(
    scope: Construct,
    id: string,
    props: ParameterGroupProps,
  ): IParameterGroup {
    const parameterGroup = new ParameterGroup(scope, id, props);
    parameterGroup.createInstanceParameterGroup();
    return parameterGroup;
  }

  /**
   * Creates a standalone cluster parameter group.
   *
   * This method allows you to explicitly create a parameter group
   * without binding it to a database cluster.
   *
   * @returns cluster parameter group (aws_rds_cluster_parameter_group)
   */
  public static forCluster(
    scope: Construct,
    id: string,
    props: ParameterGroupProps,
  ): IParameterGroup {
    const parameterGroup = new ParameterGroup(scope, id, props);
    parameterGroup.createClusterParameterGroup();
    return parameterGroup;
  }

  private readonly parameters: Map<string, string>;
  private readonly family: string;
  private readonly description?: string;
  private readonly name?: string;

  private clusterResource?: rdsClusterParameterGroup.RdsClusterParameterGroup;
  private instanceResource?: dbParameterGroup.DbParameterGroup;

  constructor(scope: Construct, id: string, props: ParameterGroupProps) {
    super(scope, id, props);

    const family = props.engine.parameterGroupFamily;
    if (!family) {
      throw new ValidationError(
        "ParameterGroup cannot be used with an engine that doesn't specify a version",
        this,
      );
    }
    this.family = family;
    this.description = props.description;
    this.name = props.name;
    this.parameters = new Map(Object.entries(props.parameters ?? {}));
  }

  /**
   * Method called when this Parameter Group is used when defining a database cluster.
   */
  public bindToCluster(
    _options: ParameterGroupClusterBindOptions,
  ): ParameterGroupClusterConfig {
    return {
      parameterGroupName: this.createClusterParameterGroup(),
    };
  }

  /**
   * Method called when this Parameter Group is used when defining a database instance.
   */
  public bindToInstance(
    _options: ParameterGroupInstanceBindOptions,
  ): ParameterGroupInstanceConfig {
    return {
      parameterGroupName: this.createInstanceParameterGroup(),
    };
  }

  /**
   * Add a parameter to this parameter group
   *
   * @param key The key of the parameter to be added
   * @param value The value of the parameter to be added
   */
  public addParameter(key: string, value: string): boolean {
    this.parameters.set(key, value);
    return true;
  }

  /**
   * Render the current parameter map into the shape expected by the `parameter` block of
   * both `aws_db_parameter_group` and `aws_rds_cluster_parameter_group`.
   *
   * TERRACONSTRUCTS DEVIATION: the provider's parameter block also exposes
   * `apply_method` (Terraform-only; no CloudFormation analogue -- CFN picks
   * the right method server-side). It is intentionally left at the provider
   * default (`immediate`), which FAILS at `terraform apply` for static engine
   * parameters (e.g. `character_set_server`). Exposing apply_method is
   * follow-up work that must land before instance/cluster ports rely on
   * static parameters.
   */
  private renderParameters(): { name: string; value: string }[] {
    return Array.from(this.parameters.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  }

  /**
   * Creates the instance parameter group Terraform resource if it doesn't exist.
   * @returns parameter group name
   */
  private createInstanceParameterGroup(): string {
    if (!this.instanceResource) {
      const id = this.clusterResource ? "InstanceParameterGroup" : "Resource";
      this.instanceResource = new dbParameterGroup.DbParameterGroup(this, id, {
        description: this.description || `Parameter group for ${this.family}`,
        family: this.family,
        // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a
        // gridUUID-scoped uniqueResourceName default (lowercased; RDS
        // parameter-group names must be lowercase) instead of the provider's
        // opaque terraform-<hash> fallback.
        name: this.name ?? this.stack.uniqueResourceName(this).toLowerCase(),
        parameter: Lazy.anyValue(
          {
            produce: () =>
              this.renderParameters().map(
                dbParameterGroup.dbParameterGroupParameterToTerraform,
              ),
          },
          { omitEmptyArray: true },
        ),
        // TERRACONSTRUCTS DEVIATION: no `removalPolicy` to map onto `skipDestroy` — see
        // ParameterGroupProps note above.
        // skipDestroy: this.removalPolicy === RemovalPolicy.RETAIN,
      });
    }

    return this.instanceResource.name;
  }

  /**
   * Creates the cluster parameter group Terraform resource if it doesn't exist.
   * @returns parameter group name
   */
  private createClusterParameterGroup(): string {
    if (!this.clusterResource) {
      const id = this.instanceResource ? "ClusterParameterGroup" : "Resource";
      this.clusterResource =
        new rdsClusterParameterGroup.RdsClusterParameterGroup(this, id, {
          description:
            this.description || `Cluster parameter group for ${this.family}`,
          family: this.family,
          // TERRACONSTRUCTS DEVIATION: same uniqueResourceName default as the
          // instance resource above (DB and DB-cluster parameter groups live
          // in separate AWS namespaces, so the shared default cannot collide).
          name: this.name ?? this.stack.uniqueResourceName(this).toLowerCase(),
          parameter: Lazy.anyValue(
            {
              produce: () =>
                this.renderParameters().map(
                  rdsClusterParameterGroup.rdsClusterParameterGroupParameterToTerraform,
                ),
            },
            { omitEmptyArray: true },
          ),
          // TERRACONSTRUCTS DEVIATION: `aws_rds_cluster_parameter_group` has no `skip_destroy`
          // (or equivalent) argument — unlike `aws_db_parameter_group`, RETAIN can never be
          // honored here even once a `removalPolicy` prop is added. See ParameterGroupProps
          // note above.
        });
    }

    return this.clusterResource.name;
  }

  // TERRACONSTRUCTS DEVIATION: `ParameterGroup` can back up to two Terraform resources at once
  // (an `aws_db_parameter_group` and an `aws_rds_cluster_parameter_group`, e.g. when both
  // `bindToInstance` and `bindToCluster` are called on the same construct), so it cannot expose
  // a single unqualified `{ name, arn }` pair the way the other constructs in this slice do. The
  // instance parameter group -- the primary/most common case -- gets the bare `name`/`arn` keys;
  // the cluster parameter group (when present) is exposed under prefixed `clusterName`/
  // `clusterArn` keys instead.
  public get outputs(): Record<string, any> {
    return {
      ...(this.instanceResource && {
        name: this.instanceResource.name,
        arn: this.instanceResource.arn,
      }),
      ...(this.clusterResource && {
        clusterName: this.clusterResource.name,
        clusterArn: this.clusterResource.arn,
      }),
    };
  }
}
