// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/shared/base-load-balancer.ts

import { lb as tfLoadBalancer } from "@cdktf/provider-aws";
import {
  TerraformResource,
  // ContextProvider,
  Lazy,
  Token,
} from "cdktf";
import { Construct } from "constructs";
import { IpAddressType } from "./enums";
// import { RegionInfo } from "../../../region-info";
import {
  Attributes,
  ifUndefined,
  LoadBalancerAttribute as Attribute,
  lookupBoolAttribute,
  lookupNumberAttribute,
  // mapTagMapToCxschema,
  // renderAttributes,
} from "./util";
import * as ec2 from "../";
import { getElbv2Account } from "./access-logs-accounts";
import { LoadBalancerType } from "./grid-lookup-types";
import { ArnFormat } from "../../arn";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../../aws-construct";
import { AwsStack } from "../../aws-stack";
import * as iam from "../../iam";
import { PolicyStatement, ServicePrincipal } from "../../iam";
import * as s3 from "../../storage";

/**
 * Shared properties of both Application and Network Load Balancers
 */
export interface BaseLoadBalancerProps extends AwsConstructProps {
  /**
   * Name of the load balancer
   *
   * @default - Automatically generated name.
   */
  readonly loadBalancerName?: string;

  /**
   * The VPC network to place the load balancer in
   */
  readonly vpc: ec2.IVpc;

  /**
   * Whether the load balancer has an internet-routable address
   *
   * @default false
   */
  readonly internetFacing?: boolean;

  /**
   * Which subnets place the load balancer in
   *
   * @default - the Vpc default strategy.
   *
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Indicates whether deletion protection is enabled.
   *
   * @default false
   */
  readonly deletionProtection?: boolean;

  /**
   * Indicates whether cross-zone load balancing is enabled.
   *
   * @default - false for Network Load Balancers and true for Application Load Balancers.
   * This can not be `false` for Application Load Balancers.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-loadbalancer-loadbalancerattribute.html
   */
  readonly crossZoneEnabled?: boolean;

  /**
   * Indicates whether the load balancer blocks traffic through the Internet Gateway (IGW).
   *
   * @default - false for internet-facing load balancers and true for internal load balancers
   */
  readonly denyAllIgwTraffic?: boolean;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface LoadBalancerV2Outputs {
  /**
   * The canonical hosted zone ID of this load balancer
   *
   * Example value: `Z2P70J7EXAMPLE`
   *
   * @attribute
   */
  readonly loadBalancerCanonicalHostedZoneId: string;
  /**
   * The DNS name of this load balancer
   *
   * Example value: `my-load-balancer-424835706.us-west-2.elb.amazonaws.com`
   *
   * @attribute
   */
  readonly loadBalancerDnsName: string;
}

export interface ILoadBalancerV2 extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly loadBalancerV2Outputs: LoadBalancerV2Outputs;
  /**
   * The canonical hosted zone ID of this load balancer
   *
   * Example value: `Z2P70J7EXAMPLE`
   *
   * @attribute
   */
  readonly loadBalancerCanonicalHostedZoneId: string;

  /**
   * The DNS name of this load balancer
   *
   * Example value: `my-load-balancer-424835706.us-west-2.elb.amazonaws.com`
   *
   * @attribute
   */
  readonly loadBalancerDnsName: string;
}

/**
 * Options for looking up load balancers
 */
export interface BaseLoadBalancerLookupOptions {
  /**
   * Find by load balancer's ARN
   * @default - does not search by load balancer arn
   */
  readonly loadBalancerArn?: string;

  /**
   * Match load balancer tags.
   * @default - does not match load balancers by tags
   */
  readonly loadBalancerTags?: Record<string, string>;
}

/**
 * Options for query context provider
 * @internal
 */
export interface LoadBalancerQueryContextProviderOptions {
  /**
   * User's lookup options
   */
  readonly userOptions: BaseLoadBalancerLookupOptions;

