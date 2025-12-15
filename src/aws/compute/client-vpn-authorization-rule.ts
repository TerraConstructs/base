// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/client-vpn-authorization-rule.ts

import { ec2ClientVpnAuthorizationRule } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IClientVpnEndpoint } from "./client-vpn-endpoint-types";
import { AwsConstructBase } from "../aws-construct";

/**
 * Options for a ClientVpnAuthorizationRule
 */
export interface ClientVpnAuthorizationRuleOptions {
  /**
   * The IPv4 address range, in CIDR notation, of the network for which access
   * is being authorized.
   */
  readonly cidr: string;

  /**
   * The ID of the group to grant access to, for example, the Active Directory
   * group or identity provider (IdP) group.
   *
   * @default - authorize all groups
   */
  readonly groupId?: string;

  /**
   * A brief description of the authorization rule.
   *
   * @default - no description
   */
  readonly description?: string;
}

/**
 * Properties for a ClientVpnAuthorizationRule
 */
export interface ClientVpnAuthorizationRuleProps extends ClientVpnAuthorizationRuleOptions {
  /**
   * The client VPN endpoint to which to add the rule.
   * @default clientVpnEndpoint is required
   */
  readonly clientVpnEndpoint: IClientVpnEndpoint;
}

/**
 * A client VPN authorization rule
 */
export class ClientVpnAuthorizationRule extends AwsConstructBase {
  public get outputs(): Record<string, any> {
    return {};
  }
  constructor(
    scope: Construct,
    id: string,
    props: ClientVpnAuthorizationRuleProps,
  ) {
    super(scope, id);
    new ec2ClientVpnAuthorizationRule.Ec2ClientVpnAuthorizationRule(
      this,
      "Resource",
      {
        clientVpnEndpointId: props.clientVpnEndpoint.endpointId,
        targetNetworkCidr: props.cidr,
        accessGroupId: props.groupId,
        authorizeAllGroups: !props.groupId,
        description: props.description,
      },
    );
  }
}
