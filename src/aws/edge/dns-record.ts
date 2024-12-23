import { route53Record } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
// import { GeoLocation } from "./geo-location";
import { IDnsZone, IAliasRecordTarget } from ".";
import { IAwsConstruct, AwsConstructProps, AwsConstructBase } from "../";
import { Duration } from "../..";

// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-route53/lib/record-set.ts

/**
 * Options for a RecordSet.
 */
export interface RecordSetOptions {
  /**
   * The hosted zone in which to define the new record.
   */
  readonly zone: IDnsZone;

  /**
   * The subdomain name for this record. This should be relative to the zone root name.
   *
   * For example, if you want to create a record for acme.example.com, specify
   * "acme".
   *
   * You can also specify the fully qualified domain name which terminates with a
   * ".". For example, "acme.example.com.".
   *
   * @default zone root
   */
  readonly recordName?: string;

  /**
   * The resource record cache time to live (TTL).
   *
   * @default Duration.minutes(30)
   */
  readonly ttl?: Duration;

  /**
   * Whether to delete the same record set in the hosted zone if it already exists (dangerous!)
   *
   * This allows to deploy a new record set while minimizing the downtime because the
   * new record set will be created immediately after the existing one is deleted. It
   * also avoids "manual" actions to delete existing record sets.
   *
   * > **N.B.:** this feature is dangerous, use with caution!
   *
   * @default false
   */
  readonly allowOverwrite?: boolean;

  /**
   * Among resource record sets that have the same combination of DNS name and type,
   * a value that determines the proportion of DNS queries that Amazon Route 53 responds to using the current resource record set.
   *
   * Route 53 calculates the sum of the weights for the resource record sets that have the same combination of DNS name and type.
   * Route 53 then responds to queries based on the ratio of a resource's weight to the total.
   *
   * This value can be a number between 0 and 255.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html
   *
   * @default - Do not set weighted routing
   */
  readonly weight?: number;

  /**
   * The Amazon EC2 Region where you created the resource that this resource record set refers to.
   * The resource typically is an AWS resource, such as an EC2 instance or an ELB load balancer,
   * and is referred to by an IP address or a DNS domain name, depending on the record type.
   *
   * When Amazon Route 53 receives a DNS query for a domain name and type for which you have created latency resource record sets,
   * Route 53 selects the latency resource record set that has the lowest latency between the end user and the associated Amazon EC2 Region.
   * Route 53 then returns the value that is associated with the selected resource record set.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-route53-recordset.html#cfn-route53-recordset-region
   *
   * @default - Do not set latency based routing
   */
  readonly region?: string;

  /**
   * Whether to return multiple values, such as IP addresses for your web servers, in response to DNS queries.
   * Set to true to indicate a multivalue answer routing policy. Conflicts with any other routing policy.
   *
   * @default false
   */
  readonly multiValueAnswer?: boolean;

  /**
   * A string used to distinguish between different records with the same combination of DNS name and type.
   * It can only be set when either weight or geoLocation is defined.
   *
   * This parameter must be between 1 and 128 characters in length.
   *
   * @default - Auto generated string
   */
  readonly setIdentifier?: string;

  // R53 record comment is hardcoded for terraform-provider-aws
  // https://github.com/hashicorp/terraform-provider-aws/blob/v5.68.0/internal/service/route53/record.go#L363
  // /**
  //  * A comment to add on the record.
  //  *
  //  * @default "Managed by Terraform"
  //  */
  // readonly comment?: string;
}

/**
 * Construction properties for a RecordSet.
 */
export interface RecordSetProps extends RecordSetOptions, AwsConstructProps {
  /**
   * The record type.
   */
  readonly recordType: RecordType;

  /**
   * The target for this record, either `RecordTarget.fromValues()` or
   * `RecordTarget.fromAlias()`.
   */
  readonly target: RecordTarget;
}

export interface RecordSetOutputs {
  /**
   * The domain name of the record
   */
  readonly domainName: string;
  /**
   * The FQDN[fqn] built using the zone domain and name
   *
   * [fqn]: https://en.wikipedia.org/wiki/Fully_qualified_domain_name
   */
  readonly fqdn: string;
}

/**
 * A record set Attributes
 */
