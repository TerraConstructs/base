// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/nlb/network-load-balancer.ts

import { dataAwsLb } from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import { BaseNetworkListenerProps, NetworkListener } from "./network-listener";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as cloudwatch from "../../cloudwatch";
import { Connections, IConnectable } from "../connections";
// import {
//   LoadBalancerType,
//   LoadBalancerListenerProtocol,
// } from "../lb-shared/grid-lookup-types";
import { NetworkELBMetrics } from "../elasticloadbalancingv2-canned-metrics.generated";
import {
  BaseLoadBalancer,
  BaseLoadBalancerLookupOptions,
  BaseLoadBalancerProps,
  ILoadBalancerV2,
  LoadBalancerV2Outputs,
} from "../lb-shared/base-load-balancer";
import { IpAddressType, LbProtocol } from "../lb-shared/enums";
import { parseLoadBalancerFullName } from "../lb-shared/util";
import { ISecurityGroup, SecurityGroup } from "../security-group";
import {
  IVpc,
  // TODO: Add Grid Lookup support
  // Vpc,
} from "../vpc";
import { IVpcEndpointServiceLoadBalancer } from "../vpc-endpoint-service";

/**
 * Indicates how traffic is distributed among the load balancer Availability Zones.
 *
 * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/network/network-load-balancers.html#zonal-dns-affinity
 */
export enum ClientRoutingPolicy {
  /**
   * 100 percent zonal affinity
   */
  AVAILABILITY_ZONE_AFFINITY = "availability_zone_affinity",
  /**
   * 85 percent zonal affinity
   */
  PARTIAL_AVAILABILITY_ZONE_AFFINITY = "partial_availability_zone_affinity",
  /**
   * No zonal affinity
   */
  ANY_AVAILABILITY_ZONE = "any_availability_zone",
}

/**
 * Properties for a network load balancer
 */
export interface NetworkLoadBalancerProps extends BaseLoadBalancerProps {
  /**
   * Security groups to associate with this load balancer
   *
   * @default - No security groups associated with the load balancer.
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * The type of IP addresses to use
   *
   * If you want to add a UDP or TCP_UDP listener to the load balancer,
   * you must choose IPv4.
   *
   * @default IpAddressType.IPV4
   */
  readonly ipAddressType?: IpAddressType;

  /**
   * The AZ affinity routing policy
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/network/network-load-balancers.html#zonal-dns-affinity
   *
   * @default - AZ affinity is disabled.
   */
  readonly clientRoutingPolicy?: ClientRoutingPolicy;

  /**
   * Indicates whether to evaluate inbound security group rules for traffic sent to a Network Load Balancer through AWS PrivateLink.
   *
   * @default true
   */
  readonly enforceSecurityGroupInboundRulesOnPrivateLinkTraffic?: boolean;

  /**
   * Indicates whether zonal shift is enabled
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/network/zonal-shift.html
   *
   * @default false
   */
  readonly zonalShift?: boolean;

  // TODO: Missing in provider-aws
  // https://github.com/hashicorp/terraform-provider-aws/issues/40379
  // /**
  //  * Indicates whether to use an IPv6 prefix from each subnet for source NAT.
  //  *
  //  * The IP address type must be IpAddressType.DUALSTACK.
  //  *
  //  * @default undefined - NLB default behavior is false
  //  */
  // readonly enablePrefixForIpv6SourceNat?: boolean;
}

/**
 * Properties to reference an existing load balancer
 */
export interface NetworkLoadBalancerAttributes {
  /**
   * ARN of the load balancer
   */
  readonly loadBalancerArn: string;

  /**
   * The canonical hosted zone ID of this load balancer
   *
   * @default - Token via data source from loadBalancerArn.
   */
  readonly loadBalancerCanonicalHostedZoneId?: string;

  /**
   * The DNS name of this load balancer
   *
   * @default - Token via data source from loadBalancerArn.
   */
  readonly loadBalancerDnsName?: string;

  /**
   * The VPC to associate with the load balancer.
   *
   * @default - When not provided, listeners cannot be created on imported load
   * balancers.
   */
  readonly vpc?: IVpc;

  /**
   * Security groups to associate with this load balancer
   *
   * @default - No security groups associated with the load balancer.
   */
  readonly loadBalancerSecurityGroups?: string[];
}

/**
 * Options for looking up an NetworkLoadBalancer
 */
