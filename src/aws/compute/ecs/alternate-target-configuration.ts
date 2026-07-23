// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/alternate-target-configuration.ts

import { IConstruct } from "constructs";
import * as iam from "../../iam";
import { ApplicationListenerRule } from "../alb/application-listener-rule";
import { ITargetGroup } from "../lb-shared/base-target-group";
import { NetworkListener } from "../nlb/network-listener";

/**
 * Represents a listener configuration for advanced load balancer settings
 */
export abstract class ListenerRuleConfiguration {
  /**
   * Use an Application Load Balancer listener rule
   */
  public static applicationListenerRule(
    rule: ApplicationListenerRule,
  ): ListenerRuleConfiguration {
    return new ApplicationListenerRuleConfiguration(rule);
  }

  /**
   * Use a Network Load Balancer listener
   */
  public static networkListener(
    listener: NetworkListener,
  ): ListenerRuleConfiguration {
    return new NetworkListenerConfiguration(listener);
  }

  /**
   * @internal
   */
  public abstract readonly _listenerArn: string;
}

class ApplicationListenerRuleConfiguration extends ListenerRuleConfiguration {
  constructor(private readonly rule: ApplicationListenerRule) {
    super();
  }

  public get _listenerArn(): string {
    return this.rule.listenerRuleArn;
  }
}

class NetworkListenerConfiguration extends ListenerRuleConfiguration {
  constructor(private readonly listener: NetworkListener) {
    super();
  }

  public get _listenerArn(): string {
    return this.listener.listenerArn;
  }
}

/**
 * Configuration returned by AlternateTargetConfiguration.bind()
 */
export interface AlternateTargetConfig {
  /**
   * The ARN of the alternate target group
   */
  readonly alternateTargetGroupArn: string;

  /**
   * The IAM role ARN for the configuration
   * @default - a new role will be created
   */
  readonly roleArn: string;

  /**
   * The production listener rule ARN (ALB) or listener ARN (NLB)
   *
   * TERRACONSTRUCTS DEVIATION: required (not optional) because the underlying
   * `aws_ecs_service` `load_balancer.advanced_configuration.production_listener_rule`
   * Terraform attribute is required (unlike the upstream CFN L1 property, which is
   * optional). `bind()` always sets this from the required `productionListener` prop.
   */
  readonly productionListenerRule: string;

  /**
   * The test listener rule ARN (ALB) or listener ARN (NLB)
   * @default - none
   */
  readonly testListenerRule?: string;
}

/**
 * Interface for configuring alternate target groups for blue/green deployments
 */
export interface IAlternateTarget {
  /**
   * Bind this configuration to a service
   *
   * @param scope The construct scope
   * @returns The configuration to apply to the service
   */
  bind(scope: IConstruct): AlternateTargetConfig;
}

/**
 * Options for AlternateTarget configuration
 */
export interface AlternateTargetOptions {
  /**
   * The IAM role for the configuration
   * @default - a new role will be created
   */
  readonly role?: iam.IRole;

  /**
   * The test listener configuration
   * @default - none
   */
  readonly testListener?: ListenerRuleConfiguration;
}

/**
 * Properties for AlternateTarget configuration
 */
export interface AlternateTargetProps extends AlternateTargetOptions {
  /**
   * The alternate target group
   */
  readonly alternateTargetGroup: ITargetGroup;

  /**
   * The production listener rule ARN (ALB) or listener ARN (NLB)
   */
  readonly productionListener: ListenerRuleConfiguration;
}

/**
 * Configuration for alternate target groups used in blue/green deployments with load balancers
 */
export class AlternateTarget implements IAlternateTarget {
  constructor(
    private readonly id: string,
    private readonly props: AlternateTargetProps,
  ) {}

  /**
   * Bind this configuration to a service
   */
  public bind(scope: IConstruct): AlternateTargetConfig {
    const roleId = `${this.id}Role`;
    const role =
      this.props.role ??
      new iam.Role(scope, roleId, {
        assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            scope,
            "AmazonECSInfrastructureRolePolicyForLoadBalancers",
            "AmazonECSInfrastructureRolePolicyForLoadBalancers",
          ),
        ],
      });

    const config: AlternateTargetConfig = {
      alternateTargetGroupArn: this.props.alternateTargetGroup.targetGroupArn,
      roleArn: role.roleArn,
      productionListenerRule: this.props.productionListener._listenerArn,
      testListenerRule: this.props.testListener?._listenerArn,
    };

    return config;
  }
}