export interface IRecordSet extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly recordSetOutputs: RecordSetOutputs;

  /**
   * The domain name of the record
   */
  readonly domainName: string;
  /**
   * The [FQDN][fqdn] built using the zone domain and name
   *
   * [fqdn]: https://en.wikipedia.org/wiki/Fully_qualified_domain_name
   */
  readonly fqdn: string;
}

/**
 * A record set.
 */
export class RecordSet extends AwsConstructBase implements IRecordSet {
  public readonly resource: route53Record.Route53Record;
  private readonly _outputs: RecordSetOutputs;
  public get recordSetOutputs(): RecordSetOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.recordSetOutputs;
  }
  public readonly domainName: string;
  public readonly fqdn: string;
  // private readonly geoLocation?: GeoLocation;
  private readonly weight?: number;
  private readonly region?: string;
  private readonly multiValueAnswer?: boolean;

  constructor(scope: Construct, id: string, props: RecordSetProps) {
    super(scope, id, props);

    if (props.weight && (props.weight < 0 || props.weight > 255)) {
      throw new Error(
        `weight must be between 0 and 255 inclusive, got: ${props.weight}`,
      );
    }
    if (
      props.setIdentifier &&
      (props.setIdentifier.length < 1 || props.setIdentifier.length > 128)
    ) {
      throw new Error(
        `setIdentifier must be between 1 and 128 characters long, got: ${props.setIdentifier.length}`,
      );
    }
    if (
      props.setIdentifier &&
      props.weight === undefined &&
      // !props.geoLocation &&
      !props.region &&
      !props.multiValueAnswer
    ) {
      throw new Error(
        "setIdentifier can only be specified for non-simple routing policies",
      );
    }
    if (props.multiValueAnswer && props.target.aliasTarget) {
      throw new Error("multiValueAnswer cannot be specified for alias record");
    }

    const nonSimpleRoutingPolicies = [
      // props.geoLocation,
      props.region,
      props.weight,
      props.multiValueAnswer,
    ].filter((variable) => variable !== undefined).length;
    if (nonSimpleRoutingPolicies > 1) {
      throw new Error(
        "Only one of region, weight, multiValueAnswer or geoLocation can be defined",
      );
    }

    // this.geoLocation = props.geoLocation;
    this.weight = props.weight;
    this.region = props.region;
    this.multiValueAnswer = props.multiValueAnswer;

    const ttl = props.target.aliasTarget
      ? undefined
      : ((props.ttl && props.ttl.toSeconds()) ?? 1800);

    const recordName = determineFullyQualifiedDomainName(
      props.zone,
      props.recordName,
    );

    this.resource = new route53Record.Route53Record(this, "Resource", {
      ...props, // copy all MetaArguments
      zoneId: props.zone.zoneId,
      name: recordName,
      type: props.recordType,
      records: props.target.values,
      alias:
        props.target.aliasTarget &&
        props.target.aliasTarget.bind(this, props.zone),
      ttl,
      setIdentifier: props.setIdentifier ?? this.configureSetIdentifier(),
      // geoLocation: props.geoLocation
      //   ? {
      //       continentCode: props.geoLocation.continentCode,
      //       countryCode: props.geoLocation.countryCode,
      //       subdivisionCode: props.geoLocation.subdivisionCode,
      //     }
      //   : undefined,
      multivalueAnswerRoutingPolicy: props.multiValueAnswer,
      weightedRoutingPolicy: props.weight
        ? {
            weight: props.weight,
          }
        : undefined,
      latencyRoutingPolicy: props.region
        ? {
            region: props.region,
          }
        : undefined,
      allowOverwrite: props.allowOverwrite,
    });

    this.fqdn = this.resource.fqdn;
    this.domainName = this.resource.name;
    this._outputs = {
      domainName: this.domainName,
      fqdn: this.fqdn,
    };
  }

  private configureSetIdentifier(): string | undefined {
    // if (this.geoLocation) {
    //   let identifier = "GEO";
    //   if (this.geoLocation.continentCode) {
    //     identifier = identifier.concat(
    //       "_CONTINENT_",
    //       this.geoLocation.continentCode,
    //     );
    //   }
    //   if (this.geoLocation.countryCode) {
    //     identifier = identifier.concat(
    //       "_COUNTRY_",
    //       this.geoLocation.countryCode,
    //     );
    //   }
    //   if (this.geoLocation.subdivisionCode) {
    //     identifier = identifier.concat(
    //       "_SUBDIVISION_",
    //       this.geoLocation.subdivisionCode,
    //     );
    //   }
    //   return identifier;
    // }

    if (this.weight !== undefined) {
      const idPrefix = `WEIGHT_${this.weight}_ID_`;
      return this.createIdentifier(idPrefix);
    }

    if (this.region) {
      const idPrefix = `REGION_${this.region}_ID_`;
      return this.createIdentifier(idPrefix);
    }

    if (this.multiValueAnswer) {
      const idPrefix = "MVA_ID_";
      return this.createIdentifier(idPrefix);
    }

    return undefined;
  }

  private createIdentifier(prefix: string): string {
    return this.stack.uniqueResourceName(this, { maxLength: 64, prefix });
  }
}

