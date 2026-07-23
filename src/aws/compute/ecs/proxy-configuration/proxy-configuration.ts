// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/proxy-configuration/proxy-configuration.ts

import { Construct } from "constructs";
import { TaskDefinition } from "../base/task-definition";

/**
 * The configuration to pass to the `aws_ecs_task_definition` `proxy_configuration` block, mirroring
 * the shape of the CloudFormation `AWS::ECS::TaskDefinition.ProxyConfiguration` property.
 */
export interface ProxyConfigurationConfig {
  /**
   * The name of the container that will serve as the App Mesh proxy.
   */
  readonly containerName: string;

  /**
   * The set of network configuration parameters to provide the Container Network Interface (CNI)
   * plugin, specified as key-value pairs.
   *
   * @default - no properties
   */
  readonly properties?: { [key: string]: string };

  /**
   * The proxy type.
   *
   * The only supported value is `APPMESH`.
   *
   * @default - no type
   */
  readonly type?: string;
}

/**
 * The base class for proxy configurations.
 */
export abstract class ProxyConfiguration {
  /**
   * Called when the proxy configuration is configured on a task definition.
   */
  public abstract bind(
    _scope: Construct,
    _taskDefinition: TaskDefinition,
  ): ProxyConfigurationConfig;
}
