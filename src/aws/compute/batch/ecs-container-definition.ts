// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/ecs-container-definition.ts

import { IResolvable, Lazy } from "cdktn";
import { Construct, IConstruct } from "constructs";
import { LinuxParameters, LinuxParametersConfig } from "./linux-parameters";
import { ValidationError } from "../../../errors";
import { Size } from "../../../size";
import { LogGroup } from "../../cloudwatch";
import { ISecret } from "../../encryption";
import * as iam from "../../iam";
import { IParameter } from "../../storage";
import * as ecs from "../ecs";

const HOST_VOLUME_SYMBOL = Symbol.for(
  "terraconstructs/aws/compute/batch/ecs-container-definition.HostVolume",
);

/**
 * Specify the secret's version id or version stage
 */
export interface SecretVersionInfo {
  /**
   * version id of the secret
   *
   * @default - use default version id
   */
  readonly versionId?: string;
  /**
   * version stage of the secret
   *
   * @default - use default version stage
   */
  readonly versionStage?: string;
}

/**
 * A secret environment variable.
 */
export abstract class Secret {
  /**
   * Creates an environment variable value from a parameter stored in AWS
   * Systems Manager Parameter Store.
   */
  public static fromSsmParameter(parameter: IParameter): Secret {
    return {
      arn: parameter.parameterArn,
      grantRead: (grantee) => parameter.grantRead(grantee),
    };
  }

  /**
   * Creates a environment variable value from a secret stored in AWS Secrets
   * Manager.
   *
   * @param secret the secret stored in AWS Secrets Manager
   * @param field the name of the field with the value that you want to set as
   * the environment variable value. Only values in JSON format are supported.
   * If you do not specify a JSON field, then the full content of the secret is
   * used.
   */
  public static fromSecretsManager(secret: ISecret, field?: string): Secret {
    return {
      arn: field ? `${secret.secretArn}:${field}::` : secret.secretArn,
      hasField: !!field,
      grantRead: (grantee) => secret.grantRead(grantee),
    };
  }

  /**
   * Creates a environment variable value from a secret stored in AWS Secrets
   * Manager.
   *
   * @param secret the secret stored in AWS Secrets Manager
   * @param versionInfo the version information to reference the secret
   * @param field the name of the field with the value that you want to set as
   * the environment variable value. Only values in JSON format are supported.
   * If you do not specify a JSON field, then the full content of the secret is
   * used.
   */
  public static fromSecretsManagerVersion(
    secret: ISecret,
    versionInfo: SecretVersionInfo,
    field?: string,
  ): Secret {
    return {
      arn: `${secret.secretArn}:${field ?? ""}:${versionInfo.versionStage ?? ""}:${versionInfo.versionId ?? ""}`,
      hasField: !!field,
      grantRead: (grantee) => secret.grantRead(grantee),
    };
  }

  /**
   * The ARN of the secret
   */
  public abstract readonly arn: string;

  /**
   * Whether this secret uses a specific JSON field
   */
  public abstract readonly hasField?: boolean;

  /**
   * Grants reading the secret to a principal
   */
  public abstract grantRead(grantee: iam.IGrantable): iam.Grant;
}

/**
 * Options to configure an EcsVolume
 */
export interface EcsVolumeOptions {
  /**
   * the name of this volume
   */
  readonly name: string;

  /**
   * the path on the container where this volume is mounted
   */
  readonly containerPath: string;

  /**
   * if set, the container will have readonly access to the volume
   *
   * @default false
   */
  readonly readonly?: boolean;
}

/**
 * Represents a Volume that can be mounted to a container that uses ECS
 */
export abstract class EcsVolume {
  // TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/ecs-container-definition.ts#L133-L136

  /**
   * Creates a Host volume. This volume will persist on the host at the specified `hostPath`.
   * If the `hostPath` is not specified, Docker will choose the host path. In this case,
   * the data may not persist after the containers that use it stop running.
   */
  static host(options: HostVolumeOptions) {
    return new HostVolume(options);
  }

  /**
   * The name of this volume
   */
  public readonly name: string;

  /**
   * The path on the container that this volume will be mounted to
   */
  public readonly containerPath: string;

  /**
   * Whether or not the container has readonly access to this volume
   *
   * @default false
   */
  public readonly readonly?: boolean;

  constructor(options: EcsVolumeOptions) {
    this.name = options.name;
    this.containerPath = options.containerPath;
    this.readonly = options.readonly;
  }
}

// TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/ecs-container-definition.ts#L173-L233

// TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/ecs-container-definition.ts#L234-L308

/**
 * Options for configuring an ECS HostVolume
 */
export interface HostVolumeOptions extends EcsVolumeOptions {
  /**
   * The path on the host machine this container will have access to
   *
   * @default - Docker will choose the host path.
   * The data may not persist after the containers that use it stop running.
   */
  readonly hostPath?: string;
}

/**
 * Creates a Host volume. This volume will persist on the host at the specified `hostPath`.
 * If the `hostPath` is not specified, Docker will choose the host path. In this case,
 * the data may not persist after the containers that use it stop running.
 */
export class HostVolume extends EcsVolume {
  /**
   * returns `true` if `x` is a `HostVolume`, `false` otherwise
   */
  public static isHostVolume(x: any): x is HostVolume {
    return x !== null && typeof x === "object" && HOST_VOLUME_SYMBOL in x;
  }

  /**
   * The path on the host machine this container will have access to
   */
  public readonly hostPath?: string;

  constructor(options: HostVolumeOptions) {
    super(options);
    this.hostPath = options.hostPath;
  }
}

Object.defineProperty(HostVolume.prototype, HOST_VOLUME_SYMBOL, {
  value: true,
  enumerable: false,
  writable: false,
});

/**
 * A container that can be run with ECS orchestration
 */
export interface IEcsContainerDefinition extends IConstruct {
  /**
   * The image that this container will run
   */
  readonly image: ecs.ContainerImage;

  /**
   * The number of vCPUs reserved for the container.
   * Each vCPU is equivalent to 1,024 CPU shares.
   * For containers running on EC2 resources, you must specify at least one vCPU.
   */
  readonly cpu: number;

  /**
   * The memory hard limit present to the container.
   * If your container attempts to exceed the memory specified, the container is terminated.
   * You must specify at least 4 MiB of memory for a job.
   */
  readonly memory: Size;

  /**
   * The command that's passed to the container
   *
   * @see https://docs.docker.com/engine/reference/builder/#cmd
   */
  readonly command?: string[];

  /**
   * The environment variables to pass to a container.
   * Cannot start with `AWS_BATCH`.
   * We don't recommend using plaintext environment variables for sensitive information, such as credential data.
   *
   * @default - no environment variables
   */
  readonly environment?: { [key: string]: string };

  /**
   * The role used by Amazon ECS container and AWS Fargate agents to make AWS API calls on your behalf.
   *
   * @see https://docs.aws.amazon.com/batch/latest/userguide/execution-IAM-role.html
   */
  readonly executionRole: iam.IRole;

  /**
   * The role that the container can assume.
   *
   * @default - no jobRole
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
   */
  readonly jobRole?: iam.IRole;

  /**
   * Linux-specific modifications that are applied to the container, such as details for device mappings.
   *
   * @default none
   */
  readonly linuxParameters?: LinuxParameters;

  /**
   * The configuration of the log driver
   */
  readonly logDriverConfig?: ecs.LogDriverConfig;

  /**
   * Gives the container readonly access to its root filesystem.
   *
   * @default false
   */
  readonly readonlyRootFilesystem?: boolean;

  /**
   * A map from environment variable names to the secrets for the container. Allows your job definitions
   * to reference the secret by the environment variable name defined in this property.
   *
   * @see https://docs.aws.amazon.com/batch/latest/userguide/specifying-sensitive-data.html
   *
   * @default - no secrets
   */
  readonly secrets?: { [envVarName: string]: Secret };

  /**
   * The user name to use inside the container
   *
   * @default - no user
   */
  readonly user?: string;

  /**
   * The volumes to mount to this container. Automatically added to the job definition.
   *
   * @default - no volumes
   */
  readonly volumes: EcsVolume[];

  /**
   * Whether to enable ecs exec for this container.
   *
   * @default undefined - AWS Batch default is false
   */
  readonly enableExecuteCommand?: boolean;

  /**
   * Renders this container to the plain container-properties JSON object embedded in the job
   * definition's jsonencoded `container_properties`.
   *
   * @internal
   */
  _renderContainerDefinition(): ContainerPropertiesConfig;

  /**
   * Add a Volume to this container
   */
  addVolume(volume: EcsVolume): void;
}

/**
 * Props to configure an EcsContainerDefinition
 */