  /**
   * Type of load balancer
   */
  readonly loadBalancerType: LoadBalancerType;
}

/**
 * Base class for both Application and Network Load Balancers
 */
export abstract class BaseLoadBalancer extends AwsConstructBase {
  // /**
  //  * Queries the load balancer context provider for load balancer info.
  //  * @internal
  //  */
  // protected static _queryContextProvider(
  //   scope: Construct,
  //   options: LoadBalancerQueryContextProviderOptions,
  // ) {
  //   if (
  //     Token.isUnresolved(options.userOptions.loadBalancerArn) ||
  //     Object.values(options.userOptions.loadBalancerTags ?? {}).some(
  //       Token.isUnresolved,
  //     )
  //   ) {
  //     throw new Error(
  //       "All arguments to look up a load balancer must be concrete (no Tokens)",
  //     );
  //   }

  //   let cxschemaTags: cxschema.Tag[] | undefined;
  //   if (options.userOptions.loadBalancerTags) {
  //     cxschemaTags = mapTagMapToCxschema(options.userOptions.loadBalancerTags);
  //   }

  //   const props: cxapi.LoadBalancerContextResponse = ContextProvider.getValue(
  //     scope,
  //     {
  //       provider: cxschema.ContextProvider.LOAD_BALANCER_PROVIDER,
  //       props: {
  //         loadBalancerArn: options.userOptions.loadBalancerArn,
  //         loadBalancerTags: cxschemaTags,
  //         loadBalancerType: options.loadBalancerType,
  //       } as cxschema.LoadBalancerContextQuery,
  //       dummyValue: {
  //         ipAddressType: cxapi.LoadBalancerIpAddressType.DUAL_STACK,
  //         // eslint-disable-next-line @cdklabs/no-literal-partition
  //         loadBalancerArn: `arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/${options.loadBalancerType}/my-load-balancer/50dc6c495c0c9188`,
  //         loadBalancerCanonicalHostedZoneId: "Z3DZXE0EXAMPLE",
  //         loadBalancerDnsName:
  //           "my-load-balancer-1234567890.us-west-2.elb.amazonaws.com",
  //         securityGroupIds: ["sg-1234"],
  //         vpcId: "vpc-12345",
  //       } as cxapi.LoadBalancerContextResponse,
  //     },
  //   ).value;

  //   return props;
  // }

  public get loadBalancerV2Outputs(): LoadBalancerV2Outputs {
    return {
      loadBalancerCanonicalHostedZoneId: this.loadBalancerCanonicalHostedZoneId,
      loadBalancerDnsName: this.loadBalancerDnsName,
    };
  }
  public get outputs(): Record<string, any> {
    return this.loadBalancerV2Outputs;
  }

  /**
   * The canonical hosted zone ID of this load balancer
   *
   * Example value: `Z2P70J7EXAMPLE`
   *
   * @attribute
   */
  public readonly loadBalancerCanonicalHostedZoneId: string;

  /**
   * The DNS name of this load balancer
   *
   * Example value: `my-load-balancer-424835706.us-west-2.elb.amazonaws.com`
   *
   * @attribute
   */
  public readonly loadBalancerDnsName: string;

  /**
   * The full name of this load balancer
   *
   * Example value: `app/my-load-balancer/50dc6c495c0c9188`
   *
   * @attribute
   */
  public readonly loadBalancerFullName: string;

  /**
   * The name of this load balancer
   *
   * Example value: `my-load-balancer`
   *
   * @attribute
   */
  public readonly loadBalancerName: string;

  /**
   * The ARN of this load balancer
   *
   * Example value: `arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-internal-load-balancer/50dc6c495c0c9188`
   *
   * @attribute
   */
  public readonly loadBalancerArn: string;

  /**
   * @attribute
   */
  public readonly loadBalancerSecurityGroups: string[];