/**
 * The record type.
 */
export enum RecordType {
  /**
   * route traffic to a resource, such as a web server, using an IPv4 address in dotted decimal
   * notation
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#AFormat
   */
  A = "A",

  /**
   * route traffic to a resource, such as a web server, using an IPv6 address in colon-separated
   * hexadecimal format
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#AAAAFormat
   */
  AAAA = "AAAA",

  /**
   * A CAA record specifies which certificate authorities (CAs) are allowed to issue certificates
   * for a domain or subdomain
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#CAAFormat
   */
  CAA = "CAA",

  /**
   * A CNAME record maps DNS queries for the name of the current record, such as acme.example.com,
   * to another domain (example.com or example.net) or subdomain (acme.example.com or zenith.example.org).
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#CNAMEFormat
   */
  CNAME = "CNAME",

  /**
   * A delegation signer (DS) record refers a zone key for a delegated subdomain zone.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#DSFormat
   */
  DS = "DS",

  /**
   * An MX record specifies the names of your mail servers and, if you have two or more mail servers,
   * the priority order.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#MXFormat
   */
  MX = "MX",

  /**
   * A Name Authority Pointer (NAPTR) is a type of record that is used by Dynamic Delegation Discovery
   * System (DDDS) applications to convert one value to another or to replace one value with another.
   * For example, one common use is to convert phone numbers into SIP URIs.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#NAPTRFormat
   */
  NAPTR = "NAPTR",

  /**
   * An NS record identifies the name servers for the hosted zone
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#NSFormat
   */
  NS = "NS",

  /**
   * A PTR record maps an IP address to the corresponding domain name.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#PTRFormat
   */
  PTR = "PTR",

  /**
   * A start of authority (SOA) record provides information about a domain and the corresponding Amazon
   * Route 53 hosted zone
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#SOAFormat
   */
  SOA = "SOA",

  /**
   * SPF records were formerly used to verify the identity of the sender of email messages.
   * Instead of an SPF record, we recommend that you create a TXT record that contains the applicable value.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#SPFFormat
   */
  SPF = "SPF",

  /**
   * An SRV record Value element consists of four space-separated values. The first three values are
   * decimal numbers representing priority, weight, and port. The fourth value is a domain name.
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#SRVFormat
   */
  SRV = "SRV",

  /**
   * A TXT record contains one or more strings that are enclosed in double quotation marks (").
   *
   * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#TXTFormat
   */
  TXT = "TXT",
}

/**
 * Type union for a record that accepts multiple types of target.
 */
export class RecordTarget {
  /**
   * Use string values as target.
   *
   * These can be IP addresses or domain names.
   */
  public static fromValues(...values: string[]) {
    return new RecordTarget(values);
  }

  /**
   * Use an alias as target.
   */
  public static fromAlias(aliasTarget: IAliasRecordTarget) {
    return new RecordTarget(undefined, aliasTarget);
  }

  /**
   *
   * @param values correspond with the chosen record type (e.g. for 'A' Type, specify one or more IP addresses)
   * @param aliasTarget alias for targets such as CloudFront distribution to route traffic to
   */
  protected constructor(
    public readonly values?: string[],
    public readonly aliasTarget?: IAliasRecordTarget,
  ) {}
}

/**
 * Construction properties for a ARecord.
 */
export interface ARecordProps extends RecordSetOptions, AwsConstructProps {
  /**
   * The target.
   */
  readonly target: RecordTarget;
}

/**
 * A DNS A record
 *
 * @resource aws_route53_record
 */