export interface EcsContainerDefinitionProps {
  /**
   * The image that this container will run
   */
  readonly image: ecs.ContainerImage;

  /**
   * The number of vCPUs reserved for the container.
   * Each vCPU is equivalent to 1,024 CPU shares.
   * For containers running on EC2 resources, you must specify at least one vCPU.
   */
  readonly cpu: number;

  /**
   * The memory hard limit present to the container.
   * If your container attempts to exceed the memory specified, the container is terminated.
   * You must specify at least 4 MiB of memory for a job.
   */
  readonly memory: Size;

  /**
   * The command that's passed to the container
   *
   * @see https://docs.docker.com/engine/reference/builder/#cmd
   *
   * @default - no command
   */
  readonly command?: string[];

  /**
   * The environment variables to pass to a container.
   * Cannot start with `AWS_BATCH`.
   * We don't recommend using plaintext environment variables for sensitive information, such as credential data.
   *
   * @default - no environment variables
   */
  readonly environment?: { [key: string]: string };

  /**
   * The role used by Amazon ECS container and AWS Fargate agents to make AWS API calls on your behalf.
   *
   * @see https://docs.aws.amazon.com/batch/latest/userguide/execution-IAM-role.html
   *
   * @default - a Role will be created
   */
  readonly executionRole?: iam.IRole;

  /**
   * The role that the container can assume.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html
   *
   * @default - no job role
   */
  readonly jobRole?: iam.IRole;

  /**
   * Linux-specific modifications that are applied to the container, such as details for device mappings.
   *
   * @default none
   */
  readonly linuxParameters?: LinuxParameters;

  /**
   * The loging configuration for this Job
   *
   * @default - the log configuration of the Docker daemon
   */
  readonly logging?: ecs.LogDriver;

  /**
   * Gives the container readonly access to its root filesystem.
   *
   * @default false
   */
  readonly readonlyRootFilesystem?: boolean;

  /**
   * A map from environment variable names to the secrets for the container. Allows your job definitions
   * to reference the secret by the environment variable name defined in this property.
   *
   * @see https://docs.aws.amazon.com/batch/latest/userguide/specifying-sensitive-data.html
   *
   * @default - no secrets
   */
  readonly secrets?: { [envVarName: string]: Secret };

  /**
   * The user name to use inside the container
   *
   * @default - no user
   */
  readonly user?: string;

  /**
   * The volumes to mount to this container. Automatically added to the job definition.
   *
   * @default - no volumes
   */
  readonly volumes?: EcsVolume[];

  /**
   * Determines whether execute command functionality is turned on for this task.
   *
   * If true, execute command functionality is turned on all the containers in the task.
   *
   * This allows you to use ECS Exec to access containers interactively.
   * When enabled, a job role with required SSM permissions will be created automatically if no job role is provided.
   * If a job role is alreadyprovided, the required permissions will be added to it.
   *
   * @default undefined - AWS Batch default is false
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html
   */
  readonly enableExecuteCommand?: boolean;
}

/**
 * Abstract base class for ECS Containers
 */
