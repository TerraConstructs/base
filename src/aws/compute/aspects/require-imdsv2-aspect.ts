// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/aspects/require-imdsv2-aspect.ts
import { launchTemplate } from "@cdktf/provider-aws";
import { IAspect, Annotations } from "cdktf";
import { IConstruct } from "constructs";
import { AwsStack } from "../../aws-stack";
import { Instance } from "../instance";
import { LaunchTemplate } from "../launch-template";

/**
 * Properties for `RequireImdsv2Aspect`.
 */
interface RequireImdsv2AspectProps {
  /**
   * Whether warning annotations from this Aspect should be suppressed or not.
   *
   * @default - false
   */
  readonly suppressWarnings?: boolean;
}

/**
 * Base class for Aspect that makes IMDSv2 required.
 */
abstract class RequireImdsv2Aspect implements IAspect {
  protected readonly suppressWarnings: boolean;

  constructor(props?: RequireImdsv2AspectProps) {
    this.suppressWarnings = props?.suppressWarnings ?? false;
  }

  abstract visit(node: IConstruct): void;

  /**
   * Adds a warning annotation to a node, unless `suppressWarnings` is true.
   *
   * @param node The scope to add the warning to.
   * @param message The warning message.
   */
  protected warn(node: IConstruct, message: string) {
    if (this.suppressWarnings !== true) {
      // `@aws-cdk/aws-ec2:imdsv2${RequireImdsv2Aspect.name}`,
      Annotations.of(node).addWarning(
        `${RequireImdsv2Aspect.name} failed on node ${node.node.id}: ${message}`,
      );
    }
  }
}

/**
 * Properties for `InstanceRequireImdsv2Aspect`.
 */
export interface InstanceRequireImdsv2AspectProps extends RequireImdsv2AspectProps {
  /**
   * Whether warnings that would be raised when an Instance is associated with an existing Launch Template
   * should be suppressed or not.
   *
   * You can set this to `true` if `LaunchTemplateImdsAspect` is being used alongside this Aspect to
   * suppress false-positive warnings because any Launch Templates associated with Instances will still be covered.
   *
   * @default - false
   */
  readonly suppressLaunchTemplateWarning?: boolean;
}

/**
 * Aspect that applies IMDS configuration on EC2 Instance constructs.
 *
 * This aspect configures IMDS on an EC2 instance by creating a Launch Template with the
 * IMDS configuration and associating that Launch Template with the instance. If an Instance
 * is already associated with a Launch Template, a warning will (optionally) be added to the
 * construct node and it will be skipped.
 *
 * To cover Instances already associated with Launch Templates, use `LaunchTemplateImdsAspect`.
 */
export class InstanceRequireImdsv2Aspect extends RequireImdsv2Aspect {
  private readonly suppressLaunchTemplateWarning: boolean;

  constructor(props?: InstanceRequireImdsv2AspectProps) {
    super(props);
    this.suppressLaunchTemplateWarning =
      props?.suppressLaunchTemplateWarning ?? false;
  }

  visit(node: IConstruct): void {
    if (!(node instanceof Instance)) {
      return;
    }
    if (node.instance.launchTemplateInput !== undefined) {
      this.warn(
        node,
        "Cannot toggle IMDSv1 because this Instance is associated with an existing Launch Template.",
      );
      return;
    }

    const lt = new launchTemplate.LaunchTemplate(node, "LaunchTemplate", {
      metadataOptions: {
        httpTokens: "required",
      },
    });
    lt.name = AwsStack.uniqueId(lt);
    node.instance.putLaunchTemplate({
      name: lt.name,
      version: lt.latestVersion.toString(),
    });
  }

  protected warn(node: IConstruct, message: string) {
    if (this.suppressLaunchTemplateWarning !== true) {
      super.warn(node, message);
    }
  }
}

/**
 * Properties for `LaunchTemplateRequireImdsv2Aspect`.
 */
export interface LaunchTemplateRequireImdsv2AspectProps extends RequireImdsv2AspectProps {}

/**
 * Aspect that applies IMDS configuration on EC2 Launch Template constructs.
 *
 * @see https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/launch_template#metadata-options
 * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html
 */
export class LaunchTemplateRequireImdsv2Aspect extends RequireImdsv2Aspect {
  constructor(props?: LaunchTemplateRequireImdsv2AspectProps) {
    super(props);
  }

  visit(node: IConstruct): void {
    if (!(node instanceof LaunchTemplate)) {
      return;
    }

    const lt = node.node.tryFindChild(
      "Resource",
    ) as launchTemplate.LaunchTemplate;
    const metadataOptions = lt.metadataOptionsInput;
    // // metaDataOptions is ComplexListObject and can never be a token
    // if (Tokenization.isResolvable(metadataOptions)) {
    //   this.warn(node, "LaunchTemplateData.MetadataOptions is a CDK token.");
    //   return;
    // }

    lt.putMetadataOptions({
      ...metadataOptions,
      httpTokens: "required",
    });
  }
}
