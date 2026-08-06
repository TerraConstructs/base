// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/lib/linux-parameters.ts

import { IResolvable, Lazy, Token } from "cdktn";
import { Construct } from "constructs";
import { ValidationError } from "../../../errors";
import { Size } from "../../../size";

/**
 * The properties for defining Linux-specific options that are applied to the container.
 */
export interface LinuxParametersProps {
  /**
   * Specifies whether to run an init process inside the container that forwards signals and reaps processes.
   *
   * @default false
   */
  readonly initProcessEnabled?: boolean;

  /**
   * The value for the size of the /dev/shm volume.
   *
   * @default No shared memory.
   */
  readonly sharedMemorySize?: Size;

  /**
   * The total amount of swap memory a container can use. This parameter
   * will be translated to the --memory-swap option to docker run.
   *
   * This parameter is only supported when you are using the EC2 launch type.
   * Accepted values are positive integers.
   *
   * @default No swap.
   */
  readonly maxSwap?: Size;

  /**
   * This allows you to tune a container's memory swappiness behavior. This parameter
   * maps to the --memory-swappiness option to docker run. The swappiness relates
   * to the kernel's tendency to swap memory. A value of 0 will cause swapping to
   * not happen unless absolutely necessary. A value of 100 will cause pages to
   * be swapped very aggressively.
   *
   * This parameter is only supported when you are using the EC2 launch type.
   * Accepted values are whole numbers between 0 and 100. If a value is not
   * specified for maxSwap then this parameter is ignored.
   *
   * @default 60
   */
  readonly swappiness?: number;
}

/**
 * Linux-specific options that are applied to the container.
 */
export class LinuxParameters extends Construct {
  /**
   * Whether the init process is enabled
   */
  protected readonly initProcessEnabled?: boolean;

  /**
   * The shared memory size (in MiB). Not valid for Fargate launch type
   */
  protected readonly sharedMemorySize?: Size;

  /**
   * The max swap memory
   */
  protected readonly maxSwap?: Size;

  /**
   * The swappiness behavior
   */
  protected readonly swappiness?: number;

  /**
   * Device mounts
   */
  protected readonly devices = new Array<Device>();

  /**
   * TmpFs mounts
   */
  protected readonly tmpfs = new Array<Tmpfs>();

  /**
   * Constructs a new instance of the LinuxParameters class.
   */
  constructor(scope: Construct, id: string, props: LinuxParametersProps = {}) {
    super(scope, id);

    this.validateProps(props);

    this.sharedMemorySize = props.sharedMemorySize;
    this.initProcessEnabled = props.initProcessEnabled;
    this.maxSwap = props.maxSwap;
    this.swappiness = props.maxSwap ? props.swappiness : undefined;
  }

  private validateProps(props: LinuxParametersProps) {
    if (
      !Token.isUnresolved(props.swappiness) &&
      props.swappiness !== undefined &&
      (!Number.isInteger(props.swappiness) ||
        props.swappiness < 0 ||
        props.swappiness > 100)
    ) {
      throw new ValidationError(
        `swappiness: Must be an integer between 0 and 100; received ${props.swappiness}.`,
        this,
      );
    }
  }

  /**
   * Adds one or more host devices to a container.
   */
  public addDevices(...device: Device[]) {
    this.devices.push(...device);
  }

  /**
   * Specifies the container path, mount options, and size (in MiB) of the tmpfs mount for a container.
   *
   * Only works with EC2 launch type.
   */
  public addTmpfs(...tmpfs: Tmpfs[]) {
    this.tmpfs.push(...tmpfs);
  }

  /**
   * Renders the Linux parameters to the Batch version of this resource,
   * which does not have 'capabilities' and requires tmpfs.containerPath to be defined.
   *
   * // TERRACONSTRUCTS DEVIATION: upstream renders to `CfnJobDefinition.LinuxParametersProperty`
   * (a CloudFormation L1 property type). There is no CFN L1 backing this construct in
   * TerraConstructs -- the `aws_batch_job_definition` resource takes `container_properties` as a
   * single JSON-encoded string, so this renders directly to the plain `LinuxParametersConfig`
   * shape that feeds that JSON blob. The key casing is kept as CFN camelCase (NOT snake_case)
   * because it mirrors the AWS Batch API's JSON shape, not a Terraform-schema nested block.
   */
  public renderLinuxParameters(): LinuxParametersConfig {
    return {
      initProcessEnabled: this.initProcessEnabled,
      sharedMemorySize: this.sharedMemorySize?.toMebibytes(),
      maxSwap: this.maxSwap?.toMebibytes(),
      swappiness: this.swappiness,
      devices: Lazy.anyValue(
        { produce: () => this.devices.map(renderDevice) },
        { omitEmptyArray: true },
      ),
      tmpfs: Lazy.anyValue(
        { produce: () => this.tmpfs.map(renderTmpfs) },
        { omitEmptyArray: true },
      ),
    };
  }
}

/**
 * Configuration for the Linux-specific options that are applied to the container.
 *
 * This is the plain object shape embedded in the JSON-encoded `container_properties` of the
 * `aws_batch_job_definition` resource -- replaces upstream's `CfnJobDefinition.LinuxParametersProperty`.
 */