abstract class EcsContainerDefinitionBase
  extends Construct
  implements IEcsContainerDefinition
{
  public readonly image: ecs.ContainerImage;
  public readonly cpu: number;
  public readonly memory: Size;
  public readonly command?: string[];
  public readonly environment?: { [key: string]: string };
  public readonly executionRole: iam.IRole;
  public readonly jobRole?: iam.IRole;
  public readonly linuxParameters?: LinuxParameters;
  public readonly logDriverConfig?: ecs.LogDriverConfig;
  public readonly readonlyRootFilesystem?: boolean;
  public readonly secrets?: { [envVarName: string]: Secret };
  public readonly user?: string;
  public readonly volumes: EcsVolume[];
  public readonly enableExecuteCommand?: boolean;

  private readonly imageConfig: ecs.ContainerImageConfig;

  constructor(
    scope: Construct,
    id: string,
    props: EcsContainerDefinitionProps,
  ) {
    super(scope, id);

    this.image = props.image;
    this.cpu = props.cpu;
    this.command = props.command;
    this.environment = props.environment;
    this.executionRole =
      props.executionRole ??
      createExecutionRole(this, "ExecutionRole", props.logging ? true : false);
    this.enableExecuteCommand = props.enableExecuteCommand;
    this.jobRole = this.handleJobRoleForEcsExec(props);
    this.linuxParameters = props.linuxParameters;
    this.memory = props.memory;

    if (props.logging) {
      this.logDriverConfig = props.logging.bind(this, {
        ...(this as any),
        // TS!
        taskDefinition: {
          obtainExecutionRole: () => this.executionRole,
        },
      });
    }

    this.readonlyRootFilesystem = props.readonlyRootFilesystem ?? false;
    this.secrets = props.secrets;
    this.user = props.user;
    this.volumes = props.volumes ?? [];

    this.imageConfig = props.image.bind(this, {
      ...(this as any),
      taskDefinition: {
        obtainExecutionRole: () => this.executionRole,
      },
    });
  }

  /**
   * Renders this container to the plain container-properties JSON object embedded in the job
   * definition's jsonencoded `container_properties`.
   *
   * // TERRACONSTRUCTS DEVIATION: upstream renders to `CfnJobDefinition.ContainerPropertiesProperty`
   * (a CloudFormation L1 property type). There is no CFN L1 backing this construct in
   * TerraConstructs -- the `aws_batch_job_definition` resource takes `container_properties` as a
   * single JSON-encoded string, so this renders directly to the plain `ContainerPropertiesConfig`
   * shape that feeds that JSON blob. The key casing is kept as CFN camelCase (NOT snake_case)
   * because it mirrors the AWS Batch API's JSON shape, not a Terraform-schema nested block.
   *
   * @internal
   */
  public _renderContainerDefinition(): ContainerPropertiesConfig {
    return {
      image: this.imageConfig.imageName,
      command: this.command,
      environment: Object.keys(this.environment ?? {}).map((envKey) => ({
        name: envKey,
        value: (this.environment ?? {})[envKey],
      })),
      jobRoleArn: this.jobRole?.roleArn,
      executionRoleArn: this.executionRole?.roleArn,
      linuxParameters:
        this.linuxParameters && this.linuxParameters.renderLinuxParameters(),
      logConfiguration: this.logDriverConfig,
      readonlyRootFilesystem: this.readonlyRootFilesystem,
      resourceRequirements: this._renderResourceRequirements(),
      secrets: this.secrets
        ? Object.entries(this.secrets).map(([name, secret]) => {
            secret.grantRead(this.executionRole);

            return {
              name,
              valueFrom: secret.arn,
            };
          })
        : undefined,
      mountPoints: Lazy.anyValue(
        {
          produce: () =>
            this.volumes.map((volume) => {
              return {
                containerPath: volume.containerPath,
                readOnly: volume.readonly,
                sourceVolume: volume.name,
              };
            }),
        },
        { omitEmptyArray: true },
      ),
      volumes: Lazy.anyValue(
        {
          produce: () =>
            this.volumes.map((volume) => {
              if (HostVolume.isHostVolume(volume)) {
                return {
                  name: volume.name,
                  host: {
                    sourcePath: volume.hostPath,
                  },
                };
              }

              // TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/ecs-container-definition.ts#L699-L712
              throw new ValidationError("unsupported Volume encountered", this);
            }),
        },
        { omitEmptyArray: true },
      ),
      user: this.user,
      enableExecuteCommand: this.enableExecuteCommand,
    };
  }

  public addVolume(volume: EcsVolume): void {
    this.volumes.push(volume);
  }

  /**
   * @internal
   */
  protected _renderResourceRequirements(): ResourceRequirementConfig[] {
    const resourceRequirements: ResourceRequirementConfig[] = [];

    resourceRequirements.push({
      type: "MEMORY",
      value: this.memory.toMebibytes().toString(),
    });

    resourceRequirements.push({
      type: "VCPU",
      value: this.cpu.toString(),
    });

    return resourceRequirements;
  }

  /**
   * Handles job role setup for ECS Exec functionality
   * @internal
   */
  private handleJobRoleForEcsExec(
    props: EcsContainerDefinitionProps,
  ): iam.IRole | undefined {
    if (props.enableExecuteCommand) {
      if (props.jobRole) {
        // If job role is provided and ECS Exec is enabled, add required permissions
        this.addEcsExecPermissions(props.jobRole);
        return props.jobRole;
      } else {
        // If no job role is provided but ECS Exec is enabled, create one with required permissions
        return this.createJobRoleWithEcsExecPermissions();
      }
    } else {
      // If ECS Exec is not enabled, just use the provided job role (if any)
      return props.jobRole;
    }
  }

  /**
   * Creates a new job role with ECS Exec permissions
   * @internal
   */
  private createJobRoleWithEcsExecPermissions(): iam.IRole {
    // TERRACONSTRUCTS DEVIATION: upstream additionally sets `roleName: PhysicalName.GENERATE_IF_NEEDED`
    // here. This repo's `iam.Role` already auto-generates a physical name whenever `roleName` is
    // omitted, so no equivalent opt-in is required (see `ecs/base/task-definition.ts`
    // `obtainExecutionRole()` for the same deviation).
    const role = new iam.Role(this, "JobRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    this.addEcsExecPermissions(role);
    return role;
  }

  /**
   * Adds ECS Exec required permissions to a role
   * @internal
   */
  private addEcsExecPermissions(role: iam.IRole): void {
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        resources: ["*"],
      }),
    );
  }
}

