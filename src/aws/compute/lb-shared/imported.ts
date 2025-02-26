// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/shared/imported.ts

import { Token } from "cdktf";
import { Construct, DependencyGroup, IDependable } from "constructs";
import { ITargetGroup, TargetGroupImportProps } from "./base-target-group";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";

/**
 * Base internal class for existing target groups
 */
export abstract class ImportedTargetGroupBase
  extends Construct
  implements ITargetGroup
{
  /**
   * ARN of the target group
   */
  public readonly targetGroupArn: string;

  /**
   * The name of the target group
   */
  public readonly targetGroupName: string;

  /**
   * A token representing a list of ARNs of the load balancers that route traffic to this target group
   */
  public readonly loadBalancerArns: string;

  /**
   * Return an object to depend on the listeners added to this target group
   */
  public readonly loadBalancerAttached: IDependable = new DependencyGroup();

  constructor(scope: Construct, id: string, props: TargetGroupImportProps) {
    super(scope, id);

    this.targetGroupArn = props.targetGroupArn;
    this.targetGroupName = AwsStack.ofAwsConstruct(scope)
      .splitArn(props.targetGroupArn, ArnFormat.SLASH_RESOURCE_NAME)
      .resourceName!.split("/")[0];
    this.loadBalancerArns =
      props.loadBalancerArns || Token.asString(Token.nullValue);
  }
}