export interface LinuxParametersConfig {
  /**
   * If true, run an `init` process inside the container that forwards signals and reaps processes.
   */
  readonly initProcessEnabled?: boolean;

  /**
   * The value for the size (in MiB) of the `/dev/shm` volume.
   */
  readonly sharedMemorySize?: number;

  /**
   * The total amount of swap memory (in MiB) a container can use.
   */
  readonly maxSwap?: number;

  /**
   * You can use this parameter to tune a container's memory swappiness behavior.
   */
  readonly swappiness?: number;

  /**
   * Any of the host devices to expose to the container.
   */
  readonly devices?: DeviceConfig[] | IResolvable;

  /**
   * The container path, mount options, and size of the `tmpfs` mounts.
   */
  readonly tmpfs?: TmpfsConfig[] | IResolvable;
}

/**
 * A container instance host device.
 */
export interface Device {
  /**
   * The path inside the container at which to expose the host device.
   *
   * @default Same path as the host
   */
  readonly containerPath?: string;

  /**
   * The path for the device on the host container instance.
   */
  readonly hostPath: string;

  /**
   * The explicit permissions to provide to the container for the device.
   * By default, the container has permissions for read, write, and mknod for the device.
   *
   * @default Readonly
   */
  readonly permissions?: DevicePermission[];
}

/**
 * Configuration for a container instance host device, as embedded in
 * `LinuxParametersConfig.devices`. Replaces upstream's `CfnJobDefinition.DeviceProperty`.
 */
export interface DeviceConfig {
  /**
   * The path inside the container that's used to expose the host device.
   */
  readonly containerPath?: string;

  /**
   * The path for the device on the host container instance.
   */
  readonly hostPath: string;

  /**
   * The explicit permissions to provide to the container for the device.
   */
  readonly permissions?: DevicePermission[];
}

/**
 * The details of a tmpfs mount for a container.
 */
export interface Tmpfs {
  /**
   * The absolute file path where the tmpfs volume is to be mounted.
   */
  readonly containerPath: string;

  /**
   * The size (in MiB) of the tmpfs volume.
   */
  readonly size: Size;

  /**
   * The list of tmpfs volume mount options. For more information, see
   * [TmpfsMountOptions](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Tmpfs.html).
   *
   * @default none
   */
  readonly mountOptions?: TmpfsMountOption[];
}

/**
 * Configuration for a tmpfs mount for a container, as embedded in `LinuxParametersConfig.tmpfs`.
 * Replaces upstream's `CfnJobDefinition.TmpfsProperty`.
 */
export interface TmpfsConfig {
  /**
   * The absolute file path in the container where the `tmpfs` volume is mounted.
   */
  readonly containerPath: string;

  /**
   * The size (in MiB) of the `tmpfs` volume.
   */
  readonly size: number;

  /**
   * The list of `tmpfs` volume mount options.
   */
  readonly mountOptions?: TmpfsMountOption[];
}

/**
 * Permissions for device access
 */
export enum DevicePermission {
  /**
   * Read
   */
  READ = "read",

  /**
   * Write
   */
  WRITE = "write",

  /**
   * Make a node
   */
  MKNOD = "mknod",
}

/**
 * The supported options for a tmpfs mount for a container.
 */
export enum TmpfsMountOption {
  DEFAULTS = "defaults",
  RO = "ro",
  RW = "rw",
  SUID = "suid",
  NOSUID = "nosuid",
  DEV = "dev",
  NODEV = "nodev",
  EXEC = "exec",
  NOEXEC = "noexec",
  SYNC = "sync",
  ASYNC = "async",
  DIRSYNC = "dirsync",
  REMOUNT = "remount",
  MAND = "mand",
  NOMAND = "nomand",
  ATIME = "atime",
  NOATIME = "noatime",
  DIRATIME = "diratime",
  NODIRATIME = "nodiratime",
  BIND = "bind",
  RBIND = "rbind",
  UNBINDABLE = "unbindable",
  RUNBINDABLE = "runbindable",
  PRIVATE = "private",
  RPRIVATE = "rprivate",
  SHARED = "shared",
  RSHARED = "rshared",
  SLAVE = "slave",
  RSLAVE = "rslave",
  RELATIME = "relatime",
  NORELATIME = "norelatime",
  STRICTATIME = "strictatime",
  NOSTRICTATIME = "nostrictatime",
  MODE = "mode",
  UID = "uid",
  GID = "gid",
  NR_INODES = "nr_inodes",
  NR_BLOCKS = "nr_blocks",
  MPOL = "mpol",
}

function renderTmpfs(tmpfs: Tmpfs): TmpfsConfig {
  return {
    containerPath: tmpfs.containerPath,
    size: tmpfs.size.toMebibytes(),
    mountOptions: tmpfs.mountOptions,
  };
}

function renderDevice(device: Device): DeviceConfig {
  return {
    containerPath: device.containerPath,
    hostPath: device.hostPath,
    permissions: device.permissions,
  };
}
