// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2-targets/lib/instance-target.ts

import * as compute from "../";

/**
 * An EC2 instance that is the target for load balancing
 *
 * If you register a target of this type, you are responsible for making
 * sure the load balancer's security group can connect to the instance.
 */
export class InstanceIdTarget
  implements
    compute.IApplicationLoadBalancerTarget,
    compute.INetworkLoadBalancerTarget
{
  /**
   * Create a new Instance target
   *
   * @param instanceId Instance ID of the instance to register to
   * @param port Override the default port for the target group
   */
  constructor(
    private readonly instanceId: string,
    private readonly port?: number,
  ) {}

  /**
   * Register this instance target with a load balancer
   *
   * Don't call this, it is called automatically when you add the target to a
   * load balancer.
   */
  public attachToApplicationTargetGroup(
    targetGroup: compute.IApplicationTargetGroup,
  ): compute.LoadBalancerTargetProps {
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
    return this.attach(targetGroup);
  }

  private attach(
    _targetGroup: compute.ITargetGroup,
  ): compute.LoadBalancerTargetProps {
    return {
      targetType: compute.TargetType.INSTANCE,
      targetJson: { targetId: this.instanceId, port: this.port },
    };
  }
}

export class InstanceTarget extends InstanceIdTarget {
  /**
   * Create a new Instance target
   *
   * @param instance Instance to register to
   * @param port Override the default port for the target group
   */
  constructor(instance: compute.Instance, port?: number) {
    super(instance.instanceId, port);
  }
}
