// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/unmanaged-compute-environment.ts

import { batchComputeEnvironment } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import {
  IComputeEnvironment,
  ComputeEnvironmentBase,
  ComputeEnvironmentProps,
} from "./compute-environment-base";
import { ValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";
import * as iam from "../../iam";

/**
 * Represents an UnmanagedComputeEnvironment. Batch will not provision instances on your behalf
 * in this ComputeEvironment.
 */
export interface IUnmanagedComputeEnvironment extends IComputeEnvironment {
  /**
   * The vCPUs this Compute Environment provides. Used only by the
   * scheduler to schedule jobs in `Queue`s that use `FairshareSchedulingPolicy`s.
   *
   * **If this parameter is not provided on a fairshare queue, no capacity is reserved**;
   * that is, the `FairshareSchedulingPolicy` is ignored.
   */
  readonly unmanagedvCPUs?: number;
}

/**
 * Represents an UnmanagedComputeEnvironment. Batch will not provision instances on your behalf
 * in this ComputeEvironment.
 */
export interface UnmanagedComputeEnvironmentProps
  extends ComputeEnvironmentProps {
  /**
   * The vCPUs this Compute Environment provides. Used only by the
   * scheduler to schedule jobs in `Queue`s that use `FairshareSchedulingPolicy`s.
   *
   * **If this parameter is not provided on a fairshare queue, no capacity is reserved**;
   * that is, the `FairshareSchedulingPolicy` is ignored.
   *
   * // TERRACONSTRUCTS DEVIATION: NOT SUPPORTED - the aws_batch_compute_environment
   * Terraform resource cannot express this Batch API parameter, so supplying it throws a
   * `ValidationError` at construction (fail-fast) instead of silently deploying a compute
   * environment without the requested capacity.
   *
   * @default 0
   */
  readonly unmanagedvCpus?: number;

  /**
   * A prefix used to generate the `computeEnvironmentName`. Terraform generates a unique
   * suffix for the resulting name.
   *
   * Conflicts with `computeEnvironmentName`.
   *
   * @default - If omitted, TerraConstructs will assign a random, unique name prefixed by GridUUID.
   */
  readonly computeEnvironmentNamePrefix?: string;
}

/**
 * Unmanaged ComputeEnvironments do not provision or manage EC2 instances on your behalf.
 *
 * @resource aws_batch_compute_environment
 */
export class UnmanagedComputeEnvironment
  extends ComputeEnvironmentBase
  implements IUnmanagedComputeEnvironment
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.batch.UnmanagedComputeEnvironment";

  /**
   * Import an UnmanagedComputeEnvironment by its arn
   */
  public static fromUnmanagedComputeEnvironmentArn(
    scope: Construct,
    id: string,
    unmanagedComputeEnvironmentArn: string,
  ): IUnmanagedComputeEnvironment {
    const stack = AwsStack.ofAwsConstruct(scope);
    const computeEnvironmentName = stack.splitArn(
      unmanagedComputeEnvironmentArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).resourceName!;

    class Import
      extends ComputeEnvironmentBase
      implements IUnmanagedComputeEnvironment
    {
      public readonly computeEnvironmentArn = unmanagedComputeEnvironmentArn;
      public readonly computeEnvironmentName = computeEnvironmentName;
      public readonly enabled = true;
      public readonly containerDefinition = {} as any;
    }

    return new Import(scope, id, {
      environmentFromArn: unmanagedComputeEnvironmentArn,
    });
  }

  public readonly resource: batchComputeEnvironment.BatchComputeEnvironment;

  public readonly unmanagedvCPUs?: number | undefined;
  public readonly computeEnvironmentArn: string;
  public readonly computeEnvironmentName: string;

  constructor(
    scope: Construct,
    id: string,
    props?: UnmanagedComputeEnvironmentProps,
  ) {
    super(scope, id, props);

    this.unmanagedvCPUs = props?.unmanagedvCpus;

    // TERRACONSTRUCTS DEVIATION (fail-fast): the `aws_batch_compute_environment` Terraform
    // resource has no attribute for the Batch CreateComputeEnvironment `unmanagedvCpus`
    // parameter (verified against @cdktn/provider-aws 6.52.0), so a supplied value would
    // synthesize and deploy a compute environment WITHOUT the requested vCPU capacity --
    // silently breaking FairshareSchedulingPolicy capacity reservations. Upstream forwards
    // it to CloudFormation; until the provider exposes it, reject it loudly rather than
    // dropping it.
    if (props?.unmanagedvCpus !== undefined) {
      throw new ValidationError(
        "unmanagedvCpus is not supported: the Terraform provider's" +
          " aws_batch_compute_environment resource cannot express the Batch" +
          " 'unmanagedvCpus' parameter, so the value would be silently ignored at" +
          " deploy time. Omit it (and manage unmanaged capacity outside Terraform)" +
          " until provider support exists.",
        this,
      );
    }

    // gridUUID physical naming (HARD REPO INVARIANT): the `aws_batch_compute_environment`
    // Terraform resource exposes both `name` (exact) and `name_prefix` (Terraform-generated
    // unique suffix); mirror the bucket.ts/state-machine.ts hybrid model rather than upstream's
    // CloudFormation-only `computeEnvironmentName`.
    if (props?.computeEnvironmentName && props?.computeEnvironmentNamePrefix) {
      throw new ValidationError(
        "Cannot specify both 'computeEnvironmentName' and 'computeEnvironmentNamePrefix'. Use only one.",
        this,
      );
    }
    const namePrefix = props?.computeEnvironmentName
      ? undefined
      : this.stack.uniqueResourceNamePrefix(this, {
          prefix: (props?.computeEnvironmentNamePrefix ?? this.gridUUID) + "-",
          allowedSpecialCharacters: "_-",
          maxLength: 128,
        });

    this.resource = new batchComputeEnvironment.BatchComputeEnvironment(
      this,
      "Resource",
      {
        // NOTE: upstream CDK passes the lowercase CFN enum literal 'unmanaged'; the Terraform
        // provider forwards `type` verbatim to the Batch API, so the canonical uppercase
        // `ComputeEnvironmentType` enum value is used here instead.
        type: "UNMANAGED",
        state: this.enabled ? "ENABLED" : "DISABLED",
        name: props?.computeEnvironmentName,
        namePrefix,
        serviceRole:
          props?.serviceRole?.roleArn ??
          new iam.Role(this, "BatchServiceRole", {
            managedPolicies: [
              iam.ManagedPolicy.fromAwsManagedPolicyName(
                this,
                "AWSBatchServiceRole",
                "service-role/AWSBatchServiceRole",
              ),
            ],
            assumedBy: new iam.ServicePrincipal("batch.amazonaws.com"),
          }).roleArn,
        // TERRACONSTRUCTS DEVIATION: `unmanagedvCpus` has no counterpart on
        // `BatchComputeEnvironmentConfig` (verified against @cdktn/provider-aws 6.52.0) even though
        // the underlying Batch CreateComputeEnvironment API accepts it; the Terraform provider
        // simply does not expose it. `unmanagedvCPUs` is preserved as a construct-level property
        // (for FairshareSchedulingPolicy-aware `JobQueue`s to read) but cannot be forwarded to the
        // L1 resource.
      },
    );
    this.computeEnvironmentName = this.resource.name;
    this.computeEnvironmentArn = this.resource.arn;
  }
}
