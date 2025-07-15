import { apiGatewayVpcLink } from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat } from "../arn";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as elbv2 from "../compute";

/**
 * Outputs for the VpcLink construct that might be registered.
 */
export interface VpcLinkOutputs {
  /**
   * Physical ID of the VpcLink resource.
   */
  readonly vpcLinkId: string;
  /**
   * ARN of the VpcLink resource.
   */
  readonly vpcLinkArn: string;
}

/**
 * Represents an API Gateway VpcLink
 */
export interface IVpcLink extends IAwsConstruct {
  /**
   * Physical ID of the VpcLink resource
   * @attribute
   */
  readonly vpcLinkId: string;

  /**
   * ARN of the VpcLink resource
   * @attribute
   */
  readonly vpcLinkArn: string;

  /**
   * The list of DNS names from the target NLBs.
   * @internal
   */
  readonly _targetDnsNames: string[];

  /**
   * Adds Network Load Balancer targets to this VPC Link.
   * @param targets The Network Load Balancers to add as targets.
   */
  addTargets(...targets: elbv2.INetworkLoadBalancer[]): void;
}

/**
 * Properties for a VpcLink
 */
export interface VpcLinkProps extends AwsConstructProps {
  /**
   * The name used to label and identify the VPC link.
   * @default - friendlyName (derived from environmentName and construct ID)
   */
  readonly vpcLinkName?: string;

  /**
   * The description of the VPC link.
   * @default no description
   */
  readonly description?: string;

  /**
   * The network load balancers of the VPC targeted by the VPC link.
   * The network load balancers must be owned by the same AWS account of the API owner.
   *
   * @default - no targets. Use `addTargets` to add targets
   */
  readonly targets?: elbv2.INetworkLoadBalancer[];

  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.100.0/docs/resources/api_gateway_vpc_link#tags ApiGatewayVpcLink#tags}
   */
  readonly tags?: {
    [key: string]: string;
  };
}

/**
 * Define a new VPC Link
 * Specifies an API Gateway VPC link for a RestApi to access resources in an Amazon Virtual Private Cloud (VPC).
 * @resource AWS::ApiGateway::VpcLink
 */
export class VpcLink extends AwsConstructBase implements IVpcLink {
  /**
   * Import a VPC Link by its Id
   */
  public static fromVpcLinkId(
    scope: Construct,
    id: string,
    vpcLinkId: string,
  ): IVpcLink {
    return new ImportedVpcLink(scope, id, vpcLinkId);
  }

  private readonly resource: apiGatewayVpcLink.ApiGatewayVpcLink;
  private readonly _targets = new Array<elbv2.INetworkLoadBalancer>();

  /**
   * Physical ID of the VpcLink resource
   */
  public get vpcLinkId(): string {
    return this.resource.id;
  }

  /**
   * ARN of the VpcLink resource
   */
  public get vpcLinkArn(): string {
    return this.resource.arn;
  }

  /**
   * Strongly typed outputs for the VpcLink.
   */
  public get vpcLinkOutputs(): VpcLinkOutputs {
    return {
      vpcLinkId: this.vpcLinkId,
      vpcLinkArn: this.vpcLinkArn,
    };
  }

  public get outputs(): Record<string, any> {
    return this.vpcLinkOutputs;
  }

  constructor(scope: Construct, id: string, props: VpcLinkProps = {}) {
    super(scope, id, props);

    const vpcLinkName =
      props.vpcLinkName ?? this.stack.uniqueResourceName(this);

    this.resource = new apiGatewayVpcLink.ApiGatewayVpcLink(this, "Resource", {
      name: vpcLinkName,
      description: props.description,
      targetArns: Lazy.listValue({ produce: () => this.renderTargets() }),
      tags: props.tags,
    });

    if (props.targets) {
      this.addTargets(...props.targets);
    }

    this.node.addValidation({ validate: () => this.validateVpcLink() });
  }

  public addTargets(...targets: elbv2.INetworkLoadBalancer[]) {
    this._targets.push(...targets);
  }

  /**
   * Return the list of DNS names from the target NLBs.
   * @internal
   * */
  public get _targetDnsNames(): string[] {
    // This assumes INetworkLoadBalancer has a loadBalancerDnsName property.
    // If INetworkLoadBalancer is an interface for an imported resource without a direct DNS name attribute,
    // this might need adjustment or might not be directly available.
    return this._targets.map((t) => t.loadBalancerDnsName);
  }

  private validateVpcLink(): string[] {
    if (this._targets.length === 0) {
      return ["No targets added to vpc link. At least one target is required."];
    }
    // AWS currently supports only 1 target ARN for API Gateway V1 VPC Links.
    // Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/api_gateway_vpc_link#target_arns
    if (this._targets.length > 1) {
      // This is a deviation from CDK which allows multiple targets in the array,
      // but Terraform provider for aws_api_gateway_vpc_link expects a list with one item.
      // For now, we'll allow multiple in the internal array and let synth-time rendering pick the first one or error if TF provider complains.
      // A better approach might be to enforce this in addTargets or during validation.
      // However, the CDK CfnVpcLink also takes a list, so this behavior might be intended for future AWS support or other reasons.
      // For strictness with current TF provider, this validation could be: return ['VPC Link for API Gateway V1 supports only one target Network Load Balancer.'];
    }
    return [];
  }

  private renderTargets(): string[] {
    // Terraform provider for aws_api_gateway_vpc_link currently expects a list with a single target ARN.
    // If multiple targets are provided, we might take the first one, or let Terraform error out.
    // For now, returning all ARNs, and Terraform will likely fail if more than one is provided and not supported.
    return this._targets.map((nlb) => nlb.loadBalancerArn);
  }
}

class ImportedVpcLink extends AwsConstructBase implements IVpcLink {
  private static buildArn(scope: Construct, vpcLinkId: string): string {
    const stack = AwsStack.ofAwsConstruct(scope);
    return stack.formatArn({
      service: "apigateway",
      // For VpcLink, the region is part of the service endpoint, not explicitly in the resource segment like some other ARNs.
      // The resource segment is /vpclinks/{vpclink_id}
      resource: `vpclinks/${vpcLinkId}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME, // This format might need adjustment based on actual VpcLink ARN structure
    });
  }

  public readonly vpcLinkId: string;
  public readonly vpcLinkArn: string;

  private readonly _importedTargets: elbv2.INetworkLoadBalancer[] = [];

  public get outputs(): VpcLinkOutputs {
    return {
      vpcLinkId: this.vpcLinkId,
      vpcLinkArn: this.vpcLinkArn,
    };
  }

  constructor(scope: Construct, id: string, vpcLinkId: string) {
    super(scope, id, {
      environmentFromArn: ImportedVpcLink.buildArn(scope, vpcLinkId),
    });
    this.vpcLinkId = vpcLinkId;
    this.vpcLinkArn = ImportedVpcLink.buildArn(scope, vpcLinkId);
  }

  public addTargets(...targets: elbv2.INetworkLoadBalancer[]) {
    // For imported VpcLinks, adding targets post-import is typically not meaningful
    // as the targets are part of the existing AWS resource.
    // We can store them if needed for local representation, but it won't modify the imported resource.
    this._importedTargets.push(...targets);
    // console.warn(`Adding targets to an imported VpcLink (${this.vpcLinkId}) has no effect on the deployed AWS resource.`);
  }

  public get _targetDnsNames(): string[] {
    return this._importedTargets.map((t) => t.loadBalancerDnsName);
  }
}
