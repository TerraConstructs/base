// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/linux-parameters.ts

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
  readonly sharedMemorySize?: number;

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
  private readonly initProcessEnabled?: boolean;

  /**
   * The shared memory size (in MiB). Not valid for Fargate launch type
   */
  private readonly sharedMemorySize?: number;

  /**
   * The max swap memory
   */
  private readonly maxSwap?: Size;

  /**
   * The swappiness behavior
   */
  private readonly swappiness?: number;

  /**
   * Capabilities to be added
   */
  private readonly capAdd = new Array<Capability>();

  /**
   * Capabilities to be dropped
   */
  private readonly capDrop = new Array<Capability>();

  /**
   * Device mounts
   */
  private readonly devices = new Array<Device>();

  /**
   * TmpFs mounts
   */
  private readonly tmpfs = new Array<Tmpfs>();

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
      !Token.isUnresolved(props.sharedMemorySize) &&
      props.sharedMemorySize !== undefined &&
      (!Number.isInteger(props.sharedMemorySize) || props.sharedMemorySize < 0)
    ) {
      throw new ValidationError(
        `sharedMemorySize: Must be an integer greater than 0; received ${props.sharedMemorySize}.`,
        this,
      );
    }

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
   * Adds one or more Linux capabilities to the Docker configuration of a container.
   *
   * Tasks launched on Fargate only support adding the 'SYS_PTRACE' kernel capability.
   */
  public addCapabilities(...cap: Capability[]) {
    this.capAdd.push(...cap);
  }

  /**
   * Removes one or more Linux capabilities to the Docker configuration of a container.
   */
  public dropCapabilities(...cap: Capability[]) {
    this.capDrop.push(...cap);
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
   * Renders the Linux parameters to a container-definition JSON sub-object.
   *
   * // TERRACONSTRUCTS DEVIATION: upstream renders to `CfnTaskDefinition.LinuxParametersProperty`
   * (a CloudFormation L1 property type). There is no CFN L1 backing this construct in
   * TerraConstructs -- the aws_ecs_task_definition resource takes `container_definitions` as a
   * single jsonencode()'d string, so this renders directly to the plain `LinuxParametersConfig`
   * shape that feeds that JSON blob.
   */
  public renderLinuxParameters(): LinuxParametersConfig {
    return {
      initProcessEnabled: this.initProcessEnabled,
      sharedMemorySize: this.sharedMemorySize,
      maxSwap: this.maxSwap?.toMebibytes(),
      swappiness: this.swappiness,
      capabilities: {
        add: Lazy.listValue(
          { produce: () => this.capAdd },
          { omitEmpty: true },
        ),
        drop: Lazy.listValue(
          { produce: () => this.capDrop },
          { omitEmpty: true },
        ),
      },
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
 * This is the plain object shape embedded in the jsonencoded `container_definitions` of the
 * `aws_ecs_task_definition` resource -- replaces upstream's `CfnTaskDefinition.LinuxParametersProperty`.
 */
export interface LinuxParametersConfig {
  /**
   * Run an `init` process inside the container that forwards signals and reaps processes.
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
   * This allows you to tune a container's memory swappiness behavior.
   */
  readonly swappiness?: number;

  /**
   * The Linux capabilities for the container that are added to or dropped from the default
   * configuration provided by Docker.
   */
  readonly capabilities?: KernelCapabilitiesConfig;

  /**
   * Any host devices to expose to the container.
   */
  readonly devices?: DeviceConfig[] | IResolvable;

  /**
   * The container path, mount options, and size (in MiB) of the tmpfs mounts to add to the container.
   */
  readonly tmpfs?: TmpfsConfig[] | IResolvable;
}

/**
 * The Linux capabilities to add or drop from the default Docker configuration, as embedded in
 * `LinuxParametersConfig.capabilities`. Replaces upstream's `CfnTaskDefinition.KernelCapabilitiesProperty`.
 */
export interface KernelCapabilitiesConfig {
  /**
   * The Linux capabilities for the container that have been added to the default configuration
   * provided by Docker.
   */
  readonly add?: string[];

  /**
   * The Linux capabilities for the container that have been removed from the default
   * configuration provided by Docker.
   */
  readonly drop?: string[];
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
 * `LinuxParametersConfig.devices`. Replaces upstream's `CfnTaskDefinition.DeviceProperty`.
 */
export interface DeviceConfig {
  /**
   * The path inside the container at which to expose the host device.
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

function renderDevice(device: Device): DeviceConfig {
  return {
    containerPath: device.containerPath,
    hostPath: device.hostPath,
    permissions: device.permissions,
  };
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
  readonly size: number;

  /**
   * The list of tmpfs volume mount options. For more information, see
   * [TmpfsMountOptions](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Tmpfs.html).
   */
  readonly mountOptions?: TmpfsMountOption[];
}

/**
 * Configuration for a tmpfs mount for a container, as embedded in `LinuxParametersConfig.tmpfs`.
 * Replaces upstream's `CfnTaskDefinition.TmpfsProperty`.
 */
export interface TmpfsConfig {
  /**
   * The absolute file path where the tmpfs volume is to be mounted.
   */
  readonly containerPath: string;

  /**
   * The maximum size (in MiB) of the tmpfs volume.
   */
  readonly size: number;

  /**
   * The list of tmpfs volume mount options.
   */
  readonly mountOptions?: TmpfsMountOption[];
}

function renderTmpfs(tmpfs: Tmpfs): TmpfsConfig {
  return {
    containerPath: tmpfs.containerPath,
    size: tmpfs.size,
    mountOptions: tmpfs.mountOptions,
  };
}

/**
 * A Linux capability
 */
export enum Capability {
  ALL = "ALL",
  AUDIT_CONTROL = "AUDIT_CONTROL",
  AUDIT_WRITE = "AUDIT_WRITE",
  BLOCK_SUSPEND = "BLOCK_SUSPEND",
  CHOWN = "CHOWN",
  DAC_OVERRIDE = "DAC_OVERRIDE",
  DAC_READ_SEARCH = "DAC_READ_SEARCH",
  FOWNER = "FOWNER",
  FSETID = "FSETID",
  IPC_LOCK = "IPC_LOCK",
  IPC_OWNER = "IPC_OWNER",
  KILL = "KILL",
  LEASE = "LEASE",
  LINUX_IMMUTABLE = "LINUX_IMMUTABLE",
  MAC_ADMIN = "MAC_ADMIN",
  MAC_OVERRIDE = "MAC_OVERRIDE",
  MKNOD = "MKNOD",
  NET_ADMIN = "NET_ADMIN",
  NET_BIND_SERVICE = "NET_BIND_SERVICE",
  NET_BROADCAST = "NET_BROADCAST",
  NET_RAW = "NET_RAW",
  SETFCAP = "SETFCAP",
  SETGID = "SETGID",
  SETPCAP = "SETPCAP",
  SETUID = "SETUID",
  SYS_ADMIN = "SYS_ADMIN",
  SYS_BOOT = "SYS_BOOT",
  SYS_CHROOT = "SYS_CHROOT",
  SYS_MODULE = "SYS_MODULE",
  SYS_NICE = "SYS_NICE",
  SYS_PACCT = "SYS_PACCT",
  SYS_PTRACE = "SYS_PTRACE",
  SYS_RAWIO = "SYS_RAWIO",
  SYS_RESOURCE = "SYS_RESOURCE",
  SYS_TIME = "SYS_TIME",
  SYS_TTY_CONFIG = "SYS_TTY_CONFIG",
  SYSLOG = "SYSLOG",
  WAKE_ALARM = "WAKE_ALARM",
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
