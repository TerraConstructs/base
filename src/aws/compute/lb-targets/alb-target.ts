// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2-targets/lib/alb-target.ts

import * as compute from "../";

/**
 * A single Application Load Balancer as the target for load balancing.
 */
export class AlbArnTarget implements compute.INetworkLoadBalancerTarget {
  /**
   * Create a new alb target.
   * Note that the ALB must have a listener on the provided target port.
   *
   * @param albArn The ARN of the application load balancer to load balance to
   * @param port The port on which the target is listening
   */
  constructor(
    private readonly albArn: string,
    private readonly port: number,
  ) {}

  /**
   * Register this alb target with a load balancer
   *
   * Don't call this, it is called automatically when you add the target to a
   * load balancer.
   */
  public attachToNetworkTargetGroup(
    targetGroup: compute.INetworkTargetGroup,
  ): compute.LoadBalancerTargetProps {
    return this._attach(targetGroup);
  }

  /**
   * @internal
   */
  protected _attach(
    _targetGroup: compute.ITargetGroup,
  ): compute.LoadBalancerTargetProps {
    return {
      targetType: compute.TargetType.ALB,
      targetJson: { targetId: this.albArn, port: this.port },
    };
  }
}

/**
 * A single Application Load Balancer as the target for load balancing.
 * @deprecated Use `AlbListenerTarget` instead or
 * `AlbArnTarget` for an imported load balancer. This target does not automatically
 * add a dependency between the ALB listener and resulting NLB target group,
 * without which may cause stack deployments to fail if the NLB target group is provisioned
 * before the listener has been fully created.
 */
export class AlbTarget extends AlbArnTarget {
  /**
   * @param alb The application load balancer to load balance to
   * @param port The port on which the target is listening
   */
  constructor(alb: compute.IApplicationLoadBalancer, port: number) {
    super(alb.loadBalancerArn, port);
  }
}

/**
 * A single Application Load Balancer's listener as the target for load balancing.
 */
export class AlbListenerTarget extends AlbArnTarget {
  /**
   * Create a new ALB target.
   * The associated target group will automatically have a dependency added
   * against the ALB's listener.
   *
   * @param albListener The application load balancer listener to target.
   */
  constructor(private albListener: compute.ApplicationListener) {
    super(albListener.loadBalancer.loadBalancerArn, albListener.port);
  }

  private attach(
    targetGroup: compute.ITargetGroup,
  ): compute.LoadBalancerTargetProps {
    targetGroup.node.addDependency(this.albListener);
    return super._attach(targetGroup);
  }

  /**
   * Register this ALB target with a load balancer.
   *
   * Don't call this, it is called automatically when you add the target to a
   * load balancer.
   *
   * This adds dependency on albListener because creation of ALB listener and NLB can vary during runtime.
   * More Details on - https://github.com/aws/aws-cdk/issues/17208
   */
  public attachToNetworkTargetGroup(
    targetGroup: compute.INetworkTargetGroup,
  ): compute.LoadBalancerTargetProps {
    return this.attach(targetGroup);
  }
}
