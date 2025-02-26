// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/client-vpn-endpoint-types.ts

import { IDependable } from "constructs";
import { IConnectable } from "./connections";
import { IAwsConstruct } from "../aws-construct";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface ClientVpnOutputs {
  /**
   * The ID of the client VPN endpoint
   */
  readonly clientVpnEndpointId: string;

  /**
   * The URL of the self-service portal
   */
  readonly SelfServicePortalUrl?: string;
}

/**
 * A client VPN endpoint
 */
export interface IClientVpnEndpoint extends IAwsConstruct, IConnectable {
  /** strongly typed outputs */
  readonly clientVpnOutputs: ClientVpnOutputs;
  /**
   * The endpoint ID
   */
  readonly endpointId: string;

  /**
   * Dependable that can be depended upon to force target networks associations
   */
  readonly targetNetworksAssociated: IDependable;
}

/**
 * A connection handler for client VPN endpoints
 */
export interface IClientVpnConnectionHandler {
  /**
   * The name of the function
   */
  readonly functionName: string;

  /**
   * The ARN of the function.
   */
  readonly functionArn: string;
}

/**
 * Transport protocol for client VPN
 */
export enum TransportProtocol {
  /** Transmission Control Protocol (TCP) */
  TCP = "tcp",
  /** User Datagram Protocol (UDP) */
  UDP = "udp",
}

/**
 * Port for client VPN
 */
export enum VpnPort {
  /** HTTPS */
  HTTPS = 443,
  /** OpenVPN */
  OPENVPN = 1194,
}