export interface NetworkLoadBalancerLookupOptions
  extends BaseLoadBalancerLookupOptions {}

/**
 * The metrics for a network load balancer.
 */
class NetworkLoadBalancerMetrics implements INetworkLoadBalancerMetrics {
  private readonly loadBalancerFullName: string;
  private readonly scope: Construct;

  constructor(scope: Construct, loadBalancerFullName: string) {
    this.scope = scope;
    this.loadBalancerFullName = loadBalancerFullName;
  }

  public custom(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/NetworkELB",
      metricName,
      dimensionsMap: { LoadBalancer: this.loadBalancerFullName },
      ...props,
    }).attachTo(this.scope);
  }

  public activeFlowCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.activeFlowCountAverage, props);
  }

  public consumedLCUs(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.consumedLcUsAverage, {
      statistic: "Sum",
      ...props,
    });
  }

  public newFlowCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.newFlowCountSum, props);
  }

  public processedBytes(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.processedBytesSum, props);
  }

  public tcpClientResetCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.tcpClientResetCountSum, props);
  }
  public tcpElbResetCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.tcpElbResetCountSum, props);
  }
  public tcpTargetResetCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(NetworkELBMetrics.tcpTargetResetCountSum, props);
  }

  private cannedMetric(
    fn: (dims: { LoadBalancer: string }) => cloudwatch.MetricProps,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...fn({ LoadBalancer: this.loadBalancerFullName }),
      ...props,
    }).attachTo(this.scope);
  }
}

/**
 * Define a new network load balancer
 *
 * @resource AWS::ElasticLoadBalancingV2::LoadBalancer
 */