  /**
   * The VPC this load balancer has been created in.
   *
   * This property is always defined (not `null` or `undefined`) for sub-classes of `BaseLoadBalancer`.
   */
  public readonly vpc?: ec2.IVpc;

  /**
   * Attributes set on this load balancer
   */
  private readonly attributes: Attributes = {};
  private readonly physicalName: string;

  constructor(
    scope: Construct,
    id: string,
    baseProps: BaseLoadBalancerProps,
    additionalProps: tfLoadBalancer.LbConfig,
  ) {
    super(scope, id, baseProps);
    this.physicalName =
      baseProps.loadBalancerName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    const internetFacing = ifUndefined(baseProps.internetFacing, false);

    const vpcSubnets = ifUndefined(
      baseProps.vpcSubnets,
      internetFacing ? { subnetType: ec2.SubnetType.PUBLIC } : {},
    );
    const { subnetIds, internetConnectivityEstablished } =
      baseProps.vpc.selectSubnets(vpcSubnets);

    this.vpc = baseProps.vpc;

    if (
      additionalProps.ipAddressType ===
        IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4 &&
      additionalProps.loadBalancerType !== LoadBalancerType.APPLICATION
    ) {
      throw new Error(
        `'ipAddressType' DUAL_STACK_WITHOUT_PUBLIC_IPV4 can only be used with Application Load Balancer, got ${additionalProps.loadBalancerType}`,
      );
    }

    const resource = new tfLoadBalancer.Lb(this, "Resource", {
      name: this.physicalName,
      subnets: subnetIds,
      internal: !internetFacing, // AWS CDK "Scheme"
      // Reverse CFN LoadBalancerAttributes to Terraform Resource properties
      // https://github.com/hashicorp/terraform-provider-aws/blob/v5.88.0/internal/service/elbv2/load_balancer.go#L718
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-loadbalancer-loadbalancerattribute.html
      clientKeepAlive: this.lazyNumberAttr(Attribute.clientKeepAliveSeconds),
      // customerOwnedIpv4Pool [Application Load Balancers on Outposts]
      desyncMitigationMode: this.lazyStringAttr(
        Attribute.routingHTTPDesyncMitigationMode,
      ),
      dnsRecordClientRoutingPolicy: this.lazyStringAttr(
        Attribute.dNSRecordClientRoutingPolicy,
      ),
      dropInvalidHeaderFields: this.lazyBoolAttr(
        Attribute.routingHTTPDropInvalidHeaderFieldsEnabled,
      ),
      enableCrossZoneLoadBalancing: this.lazyBoolAttr(
        Attribute.loadBalancingCrossZoneEnabled,
      ),
      enableDeletionProtection: this.lazyBoolAttr(
        Attribute.deletionProtectionEnabled,
      ),
      enableHttp2: this.lazyBoolAttr(Attribute.routingHTTP2Enabled),
      enableTlsVersionAndCipherSuiteHeaders: this.lazyBoolAttr(
        Attribute.routingHTTPXAmznTLSVersionAndCipherSuiteEnabled,
      ),
      enableWafFailOpen: this.lazyBoolAttr(Attribute.wAFFailOpenEnabled),
      enableXffClientPort: this.lazyBoolAttr(
        Attribute.routingHTTPXFFClientPortEnabled,
      ),
      enableZonalShift: this.lazyBoolAttr(Attribute.zonalShiftConfigEnabled),
      // enforceSecurityGroupInboundRulesOnPrivateLinkTraffic,
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-elasticloadbalancingv2-loadbalancer.html#cfn-elasticloadbalancingv2-loadbalancer-enforcesecuritygroupinboundrulesonprivatelinktraffic
      idleTimeout: this.lazyNumberAttr(Attribute.idleTimeoutTimeoutSeconds),
      // ipAddressType
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-elasticloadbalancingv2-loadbalancer.html#cfn-elasticloadbalancingv2-loadbalancer-ipaddresstype
      preserveHostHeader: this.lazyBoolAttr(
        Attribute.routingHTTPPreserveHostHeaderEnabled,
      ),
      xffHeaderProcessingMode: this.lazyStringAttr(
        Attribute.routingHTTPXFFHeaderProcessingMode,
      ),
      accessLogs: Lazy.anyValue({
        produce: (): tfLoadBalancer.LbAccessLogs | undefined => {
          const enabled = lookupBoolAttribute(
            this.attributes,
            Attribute.accessLogsS3Enabled,
          );
          if (enabled) {
            const bucket = this.attributes[Attribute.accessLogsS3Bucket];
            if (!bucket) {
              throw new Error(
                "Access logs are enabled, but no bucket was provided.",
              );
            }
            return {
              enabled,
              bucket,
              prefix: this.attributes[Attribute.accessLogsS3Prefix],
            };
          }
          return undefined;
        },
      }) as any,
      connectionLogs: Lazy.anyValue({
        produce: (): tfLoadBalancer.LbConnectionLogs | undefined => {
          const enabled = lookupBoolAttribute(
            this.attributes,
            Attribute.connectionLogsS3Enabled,
          );
          if (enabled) {
            const bucket = this.attributes[Attribute.connectionLogsS3Bucket];
            if (!bucket) {
              throw new Error(
                "Connection logs are enabled, but no bucket was provided.",
              );
            }
            return {
              enabled,
              bucket,
              prefix: this.attributes[Attribute.connectionLogsS3Prefix],
            };
          }
          return undefined;
        },
      }) as any,
      //subnetMappings
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-elasticloadbalancingv2-loadbalancer.html#cfn-elasticloadbalancingv2-loadbalancer-subnetmappings
      ...additionalProps,
    });
    if (internetFacing) {
      resource.node.addDependency(internetConnectivityEstablished);
    }

    this.setAttribute(
      Attribute.deletionProtectionEnabled,
      baseProps.deletionProtection ? "true" : "false",
    );

    if (baseProps.crossZoneEnabled !== undefined) {
      this.setAttribute(
        Attribute.loadBalancingCrossZoneEnabled,
        baseProps.crossZoneEnabled === true ? "true" : "false",
      );
    }

    if (baseProps.denyAllIgwTraffic !== undefined) {
      if (additionalProps.ipAddressType === IpAddressType.DUAL_STACK) {
        this.setAttribute(
          Attribute.iPv6DenyAllIGWTraffic,
          baseProps.denyAllIgwTraffic.toString(),
        );
      } else {
        throw new Error(
          `'denyAllIgwTraffic' may only be set on load balancers with ${IpAddressType.DUAL_STACK} addressing.`,
        );
      }
    }

    this.loadBalancerCanonicalHostedZoneId = resource.zoneId;
    this.loadBalancerDnsName = resource.dnsName;
    this.loadBalancerFullName = this.stack.splitArn(
      resource.arn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).resource;
    this.loadBalancerName = resource.name;
    this.loadBalancerArn = resource.arn;
    this.loadBalancerSecurityGroups = resource.securityGroups;

    this.node.addValidation({ validate: this.validateLoadBalancer.bind(this) });
  }

