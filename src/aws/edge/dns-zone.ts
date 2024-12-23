import { route53Zone, dataAwsRoute53Zone } from "@cdktf/provider-aws";
import { Lazy, IResolvable } from "cdktf";
import { Construct } from "constructs";
import {
  AwsStack,
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../";
import { INetwork } from "../network";

// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-route53/lib/hosted-zone.ts

/**
 * Common properties to create a Route 53 hosted zone
 */
export interface CommonDnsZoneProps extends AwsConstructProps {
  /**
   * The name of the domain. For resource record types that include a domain
   * name, specify a fully qualified domain name.
   */
  readonly zoneName: string;

  /**
   * Whether to add a trailing dot to the zone name.
   *
   * @default true
   */
  readonly addTrailingDot?: boolean;

  /**
   * Any comments that you want to include about the hosted zone.
   *
   * @default none
   */
  readonly comment?: string;

  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/resources/route53_zone#force_destroy Route53Zone#force_destroy}
   */
  readonly forceDestroy?: boolean | IResolvable;
}

/**
 * Properties of a new hosted zone
 */
export interface DnsZoneProps extends CommonDnsZoneProps {
  /**
   * Networks that you want to associate with this hosted zone. When you specify
   * this property, a private hosted zone will be created.
   *
   * Conflicts with the `delegationSetId` and any `aws_route53_zone_association`
   * resource specifying the same zone ID.
   *
   * You can associate additional networks to this private zone using `addNetwork(network)`.
   *
   * @default public (no networks associated)
   */
  readonly networks?: INetwork[];

  /**
   * Delegation set ID for the private hosted zone.
   *
   * The ID of the reusable delegation set whose NS records you want to assign to the hosted zone.
   *
   * Conflicts with vpc as delegation sets can only be used for public zones.
   */
  readonly delegationSetId?: string;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface DnsZoneOutputs {
  /**
   * Identifier of the hosted zone
   */
  readonly zoneId: string;

  /**
   * Name of the hosted zone
   */
  readonly zoneName: string;

  /**
   * Returns the set of name servers for the specific hosted zone. For example:
   * ns1.example.com.
   *
   * This attribute will be undefined for private hosted zones or hosted zones imported from another stack.
   *
   * @attribute
   */
  readonly nameServers: string[];

  /**
   * The Route 53 name server that created the SOA record.
   */
  readonly primaryNameServer: string;
}

/**
 * Imported or created DNS zone attributes
 */
export interface IDnsZone extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly dnsZoneOutputs: DnsZoneOutputs;

  /**
   * ID of this hosted zone, such as "Z23ABC4XYZL05B"
   *
   * @attribute
   */
  readonly zoneId: string;

  /**
   * FQDN of this hosted zone
   */
  readonly zoneName: string;

  /**
   * ARN of this hosted zone, such as arn:${Partition}:route53:::hostedzone/${Id}
   *
   * @attribute
   */
  readonly arn: string;

  /**
   * A list of name servers in associated (or default) delegation set.
   * Find more about delegation sets in [AWS docs][delegation set docs].
   *
   * Returns the set of name servers for the specific hosted zone. For example:
   * ns1.example.com.
   *
   * [delegation set docs]: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-configuring-delegation-set.html
   * @attribute
   */
  readonly nameServers: string[];

  /**
   * The Route 53 name server that created the SOA record.
   */
  readonly primaryNameServer: string;
}

/**
 * Container for records, and records contain information about how to route traffic for a
 * specific domain, such as example.com and its subdomains (acme.example.com, zenith.example.com)
 */
export class DnsZone extends AwsConstructBase implements IDnsZone {
  // TODO: Add "from Grid Lookup" static methods?
  /**
   * Import a Route 53 hosted zone defined either outside of TerraConstruct, or from Grid Lookup
   *
   * Use when hosted zone ID is known.
   *
   * @param scope the parent Construct for this Construct
   * @param id  the logical name of this Construct
   * @param zoneId the ID of the hosted zone to import
   */
  public static fromZoneId(
    scope: Construct,
    id: string,
    zoneId: string,
  ): IDnsZone {
    class Import extends AwsConstructBase implements IDnsZone {
      private readonly _outputs: DnsZoneOutputs;
      public get dnsZoneOutputs(): DnsZoneOutputs {
        return this._outputs;
      }
      public get outputs(): Record<string, any> {
        return this.dnsZoneOutputs;
      }
      public readonly zoneId = zoneId;
      public get zoneName(): string {
        return this.datasource.name;
      }
      public get arn(): string {
        return this.datasource.arn;
      }
      public get nameServers(): string[] {
        return this.datasource.nameServers;
      }
      public get primaryNameServer(): string {
        return this.datasource.primaryNameServer;
      }
      private readonly datasource: dataAwsRoute53Zone.DataAwsRoute53Zone;
      constructor(_scope: Construct, _id: string) {
        super(_scope, _id, {});
        this.datasource = new dataAwsRoute53Zone.DataAwsRoute53Zone(
          this,
          "Resource",
          {
            zoneId,
          },
        );
        this._outputs = {
          zoneId: zoneId,
          zoneName: this.datasource.name,
          nameServers: this.datasource.nameServers,
          primaryNameServer: this.datasource.primaryNameServer,
        };
      }
    }

    return new Import(scope, id);
  }

  private readonly _outputs: DnsZoneOutputs;
  public get dnsZoneOutputs(): DnsZoneOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.dnsZoneOutputs;
  }
  public readonly zoneId: string;
  public readonly arn: string;
  public readonly zoneName: string;
  public readonly nameServers: string[];
  public readonly primaryNameServer: string;

  /**
   * Networks to which this hosted zone will be added
   */
  protected readonly networks = new Array<route53Zone.Route53ZoneVpc>();

  protected readonly resource: route53Zone.Route53Zone;

  constructor(scope: Construct, id: string, props: DnsZoneProps) {
    super(scope, id, props);

    validateZoneName(props.zoneName);

    // Add a dot at the end if the addTrailingDot property is not false.
    const zoneName =
      props.addTrailingDot === false || props.zoneName.endsWith(".")
        ? props.zoneName
        : `${props.zoneName}.`;

    this.resource = new route53Zone.Route53Zone(this, "Resource", {
      name: zoneName,
      comment: props.comment,
      vpc: Lazy.anyValue({
        produce: () =>
          this.networks.length === 0
            ? undefined
            : this.networks.map((n) =>
                route53Zone.route53ZoneVpcToTerraform(n),
              ),
      }),
    });

    this.zoneId = this.resource.id;
    this.arn = this.resource.arn;
    this.nameServers = this.resource.nameServers;
    this.primaryNameServer = this.resource.primaryNameServer;
    this.zoneName = props.zoneName;

    for (const vpc of props.networks || []) {
      this.addNetwork(vpc);
    }

    this._outputs = {
      zoneId: this.zoneId,
      zoneName: this.zoneName,
      nameServers: this.nameServers,
      primaryNameServer: this.resource.primaryNameServer,
    };
  }

  /**
   * Add another Network to this private hosted zone.
   *
   * This conflicts with the `delegationSetId` and any
   * `aws_route53_zone_association` created outside this spec.
   *
   * @param network the other Network to add.
   */
  public addNetwork(network: INetwork) {
    this.networks.push({
      vpcId: network.vpcId,
      vpcRegion: network.env.region ?? AwsStack.ofAwsConstruct(network).region,
    });
  }
}

export function makeHostedZoneArn(
  construct: Construct,
  hostedZoneId: string,
): string {
  return AwsStack.ofAwsConstruct(construct).formatArn({
    account: "",
    region: "",
    service: "route53",
    resource: "hostedzone",
    resourceName: hostedZoneId,
  });
}

/**
 * Validates a zone name is valid by Route53 specifc naming rules,
 * and that there is no trailing dot in the name.
 *
 * @param zoneName the zone name to be validated.
 * @returns +zoneName+
 * @throws ValidationError if the name is not valid.
 */
export function validateZoneName(zoneName: string) {
  if (zoneName.length > 255) {
    throw new Error("zone name cannot be more than 255 bytes long");
  }
  if (zoneName.split(".").find((label) => label.length > 63)) {
    throw new Error("zone name labels cannot be more than 63 bytes long");
  }
  if (!zoneName.match(/^[a-z0-9!"#$%&'()*+,/:;<=>?@[\\\]^_`{|}~.-]+$/i)) {
    throw new Error(
      "zone names can only contain a-z, 0-9, -, ! \" # $ % & ' ( ) * + , - / : ; < = > ? @ [  ] ^ _ ` { | } ~ .",
    );
  }
}
