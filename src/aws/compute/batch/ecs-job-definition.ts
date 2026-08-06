// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/ecs-job-definition.ts

import { batchJobDefinition } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import {
  EcsEc2ContainerDefinition,
  IEcsContainerDefinition,
} from "./ecs-container-definition";
import {
  baseJobDefinitionProperties,
  IJobDefinition,
  JobDefinitionBase,
  JobDefinitionProps,
} from "./job-definition-base";
import { IJobQueue } from "./job-queue";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";
import * as iam from "../../iam";

/**
 * A JobDefinition that uses ECS orchestration
 */
interface IEcsJobDefinition extends IJobDefinition {
  /**
   * The container that this job will run
   */
  readonly container: IEcsContainerDefinition;

  /**
   * Whether to propagate tags from the JobDefinition
   * to the ECS task that Batch spawns
   *
   * @default false
   */
  readonly propagateTags?: boolean;
}

/**
 * @internal
 */
export enum Compatibility {
  EC2 = "EC2",
  FARGATE = "FARGATE",
}

/**
 * Props for EcsJobDefinition
 */
export interface EcsJobDefinitionProps extends JobDefinitionProps {
  /**
   * The container that this job will run
   */
  readonly container: IEcsContainerDefinition;

  /**
   * Whether to propagate tags from the JobDefinition
   * to the ECS task that Batch spawns
   *
   * @default false
   */
  readonly propagateTags?: boolean;
}

/**
 * A JobDefinition that uses ECS orchestration
 *
 * @resource aws_batch_job_definition
 */
export class EcsJobDefinition
  extends JobDefinitionBase
  implements IEcsJobDefinition
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.batch.EcsJobDefinition";

  /**
   * Import a JobDefinition by its arn.
   */
  public static fromJobDefinitionArn(
    scope: Construct,
    id: string,
    jobDefinitionArn: string,
  ): IJobDefinition {
    class Import extends JobDefinitionBase implements IEcsJobDefinition {
      public readonly jobDefinitionArn = jobDefinitionArn;
      public readonly jobDefinitionName = EcsJobDefinition.getJobDefinitionName(
        this,
        jobDefinitionArn,
      );
      public readonly enabled = true;
      container = {} as any;
    }

    return new Import(scope, id);
  }

  private static getJobDefinitionName(
    scope: Construct,
    jobDefinitionArn: string,
  ) {
    const resourceName = AwsStack.ofAwsConstruct(scope).splitArn(
      jobDefinitionArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).resourceName!;
    return resourceName.split(":")[0];
  }

  public readonly resource: batchJobDefinition.BatchJobDefinition;

  readonly container: IEcsContainerDefinition;
  public readonly propagateTags?: boolean;

  public readonly jobDefinitionArn: string;
  public readonly jobDefinitionName: string;

  constructor(scope: Construct, id: string, props: EcsJobDefinitionProps) {
    super(scope, id, props);

    this.container = props.container;
    this.propagateTags = props?.propagateTags;

    // TERRACONSTRUCTS DEVIATION: the `aws_batch_job_definition` Terraform resource requires
    // `name` up front (no `name_prefix` support), so unlike upstream's CloudFormation-generated
    // physical name, an omitted `jobDefinitionName` resolves to a stack-scoped unique name here.
    const jobDefinitionName =
      props.jobDefinitionName ??
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID + "-",
        allowedSpecialCharacters: "_-",
        maxLength: 128,
      });

    this.resource = new batchJobDefinition.BatchJobDefinition(
      this,
      "Resource",
      {
        ...baseJobDefinitionProperties(this),
        name: jobDefinitionName,
        type: "container",
        // TERRACONSTRUCTS DEVIATION: upstream renders `this.container._renderContainerDefinition()`
        // directly into the CFN L1's typed `containerProperties` (CloudFormation JSON-encodes the
        // whole template at deploy time). The `aws_batch_job_definition` Terraform resource instead
        // takes `container_properties` as a single jsonencoded string, and the rendered object embeds
        // nested `Lazy.anyValue()` tokens (mountPoints/volumes/ulimits) whose raw `toJSON()` would
        // serialize as the unresolved-lazy placeholder. `this.stack.toJsonString()` (itself a
        // `Lazy.stringValue()`) defers the token-resolve-and-stringify step to synth time, NOT a
        // bare `JSON.stringify()` -- see `ecs/base/task-definition.ts` `containerDefinitions` for the
        // same pattern. Unlike that call site, `_renderContainerDefinition()` is invoked eagerly here
        // (not inside its own outer `Lazy`), matching upstream's eager invocation: the container's
        // `volumes`/`ulimits` mutate via `addVolume()`/`addUlimit()` but are already deferred by
        // nested `Lazy.anyValue()` tokens inside `_renderContainerDefinition()` itself, and secret
        // `grantRead()` calls embedded in the render must fire synchronously at construction time
        // (same as upstream), not deferred to token resolution.
        containerProperties: this.stack.toJsonString(
          this.container._renderContainerDefinition(),
        ),
        platformCapabilities: this.renderPlatformCapabilities(),
        propagateTags: this.propagateTags,
      },
    );

    this.jobDefinitionArn = this.resource.arn;
    this.jobDefinitionName = this.resource.name;
  }

  /**
   * Grants the `batch:submitJob` permission to the identity on both this job definition and the `queue`
   */
  public grantSubmitJob(identity: iam.IGrantable, queue: IJobQueue) {
    iam.Grant.addToPrincipal({
      actions: ["batch:SubmitJob"],
      grantee: identity,
      resourceArns: [this.jobDefinitionArn, queue.jobQueueArn],
    });
  }

  private renderPlatformCapabilities() {
    if (this.container instanceof EcsEc2ContainerDefinition) {
      return [Compatibility.EC2];
    }

    return [Compatibility.FARGATE];
  }
}
