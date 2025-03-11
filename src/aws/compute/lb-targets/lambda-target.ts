// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2-targets/lib/lambda-target.ts

import * as compute from "../";
import * as iam from "../../iam";

export class LambdaTarget implements compute.IApplicationLoadBalancerTarget {
  /**
   * Create a new Lambda target
   *
   * @param functionArn The Lambda Function to load balance to
   */
  constructor(private readonly fn: compute.IFunction) {}

  /**
   * Register this instance target with a load balancer
   *
   * Don't call this, it is called automatically when you add the target to a
   * load balancer.
   */
  public attachToApplicationTargetGroup(
    targetGroup: compute.IApplicationTargetGroup,
  ): compute.LoadBalancerTargetProps {
    const grant = this.fn.grantInvoke(
      new iam.ServicePrincipal("elasticloadbalancing.amazonaws.com"),
    );
    grant.applyBefore(targetGroup);
    return this.attach(targetGroup);
  }

  /**
   * Register this instance target with a load balancer
   *
   * Don't call this, it is called automatically when you add the target to a
   * load balancer.
   */
  public attachToNetworkTargetGroup(
    targetGroup: compute.INetworkTargetGroup,
  ): compute.LoadBalancerTargetProps {
    const grant = this.fn.grantInvoke(
      new iam.ServicePrincipal("elasticloadbalancing.amazonaws.com"),
    );
    grant.applyBefore(targetGroup);
    return this.attach(targetGroup);
  }

  private attach(
    _targetGroup: compute.ITargetGroup,
  ): compute.LoadBalancerTargetProps {
    return {
      targetType: compute.TargetType.LAMBDA,
      targetJson: { targetId: this.fn.functionArn },
    };
  }
}