export class ARecord extends RecordSet {
  constructor(scope: Construct, id: string, props: ARecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.A,
      target: props.target,
    });
  }
}

/**
 * Construction properties for a AaaaRecord.
 */
export interface AaaaRecordProps extends RecordSetOptions, AwsConstructProps {
  /**
   * The target.
   */
  readonly target: RecordTarget;
}

/**
 * A DNS AAAA record
 *
 * @resource aws_route53_record
 */
export class AaaaRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: AaaaRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.AAAA,
      target: props.target,
    });
  }
}

/**
 * Construction properties for a CnameRecord.
 */
export interface CnameRecordProps extends RecordSetOptions {
  /**
   * The domain name of the target that this record should point to.
   */
  readonly domainName: string;
}

/**
 * A DNS CNAME record
 *
 * @resource aws_route53_record
 */
export class CnameRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: CnameRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.CNAME,
      target: RecordTarget.fromValues(props.domainName),
    });
  }
}

/**
 * Construction properties for a TxtRecord.
 */
export interface TxtRecordProps extends RecordSetOptions {
  /**
   * The text values.
   */
  readonly values: string[];
}

/**
 * A DNS TXT record
 *
 * @resource aws_route53_record
 */
export class TxtRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: TxtRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.TXT,
      target: RecordTarget.fromValues(...props.values.map((v) => formatTxt(v))),
    });
  }
}

/**
 * Formats a text value for use in a TXT record
 *
 * Use `JSON.stringify` to correctly escape and enclose in double quotes ("").
 *
 * DNS TXT records can contain up to 255 characters in a single string. TXT
 * record strings over 255 characters must be split into multiple text strings
 * within the same record.
 *
 * @see https://aws.amazon.com/premiumsupport/knowledge-center/route53-resolve-dkim-text-record-error/
 */
function formatTxt(string: string): string {
  const result = [];
  let idx = 0;
  while (idx < string.length) {
    result.push(string.slice(idx, (idx += 255))); // chunks of 255 characters long
  }
  return result.map((r) => JSON.stringify(r)).join("");
}

/**
 * Properties for a SRV record value.
 */
export interface SrvRecordValue {
  /**
   * The priority.
   */
  readonly priority: number;

  /**
   * The weight.
   */
  readonly weight: number;

  /**
   * The port.
   */
  readonly port: number;

  /**
   * The server host name.
   */
  readonly hostName: string;
}
/**
 * Construction properties for a SrvRecord.
 */
export interface SrvRecordProps extends RecordSetOptions {
  /**
   * The values.
   */
  readonly values: SrvRecordValue[];
}

/**
 * A DNS SRV record
 *
 * @resource aws_route53_record
 */
export class SrvRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: SrvRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.SRV,
      target: RecordTarget.fromValues(
        ...props.values.map(
          (v) => `${v.priority} ${v.weight} ${v.port} ${v.hostName}`,
        ),
      ),
    });
  }
}

/**
 * The CAA tag.
 */
export enum CaaTag {
  /**
   * Explicity authorizes a single certificate authority to issue a
   * certificate (any type) for the hostname.
   */
  ISSUE = "issue",

  /**
   * Explicity authorizes a single certificate authority to issue a
   * wildcard certificate (and only wildcard) for the hostname.
   */
  ISSUEWILD = "issuewild",

  /**
   * Specifies a URL to which a certificate authority may report policy
   * violations.
   */
  IODEF = "iodef",
}

/**
 * Properties for a CAA record value.
 */
export interface CaaRecordValue {
  /**
   * The flag.
   */
  readonly flag: number;

  /**
   * The tag.
   */
  readonly tag: CaaTag;

  /**
   * The value associated with the tag.
   */
  readonly value: string;
}

/**
 * Construction properties for a CaaRecord.
 */
export interface CaaRecordProps extends RecordSetOptions {
  /**
   * The values.
   */
  readonly values: CaaRecordValue[];
}

/**
 * A DNS CAA record
 *
 * @resource aws_route53_record
 */
export class CaaRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: CaaRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.CAA,
      target: RecordTarget.fromValues(
        ...props.values.map((v) => `${v.flag} ${v.tag} "${v.value}"`),
      ),
    });
  }
}

/**
 * Construction properties for a CaaAmazonRecord.
 */
export interface CaaAmazonRecordProps extends RecordSetOptions {}

