// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/vpn.ts

import * as net from "node:net";
import {
  customerGateway,
  vpnConnection,
  vpnConnectionRoute,
  vpnGateway,
} from "@cdktf/provider-aws";
import {
  //SecretValue,
  Token,
} from "cdktf";
import { Construct } from "constructs";
import { IVpc, SubnetSelection } from "./vpc";
import { Duration } from "../../duration";
import { IAwsConstruct, AwsConstructBase } from "../aws-construct";
import * as cloudwatch from "../cloudwatch";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface VpnConnectionOutputs {
  /**
   * The id of the VPN connection.
   * @attribute VpnConnectionId
   */
  readonly vpnId: string;

  /**
   * The id of the customer gateway.
   */
  readonly customerGatewayId: string;

  /**
   * The ip address of the customer gateway.
   */
  readonly customerGatewayIp: string;

  /**
   * The ASN of the customer gateway.
   */
  readonly customerGatewayAsn: number;
}

export interface IVpnConnection extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly vpnConnectionOutputs: VpnConnectionOutputs;
  /**
   * The id of the VPN connection.
   * @attribute VpnConnectionId
   */
  readonly vpnId: string;

  /**
   * The id of the customer gateway.
   */
  readonly customerGatewayId: string;

  /**
   * The ip address of the customer gateway.
   */
  readonly customerGatewayIp: string;

  /**
   * The ASN of the customer gateway.
   */
  readonly customerGatewayAsn: number;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface VpnGatewayOutputs {
  /**
   * The virtual private gateway Id
   * @attribute VpnGatewayId
   */
  readonly gatewayId: string;
}

/**
 * The virtual private gateway interface
 */
export interface IVpnGateway extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly vpnGatewayOutputs: VpnGatewayOutputs;
  /**
   * The virtual private gateway Id
   */
  readonly gatewayId: string;
}

export interface VpnTunnelOption {
  /**
   * The pre-shared key (PSK) to establish initial authentication between the
   * virtual private gateway and customer gateway. Allowed characters are
   * alphanumeric characters period `.` and underscores `_`. Must be between 8
   * and 64 characters in length and cannot start with zero (0).
   *
   * @default an Amazon generated pre-shared key
   */
  readonly preSharedKey?: string;

  // TODO: Adopt SecretValue pattern from AWSCDK

  // /**
  //  * The pre-shared key (PSK) to establish initial authentication between the
  //  * virtual private gateway and customer gateway. Allowed characters are
  //  * alphanumeric characters period `.` and underscores `_`. Must be between 8
  //  * and 64 characters in length and cannot start with zero (0).
  //  *
  //  * @default an Amazon generated pre-shared key
  //  */
  // readonly preSharedKeySecret?: SecretValue;

  /**
   * The range of inside IP addresses for the tunnel. Any specified CIDR blocks must be
   * unique across all VPN connections that use the same virtual private gateway.
   * A size /30 CIDR block from the 169.254.0.0/16 range.
   *
   * @default an Amazon generated inside IP CIDR
   */
  readonly tunnelInsideCidr?: string;

  /**
   * The IKE versions for the tunnel
   */
  readonly ikeVersions?: IkeVersion[];

  /**
   * The DPD timeout action for the tunnel
   */
  readonly dpdTimeoutAction?: DpdTimeoutAction;

  /**
   * The DPD timeout
   */
  readonly dpdTimeout?: Duration;

  /**
   * Enable tunnel lifecycle control
   */
  readonly enableTunnelLifecycleControl?: boolean;

  /**
   * The phase 1 DH group numbers
   */
  readonly phase1DhGroupNumbers?: Phase1DhGroupNumber[];

  /**
   * The phase 1 encryption algorithms
   */
  readonly phase1EncryptionAlgorithms?: EncryptionAlgorithm[];

  /**
   * The phase 1 integrity algorithms
   */
  readonly phase1IntegrityAlgorithms?: IntegrityAlgorithm[];

  /**
   * The phase 1 lifetime
   */
  readonly phase1Lifetime?: Duration;

  /**
   * The phase 2 DH group numbers
   */
  readonly phase2DhGroupNumbers?: Phase2DhGroupNumber[];

  /**
   * The phase 2 encryption algorithms
   */
  readonly phase2EncryptionAlgorithms?: EncryptionAlgorithm[];

  /**
   * The phase 2 integrity algorithms
   */
  readonly phase2IntegrityAlgorithms?: IntegrityAlgorithm[];