export class NetworkLoadBalancer
  extends BaseLoadBalancer
  implements INetworkLoadBalancer
{
  // TODO: Add Grid lookup support
  // /**
  //  * Looks up the network load balancer.
  //  */
  // public static fromLookup(
  //   scope: Construct,
  //   id: string,
  //   options: NetworkLoadBalancerLookupOptions,
  // ): INetworkLoadBalancer {
  //   const props = BaseLoadBalancer._queryContextProvider(scope, {
  //     userOptions: options,
  //     loadBalancerType: LoadBalancerType.NETWORK,
  //   });

  //   return new LookedUpNetworkLoadBalancer(scope, id, props);
  // }

  public static fromNetworkLoadBalancerAttributes(
    scope: Construct,
    id: string,
    attrs: NetworkLoadBalancerAttributes,
  ): INetworkLoadBalancer {
    class Import extends AwsConstructBase implements INetworkLoadBalancer {
      public readonly connections: Connections = new Connections({
        securityGroups: attrs.loadBalancerSecurityGroups?.map(
          (securityGroupId, index) =>
            SecurityGroup.fromSecurityGroupId(
              this,
              `SecurityGroup-${index}`,
              securityGroupId,
            ),
        ),
      });
      public readonly loadBalancerArn = attrs.loadBalancerArn;
      public readonly vpc?: IVpc = attrs.vpc;
      public readonly metrics: INetworkLoadBalancerMetrics =
        new NetworkLoadBalancerMetrics(
          this,
          parseLoadBalancerFullName(attrs.loadBalancerArn),
        );
      public readonly securityGroups?: string[] =
        attrs.loadBalancerSecurityGroups;

      public readonly resource: dataAwsLb.DataAwsLb;
      constructor(props: AwsConstructProps) {
        super(scope, id, props);
        this.resource = new dataAwsLb.DataAwsLb(this, "Resource", {
          arn: attrs.loadBalancerArn,
        });
      }

      public addListener(
        lid: string,
        props: BaseNetworkListenerProps,
      ): NetworkListener {
        return new NetworkListener(this, lid, {
          loadBalancer: this,
          ...props,
        });
      }

      public get loadBalancerCanonicalHostedZoneId(): string {
        if (attrs.loadBalancerCanonicalHostedZoneId) {
          return attrs.loadBalancerCanonicalHostedZoneId;
        }
        return this.resource.zoneId;
        // // eslint-disable-next-line max-len
        // throw new Error(
        //   `'loadBalancerCanonicalHostedZoneId' was not provided when constructing Network Load Balancer ${this.node.path} from attributes`,
        // );
      }

      public get loadBalancerDnsName(): string {
        if (attrs.loadBalancerDnsName) {
          return attrs.loadBalancerDnsName;
        }
        return this.resource.dnsName;
        // // eslint-disable-next-line max-len
        // throw new Error(
        //   `'loadBalancerDnsName' was not provided when constructing Network Load Balancer ${this.node.path} from attributes`,
        // );
      }

      public get loadBalancerV2Outputs(): LoadBalancerV2Outputs {
        return {
          loadBalancerCanonicalHostedZoneId:
            this.loadBalancerCanonicalHostedZoneId,
          loadBalancerDnsName: this.loadBalancerDnsName,
        };
      }
      public get outputs(): Record<string, any> {
        return this.loadBalancerV2Outputs;
      }
    }

    return new Import({ environmentFromArn: attrs.loadBalancerArn });
  }

  public readonly metrics: INetworkLoadBalancerMetrics;
  public readonly ipAddressType?: IpAddressType;
  public readonly connections: Connections;
  private readonly isSecurityGroupsPropertyDefined: boolean;
  private readonly _enforceSecurityGroupInboundRulesOnPrivateLinkTraffic?: boolean;
  // TODO: Missing in provider-aws
  // https://github.com/hashicorp/terraform-provider-aws/issues/40379
  // private enablePrefixForIpv6SourceNat?: boolean;

  /**
   * After the implementation of `IConnectable` (see https://github.com/aws/aws-cdk/pull/28494), the default
   * value for `securityGroups` is set by the `Connections` constructor to an empty array.
   * To keep backward compatibility (`securityGroups` is `undefined` if the related property is not specified)
   * a getter has been added.
   */
  public get securityGroups(): string[] | undefined {
    return this.isSecurityGroupsPropertyDefined ||
      this.connections.securityGroups.length
      ? this.connections.securityGroups.map((sg) => sg.securityGroupId)
      : undefined;
  }

  constructor(scope: Construct, id: string, props: NetworkLoadBalancerProps) {
    super(scope, id, props, {
      loadBalancerType: "network",
      securityGroups: Lazy.listValue({ produce: () => this.securityGroups }),
      ipAddressType: props.ipAddressType,
      enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: Lazy.stringValue({
        produce: () =>
          this.enforceSecurityGroupInboundRulesOnPrivateLinkTraffic,
      }),
      // TODO: Missing in provider-aws
      // https://github.com/hashicorp/terraform-provider-aws/issues/40379
      // enablePrefixForIpv6SourceNat:
      //   props.enablePrefixForIpv6SourceNat === true
      //     ? "on"
      //     : props.enablePrefixForIpv6SourceNat === false
      //       ? "off"
      //       : undefined,
    });

    // this.enablePrefixForIpv6SourceNat = props.enablePrefixForIpv6SourceNat;
    this.metrics = new NetworkLoadBalancerMetrics(
      this,
      this.loadBalancerFullName,
    );
    this.isSecurityGroupsPropertyDefined = !!props.securityGroups;
    this.connections = new Connections({
      securityGroups: props.securityGroups,
    });
    this.ipAddressType = props.ipAddressType ?? IpAddressType.IPV4;
    if (props.clientRoutingPolicy) {
      this.setAttribute(
        "dns_record.client_routing_policy",
        props.clientRoutingPolicy,
      );
    }
    if (props.zonalShift !== undefined) {
      this.setAttribute(
        "zonal_shift.config.enabled",
        props.zonalShift ? "true" : "false",
      );
    }
    this._enforceSecurityGroupInboundRulesOnPrivateLinkTraffic =
      props.enforceSecurityGroupInboundRulesOnPrivateLinkTraffic;
  }

  public get enforceSecurityGroupInboundRulesOnPrivateLinkTraffic():
    | string
    | undefined {
    if (
      this._enforceSecurityGroupInboundRulesOnPrivateLinkTraffic === undefined
    )
      return undefined;
    return this._enforceSecurityGroupInboundRulesOnPrivateLinkTraffic
      ? "on"
      : "off";
  }

  /**
   * Add a listener to this load balancer
   *
   * @returns The newly created listener
   */
  public addListener(
    id: string,
    props: BaseNetworkListenerProps,
  ): NetworkListener {
    // UDP listener with dual stack NLB requires prefix IPv6 source NAT to be enabled
    if (
      (props.protocol === LbProtocol.UDP ||
        props.protocol === LbProtocol.TCP_UDP) &&
      (this.ipAddressType === IpAddressType.DUAL_STACK ||
        this.ipAddressType === IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4) // &&
      // this.enablePrefixForIpv6SourceNat !== true
    ) {
      throw new Error(
        "To add a listener with UDP protocol to a dual stack NLB, missing in terraform see: https://github.com/hashicorp/terraform-provider-aws/issues/40379.",
      );
      // throw new Error(
      //   "To add a listener with UDP protocol to a dual stack NLB, 'enablePrefixForIpv6SourceNat' must be set to true.",
      // );
    }
    return new NetworkListener(this, id, {
      loadBalancer: this,
      ...props,
    });
  }

  /**
   * Add a security group to this load balancer
   */
  public addSecurityGroup(securityGroup: ISecurityGroup) {
    this.connections.addSecurityGroup(securityGroup);
  }

  /**
   * Return the given named metric for this Network Load Balancer
   *
   * @default Average over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.custom`` instead
   */
  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/NetworkELB",
      metricName,
      dimensionsMap: { LoadBalancer: this.loadBalancerFullName },
      ...props,
    }).attachTo(this);
  }

  /**
   * The total number of concurrent TCP flows (or connections) from clients to targets.
   *
   * This metric includes connections in the SYN_SENT and ESTABLISHED states.
   * TCP connections are not terminated at the load balancer, so a client
   * opening a TCP connection to a target counts as a single flow.
   *
   * @default Average over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.activeFlowCount`` instead
   */
  public metricActiveFlowCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.activeFlowCount(props);
  }

  /**
   * The number of load balancer capacity units (LCU) used by your load balancer.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.activeFlowCount`` instead
   */
  public metricConsumedLCUs(props?: cloudwatch.MetricOptions) {
    return this.metrics.consumedLCUs(props);
  }

  /**
   * The number of targets that are considered healthy.
   *
   * @default Average over 5 minutes
   * @deprecated use ``NetworkTargetGroup.metricHealthyHostCount`` instead
   */
  public metricHealthyHostCount(props?: cloudwatch.MetricOptions) {
    return this.metric("HealthyHostCount", {
      statistic: "Average",
      ...props,
    });
  }

  /**
   * The number of targets that are considered unhealthy.
   *
   * @default Average over 5 minutes
   * @deprecated use ``NetworkTargetGroup.metricUnHealthyHostCount`` instead
   */
  public metricUnHealthyHostCount(props?: cloudwatch.MetricOptions) {
    return this.metric("UnHealthyHostCount", {
      statistic: "Average",
      ...props,
    });
  }

  /**
   * The total number of new TCP flows (or connections) established from clients to targets in the time period.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.newFlowCount`` instead
   */
  public metricNewFlowCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.newFlowCount(props);
  }

  /**
   * The total number of bytes processed by the load balancer, including TCP/IP headers.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.processedBytes`` instead
   */
  public metricProcessedBytes(props?: cloudwatch.MetricOptions) {
    return this.metrics.processedBytes(props);
  }

  /**
   * The total number of reset (RST) packets sent from a client to a target.
   *
   * These resets are generated by the client and forwarded by the load balancer.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.tcpClientResetCount`` instead
   */
  public metricTcpClientResetCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.tcpClientResetCount(props);
  }

  /**
   * The total number of reset (RST) packets generated by the load balancer.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.tcpElbResetCount`` instead
   */
  public metricTcpElbResetCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.tcpElbResetCount(props);
  }

  /**
   * The total number of reset (RST) packets sent from a target to a client.
   *
   * These resets are generated by the target and forwarded by the load balancer.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``NetworkLoadBalancer.metrics.tcpTargetResetCount`` instead
   */
  public metricTcpTargetResetCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.tcpTargetResetCount(props);
  }
}