/**
 * A DNS Amazon CAA record.
 *
 * A CAA record to restrict certificate authorities allowed
 * to issue certificates for a domain to Amazon only.
 *
 * @resource aws_route53_record
 */
export class CaaAmazonRecord extends CaaRecord {
  constructor(scope: Construct, id: string, props: CaaAmazonRecordProps) {
    super(scope, id, {
      ...props,
      values: [
        {
          flag: 0,
          tag: CaaTag.ISSUE,
          value: "amazon.com",
        },
      ],
    });
  }
}

/**
 * Properties for a MX record value.
 */
export interface MxRecordValue {
  /**
   * The priority.
   */
  readonly priority: number;

  /**
   * The mail server host name.
   */
  readonly hostName: string;
}

/**
 * Construction properties for a MxRecord.
 */
export interface MxRecordProps extends RecordSetOptions {
  /**
   * The values.
   */
  readonly values: MxRecordValue[];
}

/**
 * A DNS MX record
 *
 * @resource aws_route53_record
 */
export class MxRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: MxRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.MX,
      target: RecordTarget.fromValues(
        ...props.values.map((v) => `${v.priority} ${v.hostName}`),
      ),
    });
  }
}

/**
 * Construction properties for a NSRecord.
 */
export interface NsRecordProps extends RecordSetOptions {
  /**
   * The NS values.
   */
  readonly values: string[];
}

/**
 * A DNS NS record
 *
 * @resource aws_route53_record
 */
export class NsRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: NsRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.NS,
      target: RecordTarget.fromValues(...props.values),
    });
  }
}

/**
 * Construction properties for a DSRecord.
 */
export interface DsRecordProps extends RecordSetOptions {
  /**
   * The DS values.
   */
  readonly values: string[];
}

/**
 * A DNS DS record
 *
 * @resource aws_route53_record
 */
export class DsRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: DsRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.DS,
      target: RecordTarget.fromValues(...props.values),
    });
  }
}

/**
 * Construction properties for a ZoneDelegationRecord
 */
export interface ZoneDelegationRecordProps extends RecordSetOptions {
  /**
   * The name servers to report in the delegation records.
   */
  readonly nameServers: string[];
}

/**
 * A record to delegate further lookups to a different set of name servers.
 */
export class ZoneDelegationRecord extends RecordSet {
  constructor(scope: Construct, id: string, props: ZoneDelegationRecordProps) {
    super(scope, id, {
      ...props,
      recordType: RecordType.NS,
      target: RecordTarget.fromValues(
        ...(Token.isUnresolved(props.nameServers)
          ? props.nameServers // Can't map a string-array token!
          : props.nameServers.map((ns) =>
              Token.isUnresolved(ns) || ns.endsWith(".") ? ns : `${ns}.`,
            )),
      ),
      ttl: props.ttl || Duration.days(2),
    });
  }
}

// ref https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-route53/lib/util.ts

/**
 * Route53 requires the record names are specified as fully qualified names, but this
 * forces lots of redundant work on the user (repeating the zone name over and over).
 * This function allows the user to be lazier and offers a nicer experience, by
 * qualifying relative names appropriately:
 *
 * @param providedName the user-specified name of the record.
 * @param dnsZone      the zone the record will be created in.
 *
 * @returns <ul>
 *        <li>If +providedName+ ends with a +.+, use it as-is</li>
 *        <li>If +dnsZone.zoneName+ is a token, use +providedName+ as-is</li>
 *        <li>If +providedName+ ends with or equals +zoneName+, append a trailing +.+</li>
 *        <li>Otherwise, append +.+, +zoneName+ and a trailing +.+</li>
 *      </ul>
 */
export function determineFullyQualifiedDomainName(
  dnsZone: IDnsZone,
  recordName?: string,
): string {
  if (!recordName) {
    return `${dnsZone.zoneName}`;
  }

  if (recordName.endsWith(".") || Token.isUnresolved(dnsZone.zoneName)) {
    return recordName;
  }

  const zoneName = dnsZone.zoneName.endsWith(".")
    ? dnsZone.zoneName.substring(0, dnsZone.zoneName.length - 1)
    : dnsZone.zoneName;

  const suffix = `.${zoneName}`;
  if (recordName.endsWith(suffix) || recordName === zoneName) {
    return `${recordName}.`;
  }

  return `${recordName}${suffix}.`;
}