  /**
   * The phase 2 lifetime in seconds
   */
  readonly phase2Lifetime?: Duration;

  /**
   * The percentage of the rekey window during which the rekey time is randomly selected
   * @default 100
   * @minimum 0
   * @maximum 100
   */
  readonly rekeyFuzzPercentage?: number;

  /**
   * The margin time before phase 2 lifetime expires for IKE rekey
   * @default 540
   * @minimum 60
   * @remarks Must be between 60 and half of phase2LifetimeSeconds
   */
  readonly rekeyMarginTime?: Duration;

  /**
   * The number of packets in an IKE replay window
   * @default 1024
   * @minimum 64
   * @maximum 2048
   */
  readonly replayWindowSize?: number;

  /**
   * The action to take when the establishing the tunnel for the second VPN connection.
   *
   * By default, your customer gateway device must initiate the IKE negotiation and bring up the tunnel.
   * Specify `start` for AWS to initiate the IKE negotiation.
   */
  readonly startupAction?: TunnelStartupAction;
}

export interface VpnConnectionOptions {
  /**
   * The ip address of the customer gateway.
   */
  readonly ip: string;

  /**
   * The ASN of the customer gateway.
   *
   * @default 65000
   */
  readonly asn?: number;

  /**
   * The static routes to be routed from the VPN gateway to the customer gateway.
   *
   * @default Dynamic routing (BGP)
   */
  readonly staticRoutes?: string[];

  /**
   * The tunnel options for the VPN connection. At most two elements (one per tunnel).
   * Duplicates not allowed.
   *
   * @default Amazon generated tunnel options
   */
  readonly tunnelOptions?: VpnTunnelOption[];
}

/**
 * The VpnGateway Properties
 */
export interface VpnGatewayProps {
  /**
   * Default type ipsec.1
   *
   * This is ignored by Terraform Provider AWS
   *
   * @see https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/internet_gateway_attachment#argument-reference
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-vpngateway.html#cfn-ec2-vpngateway-type
   */
  readonly type: string;

  /**
   * Explicitly specify an Asn or let aws pick an Asn for you.
   * @default 65000
   */
  readonly amazonSideAsn?: number;
}

/**
 * Options for the Vpc.enableVpnGateway() method
 */
export interface EnableVpnGatewayOptions extends VpnGatewayProps {
  /**
   * Provide an array of subnets where the route propagation should be added.
   * @default noPropagation
   */
  readonly vpnRoutePropagation?: SubnetSelection[];
}

export interface VpnConnectionProps extends VpnConnectionOptions {
  /**
   * The VPC to connect to.
   */
  readonly vpc: IVpc;
}

/**
 * The VPN connection type.
 */
export enum VpnConnectionType {
  // NOTE: Terraform Provider AWS does not have a VpnConnection.Type field ...
  // But the Customer Gateway Does
  // @see https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/customer_gateway#type-1
  /**
   * The IPsec 1 VPN connection type.
   */
  IPSEC_1 = "ipsec.1",

  /**
   * Dummy member
   * TODO: remove once https://github.com/aws/jsii/issues/231 is fixed
   */
  DUMMY = "dummy",
}

/**
 * The VPN Gateway that shall be added to the VPC
 *
 * @resource aws_vpn_gateway
 */
export class VpnGateway extends AwsConstructBase implements IVpnGateway {
  /**
   * The virtual private gateway Id
   */
  public readonly gatewayId: string;
  public get vpnGatewayOutputs(): VpnGatewayOutputs {
    return {
      gatewayId: this.gatewayId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.vpnGatewayOutputs;
  }

  constructor(scope: Construct, id: string, props: VpnGatewayProps) {
    super(scope, id);

    // This is 'Default' instead of 'Resource', because using 'Default' will generate
    // a logical ID for a VpnGateway which is exactly the same as the logical ID that used
    // to be created for the CfnVPNGateway (and 'Resource' would not do that).
    const vpnGW = new vpnGateway.VpnGateway(this, "Default", {
      amazonSideAsn:
        props.amazonSideAsn !== undefined
          ? props.amazonSideAsn.toString()
          : undefined,
    });
    this.gatewayId = vpnGW.id;
  }
}

/**
 * Attributes of an imported VpnConnection.
 */
export interface VpnConnectionAttributes {
  /**
   * The id of the VPN connection.
   */
  readonly vpnId: string;

  /**
   * The id of the customer gateway.
   */
  readonly customerGatewayId: string;

  /**
   * The ip address of the customer gateway.
   */
  readonly customerGatewayIp: string;