/**
 * Sets limits for a resource with `ulimit` on linux systems.
 * Used by the Docker daemon.
 */
export interface Ulimit {
  /**
   * The hard limit for this resource. The container will
   * be terminated if it exceeds this limit.
   */
  readonly hardLimit: number;

  /**
   * The resource to limit
   */
  readonly name: UlimitName;

  /**
   * The reservation for this resource. The container will
   * not be terminated if it exceeds this limit.
   */
  readonly softLimit: number;
}

/**
 * The resources to be limited
 */
export enum UlimitName {
  /**
   * max core dump file size
   */
  CORE = "core",

  /**
   * max cpu time (seconds) for a process
   */
  CPU = "cpu",

  /**
   * max data segment size
   */
  DATA = "data",

  /**
   * max file size
   */
  FSIZE = "fsize",

  /**
   * max number of file locks
   */
  LOCKS = "locks",

  /**
   * max locked memory
   */
  MEMLOCK = "memlock",

  /**
   * max POSIX message queue size
   */
  MSGQUEUE = "msgqueue",

  /**
   * max nice value for any process this user is running
   */
  NICE = "nice",

  /**
   * maximum number of open file descriptors
   */
  NOFILE = "nofile",

  /**
   * maximum number of processes
   */
  NPROC = "nproc",

  /**
   * size of the process' resident set (in pages)
   */
  RSS = "rss",

  /**
   * max realtime priority
   */
  RTPRIO = "rtprio",

  /**
   * timeout for realtime tasks
   */
  RTTIME = "rttime",

  /**
   * max number of pending signals
   */
  SIGPENDING = "sigpending",

  /**
   * max stack size (in bytes)
   */
  STACK = "stack",
}

/**
 * A container orchestrated by ECS that uses EC2 resources
 */
export interface IEcsEc2ContainerDefinition extends IEcsContainerDefinition {
  /**
   * When this parameter is true, the container is given elevated permissions on the host container instance (similar to the root user).
   *
   * @default false
   */
  readonly privileged?: boolean;

  /**
   * Limits to set for the user this docker container will run as
   */
  readonly ulimits: Ulimit[];

  /**
   * The number of physical GPUs to reserve for the container.
   * Make sure that the number of GPUs reserved for all containers in a job doesn't exceed
   * the number of available GPUs on the compute resource that the job is launched on.
   *
   * @default - no gpus
   */
  readonly gpu?: number;

  /**
   * Add a ulimit to this container
   */
  addUlimit(ulimit: Ulimit): void;
}

/**
 * Props to configure an EcsEc2ContainerDefinition
 */
export interface EcsEc2ContainerDefinitionProps
  extends EcsContainerDefinitionProps {
  /**
   * When this parameter is true, the container is given elevated permissions on the host container instance (similar to the root user).
   *
   * @default false
   */
  readonly privileged?: boolean;

  /**
   * Limits to set for the user this docker container will run as
   *
   * @default - no ulimits
   */
  readonly ulimits?: Ulimit[];

  /**
   * The number of physical GPUs to reserve for the container.
   * Make sure that the number of GPUs reserved for all containers in a job doesn't exceed
   * the number of available GPUs on the compute resource that the job is launched on.
   *
   * @default - no gpus
   */
  readonly gpu?: number;
}

/**
 * A container orchestrated by ECS that uses EC2 resources
 */
