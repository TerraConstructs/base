// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/client-vpn-route.ts

import { ec2ClientVpnRoute } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IClientVpnEndpoint } from "./client-vpn-endpoint-types";
import { ISubnet } from "./vpc";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";

/**
 * Options for a ClientVpnRoute
 */
export interface ClientVpnRouteOptions {
  /**
   * The IPv4 address range, in CIDR notation, of the route destination.
   *
   * For example:
   *   - To add a route for Internet access, enter 0.0.0.0/0
   *   - To add a route for a peered VPC, enter the peered VPC's IPv4 CIDR range
   *   - To add a route for an on-premises network, enter the AWS Site-to-Site VPN
   *     connection's IPv4 CIDR range
   *   - To add a route for the local network, enter the client CIDR range
   */
  readonly cidr: string;

  /**
   * A brief description of the authorization rule.
   *
   * @default - no description
   */
  readonly description?: string;

  /**
   * The target for the route
   */
  readonly target: ClientVpnRouteTarget;
}

/**
 * Target for a client VPN route
 */
export abstract class ClientVpnRouteTarget {
  /**
   * Subnet
   *
   * The specified subnet must be an existing target network of the client VPN
   * endpoint.
   */
  public static subnet(subnet: ISubnet): ClientVpnRouteTarget {
    return { subnetId: subnet.subnetId };
  }

  /**
   * Local network
   */
  public static local(): ClientVpnRouteTarget {
    return { subnetId: "local" };
  }

  /** The subnet ID */
  public abstract readonly subnetId: string;
}

/**
 * Properties for a ClientVpnRoute
 */
export interface ClientVpnRouteProps
  extends ClientVpnRouteOptions,
    AwsConstructProps {
  /**
   * The client VPN endpoint to which to add the route.
   * @default clientVpnEndpoint is required
   */
  readonly clientVpnEndpoint: IClientVpnEndpoint;
}

/**
 * A client VPN route
 */
export class ClientVpnRoute extends AwsConstructBase {
  public resource: ec2ClientVpnRoute.Ec2ClientVpnRoute;
  public get outputs(): Record<string, any> {
    return {
      // is this the ID of the Client VPN endpoint or the VPN route?
      clientVpnRouteId: this.resource.id,
    };
  }
  constructor(scope: Construct, id: string, props: ClientVpnRouteProps) {
    super(scope, id, props);
    this.resource = new ec2ClientVpnRoute.Ec2ClientVpnRoute(this, "Resource", {
      clientVpnEndpointId: props.clientVpnEndpoint.endpointId,
      description: props.description,
      destinationCidrBlock: props.cidr,
      targetVpcSubnetId: props.target.subnetId,
    });

    // See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-clientvpnroute.html
    this.resource.node.addDependency(
      props.clientVpnEndpoint.targetNetworksAssociated,
    );
  }
}
