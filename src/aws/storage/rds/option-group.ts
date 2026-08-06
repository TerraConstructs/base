// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/option-group.ts

import { dbOptionGroup } from "@cdktn/provider-aws";
import { Lazy } from "cdktn";
import { Construct } from "constructs";
import type { IInstanceEngine } from "./instance-engine";
import { ValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import * as ec2 from "../../compute";

/**
 * An option group
 */
export interface IOptionGroup extends IAwsConstruct {
  /**
   * The name of the option group.
   */
  readonly optionGroupName: string;

  /**
   * Adds a configuration to this OptionGroup.
   * This method is a no-op for an imported OptionGroup.
   *
   * @returns true if the OptionConfiguration was successfully added.
   */
  addConfiguration(configuration: OptionConfiguration): boolean;

  // TODO: omitted — upstream also extends `IOptionGroupRef`, a CloudFormation cross-stack
  // "Reference" marker interface generated from the CFN resource spec. TerraConstructs has no
  // equivalent generated-reference layer, so `optionGroupRef` is dropped —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/option-group.ts#L19
}

/**
 * Configuration properties for an option.
 */
export interface OptionConfiguration {
  /**
   * The name of the option.
   */
  readonly name: string;

  /**
   * The settings for the option.
   *
   * @default - no settings
   */
  readonly settings?: { [name: string]: string };

  /**
   * The version for the option.
   *
   * @default - no version
   */
  readonly version?: string;

  /**
   * The port number that this option uses. If `port` is specified then `vpc`
   * must also be specified.
   *
   * @default - no port
   */
  readonly port?: number;

  /**
   * The VPC where a security group should be created for this option. If `vpc`
   * is specified then `port` must also be specified.
   *
   * @default - no VPC
   */
  readonly vpc?: ec2.IVpc;

  /**
   * Optional list of security groups to use for this option, if `vpc` is specified.
   * If no groups are provided, a default one will be created.
   *
   * @default - a default group will be created if `port` or `vpc` are specified.
   */
  readonly securityGroups?: ec2.ISecurityGroup[];
}

/**
 * Construction properties for an OptionGroup.
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps`, which upstream's `OptionGroupProps`
 * does not — matching the base-idiom used throughout this repo (e.g. `SecurityGroupProps`,
 * `QueueProps`, `TableProps`) for cross-account/-region construct placement.
 */
export interface OptionGroupProps extends AwsConstructProps {
  /**
   * The database engine that this option group is associated with.
   */
  readonly engine: IInstanceEngine;

  /**
   * A description of the option group.
   *
   * @default a generated description
   */
  readonly description?: string;

  /**
   * The configurations for this option group.
   */
  readonly configurations: OptionConfiguration[];

  /**
   * The name of the option group.
   *
   * @default - a generated name
   */
  readonly optionGroupName?: string;
}

/**
 * An option group
 */
export class OptionGroup extends AwsConstructBase implements IOptionGroup {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.rds.OptionGroup";

  /**
   * Import an existing option group.
   */
  public static fromOptionGroupName(
    scope: Construct,
    id: string,
    optionGroupName: string,
  ): IOptionGroup {
    class Import extends AwsConstructBase implements IOptionGroup {
      public readonly optionGroupName = optionGroupName;
      public addConfiguration(_: OptionConfiguration) {
        return false;
      }
      // TODO: omitted — see IOptionGroup ref note above —
      // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/option-group.ts#L129-L131
      public get outputs(): Record<string, any> {
        return { name: this.optionGroupName };
      }
    }
    return new Import(scope, id);
  }

  /**
   * The name of the option group.
   */
  public readonly optionGroupName: string;

  /**
   * The connections object for the options.
   */
  public readonly optionConnections: { [key: string]: ec2.Connections } = {};

  private readonly configurations: OptionConfiguration[] = [];
  private readonly resource: dbOptionGroup.DbOptionGroup;

  constructor(scope: Construct, id: string, props: OptionGroupProps) {
    super(scope, id, props);

    const majorEngineVersion = props.engine.engineVersion?.majorVersion;
    if (!majorEngineVersion) {
      throw new ValidationError(
        "OptionGroup cannot be used with an engine that doesn't specify a version",
        this,
      );
    }

    props.configurations.forEach((config) => this.addConfiguration(config));

    this.resource = new dbOptionGroup.DbOptionGroup(this, "Resource", {
      engineName: props.engine.engineType,
      majorEngineVersion,
      optionGroupDescription:
        props.description ||
        `Option group for ${props.engine.engineType} ${majorEngineVersion}`,
      // TERRACONSTRUCTS DEVIATION: upstream deliberately renders an empty
      // `OptionConfigurations: []` (Box.fromArray([], { omitEmpty: false }));
      // Terraform has no meaningful empty-block representation for `option`,
      // so an empty list omits the argument entirely.
      option: Lazy.anyValue(
        {
          produce: () =>
            this.renderConfigurations(this.configurations).map(
              dbOptionGroup.dbOptionGroupOptionToTerraform,
            ),
        },
        { omitEmptyArray: true },
      ),
      // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a
      // gridUUID-scoped uniqueResourceName default (lowercased; option-group
      // names must be lowercase) instead of the provider's terraform-<hash>.
      name:
        props.optionGroupName ??
        this.stack.uniqueResourceName(this).toLowerCase(),
    });

    this.optionGroupName = props.optionGroupName ?? this.resource.name;
  }

  public addConfiguration(configuration: OptionConfiguration) {
    this.configurations.push(configuration);

    if (configuration.port) {
      if (!configuration.vpc) {
        throw new ValidationError(
          "`port` and `vpc` must be specified together.",
          this,
        );
      }

      const securityGroups =
        configuration.securityGroups && configuration.securityGroups.length > 0
          ? configuration.securityGroups
          : [
              new ec2.SecurityGroup(
                this,
                `SecurityGroup${configuration.name}`,
                {
                  description: `Security group for ${configuration.name} option`,
                  vpc: configuration.vpc,
                },
              ),
            ];

      this.optionConnections[configuration.name] = new ec2.Connections({
        securityGroups: securityGroups,
        defaultPort: ec2.Port.tcp(configuration.port),
      });
    }

    return true;
  }

  /**
   * Renders the option configurations specifications.
   */
  private renderConfigurations(
    configurations: OptionConfiguration[],
  ): dbOptionGroup.DbOptionGroupOption[] {
    const configs: dbOptionGroup.DbOptionGroupOption[] = [];
    for (const config of configurations) {
      const securityGroups = config.vpc
        ? this.optionConnections[config.name].securityGroups.map(
            (sg) => sg.securityGroupId,
          )
        : undefined;

      configs.push({
        optionName: config.name,
        optionSettings:
          config.settings &&
          Object.entries(config.settings).map(([name, value]) => ({
            name,
            value,
          })),
        version: config.version,
        port: config.port,
        vpcSecurityGroupMemberships: securityGroups,
      });
    }

    return configs;
  }

  public get outputs(): Record<string, any> {
    return {
      name: this.optionGroupName,
      arn: this.resource.arn,
    };
  }
}