export class EcsEc2ContainerDefinition
  extends EcsContainerDefinitionBase
  implements IEcsEc2ContainerDefinition
{
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.batch.EcsEc2ContainerDefinition";

  public readonly privileged?: boolean;
  public readonly ulimits: Ulimit[];
  public readonly gpu?: number;

  constructor(
    scope: Construct,
    id: string,
    props: EcsEc2ContainerDefinitionProps,
  ) {
    super(scope, id, props);
    this.privileged = props.privileged;
    this.ulimits = props.ulimits ?? [];
    this.gpu = props.gpu;
  }

  /**
   * @internal
   */
  public _renderContainerDefinition(): ContainerPropertiesConfig {
    return {
      ...super._renderContainerDefinition(),
      ulimits: Lazy.anyValue(
        {
          produce: () =>
            this.ulimits.map((ulimit) => ({
              hardLimit: ulimit.hardLimit,
              name: ulimit.name,
              softLimit: ulimit.softLimit,
            })),
        },
        { omitEmptyArray: true },
      ),
      privileged: this.privileged,
      resourceRequirements: this._renderResourceRequirements(),
    };
  }

  /**
   * Add a ulimit to this container
   */
  addUlimit(ulimit: Ulimit): void {
    this.ulimits.push(ulimit);
  }

  /**
   * @internal
   */
  protected _renderResourceRequirements(): ResourceRequirementConfig[] {
    const resourceRequirements = super._renderResourceRequirements();
    if (this.gpu) {
      resourceRequirements.push({
        type: "GPU",
        value: this.gpu.toString(),
      });
    }

    return resourceRequirements;
  }
}

/**
 * A container orchestrated by ECS that uses Fargate resources and is orchestrated by ECS
 */
export interface IEcsFargateContainerDefinition
  extends IEcsContainerDefinition {
  /**
   * Indicates whether the job has a public IP address.
   * For a job that's running on Fargate resources in a private subnet to send outbound traffic to the internet
   * (for example, to pull container images), the private subnet requires a NAT gateway be attached to route requests to the internet.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking.html
   *
   * @default false
   */
  readonly assignPublicIp?: boolean;

  /**
   * Which version of Fargate to use when running this container
   *
   * @default LATEST
   */
  readonly fargatePlatformVersion?: ecs.FargatePlatformVersion;

  /**
   * The size for ephemeral storage.
   *
   * @default - 20 GiB
   */
  readonly ephemeralStorageSize?: Size;

  /**
   * The vCPU architecture of Fargate Runtime.
   *
   * @default - X86_64
   */
  readonly fargateCpuArchitecture?: ecs.CpuArchitecture;

  /**
   * The operating system for the compute environment.
   *
   * @default - LINUX
   */
  readonly fargateOperatingSystemFamily?: ecs.OperatingSystemFamily;
}

/**
 * Props to configure an EcsFargateContainerDefinition
 */
export interface EcsFargateContainerDefinitionProps
  extends EcsContainerDefinitionProps {
  /**
   * Indicates whether the job has a public IP address.
   * For a job that's running on Fargate resources in a private subnet to send outbound traffic to the internet
   * (for example, to pull container images), the private subnet requires a NAT gateway be attached to route requests to the internet.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking.html
   *
   * @default false
   */
  readonly assignPublicIp?: boolean;

  /**
   * Which version of Fargate to use when running this container
   *
   * @default LATEST
   */
  readonly fargatePlatformVersion?: ecs.FargatePlatformVersion;

  /**
   * The size for ephemeral storage.
   *
   * @default - 20 GiB
   */
  readonly ephemeralStorageSize?: Size;

  /**
   * The vCPU architecture of Fargate Runtime.
   *
   * @default - X86_64
   */
  readonly fargateCpuArchitecture?: ecs.CpuArchitecture;

  /**
   * The operating system for the compute environment.
   *
   * @default - LINUX
   */
  readonly fargateOperatingSystemFamily?: ecs.OperatingSystemFamily;
}

/**
 * A container orchestrated by ECS that uses Fargate resources
 */
