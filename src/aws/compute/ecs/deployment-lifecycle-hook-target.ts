// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/deployment-lifecycle-hook-target.ts

import { IConstruct } from "constructs";
import * as iam from "../../iam";
import { IFunction } from "../function-base";

/**
 * Deployment lifecycle stages where hooks can be executed
 */
export enum DeploymentLifecycleStage {
  /**
   * Execute during service reconciliation
   */
  RECONCILE_SERVICE = "RECONCILE_SERVICE",
  /**
   * Execute before scaling up tasks
   */
  PRE_SCALE_UP = "PRE_SCALE_UP",
  /**
   * Execute after scaling up tasks
   */
  POST_SCALE_UP = "POST_SCALE_UP",
  /**
   * Execute during test traffic shift
   */
  TEST_TRAFFIC_SHIFT = "TEST_TRAFFIC_SHIFT",
  /**
   * Execute after test traffic shift
   */
  POST_TEST_TRAFFIC_SHIFT = "POST_TEST_TRAFFIC_SHIFT",
  /**
   * Execute during production traffic shift
   */
  PRODUCTION_TRAFFIC_SHIFT = "PRODUCTION_TRAFFIC_SHIFT",
  /**
   * Execute after production traffic shift
   */
  POST_PRODUCTION_TRAFFIC_SHIFT = "POST_PRODUCTION_TRAFFIC_SHIFT",
}

/**
 * Configuration for a deployment lifecycle hook target
 */
export interface DeploymentLifecycleHookTargetConfig {
  /**
   * The ARN of the target resource
   */
  readonly targetArn: string;

  /**
   * The IAM role that grants permissions to invoke the target
   * @default - a role will be created automatically
   */
  readonly role?: iam.IRole;

  /**
   * The lifecycle stages when this hook should be executed
   */
  readonly lifecycleStages: DeploymentLifecycleStage[];
}

/**
 * Interface for deployment lifecycle hook targets
 */
export interface IDeploymentLifecycleHookTarget {
  /**
   * Bind this target to a deployment lifecycle hook
   *
   * @param scope The construct scope
   */
  bind(scope: IConstruct): DeploymentLifecycleHookTargetConfig;
}

/**
 * Configuration for a lambda deployment lifecycle hook
 */
export interface DeploymentLifecycleLambdaTargetProps {
  /**
   * The IAM role that grants permissions to invoke the lambda target
   * @default - A unique role will be generated for this lambda function.
   */
  readonly role?: iam.IRole;

  /**
   * The lifecycle stages when this hook should be executed
   */
  readonly lifecycleStages: DeploymentLifecycleStage[];
}

/**
 * Use an AWS Lambda function as a deployment lifecycle hook target
 */
export class DeploymentLifecycleLambdaTarget
  implements IDeploymentLifecycleHookTarget
{
  private _role?: iam.IRole;

  constructor(
    private readonly handler: IFunction,
    private readonly id: string,
    private readonly props: DeploymentLifecycleLambdaTargetProps,
  ) {}

  /**
   * The IAM role for the deployment lifecycle hook target
   */
  public get role(): iam.IRole {
    return this._role!;
  }

  /**
   * Bind this target to a deployment lifecycle hook
   *
   * TERRACONSTRUCTS DEVIATION: upstream unconditionally reassigns `this._role =
   * this.props.role` on every `bind()` call because CFN-side `bind()` only ever runs once.
   * Here `BaseService.toTerraform()` (invoked once per `TerraformStack.prepareStack()` pass,
   * and `prepareStack()` itself runs at least twice per synth -- once explicitly by callers/
   * `Template` helpers and again inside `App.synth()`) re-derives the deployment configuration
   * via `renderLifecycleHooks()` -> `target.bind(this)` on every pass. Re-running the original
   * unconditional-overwrite logic would call `new iam.Role(scope, ...)` again with the same
   * construct id and throw ("There is already a Construct with name ..."). Only create/resolve
   * the role once and cache it so repeated `bind()` calls are idempotent.
   */
  public bind(scope: IConstruct): DeploymentLifecycleHookTargetConfig {
    // Create role if not provided (only on the first bind() call; cached afterwards)
    if (!this._role) {
      this._role = this.props.role;
      if (!this._role) {
        this._role = new iam.Role(scope, `${this.id}Role`, {
          assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
        });
        this.handler.grantInvoke(this._role);
      }
    }

    return {
      targetArn: this.handler.functionArn,
      role: this._role,
      lifecycleStages: this.props.lifecycleStages,
    };
  }
}