  /**
   * Enable access logging for this load balancer.
   *
   * A region must be specified on the stack containing the load balancer; you cannot enable logging on
   * environment-agnostic stacks. See https://docs.aws.amazon.com/cdk/latest/guide/environments.html
   */
  public logAccessLogs(bucket: s3.IBucket, prefix?: string) {
    prefix = prefix || "";
    this.setAttribute("access_logs.s3.enabled", "true");
    this.setAttribute("access_logs.s3.bucket", bucket.bucketName.toString());
    this.setAttribute("access_logs.s3.prefix", prefix);

    const logsDeliveryServicePrincipal = new ServicePrincipal(
      "delivery.logs.amazonaws.com",
    );
    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        principals: [this.resourcePolicyPrincipal()],
        resources: [
          bucket.arnForObjects(
            `${prefix ? prefix + "/" : ""}AWSLogs/${AwsStack.ofAwsConstruct(this).account}/*`,
          ),
        ],
      }),
    );
    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        principals: [logsDeliveryServicePrincipal],
        resources: [
          bucket.arnForObjects(
            `${prefix ? prefix + "/" : ""}AWSLogs/${this.env.account}/*`,
          ),
        ],
        condition: [
          {
            test: "StringEquals",
            variable: "s3:x-amz-acl",
            values: ["bucket-owner-full-control"],
          },
        ],
      }),
    );
    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:GetBucketAcl"],
        principals: [logsDeliveryServicePrincipal],
        resources: [bucket.bucketArn],
      }),
    );

    // make sure the bucket's policy is created before the ALB (see https://github.com/aws/aws-cdk/issues/1633)
    // at the L1 level to avoid creating a circular dependency (see https://github.com/aws/aws-cdk/issues/27528
    // and https://github.com/aws/aws-cdk/issues/27928)
    const lb = this.node.defaultChild;
    const bucketPolicy = bucket.policy?.node.defaultChild;
    if (
      lb &&
      bucketPolicy &&
      TerraformResource.isTerraformResource(lb) &&
      TerraformResource.isTerraformResource(bucketPolicy)
    ) {
      lb.node.addDependency(bucketPolicy);
    }
  }

  /**
   * Set a non-standard attribute on the load balancer
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html#load-balancer-attributes
   */
  public setAttribute(key: string, value: string | undefined) {
    this.attributes[key] = value;
  }

  /**
   * Remove an attribute from the load balancer
   */
  public removeAttribute(key: string) {
    this.setAttribute(key, undefined);
  }

  private lazyStringAttr(key: string) {
    return Lazy.stringValue({
      produce: () => this.attributes[key],
    });
  }
  private lazyBoolAttr(key: string) {
    return Lazy.anyValue({
      produce: () => lookupBoolAttribute(this.attributes, key),
    });
  }
  private lazyNumberAttr(key: string) {
    return Lazy.numberValue({
      produce: () => lookupNumberAttribute(this.attributes, key),
    });
  }

  protected resourcePolicyPrincipal(): iam.IPrincipal {
    const region = this.stack.region;
    if (Token.isUnresolved(region)) {
      throw new Error("Region is required to enable ELBv2 access logging");
    }

    // const account = RegionInfo.get(region).elbv2Account;
    const account = getElbv2Account(region);
    if (!account) {
      // New Regions use a service principal
      // https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/enable-access-logs.html#attach-bucket-policy
      return new iam.ServicePrincipal(
        "logdelivery.elasticloadbalancing.amazonaws.com",
      );
    }

    return new iam.AccountPrincipal(account);
  }

  protected validateLoadBalancer(): string[] {
    const ret = new Array<string>();

    // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-elasticloadbalancingv2-loadbalancer.html#cfn-elasticloadbalancingv2-loadbalancer-name
    const loadBalancerName = this.physicalName;
    if (
      !Token.isUnresolved(loadBalancerName) &&
      loadBalancerName !== undefined
    ) {
      if (loadBalancerName.length > 32) {
        ret.push(
          `Load balancer name: "${loadBalancerName}" can have a maximum of 32 characters.`,
        );
      }
      if (loadBalancerName.startsWith("internal-")) {
        ret.push(
          `Load balancer name: "${loadBalancerName}" must not begin with "internal-".`,
        );
      }
      if (loadBalancerName.startsWith("-") || loadBalancerName.endsWith("-")) {
        ret.push(
          `Load balancer name: "${loadBalancerName}" must not begin or end with a hyphen.`,
        );
      }
      if (!/^[0-9a-z-]+$/i.test(loadBalancerName)) {
        ret.push(
          `Load balancer name: "${loadBalancerName}" must contain only alphanumeric characters or hyphens.`,
        );
      }
    }

    return ret;
  }
}