export class EcsFargateContainerDefinition
  extends EcsContainerDefinitionBase
  implements IEcsFargateContainerDefinition
{
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.batch.EcsFargateContainerDefinition";

  public readonly fargatePlatformVersion?: ecs.FargatePlatformVersion;
  public readonly assignPublicIp?: boolean;
  public readonly ephemeralStorageSize?: Size;
  public readonly fargateCpuArchitecture?: ecs.CpuArchitecture;
  public readonly fargateOperatingSystemFamily?: ecs.OperatingSystemFamily;

  constructor(
    scope: Construct,
    id: string,
    props: EcsFargateContainerDefinitionProps,
  ) {
    super(scope, id, props);
    this.assignPublicIp = props.assignPublicIp;
    this.fargatePlatformVersion = props.fargatePlatformVersion;
    this.ephemeralStorageSize = props.ephemeralStorageSize;
    this.fargateCpuArchitecture = props.fargateCpuArchitecture;
    this.fargateOperatingSystemFamily = props.fargateOperatingSystemFamily;

    if (
      this.fargateOperatingSystemFamily?.isWindows() &&
      this.readonlyRootFilesystem
    ) {
      // see https://kubernetes.io/docs/concepts/windows/intro/
      throw new ValidationError(
        "Readonly root filesystem is not possible on Windows; write access is required for registry & system processes to run inside the container",
        this,
      );
    }

    // validates ephemeralStorageSize is within limits
    if (props.ephemeralStorageSize) {
      if (props.ephemeralStorageSize.toGibibytes() > 200) {
        throw new ValidationError(
          `ECS Fargate container '${id}' specifies 'ephemeralStorageSize' at ${props.ephemeralStorageSize.toGibibytes()} > 200 GB`,
          this,
        );
      } else if (props.ephemeralStorageSize.toGibibytes() < 21) {
        throw new ValidationError(
          `ECS Fargate container '${id}' specifies 'ephemeralStorageSize' at ${props.ephemeralStorageSize.toGibibytes()} < 21 GB`,
          this,
        );
      }
    }
  }

  /**
   * @internal
   */
  public _renderContainerDefinition(): ContainerPropertiesConfig {
    let containerDef: ContainerPropertiesConfig = {
      ...super._renderContainerDefinition(),
      ephemeralStorage: this.ephemeralStorageSize
        ? {
            sizeInGiB: this.ephemeralStorageSize?.toGibibytes(),
          }
        : undefined,
      fargatePlatformConfiguration: {
        platformVersion: this.fargatePlatformVersion?.toString(),
      },
      networkConfiguration: {
        assignPublicIp: this.assignPublicIp ? "ENABLED" : "DISABLED",
      },
      runtimePlatform: {
        cpuArchitecture: this.fargateCpuArchitecture?._cpuArchitecture,
        operatingSystemFamily:
          this.fargateOperatingSystemFamily?._operatingSystemFamily,
      },
    };

    // readonlyRootFilesystem isn't applicable to Windows, see https://kubernetes.io/docs/concepts/windows/intro/
    if (this.fargateOperatingSystemFamily?.isWindows()) {
      containerDef = { ...containerDef, readonlyRootFilesystem: undefined };
    }

    return containerDef;
  }
}

function createExecutionRole(
  scope: Construct,
  id: string,
  logging: boolean,
): iam.IRole {
  // TERRACONSTRUCTS DEVIATION: upstream additionally sets `roleName: PhysicalName.GENERATE_IF_NEEDED`
  // here (needed for cross-account access with TagParameterContainerImage). This repo's
  // `iam.Role` already auto-generates a physical name whenever `roleName` is omitted, so no
  // equivalent opt-in is required.
  const execRole = new iam.Role(scope, id, {
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
  });

  if (!logging) {
    // all jobs will fail without this if they produce any output at all when no logging is specified
    LogGroup.fromLogGroupName(
      scope,
      "batchDefaultLogGroup",
      "/aws/batch/job",
    ).grantWrite(execRole);
  }

  return execRole;
}

/**
 * The plain container-properties JSON object embedded in the job definition's jsonencoded
 * `container_properties`. Replaces upstream's `CfnJobDefinition.ContainerPropertiesProperty`
 * (see the `// TERRACONSTRUCTS DEVIATION` note on `EcsContainerDefinitionBase._renderContainerDefinition`).
 */
export interface ContainerPropertiesConfig {
  readonly image: string;
  readonly command?: string[];
  readonly environment?: EnvironmentVariableConfig[];
  readonly jobRoleArn?: string;
  readonly executionRoleArn?: string;
  readonly linuxParameters?: LinuxParametersConfig;
  readonly logConfiguration?: ecs.LogDriverConfig;
  readonly readonlyRootFilesystem?: boolean;
  readonly resourceRequirements?: ResourceRequirementConfig[];
  readonly secrets?: SecretConfig[];
  readonly mountPoints?: MountPointConfig[] | IResolvable;
  readonly volumes?: VolumeConfig[] | IResolvable;
  readonly user?: string;
  readonly enableExecuteCommand?: boolean;

