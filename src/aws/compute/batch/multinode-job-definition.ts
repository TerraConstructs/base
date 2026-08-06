// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/multinode-job-definition.ts

import { batchJobDefinition } from "@cdktn/provider-aws";
import { IResolvable, Lazy } from "cdktn";
import { Construct } from "constructs";
import {
  ContainerPropertiesConfig,
  EcsFargateContainerDefinition,
  IEcsContainerDefinition,
} from "./ecs-container-definition";
import { Compatibility } from "./ecs-job-definition";
import {
  baseJobDefinitionProperties,
  IJobDefinition,
  JobDefinitionBase,
  JobDefinitionProps,
} from "./job-definition-base";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";
import { InstanceType } from "../instance-types";

/**
 * Not a real instance type! Indicates that Batch will choose one it determines to be optimal
 * for the workload.
 */
export class OptimalInstanceType extends InstanceType {
  constructor() {
    // this is not a real instance type! Batch uses an `undefined` value to mean 'optimal',
    // which tells Batch to select the optimal instance type.
    super("optimal");
  }
}

interface IMultiNodeJobDefinition extends IJobDefinition {
  /**
   * The containers that this multinode job will run.
   *
   * @see https://aws.amazon.com/blogs/compute/building-a-tightly-coupled-molecular-dynamics-workflow-with-multi-node-parallel-jobs-in-aws-batch/
   */
  readonly containers: MultiNodeContainer[];

  /**
   * The instance type that this job definition will run
   *
   * @default - optimal instance, selected by Batch
   */
  readonly instanceType?: InstanceType;

  /**
   * The index of the main node in this job.
   * The main node is responsible for orchestration.
   *
   * @default 0
   */
  readonly mainNode?: number;

  /**
   * Whether to propagate tags from the JobDefinition
   * to the ECS task that Batch spawns
   *
   * @default false
   */
  readonly propagateTags?: boolean;

  /**
   * Add a container to this multinode job
   */
  addContainer(container: MultiNodeContainer): void;
}

/**
 * Runs the container on nodes [startNode, endNode]
 */
export interface MultiNodeContainer {
  /**
   * The index of the first node to run this container
   *
   * The container is run on all nodes in the range [startNode, endNode] (inclusive)
   */
  readonly startNode: number;

  /**
   * The index of the last node to run this container.
   *
   * The container is run on all nodes in the range [startNode, endNode] (inclusive)
   */
  readonly endNode: number;

  /**
   * The container that this node range will run
   */
  readonly container: IEcsContainerDefinition;
}

/**
 * Props to configure a MultiNodeJobDefinition
 */
export interface MultiNodeJobDefinitionProps extends JobDefinitionProps {
  /**
   * The instance type that this job definition
   * will run.
   *
   * @default - optimal instance, selected by Batch
   */
  readonly instanceType?: InstanceType;

  /**
   * The containers that this multinode job will run.
   *
   * @see https://aws.amazon.com/blogs/compute/building-a-tightly-coupled-molecular-dynamics-workflow-with-multi-node-parallel-jobs-in-aws-batch/
   *
   * @default none
   */
  readonly containers?: MultiNodeContainer[];

  /**
   * The index of the main node in this job.
   * The main node is responsible for orchestration.
   *
   * @default 0
   */
  readonly mainNode?: number;

  /**
   * Whether to propagate tags from the JobDefinition
   * to the ECS task that Batch spawns
   *
   * @default false
   */
  readonly propagateTags?: boolean;
}

/**
 * The rendered container definition embedded in a node range's `container`. Replaces upstream's
 * inline `{ ...container.container._renderContainerDefinition(), instanceType: ... }` spread --
 * `ContainerPropertiesConfig` doesn't declare `instanceType` (it's multinode-only), so this
 * extends it with that one extra key.
 */
export interface MultiNodeContainerPropertiesConfig
  extends ContainerPropertiesConfig {
  readonly instanceType?: string;
}

/**
 * The rendered node-range entry, as embedded in `NodePropertiesConfig.nodeRangeProperties`.
 * Replaces upstream's `CfnJobDefinition.NodeRangePropertyProperty`.
 */
export interface NodeRangePropertyConfig {
  readonly targetNodes: string;
  readonly container: MultiNodeContainerPropertiesConfig;
}

/**
 * The plain node-properties JSON object embedded in the job definition's jsonencoded
 * `node_properties`. Replaces upstream's `CfnJobDefinition.NodePropertiesProperty`.
 */
