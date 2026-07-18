// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/aspects/require-imdsv2-aspect.ts

import { launchTemplate as tfLaunchTemplate } from "@cdktn/provider-aws";
import { IAspect, Annotations } from "cdktn";
import { IConstruct } from "constructs";
import { AutoScalingGroup } from "../auto-scaling-group";
import { LaunchTemplate } from "../../launch-template";

/**
 * Aspect that makes IMDSv2 required on instances deployed by AutoScalingGroups.
 */
export class AutoScalingGroupRequireImdsv2Aspect implements IAspect {
  constructor() {}

  public visit(node: IConstruct): void {
    if (!(node instanceof AutoScalingGroup)) {
      return;
    }

    // Terraform deviation: unlike upstream CloudFormation -- which conditionally emits
    // either the legacy `AWS::AutoScaling::LaunchConfiguration` resource or a generated
    // `AWS::EC2::LaunchTemplate`, gated behind the `AUTOSCALING_GENERATE_LAUNCH_TEMPLATE`
    // feature flag -- this port's AutoScalingGroup (see ../auto-scaling-group.ts) always
    // provisions an `aws_launch_template`; the deprecated `aws_launch_configuration`
    // resource is never emitted here. Upstream's `CfnLaunchConfiguration` branch is
    // therefore dropped entirely; only the LaunchTemplate branch below applies.
    const launchTemplate = node.node.tryFindChild(
      "LaunchTemplate",
    ) as LaunchTemplate;
    const cfnLaunchTemplate = launchTemplate.node.tryFindChild(
      "Resource",
    ) as tfLaunchTemplate.LaunchTemplate;
    const metadataOptions = cfnLaunchTemplate.metadataOptionsInput;
    // metadataOptions is a typed ComplexObject value returned by the provider binding
    // (not a Lazy producer/CDK token), so unlike upstream's `cdk.isResolvableObject`
    // guard against a raw CloudFormation token, there is nothing to check here before
    // merging in the required httpTokens value.

    cfnLaunchTemplate.putMetadataOptions({
      ...metadataOptions,
      httpTokens: "required",
    });
  }

  /**
   * Adds a warning annotation to a node.
   *
   * @param node The scope to add the warning to.
   * @param message The warning message.
   */
  protected warn(node: IConstruct, message: string) {
    Annotations.of(node).addWarning(
      `${AutoScalingGroupRequireImdsv2Aspect.name} failed on node ${node.node.id}: ${message}`,
    );
  }
}