  /**
   * The ASN of the customer gateway.
   */
  readonly customerGatewayAsn: number;
}

/**
 * Base class for Vpn connections.
 */
export abstract class VpnConnectionBase
  extends AwsConstructBase
  implements IVpnConnection
{
  public abstract readonly vpnId: string;
  public abstract readonly customerGatewayId: string;
  public abstract readonly customerGatewayIp: string;
  public abstract readonly customerGatewayAsn: number;
  public get vpnConnectionOutputs(): VpnConnectionOutputs {
    return {
      vpnId: this.vpnId,
      customerGatewayId: this.customerGatewayId,
      customerGatewayIp: this.customerGatewayIp,
      customerGatewayAsn: this.customerGatewayAsn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.vpnConnectionOutputs;
  }
}

/**
 * Define a VPN Connection
 *
 * @resource AWS::EC2::VPNConnection
 */
export class VpnConnection extends VpnConnectionBase {
  /**
   * Import a VPN connection by supplying all attributes directly
   */
  public static fromVpnConnectionAttributes(
    scope: Construct,
    id: string,
    attrs: VpnConnectionAttributes,
  ): IVpnConnection {
    class Import extends VpnConnectionBase {
      public readonly vpnId: string = attrs.vpnId;
      public readonly customerGatewayId: string = attrs.customerGatewayId;
      public readonly customerGatewayIp: string = attrs.customerGatewayIp;
      public readonly customerGatewayAsn: number = attrs.customerGatewayAsn;
    }

    return new Import(scope, id);
  }

  /**
   * Return the given named metric for all VPN connections in the account/region.
   */
  public static metricAll(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/VPN",
      metricName,
      ...props,
    });
  }

  /**
   * Metric for the tunnel state of all VPN connections in the account/region.
   *
   * @default average over 5 minutes
   */
  public static metricAllTunnelState(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.metricAll("TunnelState", { statistic: "avg", ...props });
  }

  /**
   * Metric for the tunnel data in of all VPN connections in the account/region.
   *
   * @default sum over 5 minutes
   */
  public static metricAllTunnelDataIn(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.metricAll("TunnelDataIn", { statistic: "sum", ...props });
  }

  /**
   * Metric for the tunnel data out of all VPN connections.
   *
   * @default sum over 5 minutes
   */
  public static metricAllTunnelDataOut(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.metricAll("TunnelDataOut", { statistic: "sum", ...props });
  }

  public readonly vpnId: string;
  public readonly customerGatewayId: string;
  public readonly customerGatewayIp: string;
  public readonly customerGatewayAsn: number;