export interface NodePropertiesConfig {
  readonly mainNode: number;
  readonly nodeRangeProperties: NodeRangePropertyConfig[] | IResolvable;
  readonly numNodes: number;
}

/**
 * A JobDefinition that uses Ecs orchestration to run multiple containers
 *
 * @resource aws_batch_job_definition
 */
export class MultiNodeJobDefinition
  extends JobDefinitionBase
  implements IMultiNodeJobDefinition
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.batch.MultiNodeJobDefinition";

  /**
   * refer to an existing JobDefinition by its arn
   */
  public static fromJobDefinitionArn(
    scope: Construct,
    id: string,
    jobDefinitionArn: string,
  ): IJobDefinition {
    const stack = AwsStack.ofAwsConstruct(scope);
    // TERRACONSTRUCTS DEVIATION: upstream keeps the `:revision` suffix here (so
    // `job-definition/my-job-def:7` imports as name `my-job-def:7`) while
    // `EcsJobDefinition.fromJobDefinitionArn()` strips it. The revision belongs to the
    // ARN, not the name - strip it consistently.
    const jobDefinitionName = stack
      .splitArn(jobDefinitionArn, ArnFormat.SLASH_RESOURCE_NAME)
      .resourceName!.split(":")[0];

    class Import extends JobDefinitionBase implements IJobDefinition {
      public readonly jobDefinitionArn = jobDefinitionArn;
      public readonly jobDefinitionName = jobDefinitionName;
      public readonly enabled = true;
    }

    return new Import(scope, id);
  }

  public readonly resource: batchJobDefinition.BatchJobDefinition;

  public readonly containers: MultiNodeContainer[];
  public readonly mainNode?: number;
  public readonly propagateTags?: boolean;

  public readonly jobDefinitionArn: string;
  public readonly jobDefinitionName: string;

  private readonly _instanceType?: InstanceType;

  constructor(
    scope: Construct,
    id: string,
    props?: MultiNodeJobDefinitionProps,
  ) {
    super(scope, id, props);

    this.containers = props?.containers ?? [];
    this.containers.forEach((c) => this.validateEc2Container(c));
    this.mainNode = props?.mainNode;
    this._instanceType = props?.instanceType;
    this.propagateTags = props?.propagateTags;

    // TERRACONSTRUCTS DEVIATION: the `aws_batch_job_definition` Terraform resource requires
    // `name` up front (no `name_prefix` support), so unlike upstream's CloudFormation-generated
    // physical name, an omitted `jobDefinitionName` resolves to a stack-scoped unique name here.
    const jobDefinitionName =
      props?.jobDefinitionName ??
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
        type: "multinode",
        propagateTags: this.propagateTags,
        // TERRACONSTRUCTS DEVIATION: upstream renders `nodeProperties` directly into the CFN L1's
        // typed `NodePropertiesProperty` (CloudFormation JSON-encodes the whole template at deploy
        // time). The `aws_batch_job_definition` Terraform resource instead takes `node_properties`
        // as a single jsonencoded string, so this builds the plain `NodePropertiesConfig` object and
        // hands it to `this.stack.toJsonString()` (itself a `Lazy.stringValue()`), which defers the
        // token-resolve-and-stringify step to synth time -- see `ecs-job-definition.ts`
        // `containerProperties` for the same pattern. Unlike that call site, `containers` here is
        // mutated after construction via `addContainer()`, so `nodeRangeProperties`/`numNodes` must
        // themselves be wrapped in `Lazy.anyValue()`/`Lazy.numberValue()` (matching upstream's own
        // `Lazy.any()`/`Lazy.number()` for the same reason) so the `this.containers` iteration is
        // deferred to synth time, not evaluated eagerly here.
        nodeProperties: this.stack.toJsonString(this.renderNodeProperties()),
        platformCapabilities: [Compatibility.EC2],
      },
    );

    this.jobDefinitionArn = this.resource.arn;
    this.jobDefinitionName = this.resource.name;

    this.node.addValidation({
      validate: () => validateContainers(this.containers, this.mainNode ?? 0),
    });
  }

  /**
   * If the prop `instanceType` is left `undefined`, then this
   * will hold a fake instance type, for backwards compatibility reasons.
   */
  public get instanceType(): InstanceType {
    if (!this._instanceType) {
      return new OptimalInstanceType();
    }

    return this._instanceType;
  }

  public addContainer(container: MultiNodeContainer) {
    this.validateEc2Container(container);
    this.containers.push(container);
  }

  /**
   * TERRACONSTRUCTS DEVIATION: upstream types `MultiNodeContainer.container` as the broad
   * `IEcsContainerDefinition` and silently accepts `EcsFargateContainerDefinition`, but AWS
   * Batch does not support Fargate for multi-node parallel jobs - the rendered configuration
   * is rejected at RegisterJobDefinition time (verified live: ClientException
   * "networkConfiguration not applicable for EC2."). The interface type is kept for upstream
   * API parity; reject Fargate containers at construction instead of failing at deploy.
   */
  private validateEc2Container(container: MultiNodeContainer): void {
    if (container.container instanceof EcsFargateContainerDefinition) {
      throw new ValidationError(
        `MultiNodeJobDefinition container for nodes ${container.startNode}:${container.endNode}` +
          " is an EcsFargateContainerDefinition, but AWS Batch multi-node parallel jobs" +
          " support only EC2 - use EcsEc2ContainerDefinition instead.",
        this,
      );
    }
  }

  private renderNodeProperties(): NodePropertiesConfig {
    return {
      mainNode: this.mainNode ?? 0,
      nodeRangeProperties: Lazy.anyValue({
        produce: () =>
          this.containers.map((container) => ({
            targetNodes: `${container.startNode}:${container.endNode}`,
            container: {
              ...container.container._renderContainerDefinition(),
              instanceType: this._instanceType?.toString(),
            },
          })),
      }),
      numNodes: Lazy.numberValue({
        produce: () => computeNumNodes(this.containers),
      }),
    };
  }
}

