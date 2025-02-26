// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/prefix-list.ts

import { ec2ManagedPrefixList } from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface PrefixListOutputs {
  /**
   * The ID of the prefix list
   *
   * @attribute
   */
  readonly prefixListId: string;
}

/**
 * A prefix list
 */
export interface IPrefixList extends IAwsConstruct {
  /** strongly typed outputs */
  readonly prefixListOutputs: PrefixListOutputs;
  /**
   * The ID of the prefix list
   *
   * @attribute
   */
  readonly prefixListId: string;
}

/**
 * The IP address type.
 */
export enum AddressFamily {
  IP_V4 = "IPv4",
  IP_V6 = "IPv6",
}

/**
 * Options to add a prefix list
 */
export interface PrefixListOptions {
  /**
   * The maximum number of entries for the prefix list.
   *
   * @default Automatically-calculated
   */
  readonly maxEntries?: number;
}

/**
 * Properties for creating a prefix list.
 */
export interface PrefixListProps extends PrefixListOptions, AwsConstructProps {
  /**
   * The address family of the prefix list.
   *
   * @default AddressFamily.IP_V4
   */
  readonly addressFamily?: AddressFamily;

  /**
   * The name of the prefix list.
   *
   * @default None
   *
   * @remarks
   * It is not recommended to use an explicit name.
   */
  readonly prefixListName?: string;

  /**
   * The list of entries for the prefix list.
   *
   * @default []
   */
  readonly entries?: ec2ManagedPrefixList.Ec2ManagedPrefixListEntry[];
}

/**
 * The base class for a prefix list
 */
abstract class PrefixListBase extends AwsConstructBase implements IPrefixList {
  public get prefixListOutputs(): PrefixListOutputs {
    return {
      prefixListId: this.prefixListId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.prefixListOutputs;
  }
  /**
   * The ID of the prefix list
   *
   * @attribute
   */
  public abstract readonly prefixListId: string;
}

/**
 * A managed prefix list.
 * @resource AWS::EC2::PrefixList
 */
export class PrefixList extends PrefixListBase {
  /**
   * Look up prefix list by id.
   *
   */
  public static fromPrefixListId(
    scope: Construct,
    id: string,
    prefixListId: string,
  ): IPrefixList {
    class Import extends AwsConstructBase implements IPrefixList {
      public get prefixListOutputs(): PrefixListOutputs {
        return {
          prefixListId: this.prefixListId,
        };
      }
      public get outputs(): Record<string, any> {
        return this.prefixListOutputs;
      }
      public readonly prefixListId = prefixListId;
    }
    return new Import(scope, id);
  }
  /**
   * The ID of the prefix list
   *
   * @attribute
   */
  public readonly prefixListId: string;

  /**
   * The name of the prefix list
   *
   * @attribute
   */
  public readonly prefixListName: string;

  /**
   * The ARN of the prefix list
   *
   * @attribute
   */
  public readonly prefixListArn: string;

  /**
   * The owner ID of the prefix list
   *
   */
  public readonly ownerId: string;

  /**
   * The version of the prefix list
   *
   */
  public readonly version: number;

  /**
   * The address family of the prefix list
   *
   */
  public readonly addressFamily: string;

  public readonly resource: ec2ManagedPrefixList.Ec2ManagedPrefixList;

  constructor(scope: Construct, id: string, props?: PrefixListProps) {
    super(scope, id, props);
    const prefixListName =
      props?.prefixListName ??
      Lazy.stringValue({
        produce: () =>
          AwsStack.uniqueResourceName(this, {
            maxLength: 255,
            allowedSpecialCharacters: ".-_",
          }),
      });

    if (prefixListName) {
      if (prefixListName.startsWith("com.amazonaws")) {
        throw new Error("The name cannot start with 'com.amazonaws.'");
      }
      if (prefixListName.length > 255) {
        throw new Error("Lengths exceeding 255 characters cannot be set.");
      }
    }

    this.prefixListName = prefixListName;

    let defaultMaxEntries = 1;
    if (props?.entries && props.entries.length > 0) {
      const entries = props.entries;
      // Regular expressions for validating IPv6 addresses
      if (props?.addressFamily === AddressFamily.IP_V6) {
        const ipv6Regex =
          /^s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:)))(%.+)?s*(\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$/i;
        for (const entry of entries) {
          if (!ipv6Regex.test(entry.cidr)) {
            throw new Error(`Invalid IPv6 address range: ${entry.cidr}`);
          }
        }
        // Regular expressions for validating IPv4 addresses
      } else {
        const ipv4Regex =
          /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/i;
        for (const entry of entries) {
          if (!ipv4Regex.test(entry.cidr)) {
            throw new Error(`Invalid IPv4 address range: ${entry.cidr}`);
          }
        }
      }

      defaultMaxEntries = props.entries.length;
    }

    this.resource = new ec2ManagedPrefixList.Ec2ManagedPrefixList(
      this,
      "Resource",
      {
        addressFamily: props?.addressFamily || AddressFamily.IP_V4,
        maxEntries: props?.maxEntries || defaultMaxEntries,
        name: this.prefixListName,
        entry: props?.entries || [],
      },
    );

    this.prefixListId = this.resource.id;
    this.prefixListArn = this.resource.arn;
    this.ownerId = this.resource.ownerId;
    this.version = this.resource.version;
    this.addressFamily = this.resource.addressFamily;
  }
}