  constructor(scope: Construct, id: string, props: VpnConnectionProps) {
    super(scope, id);

    if (!props.vpc.vpnGatewayId) {
      props.vpc.enableVpnGateway({
        type: "ipsec.1",
        amazonSideAsn: props.asn,
      });
    }

    if (!Token.isUnresolved(props.ip) && !net.isIPv4(props.ip)) {
      throw new Error(`The \`ip\` ${props.ip} is not a valid IPv4 address.`);
    }

    const type = VpnConnectionType.IPSEC_1;
    const bgpAsn = props.asn || 65000;

    const customerGw = new customerGateway.CustomerGateway(
      this,
      "CustomerGateway",
      {
        bgpAsn: bgpAsn.toString(),
        ipAddress: props.ip,
        type,
      },
    );

    this.customerGatewayId = customerGw.id;
    this.customerGatewayAsn = bgpAsn;
    this.customerGatewayIp = props.ip;

    const vpnTunnelOptionsSpecifications: Record<string, any> = {};
    // Validate tunnel options
    if (props.tunnelOptions) {
      if (props.tunnelOptions.length > 2) {
        throw new Error("Cannot specify more than two `tunnelOptions`");
      }

      if (
        props.tunnelOptions.length === 2 &&
        props.tunnelOptions[0].tunnelInsideCidr ===
          props.tunnelOptions[1].tunnelInsideCidr &&
        props.tunnelOptions[0].tunnelInsideCidr !== undefined
      ) {
        throw new Error(
          `Same ${props.tunnelOptions[0].tunnelInsideCidr} \`tunnelInsideCidr\` cannot be used for both tunnels.`,
        );
      }

      props.tunnelOptions.forEach((options, index) => {
        // if (options.preSharedKey && options.preSharedKeySecret) {
        //   throw new Error(
        //     "Specify at most one of 'preSharedKey' and 'preSharedKeySecret'.",
        //   );
        // }

        if (
          options.preSharedKey &&
          !Token.isUnresolved(options.preSharedKey) &&
          !/^[a-zA-Z1-9._][a-zA-Z\d._]{7,63}$/.test(options.preSharedKey)
        ) {
          /* eslint-disable max-len */
          throw new Error(
            `The \`preSharedKey\` ${options.preSharedKey} for tunnel ${index + 1} is invalid. Allowed characters are alphanumeric characters and ._. Must be between 8 and 64 characters in length and cannot start with zero (0).`,
          );
          /* eslint-enable max-len */
        }

        if (options.tunnelInsideCidr) {
          if (RESERVED_TUNNEL_INSIDE_CIDR.includes(options.tunnelInsideCidr)) {
            throw new Error(
              `The \`tunnelInsideCidr\` ${options.tunnelInsideCidr} for tunnel ${index + 1} is a reserved inside CIDR.`,
            );
          }

          if (
            !/^169\.254\.\d{1,3}\.\d{1,3}\/30$/.test(options.tunnelInsideCidr)
          ) {
            /* eslint-disable-next-line max-len */
            throw new Error(
              `The \`tunnelInsideCidr\` ${options.tunnelInsideCidr} for tunnel ${index + 1} is not a size /30 CIDR block from the 169.254.0.0/16 range.`,
            );
          }

          // Validate rekeyFuzzPercentage
          if (options.rekeyFuzzPercentage !== undefined) {
            if (
              options.rekeyFuzzPercentage < 0 ||
              options.rekeyFuzzPercentage > 100
            ) {
              throw new Error(
                `rekeyFuzzPercentage for tunnel ${index + 1} must be between 0 and 100`,
              );
            }
          }

          // Validate rekeyMarginTimeSeconds
          if (options.rekeyMarginTime !== undefined) {
            if (options.rekeyMarginTime.toSeconds() < 60) {
              throw new Error(
                `rekeyMarginTime for tunnel ${index + 1} must be at least 60 seconds`,
              );
            }

            // Check if it's less than half of phase2LifetimeSeconds
            const phase2Lifetime = options.phase2Lifetime || Duration.hours(1);
            if (
              options.rekeyMarginTime.toSeconds() >
              phase2Lifetime.toSeconds() / 2
            ) {
              throw new Error(
                `rekeyMarginTime for tunnel ${index + 1} must be less than half of phase2Lifetime (${phase2Lifetime.toSeconds() / 2})`,
              );
            }
          }

          // Validate replayWindowSize
          if (options.replayWindowSize !== undefined) {
            if (
              options.replayWindowSize < 64 ||
              options.replayWindowSize > 2048
            ) {
              throw new Error(
                `replayWindowSize for tunnel ${index + 1} must be between 64 and 2048`,
              );
            }
          }
        }

        // Map tunnel options to AWS provider format
        const tunnelPrefix = `tunnel${index + 1}`;
        Object.assign(vpnTunnelOptionsSpecifications, {
          [`${tunnelPrefix}PresharedKey`]: options.preSharedKey,
          [`${tunnelPrefix}InsideCidr`]: options.tunnelInsideCidr,
          [`${tunnelPrefix}DpdTimeoutAction`]: options.dpdTimeoutAction,
          [`${tunnelPrefix}DpdTimeoutSeconds`]: options.dpdTimeout?.toSeconds(),
          [`${tunnelPrefix}EnableTunnelLifecycleControl`]:
            options.enableTunnelLifecycleControl,
          [`${tunnelPrefix}IkeVersions`]: options.ikeVersions,
          [`${tunnelPrefix}Phase1DhGroupNumbers`]: options.phase1DhGroupNumbers,
          [`${tunnelPrefix}Phase1EncryptionAlgorithms`]:
            options.phase1EncryptionAlgorithms,
          [`${tunnelPrefix}Phase1IntegrityAlgorithms`]:
            options.phase1IntegrityAlgorithms,
          [`${tunnelPrefix}Phase1LifetimeSeconds`]:
            options.phase1Lifetime?.toSeconds(),
          [`${tunnelPrefix}Phase2DhGroupNumbers`]: options.phase2DhGroupNumbers,
          [`${tunnelPrefix}Phase2EncryptionAlgorithms`]:
            options.phase2EncryptionAlgorithms,
          [`${tunnelPrefix}Phase2IntegrityAlgorithms`]:
            options.phase2IntegrityAlgorithms,
          [`${tunnelPrefix}Phase2LifetimeSeconds`]:
            options.phase2Lifetime?.toSeconds(),
          [`${tunnelPrefix}StartupAction`]: options.startupAction,
          [`${tunnelPrefix}RekeyFuzzPercentage`]: options.rekeyFuzzPercentage,
          [`${tunnelPrefix}RekeyMarginTimeSeconds`]:
            options.rekeyMarginTime?.toSeconds(),
          [`${tunnelPrefix}ReplayWindowSize`]: options.replayWindowSize,
        });
      });
    }

    const resource = new vpnConnection.VpnConnection(this, "Resource", {
      type,
      customerGatewayId: customerGw.id,
      staticRoutesOnly: props.staticRoutes ? true : false,
      vpnGatewayId: props.vpc.vpnGatewayId,
      ...vpnTunnelOptionsSpecifications,
    });

    this.vpnId = resource.id;

    if (props.staticRoutes) {
      props.staticRoutes.forEach((route) => {
        new vpnConnectionRoute.VpnConnectionRoute(
          this,
          `Route${route.replace(/[^\d]/g, "")}`,
          {
            destinationCidrBlock: route,
            vpnConnectionId: this.vpnId,
          },
        );
      });
    }
  }
}

