// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/base/_imported-task-definition.ts

import { Construct } from "constructs";
import {
  Compatibility,
  NetworkMode,
  isEc2Compatible,
  isFargateCompatible,
  isExternalCompatible,
  isManagedInstancesCompatible,
} from "./task-definition";
import { ValidationError } from "../../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../../aws-construct";
import * as iam from "../../../iam";
import { IEc2TaskDefinition } from "../ec2/ec2-task-definition";
import { IFargateTaskDefinition } from "../fargate/fargate-task-definition";

/**
 * The properties of ImportedTaskDefinition
 */
export interface ImportedTaskDefinitionProps extends AwsConstructProps {
  /**
   * The arn of the task definition
   */
  readonly taskDefinitionArn: string;

  /**
   * What launch types this task definition should be compatible with.
   *
   * @default Compatibility.EC2_AND_FARGATE
   */
  readonly compatibility?: Compatibility;

  /**
   * The networking mode to use for the containers in the task.
   *
   * @default Network mode cannot be provided to the imported task.
   */
  readonly networkMode?: NetworkMode;

  /**
   * The name of the IAM role that grants containers in the task permission to call AWS APIs on your behalf.
   *
   * @default Permissions cannot be granted to the imported task.
   */
  readonly taskRole?: iam.IRole;

  /**
   * The IAM role that grants containers and Fargate agents permission to make AWS API calls on your behalf.
   *
   * Some tasks do not have an execution role.
   *
   * @default - undefined
   */
  readonly executionRole?: iam.IRole;
}

/**
 * Task definition reference of an imported task
 */
export class ImportedTaskDefinition
  extends AwsConstructBase
  implements IEc2TaskDefinition, IFargateTaskDefinition
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.ecs.ImportedTaskDefinition";
  /**
   * What launch types this task definition should be compatible with.
   */
  readonly compatibility: Compatibility;

  /**
   * ARN of this task definition
   */
  readonly taskDefinitionArn: string;

  /**
   * Execution role for this task definition
   */
  readonly executionRole?: iam.IRole = undefined;

  /**
   * The networking mode to use for the containers in the task.
   */
  readonly _networkMode?: NetworkMode;

  /**
   * The name of the IAM role that grants containers in the task permission to call AWS APIs on your behalf.
   */
  readonly _taskRole?: iam.IRole;

  constructor(
    scope: Construct,
    id: string,
    props: ImportedTaskDefinitionProps,
  ) {
    super(scope, id, props);

    this.compatibility = props.compatibility ?? Compatibility.EC2_AND_FARGATE;
    this.taskDefinitionArn = props.taskDefinitionArn;
    this.executionRole = props.executionRole;
    this._taskRole = props.taskRole;
    this._networkMode = props.networkMode;
  }

  public get networkMode(): NetworkMode {
    if (this._networkMode == undefined) {
      throw new ValidationError(
        "This operation requires the networkMode in ImportedTaskDefinition to be defined. " +
          "Add the 'networkMode' in ImportedTaskDefinitionProps to instantiate ImportedTaskDefinition",
        this,
      );
    } else {
      return this._networkMode;
    }
  }

  public get taskRole(): iam.IRole {
    if (this._taskRole == undefined) {
      throw new ValidationError(
        "This operation requires the taskRole in ImportedTaskDefinition to be defined. " +
          "Add the 'taskRole' in ImportedTaskDefinitionProps to instantiate ImportedTaskDefinition",
        this,
      );
    } else {
      return this._taskRole;
    }
  }

  /**
   * Return true if the task definition can be run on an EC2 cluster
   */
  public get isEc2Compatible(): boolean {
    return isEc2Compatible(this.compatibility);
  }

  /**
   * Return true if the task definition can be run on a Fargate cluster
   */
  public get isFargateCompatible(): boolean {
    return isFargateCompatible(this.compatibility);
  }

  /**
   * Return true if the task definition can be run on a ECS Anywhere cluster
   */
  public get isExternalCompatible(): boolean {
    return isExternalCompatible(this.compatibility);
  }

  /**
   * Return true if the task definition can be run on Managed Instances
   */
  public get isManagedInstancesCompatible(): boolean {
    return isManagedInstancesCompatible(this.compatibility);
  }

  /**
   * Outputs for this imported task definition. `family` is omitted: unlike
   * `TaskDefinition`, an imported-by-ARN reference never has a family
   * available (imported/partial resource — unavailable keys are omitted,
   * never emitted as "" or null/undefined).
   */
  public get outputs(): Record<string, any> {
    return {
      arn: this.taskDefinitionArn,
    };
  }
}