// With the topology validated (contiguous, non-overlapping ranges starting at node 0 -
// see validateContainers), the sum of inclusive range lengths equals highestEndNode + 1.
function computeNumNodes(containers: MultiNodeContainer[]) {
  let result = 0;

  for (const container of containers) {
    result += container.endNode - container.startNode + 1;
  }

  return result;
}

// TERRACONSTRUCTS DEVIATION: upstream only checks the containers array is non-empty, so
// gapped ranges undercount numNodes relative to the highest node index, overlapping ranges
// overcount, inverted ranges can even produce a negative numNodes, and mainNode is never
// checked - all deferring a malformed node_properties failure to Terraform/AWS. Validate
// the full topology (non-negative ordered ranges, no overlaps or gaps, coverage from node
// 0, mainNode within range) so numNodes is derived from a consistent topology.
function validateContainers(
  containers: MultiNodeContainer[],
  mainNode: number,
): string[] {
  if (containers.length === 0) {
    return ["multinode job has no containers!"];
  }

  const errors: string[] = [];
  for (const { startNode, endNode } of containers) {
    if (!Number.isInteger(startNode) || !Number.isInteger(endNode)) {
      errors.push(
        `node range ${startNode}:${endNode} is invalid - startNode and endNode must be integers`,
      );
    } else if (startNode < 0) {
      errors.push(
        `node range ${startNode}:${endNode} is invalid - startNode must be non-negative`,
      );
    } else if (endNode < startNode) {
      errors.push(
        `node range ${startNode}:${endNode} is invalid - endNode must be >= startNode`,
      );
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  const sorted = [...containers].sort((a, b) => a.startNode - b.startNode);
  if (sorted[0].startNode !== 0) {
    errors.push(
      `node ranges must start at node 0, but the lowest range starts at node ${sorted[0].startNode}`,
    );
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.startNode <= prev.endNode) {
      errors.push(
        `node ranges ${prev.startNode}:${prev.endNode} and ${curr.startNode}:${curr.endNode} overlap`,
      );
    } else if (curr.startNode !== prev.endNode + 1) {
      errors.push(
        `node ranges ${prev.startNode}:${prev.endNode} and ${curr.startNode}:${curr.endNode} leave a gap - ranges must cover every node exactly once`,
      );
    }
  }

  const highestEndNode = sorted[sorted.length - 1].endNode;
  if (
    !Number.isInteger(mainNode) ||
    mainNode < 0 ||
    mainNode > highestEndNode
  ) {
    errors.push(
      `mainNode ${mainNode} is not covered by the configured node ranges (0..${highestEndNode})`,
    );
  }

  return errors;
}