export const RESERVED_TUNNEL_INSIDE_CIDR = [
  "169.254.0.0/30",
  "169.254.1.0/30",
  "169.254.2.0/30",
  "169.254.3.0/30",
  "169.254.4.0/30",
  "169.254.5.0/30",
  "169.254.169.252/30",
];

/**
 * Action to take after DPD timeout occurs
 */
export enum DpdTimeoutAction {
  /**
   * End the IKE session
   */
  CLEAR = "clear",

  /**
   * Take no action
   */
  NONE = "none",

  /**
   * Restart the IKE initiation
   */
  RESTART = "restart",
}

/**
 * IKE versions permitted for VPN tunnels
 */
export enum IkeVersion {
  /**
   * IKE version 1
   */
  IKEV1 = "ikev1",

  /**
   * IKE version 2
   */
  IKEV2 = "ikev2",
}

/**
 * Phase 1 and 2 encryption algorithms
 */
export enum EncryptionAlgorithm {
  /**
   * AES with 128-bit key
   */
  AES128 = "AES128",

  /**
   * AES with 256-bit key
   */
  AES256 = "AES256",

  /**
   * AES-GCM with 128-bit key and 16 byte integrity check
   */
  AES128_GCM_16 = "AES128-GCM-16",

  /**
   * AES-GCM with 256-bit key and 16 byte integrity check
   */
  AES256_GCM_16 = "AES256-GCM-16",
}

/**
 * Phase 1 and 2 integrity algorithms
 */
export enum IntegrityAlgorithm {
  /**
   * SHA-1 hash algorithm
   */
  SHA1 = "SHA1",

  /**
   * SHA-2 with 256-bit digest
   */
  SHA2_256 = "SHA2-256",

  /**
   * SHA-2 with 384-bit digest
   */
  SHA2_384 = "SHA2-384",

  /**
   * SHA-2 with 512-bit digest
   */
  SHA2_512 = "SHA2-512",
}

/**
 * Phase 1 Diffie-Hellman group numbers
 */
export enum Phase1DhGroupNumber {
  GROUP_2 = 2,
  GROUP_14 = 14,
  GROUP_15 = 15,
  GROUP_16 = 16,
  GROUP_17 = 17,
  GROUP_18 = 18,
  GROUP_19 = 19,
  GROUP_20 = 20,
  GROUP_21 = 21,
  GROUP_22 = 22,
  GROUP_23 = 23,
  GROUP_24 = 24,
}

/**
 * Phase 2 Diffie-Hellman group numbers
 */
export enum Phase2DhGroupNumber {
  GROUP_2 = 2,
  GROUP_5 = 5,
  GROUP_14 = 14,
  GROUP_15 = 15,
  GROUP_16 = 16,
  GROUP_17 = 17,
  GROUP_18 = 18,
  GROUP_19 = 19,
  GROUP_20 = 20,
  GROUP_21 = 21,
  GROUP_22 = 22,
  GROUP_23 = 23,
  GROUP_24 = 24,
}

/**
 * Tunnel startup action
 */
export enum TunnelStartupAction {
  /**
   * Customer gateway must initiate IKE negotiation
   */
  ADD = "add",

  /**
   * AWS will initiate IKE negotiation
   */
  START = "start",
}
