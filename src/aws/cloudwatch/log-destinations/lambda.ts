import { Construct } from "constructs";
import * as logs from "..";
import * as compute from "../../compute";
import * as iam from "../../iam";

/**
 * Options that may be provided to LambdaDestination
 */
export interface LambdaDestinationOptions {
  /** Whether or not to add Lambda Permissions.
   * @default true
   */
  readonly addPermissions?: boolean;
}

/**
 * Use a Lambda Function as the destination for a log subscription
 */
export class LambdaDestination implements logs.ILogSubscriptionDestination {
  /**  LambdaDestinationOptions */
  constructor(
    private readonly fn: compute.IFunction,
    private readonly options: LambdaDestinationOptions = {},
  ) {}

  public bind(
    scope: Construct,
    logGroup: logs.ILogGroup,
  ): logs.LogSubscriptionDestinationConfig {
    const arn = logGroup.logGroupArn;
    const dependencies: Construct[] = [];
    if (this.options.addPermissions !== false) {
      // Same bug applies here? https://github.com/aws/aws-cdk/issues/29514?
      // TODO: Add `logGroup.node.id` as prefix to permissionId?
      const permissionId = "CanInvokeLambda";
      this.fn.addPermission(permissionId, {
        principal: new iam.ServicePrincipal("logs.amazonaws.com"),
        sourceArn: arn,
        // Using SubScription Filter as scope is okay, since every Subscription Filter has only
        // one destination.
        scope,
      });
      // Need to add a dependency, otherwise the SubscriptionFilter can be created before the
      // Permission that allows the interaction.
      const tfPermission = scope.node.tryFindChild(permissionId);
      if (tfPermission) {
        // AWS CDK:
        // scope.node.addDependency(tfPermission);
        // we let the caller attach the dependency ...
        dependencies.push(tfPermission);
      }
    }
    return { arn: this.fn.functionArn, dependencies };
  }
}