  /** EC2-only: limits to set for the user this docker container will run as. */
  readonly ulimits?: UlimitConfig[] | IResolvable;
  /** EC2-only: elevated permissions on the host container instance. */
  readonly privileged?: boolean;

  /** Fargate-only: the amount of ephemeral storage to allocate for the task. */
  readonly ephemeralStorage?: EphemeralStorageConfig;
  /** Fargate-only: the platform configuration for jobs that run on Fargate resources. */
  readonly fargatePlatformConfiguration?: FargatePlatformConfigurationConfig;
  /** Fargate-only: the network configuration for jobs that run on Fargate resources. */
  readonly networkConfiguration?: NetworkConfigurationConfig;
  /** Fargate-only: the compute environment architecture for AWS Batch jobs on Fargate. */
  readonly runtimePlatform?: RuntimePlatformConfig;
}

/**
 * A `name`/`value` pair, as embedded in `ContainerPropertiesConfig.environment`. Replaces
 * upstream's `CfnJobDefinition.EnvironmentProperty`.
 */
export interface EnvironmentVariableConfig {
  readonly name: string;
  readonly value: string;
}

/**
 * The rendered secret entry, as embedded in `ContainerPropertiesConfig.secrets`. Replaces
 * upstream's `CfnJobDefinition.SecretProperty`.
 */
export interface SecretConfig {
  readonly name: string;
  readonly valueFrom: string;
}

/**
 * The rendered resource requirement, as embedded in `ContainerPropertiesConfig.resourceRequirements`.
 * Replaces upstream's `CfnJobDefinition.ResourceRequirementProperty`.
 */
export interface ResourceRequirementConfig {
  readonly type: string;
  readonly value: string;
}

/**
 * The rendered mount point, as embedded in `ContainerPropertiesConfig.mountPoints`. Replaces
 * upstream's `CfnJobDefinition.MountPointsProperty`.
 */
export interface MountPointConfig {
  readonly containerPath: string;
  readonly readOnly?: boolean;
  readonly sourceVolume: string;
}

/**
 * The rendered volume, as embedded in `ContainerPropertiesConfig.volumes`. Replaces upstream's
 * `CfnJobDefinition.VolumesProperty`. Only the `host` variant is supported -- see the
 * EFS-omission TODOs above.
 */
export interface VolumeConfig {
  readonly name: string;
  readonly host?: VolumeHostConfig;
}

/**
 * The host-path details of a `VolumeConfig`. Replaces upstream's `CfnJobDefinition.VolumesHostProperty`.
 */
export interface VolumeHostConfig {
  readonly sourcePath?: string;
}

/**
 * The rendered ulimit, as embedded in `ContainerPropertiesConfig.ulimits`. Replaces upstream's
 * `CfnJobDefinition.UlimitProperty`.
 */
export interface UlimitConfig {
  readonly hardLimit: number;
  readonly name: UlimitName;
  readonly softLimit: number;
}

/**
 * The rendered ephemeral storage config, as embedded in `ContainerPropertiesConfig.ephemeralStorage`.
 * Replaces upstream's `CfnJobDefinition.EphemeralStorageProperty`.
 */
export interface EphemeralStorageConfig {
  readonly sizeInGiB: number;
}

/**
 * The rendered Fargate platform configuration, as embedded in
 * `ContainerPropertiesConfig.fargatePlatformConfiguration`. Replaces upstream's
 * `CfnJobDefinition.FargatePlatformConfigurationProperty`.
 */
export interface FargatePlatformConfigurationConfig {
  readonly platformVersion?: string;
}

/**
 * The rendered network configuration, as embedded in `ContainerPropertiesConfig.networkConfiguration`.
 * Replaces upstream's `CfnJobDefinition.NetworkConfigurationProperty`.
 */
export interface NetworkConfigurationConfig {
  readonly assignPublicIp?: string;
}

/**
 * The rendered runtime platform, as embedded in `ContainerPropertiesConfig.runtimePlatform`.
 * Replaces upstream's `CfnJobDefinition.RuntimePlatformProperty`.
 */
export interface RuntimePlatformConfig {
  readonly cpuArchitecture?: string;
  readonly operatingSystemFamily?: string;
}