/**
 * Contains all metrics for a Network Load Balancer.
 */
export interface INetworkLoadBalancerMetrics {
  /**
   * Return the given named metric for this Network Load Balancer
   *
   * @default Average over 5 minutes
   */
  custom(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The total number of concurrent TCP flows (or connections) from clients to targets.
   *
   * This metric includes connections in the SYN_SENT and ESTABLISHED states.
   * TCP connections are not terminated at the load balancer, so a client
   * opening a TCP connection to a target counts as a single flow.
   *
   * @default Average over 5 minutes
   */
  activeFlowCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of load balancer capacity units (LCU) used by your load balancer.
   *
   * @default Sum over 5 minutes
   */
  consumedLCUs(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The total number of new TCP flows (or connections) established from clients to targets in the time period.
   *
   * @default Sum over 5 minutes
   */
  newFlowCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The total number of bytes processed by the load balancer, including TCP/IP headers.
   *
   * @default Sum over 5 minutes
   */
  processedBytes(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The total number of reset (RST) packets sent from a client to a target.
   *
   * These resets are generated by the client and forwarded by the load balancer.
   *
   * @default Sum over 5 minutes
   */
  tcpClientResetCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The total number of reset (RST) packets generated by the load balancer.
   *
   * @default Sum over 5 minutes
   */
  tcpElbResetCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The total number of reset (RST) packets sent from a target to a client.
   *
   * These resets are generated by the target and forwarded by the load balancer.
   *
   * @default Sum over 5 minutes
   */
  tcpTargetResetCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
}

/**
 * A network load balancer
 */
export interface INetworkLoadBalancer
  extends ILoadBalancerV2,
    IVpcEndpointServiceLoadBalancer,
    IConnectable {
  /**
   * The VPC this load balancer has been created in (if available)
   */
  readonly vpc?: IVpc;

  /**
   * All metrics available for this load balancer
   */
  readonly metrics: INetworkLoadBalancerMetrics;

  /**
   * Security groups associated with this load balancer
   */
  readonly securityGroups?: string[];

  /**
   * The type of IP addresses to use
   *
   * @default IpAddressType.IPV4
   */
  readonly ipAddressType?: IpAddressType;

  /**
   * Indicates whether to evaluate inbound security group rules for traffic sent to a Network Load Balancer through AWS PrivateLink
   *
   * @default on
   */
  readonly enforceSecurityGroupInboundRulesOnPrivateLinkTraffic?: string;

  /**
   * Add a listener to this load balancer
   *
   * @returns The newly created listener
   */
  addListener(id: string, props: BaseNetworkListenerProps): NetworkListener;
}

// TODO: Add Grid Lookup support
// class LookedUpNetworkLoadBalancer
//   extends AwsConstructBase
//   implements INetworkLoadBalancer
// {
//   public readonly loadBalancerCanonicalHostedZoneId: string;
//   public readonly loadBalancerDnsName: string;
//   public readonly loadBalancerArn: string;
//   public readonly vpc?: IVpc;
//   public readonly metrics: INetworkLoadBalancerMetrics;
//   public readonly securityGroups?: string[];
//   public readonly ipAddressType?: IpAddressType;
//   public readonly connections: Connections;

//   constructor(
//     scope: Construct,
//     id: string,
//     props: cxapi.LoadBalancerContextResponse,
//   ) {
//     super(scope, id, { environmentFromArn: props.loadBalancerArn });

//     this.loadBalancerArn = props.loadBalancerArn;
//     this.loadBalancerCanonicalHostedZoneId =
//       props.loadBalancerCanonicalHostedZoneId;
//     this.loadBalancerDnsName = props.loadBalancerDnsName;
//     this.metrics = new NetworkLoadBalancerMetrics(
//       this,
//       parseLoadBalancerFullName(props.loadBalancerArn),
//     );
//     this.securityGroups = props.securityGroupIds;
//     this.connections = new Connections({
//       securityGroups: props.securityGroupIds.map((securityGroupId, index) =>
//         SecurityGroup.fromLookupById(
//           this,
//           `SecurityGroup-${index}`,
//           securityGroupId,
//         ),
//       ),
//     });

//     if (props.ipAddressType === cxapi.LoadBalancerIpAddressType.IPV4) {
//       this.ipAddressType = IpAddressType.IPV4;
//     } else if (
//       props.ipAddressType === cxapi.LoadBalancerIpAddressType.DUAL_STACK
//     ) {
//       this.ipAddressType = IpAddressType.DUAL_STACK;
//     }

//     this.vpc = Vpc.fromLookup(this, "Vpc", {
//       vpcId: props.vpcId,
//     });
//   }

//   public addListener(
//     lid: string,
//     props: BaseNetworkListenerProps,
//   ): NetworkListener {
//     return new NetworkListener(this, lid, {
//       loadBalancer: this,
//       ...props,
//     });
//   }
// }
