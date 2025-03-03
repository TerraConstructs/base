// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/vpc-endpoint-service.ts

import {
  vpcEndpointService,
  vpcEndpointServiceAllowedPrincipal,
  vpcEndpointServicePrivateDnsVerification,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IAwsConstruct, AwsConstructBase } from "../aws-construct";
import { IDnsZone, TxtRecord } from "../edge";
import { ArnPrincipal } from "../iam";

/**
 * A load balancer that can host a VPC Endpoint Service
 *
 */
export interface IVpcEndpointServiceLoadBalancer {
  /**
   * The ARN of the load balancer that hosts the VPC Endpoint Service
   *
   * @attribute
   */
  readonly loadBalancerArn: string;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface VpcEndpointServiceOutputs {
  /**
   * The service name of the VPC Endpoint Service that clients use to connect to,
   * like com.amazonaws.vpce.<region>.vpce-svc-xxxxxxxxxxxxxxxx
   *
   * @attribute
   */
  readonly vpcEndpointServiceName: string;

  /**
   * The id of the VPC Endpoint Service that clients use to connect to,
   * like vpce-svc-xxxxxxxxxxxxxxxx
   *
   * @attribute
   */
  readonly vpcEndpointServiceId: string;
}
/**
 * A VPC endpoint service.
 *
 */
export interface IVpcEndpointService extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly vpcEndpointServiceOutputs: VpcEndpointServiceOutputs;
  /**
   * The service name of the VPC Endpoint Service that clients use to connect to,
   * like com.amazonaws.vpce.<region>.vpce-svc-xxxxxxxxxxxxxxxx
   *
   * @attribute
   */
  readonly vpcEndpointServiceName: string;

  /**
   * The id of the VPC Endpoint Service that clients use to connect to,
   * like vpce-svc-xxxxxxxxxxxxxxxx
   *
   * @attribute
   */
  readonly vpcEndpointServiceId: string;
}

/**
 * A VPC endpoint service
 * @resource aws_vpc_endpoint_service
 *
 */
export class VpcEndpointService
  extends AwsConstructBase
  implements IVpcEndpointService
{
  /**
   * The default value for a VPC Endpoint Service name prefix, useful if you do
   * not have a synthesize-time region literal available.
   */
  public static readonly DEFAULT_PREFIX = "com.amazonaws.vpce";

  /**
   * One or more network load balancers to host the service.
   * @attribute
   */
  public readonly vpcEndpointServiceLoadBalancers: IVpcEndpointServiceLoadBalancer[];

  /**
   * Whether to require manual acceptance of new connections to the service.
   *
   */
  public readonly acceptanceRequired: boolean;

  // TODO: Not supported in Terraform
  // /**
  //  * Whether to enable the built-in Contributor Insights rules provided by AWS PrivateLink.
  //  *
  //  */
  // public readonly contributorInsightsEnabled?: boolean;

  /**
   * One or more Principal ARNs to allow inbound connections to.
   * @deprecated use `allowedPrincipals`
   */
  public readonly whitelistedPrincipals: ArnPrincipal[];

  /**
   * One or more Principal ARNs to allow inbound connections to.
   *
   */
  public readonly allowedPrincipals: ArnPrincipal[];

  /**
   * The id of the VPC Endpoint Service, like vpce-svc-xxxxxxxxxxxxxxxx.
   * @attribute
   */
  public readonly vpcEndpointServiceId: string;

  /**
   * The service name of the VPC Endpoint Service that clients use to connect to,
   * like com.amazonaws.vpce.<region>.vpce-svc-xxxxxxxxxxxxxxxx
   *
   * @attribute
   */
  public readonly vpcEndpointServiceName: string;
  public get vpcEndpointServiceOutputs(): VpcEndpointServiceOutputs {
    return {
      vpcEndpointServiceName: this.vpcEndpointServiceName,
      vpcEndpointServiceId: this.vpcEndpointServiceId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.vpcEndpointServiceOutputs;
  }

  private readonly endpointService: vpcEndpointService.VpcEndpointService;

  constructor(scope: Construct, id: string, props: VpcEndpointServiceProps) {
    super(scope, id);

    if (
      props.vpcEndpointServiceLoadBalancers === undefined ||
      props.vpcEndpointServiceLoadBalancers.length === 0
    ) {
      throw new Error(
        "VPC Endpoint Service must have at least one load balancer specified.",
      );
    }

    if (props.privateDnsName && !props.dnsZone) {
      throw new Error(
        "A DNS zone must be provided for validation when a private DNS name is specified.",
      );
    }

    this.vpcEndpointServiceLoadBalancers =
      props.vpcEndpointServiceLoadBalancers;
    this.acceptanceRequired = props.acceptanceRequired ?? true;
    // this.contributorInsightsEnabled = props.contributorInsights;

    if (props.allowedPrincipals && props.whitelistedPrincipals) {
      throw new Error(
        "`whitelistedPrincipals` is deprecated; please use `allowedPrincipals` instead",
      );
    }
    this.allowedPrincipals =
      props.allowedPrincipals ?? props.whitelistedPrincipals ?? [];
    this.whitelistedPrincipals = this.allowedPrincipals;

    this.endpointService = new vpcEndpointService.VpcEndpointService(this, id, {
      networkLoadBalancerArns: this.vpcEndpointServiceLoadBalancers.map(
        (lb) => lb.loadBalancerArn,
      ),
      acceptanceRequired: this.acceptanceRequired,
      privateDnsName: props.privateDnsName,
      // Not supported in Terraform
      // contributorInsightsEnabled: this.contributorInsightsEnabled,
    });

    this.vpcEndpointServiceId = this.endpointService.id;
    this.vpcEndpointServiceName = this.endpointService.serviceName;

    // TODO: This fails when enabling privateDnsName on existing resources?
    // relevant GH Issue:
    // https://github.com/hashicorp/terraform-provider-aws/issues/24044
    if (props.privateDnsName && props.dnsZone) {
      // this value is only available if privateDnsName is set
      const privateDnsNameConfiguration =
        this.endpointService.privateDnsNameConfiguration.get(0);
      // create Route53 TXT records to validate the domain ownership
      const verificationRecord = new TxtRecord(
        this,
        "PrivateDnsVerificationRecord",
        {
          zone: props.dnsZone,
          recordName: privateDnsNameConfiguration.name,
          values: [privateDnsNameConfiguration.value],
        },
      );
      new vpcEndpointServicePrivateDnsVerification.VpcEndpointServicePrivateDnsVerification(
        this,
        "PrivateDnsVerification",
        {
          serviceId: this.endpointService.id,
          dependsOn: [verificationRecord],
        },
      );
    }

    if (this.allowedPrincipals.length > 0) {
      this.allowedPrincipals.map((principal, index) => {
        new vpcEndpointServiceAllowedPrincipal.VpcEndpointServiceAllowedPrincipal(
          this,
          `Permissions${index}`,
          {
            vpcEndpointServiceId: this.endpointService.id,
            principalArn: principal.arn,
          },
        );
      });
    }
  }
}

/**
 * Construction properties for a VpcEndpointService.
 *
 */
export interface VpcEndpointServiceProps {
  // /**
  //  * Name of the Vpc Endpoint Service
  //  * @deprecated This property is not used
  //  * @default - CDK generated name
  //  */
  // readonly vpcEndpointServiceName?: string;

  /**
   * The private DNS name for the service.
   */
  readonly privateDnsName?: string;

  /**
   * Zone to validate the domain ownership.
   *
   * required if `privateDnsName` is set
   */
  readonly dnsZone?: IDnsZone;

  /**
   * One or more load balancers to host the VPC Endpoint Service.
   *
   */
  readonly vpcEndpointServiceLoadBalancers: IVpcEndpointServiceLoadBalancer[];

  /**
   * Whether requests from service consumers to connect to the service through
   * an endpoint must be accepted.
   * @default true
   *
   */
  readonly acceptanceRequired?: boolean;

  // TODO: Not supported in Terraform
  // /**
  //  * Indicates whether to enable the built-in Contributor Insights rules provided by AWS PrivateLink.
  //  * @default false
  //  *
  //  */
  // readonly contributorInsights?: boolean;

  /**
   * IAM users, IAM roles, or AWS accounts to allow inbound connections from.
   * These principals can connect to your service using VPC endpoints. Takes a
   * list of one or more ArnPrincipal.
   * @default - no principals
   * @deprecated use `allowedPrincipals`
   */
  readonly whitelistedPrincipals?: ArnPrincipal[];

  /**
   * IAM users, IAM roles, or AWS accounts to allow inbound connections from.
   * These principals can connect to your service using VPC endpoints. Takes a
   * list of one or more ArnPrincipal.
   * @default - no principals
   *
   */
  readonly allowedPrincipals?: ArnPrincipal[];
}
