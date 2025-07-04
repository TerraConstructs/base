// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/instance.ts

import {
  instance,
  iamInstanceProfile as tfInstanceProfile,
  networkInterface as tfNetworkInterface,
} from "@cdktf/provider-aws";
import {
  Annotations,
  Aspects,
  // AspectPriority,
  Lazy,
  Token,
} from "cdktf";
import { Construct } from "constructs";
import { Duration } from "../../duration";
import { IAwsConstruct, AwsConstructBase } from "../aws-construct";
// TODO: Use TagManager and tag-aspect instead
import { Tags } from "../aws-tags";
// import { Tags } from "../tag-aspect";
import { InstanceRequireImdsv2Aspect } from "./aspects/require-imdsv2-aspect";
// import { CloudFormationInit } from "./cfn-init";
import { Connections, IConnectable } from "./connections";
import { InstanceType } from "./instance-types";
import { IKeyPair } from "./key-pair";
import {
  CpuCredits,
  InstanceInitiatedShutdownBehavior,
} from "./launch-template";
import { IMachineImage, OperatingSystemType } from "./machine-image";
import { IPlacementGroup } from "./placement-group";
import {
  instanceEbsBlockDeviceMappings,
  instanceEphemeralBlockDeviceMappings,
  instanceRootBlockDeviceMapping,
} from "./private/ebs-util";
import { ISecurityGroup, SecurityGroup } from "./security-group";
import { UserData } from "./user-data";
import { BlockDevice } from "./volume";
import { IVpc, Subnet, SubnetSelection } from "./vpc";
// import { md5hash } from "../../helpers-internal";
import * as iam from "../iam";

/**
 * Name tag constant
 */
const NAME_TAG: string = "Name";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface InstanceOutputs {
  /**
   * The instance's ID
   *
   * @attribute
   */
  readonly instanceId: string;
}

export interface IInstance extends IAwsConstruct, IConnectable, iam.IGrantable {
  /** Strongly typed outputs */
  readonly instanceOutputs: InstanceOutputs;

  /**
   * The instance's ID
   *
   * @attribute
   */
  readonly instanceId: string;

  /**
   * The availability zone the instance was launched in
   *
   * @attribute
   */
  readonly instanceAvailabilityZone: string;

  /**
   * Private DNS name for this instance
   * @attribute
   */
  readonly instancePrivateDnsName: string;

  /**
   * Private IP for this instance
   *
   * @attribute
   */
  readonly instancePrivateIp: string;

  /**
   * Publicly-routable DNS name for this instance.
   *
   * (May be an empty string if the instance does not have a public name).
   *
   * @attribute
   */
  readonly instancePublicDnsName: string;

  /**
   * Publicly-routable IP  address for this instance.
   *
   * (May be an empty string if the instance does not have a public IP).
   *
   * @attribute
   */
  readonly instancePublicIp: string;
}

/**
 * Properties of an EC2 Instance
 */
export interface InstanceProps {
  /**
   * Name of SSH keypair to grant access to instance
   *
   * @default - No SSH access will be possible.
   * @deprecated - Use `keyPair` instead - https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2-readme.html#using-an-existing-ec2-key-pair
   */
  readonly keyName?: string;

  /**
   * The SSH keypair to grant access to the instance.
   *
   * @default - No SSH access will be possible.
   */
  readonly keyPair?: IKeyPair;

  /**
   * Where to place the instance within the VPC
   *
   * @default - Private subnets.
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * In which AZ to place the instance within the VPC
   *
   * @default - Random zone.
   */
  readonly availabilityZone?: string;

  /**
   * Whether the instance could initiate connections to anywhere by default.
   * This property is only used when you do not provide a security group.
   *
   * @default true
   */
  readonly allowAllOutbound?: boolean;

  /**
   * Whether the instance could initiate IPv6 connections to anywhere by default.
   * This property is only used when you do not provide a security group.
   *
   * @default false
   */
  readonly allowAllIpv6Outbound?: boolean;

  /**
   * The length of time to wait for the resourceSignalCount
   *
   * The maximum value is 43200 (12 hours).
   *
   * @default Duration.minutes(5)
   */
  readonly resourceSignalTimeout?: Duration;

  /**
   * VPC to launch the instance in.
   */
  readonly vpc: IVpc;

  /**
   * Security Group to assign to this instance
   *
   * @default - create new security group
   */
  readonly securityGroup?: ISecurityGroup;

  /**
   * Type of instance to launch
   */
  readonly instanceType: InstanceType;

  /**
   * AMI to launch
   */
  readonly machineImage: IMachineImage;

  /**
   * Specific UserData to use
   *
   * The UserData may still be mutated after creation.
   *
   * Updates to this field will trigger a stop/start of the EC2 instance by default.
   *
   * If userDataCausesReplacement is set then updates to this field will trigger
   * a destroy and recreate of the EC2 instance.
   *
   * @default - A UserData object appropriate for the MachineImage's
   * Operating System is created.
   */
  readonly userData?: UserData;

  /**
   * Changes to the UserData force replacement
   *
   * Depending the EC2 instance type, changing UserData either
   * restarts the instance or replaces the instance.
   *
   * - Instance store-backed instances are replaced.
   * - EBS-backed instances are restarted.
   *
   * By default, restarting does not execute the new UserData so you
   * will need a different mechanism to ensure the instance is restarted.
   *
   * default - true
   */
  readonly userDataCausesReplacement?: boolean;
  // @default - true if `initOptions` is specified, false otherwise.

  /**
   * An IAM role to associate with the instance profile assigned to this Auto Scaling Group.
   *
   * The role must be assumable by the service principal `ec2.amazonaws.com`:
   * Note: You can provide an instanceProfile or a role, but not both.
   *
   * @example
   * const role = new iam.Role(this, 'MyRole', {
   *   assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
   * });
   *
   * @default - A role will automatically be created, it can be accessed via the `role` property
   */
  readonly role?: iam.IRole;

  /**
   * The instance profile used to pass role information to EC2 instances.
   *
   * Note: You can provide an instanceProfile or a role, but not both.
   *
   * @default - No instance profile
   */
  readonly instanceProfile?: iam.IInstanceProfile;

  /**
   * The name of the instance
   *
   * @default - CDK generated name
   */
  readonly instanceName?: string;

  /**
   * Specifies whether to enable an instance launched in a VPC to perform NAT.
   * This controls whether source/destination checking is enabled on the instance.
   * A value of true means that checking is enabled, and false means that checking is disabled.
   * The value must be false for the instance to perform NAT.
   *
   * @default true
   */
  readonly sourceDestCheck?: boolean;

  /**
   * Specifies how block devices are exposed to the instance. You can specify virtual devices and EBS volumes.
   *
   * Each instance that is launched has an associated root device volume,
   * either an Amazon EBS volume or an instance store volume.
   * You can use block device mappings to specify additional EBS volumes or
   * instance store volumes to attach to an instance when it is launched.
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/block-device-mapping-concepts.html
   * @see https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/instance#ebs-ephemeral-and-root-block-devices
   *
   * @default - Uses the block device mapping of the AMI
   */
  readonly blockDevices?: BlockDevice[];

  /**
   * Defines a private IP address to associate with an instance.
   *
   * Private IP should be available within the VPC that the instance is build within.
   *
   * @default - no association
   */
  readonly privateIpAddress?: string;

  /**
   * Propagate the EC2 instance tags to the EBS volumes.
   *
   * Do not propagate tags if you plan to manage block device tags outside
   * the `aws_instance` configuration, such as using `tags` in an `aws_ebs_volume`
   * resource attached via `aws_volume_attachment`.
   *
   * Doing so will result in resource cycling and inconsistent behavior.
   *
   * @default - false
   */
  readonly propagateTagsToVolumeOnCreation?: boolean;

  // TODO: Implement Grid Init
  // /**
  //  * Apply the given CloudFormation Init configuration to the instance at startup
  //  *
  //  * @default - no CloudFormation init
  //  */
  // readonly init?: CloudFormationInit;
  //
  // /**
  //  * Use the given options for applying CloudFormation Init
  //  *
  //  * Describes the configsets to use and the timeout to wait
  //  *
  //  * @default - default options
  //  */
  // readonly initOptions?: ApplyCloudFormationInitOptions;

  /**
   * Whether IMDSv2 should be required on this instance.
   *
   * @default - false
   */
  readonly requireImdsv2?: boolean;

  /**
   * Whether "Detailed Monitoring" is enabled for this instance
   * Keep in mind that Detailed Monitoring results in extra charges
   *
   * @see http://aws.amazon.com/cloudwatch/pricing/
   * @default - false
   */
  readonly detailedMonitoring?: boolean;

  /**
   * Add SSM session permissions to the instance role
   *
   * Setting this to `true` adds the necessary permissions to connect
   * to the instance using SSM Session Manager. You can do this
   * from the AWS Console.
   *
   * NOTE: Setting this flag to `true` may not be enough by itself.
   * You must also use an AMI that comes with the SSM Agent, or install
   * the SSM Agent yourself. See
   * [Working with SSM Agent](https://docs.aws.amazon.com/systems-manager/latest/userguide/ssm-agent.html)
   * in the SSM Developer Guide.
   *
   * @default false
   */
  readonly ssmSessionPermissions?: boolean;

  /**
   * Whether to associate a public IP address to the primary network interface attached to this instance.
   *
   * You cannot specify this property and `ipv6AddressCount` at the same time.
   *
   * @default - public IP address is automatically assigned based on default behavior
   */
  readonly associatePublicIpAddress?: boolean;

  /**
   * Specifying the CPU credit type for burstable EC2 instance types (T2, T3, T3a, etc).
   * The unlimited CPU credit option is not supported for T3 instances with a dedicated host.
   *
   * @default - T2 instances are standard, while T3, T4g, and T3a instances are unlimited.
   */
  readonly creditSpecification?: CpuCredits;

  /**
   * Indicates whether the instance is optimized for Amazon EBS I/O.
   *
   * This optimization provides dedicated throughput to Amazon EBS and an optimized configuration stack to provide optimal Amazon EBS I/O performance.
   * This optimization isn't available with all instance types.
   * Additional usage charges apply when using an EBS-optimized instance.
   *
   * @default false
   */
  readonly ebsOptimized?: boolean;

  /**
   * If true, the instance will not be able to be terminated using the Amazon EC2 console, CLI, or API.
   *
   * To change this attribute after launch, use [ModifyInstanceAttribute](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_ModifyInstanceAttribute.html).
   * Alternatively, if you set InstanceInitiatedShutdownBehavior to terminate, you can terminate the instance
   * by running the shutdown command from the instance.
   *
   * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-instance.html#cfn-ec2-instance-disableapitermination
   *
   * @default false
   */
  readonly disableApiTermination?: boolean;

  /**
   * Indicates whether an instance stops or terminates when you initiate shutdown from the instance
   * (using the operating system command for system shutdown).
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/terminating-instances.html#Using_ChangingInstanceInitiatedShutdownBehavior
   *
   * @default InstanceInitiatedShutdownBehavior.STOP
   */
  readonly instanceInitiatedShutdownBehavior?: InstanceInitiatedShutdownBehavior;

  /**
   * The placement group that you want to launch the instance into.
   *
   * @default - no placement group will be used for this instance.
   */
  readonly placementGroup?: IPlacementGroup;

  /**
   * Whether the instance is enabled for AWS Nitro Enclaves.
   *
   * Nitro Enclaves requires a Nitro-based virtualized parent instance with specific Intel/AMD with at least 4 vCPUs
   * or Graviton with at least 2 vCPUs instance types and Linux/Windows host OS,
   * while the enclave itself supports only Linux OS.
   *
   * You can't set both `enclaveEnabled` and `hibernationEnabled` to true on the same instance.
   *
   * @see https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html#nitro-enclave-reqs
   *
   * @default - false
   */
  readonly enclaveEnabled?: boolean;

  /**
   * Whether the instance is enabled for hibernation.
   *
   * You can't set both `enclaveEnabled` and `hibernationEnabled` to true on the same instance.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ec2-instance-hibernationoptions.html
   *
   * @default - false
   */
  readonly hibernationEnabled?: boolean;

  /**
   * The number of IPv6 addresses to associate with the primary network interface.
   *
   * Amazon EC2 chooses the IPv6 addresses from the range of your subnet.
   *
   * You cannot specify this property and `associatePublicIpAddress` at the same time.
   *
   * @default - For instances associated with an IPv6 subnet, use 1; otherwise, use 0.
   */
  readonly ipv6AddressCount?: number;
}

/**
 * This represents a single EC2 instance
 */
export class Instance extends AwsConstructBase implements IInstance {
  public get instanceOutputs(): InstanceOutputs {
    return {
      instanceId: this.instanceId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.instanceOutputs;
  }

  /**
   * The type of OS the instance is running.
   */
  public readonly osType: OperatingSystemType;

  /**
   * Allows specify security group connections for the instance.
   */
  public readonly connections: Connections;

  /**
   * The IAM role assumed by the instance.
   */
  public readonly role: iam.IRole;

  /**
   * The principal to grant permissions to
   */
  public readonly grantPrincipal: iam.IPrincipal;

  /**
   * UserData for the instance
   */
  public readonly userData: UserData;

  /**
   * the underlying instance resource
   */
  public readonly instance: instance.Instance;

  /**
   * the primary network inteface (if applicable)
   */
  private readonly primaryNetworkInterface?: tfNetworkInterface.NetworkInterface;

  /**
   * the primary network interface id.
   */
  public readonly primaryNetworkInterfaceId: string;

  /**
   * @attribute
   */
  public readonly instanceId: string;
  /**
   * @attribute
   */
  public readonly instanceAvailabilityZone: string;
  /**
   * @attribute
   */
  public readonly instancePrivateDnsName: string;
  /**
   * @attribute
   */
  public readonly instancePrivateIp: string;
  /**
   * @attribute
   */
  public readonly instancePublicDnsName: string;
  /**
   * @attribute
   */
  public readonly instancePublicIp: string;

  private readonly securityGroup: ISecurityGroup;
  private readonly securityGroups: ISecurityGroup[] = [];

  constructor(scope: Construct, id: string, props: InstanceProps) {
    super(scope, id);

    // if (props.initOptions && !props.init) {
    //   throw new Error("Setting 'initOptions' requires that 'init' is also set");
    // }

    if (props.keyName && props.keyPair) {
      throw new Error(
        "Cannot specify both of 'keyName' and 'keyPair'; prefer 'keyPair'",
      );
    }

    // if credit specification is set, then the instance type must be burstable
    if (props.creditSpecification && !props.instanceType.isBurstable()) {
      throw new Error(
        `creditSpecification is supported only for T4g, T3a, T3, T2 instance type, got: ${props.instanceType.toString()}`,
      );
    }

    if (props.securityGroup) {
      this.securityGroup = props.securityGroup;
    } else {
      this.securityGroup = new SecurityGroup(this, "InstanceSecurityGroup", {
        vpc: props.vpc,
        allowAllOutbound: props.allowAllOutbound !== false,
        allowAllIpv6Outbound: props.allowAllIpv6Outbound,
      });
    }
    this.connections = new Connections({
      securityGroups: [this.securityGroup],
    });
    this.securityGroups.push(this.securityGroup);
    Tags.of(this).add(NAME_TAG, props.instanceName || this.node.path);

    if (props.instanceProfile && props.role) {
      throw new Error("You cannot provide both instanceProfile and role");
    }

    let iamInstanceProfile: string | undefined = undefined;
    if (props.instanceProfile?.role) {
      this.role = props.instanceProfile.role;
      iamInstanceProfile = props.instanceProfile.instanceProfileName;
    } else {
      this.role =
        props.role ||
        new iam.Role(this, "InstanceRole", {
          assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        });

      const iamProfile = new tfInstanceProfile.IamInstanceProfile(
        this,
        "InstanceProfile",
        {
          role: this.role.roleName,
        },
      );
      iamInstanceProfile = iamProfile.id;
    }

    this.grantPrincipal = this.role;

    if (props.ssmSessionPermissions) {
      this.role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          this,
          "AmazonSSMManagedInstanceCore",
          "AmazonSSMManagedInstanceCore",
        ),
      );
    }

    // use delayed evaluation
    const imageConfig = props.machineImage.getImage(this);
    this.userData = props.userData ?? imageConfig.userData;
    const securityGroupsToken = Lazy.listValue({
      produce: () => this.securityGroups.map((sg) => sg.securityGroupId),
    });

    const { subnets, hasPublic } = props.vpc.selectSubnets(props.vpcSubnets);
    let subnet;
    if (props.availabilityZone) {
      const selected = subnets.filter(
        (sn) => sn.availabilityZone === props.availabilityZone,
      );
      if (selected.length === 1) {
        subnet = selected[0];
      } else {
        Annotations.of(this).addError(
          `Need exactly 1 subnet to match AZ '${props.availabilityZone}', found ${selected.length}. Use a different availabilityZone.`,
        );
      }
    } else {
      if (subnets.length > 0) {
        subnet = subnets[0];
      } else {
        Annotations.of(this).addError(
          `Did not find any subnets matching '${JSON.stringify(props.vpcSubnets)}', please use a different selection.`,
        );
      }
    }
    if (!subnet) {
      // We got here and we don't have a subnet because of validation errors.
      // Invent one on the spot so the code below doesn't fail.
      subnet = Subnet.fromSubnetAttributes(this, "DummySubnet", {
        subnetId: "s-notfound",
        availabilityZone: "az-notfound",
      });
    }

    // network interfaces array is set to configure the primary network interface for advanced networking scenarios
    // For basic public IP assignment, let the EC2 instance handle it directly
    let networkInterfaces: instance.InstanceNetworkInterface[] | undefined =
      undefined;

    if (props.keyPair && !props.keyPair._isOsCompatible(imageConfig.osType)) {
      throw new Error(
        `${props.keyPair.type} keys are not compatible with the chosen AMI`,
      );
    }

    if (props.enclaveEnabled && props.hibernationEnabled) {
      throw new Error(
        "You can't set both `enclaveEnabled` and `hibernationEnabled` to true on the same instance",
      );
    }

    if (
      props.ipv6AddressCount !== undefined &&
      !Token.isUnresolved(props.ipv6AddressCount) &&
      (props.ipv6AddressCount < 0 || !Number.isInteger(props.ipv6AddressCount))
    ) {
      throw new Error(
        `\'ipv6AddressCount\' must be a non-negative integer, got: ${props.ipv6AddressCount}`,
      );
    }

    if (
      props.ipv6AddressCount !== undefined &&
      props.associatePublicIpAddress !== undefined
    ) {
      throw new Error(
        "You can't set both 'ipv6AddressCount' and 'associatePublicIpAddress'",
      );
    }

    // https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance#tag-guide
    const volumeTags = props.propagateTagsToVolumeOnCreation
      ? { [NAME_TAG]: props.instanceName || this.node.path }
      : undefined;

    // if network interfaces array is configured then subnetId, securityGroupIds,
    // and privateIpAddress are configured on the network interface level and
    // there is no need to configure them on the instance level
    this.instance = new instance.Instance(this, "Resource", {
      ami: imageConfig.imageId,
      keyName: props.keyPair?.keyPairName ?? props?.keyName,
      instanceType: props.instanceType.toString(),
      subnetId: networkInterfaces ? undefined : subnet.subnetId,
      vpcSecurityGroupIds: networkInterfaces ? undefined : securityGroupsToken,
      associatePublicIpAddress: props.associatePublicIpAddress,
      networkInterface: networkInterfaces,
      iamInstanceProfile,
      userDataBase64: this.userData.render(this),
      // unlike https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/instance.ts#L652
      userDataReplaceOnChange: props.userDataCausesReplacement ?? true,
      availabilityZone: subnet.availabilityZone,
      sourceDestCheck: props.sourceDestCheck,
      ebsBlockDevice:
        props.blockDevices !== undefined
          ? instanceEbsBlockDeviceMappings(this, props.blockDevices)
          : undefined,
      rootBlockDevice:
        props.blockDevices !== undefined
          ? instanceRootBlockDeviceMapping(this, props.blockDevices)
          : undefined,
      ephemeralBlockDevice:
        props.blockDevices !== undefined
          ? instanceEphemeralBlockDeviceMappings(props.blockDevices)
          : undefined,
      privateIp: networkInterfaces ? undefined : props.privateIpAddress,
      volumeTags,
      monitoring: props.detailedMonitoring,
      creditSpecification: props.creditSpecification
        ? { cpuCredits: props.creditSpecification }
        : undefined,
      ebsOptimized: props.ebsOptimized,
      disableApiTermination: props.disableApiTermination,
      instanceInitiatedShutdownBehavior:
        props.instanceInitiatedShutdownBehavior,
      placementGroup: props.placementGroup?.placementGroupName,
      enclaveOptions:
        props.enclaveEnabled !== undefined
          ? { enabled: props.enclaveEnabled }
          : undefined,
      hibernation: props.hibernationEnabled,
      ipv6AddressCount: props.ipv6AddressCount,
    });
    this.instance.node.addDependency(this.role);

    // if associatePublicIpAddress is true, then there must be a dependency on internet connectivity
    if (
      props.associatePublicIpAddress !== undefined &&
      props.associatePublicIpAddress
    ) {
      const internetConnected = props.vpc.selectSubnets(
        props.vpcSubnets,
      ).internetConnectivityEstablished;
      this.instance.node.addDependency(internetConnected);
    }

    if (!hasPublic && props.associatePublicIpAddress) {
      throw new Error(
        "To set 'associatePublicIpAddress: true' you must select Public subnets (vpcSubnets: { subnetType: SubnetType.PUBLIC })",
      );
    }

    this.osType = imageConfig.osType;
    this.node.defaultChild = this.instance;

    this.instanceId = this.instance.id;
    this.instanceAvailabilityZone = this.instance.availabilityZone;
    this.instancePrivateDnsName = this.instance.privateDns;
    this.instancePrivateIp = this.instance.privateIp;
    this.instancePublicDnsName = this.instance.publicDns;
    this.instancePublicIp = this.instance.publicIp;
    this.primaryNetworkInterfaceId = this.primaryNetworkInterface
      ? this.primaryNetworkInterface.id
      : this.instance.primaryNetworkInterfaceId;

    // TODO: Add support for Cfn Signals
    // // if both the resourceSignalTimeout and initOptions.timeout are set,
    // // the timeout is summed together. This logic is done in applyCloudFormationInit.
    // // This is because applyUpdatePolicies overwrites the timeout when both timeout fields are specified.
    // this.applyUpdatePolicies(props);

    // if (props.init) {
    //   this.applyCloudFormationInit(props.init, props.initOptions);
    // }

    if (props.requireImdsv2) {
      Aspects.of(this).add(new InstanceRequireImdsv2Aspect());
      // , {
      //   priority: AspectPriority.MUTATING,
      // });
    }
  }

  /**
   * Add the security group to the instance.
   *
   * @param securityGroup: The security group to add
   */
  public addSecurityGroup(securityGroup: ISecurityGroup): void {
    this.securityGroups.push(securityGroup);
  }

  /**
   * Add command to the startup script of the instance.
   * The command must be in the scripting language supported by the instance's OS (i.e. Linux/Windows).
   */
  public addUserData(...commands: string[]) {
    this.userData.addCommands(...commands);
  }

  /**
   * Adds a statement to the IAM role assumed by the instance.
   */
  public addToRolePolicy(statement: iam.PolicyStatement) {
    this.role.addToPrincipalPolicy(statement);
  }

  // /**
  //  * Use a CloudFormation Init configuration at instance startup
  //  *
  //  * This does the following:
  //  *
  //  * - Attaches the CloudFormation Init metadata to the Instance resource.
  //  * - Add commands to the instance UserData to run `cfn-init` and `cfn-signal`.
  //  * - Update the instance's CreationPolicy to wait for the `cfn-signal` commands.
  //  */
  // public applyCloudFormationInit(
  //   init: CloudFormationInit,
  //   options: ApplyCloudFormationInitOptions = {},
  // ) {
  //   init.attach(this.instance, {
  //     platform: this.osType,
  //     instanceRole: this.role,
  //     userData: this.userData,
  //     configSets: options.configSets,
  //     embedFingerprint: options.embedFingerprint,
  //     printLog: options.printLog,
  //     ignoreFailures: options.ignoreFailures,
  //     includeRole: options.includeRole,
  //     includeUrl: options.includeUrl,
  //   });
  //   this.waitForResourceSignal(options.timeout ?? Duration.minutes(5));
  // }

  // /**
  //  * Wait for a single additional resource signal
  //  *
  //  * Add 1 to the current ResourceSignal Count and add the given timeout to the current timeout.
  //  *
  //  * Use this to pause the CloudFormation deployment to wait for the instances
  //  * in the AutoScalingGroup to report successful startup during
  //  * creation and updates. The UserData script needs to invoke `cfn-signal`
  //  * with a success or failure code after it is done setting up the instance.
  //  */
  // private waitForResourceSignal(timeout: Duration) {
  //   const oldResourceSignal =
  //     this.instance.cfnOptions.creationPolicy?.resourceSignal;
  //   this.instance.cfnOptions.creationPolicy = {
  //     ...this.instance.cfnOptions.creationPolicy,
  //     resourceSignal: {
  //       count: (oldResourceSignal?.count ?? 0) + 1,
  //       timeout: (oldResourceSignal?.timeout
  //         ? Duration.parse(oldResourceSignal?.timeout).plus(timeout)
  //         : timeout
  //       ).toIsoString(),
  //     },
  //   };
  // }

  // /**
  //  * Apply CloudFormation update policies for the instance
  //  */
  // private applyUpdatePolicies(props: InstanceProps) {
  //   if (props.resourceSignalTimeout !== undefined) {
  //     this.instance.cfnOptions.creationPolicy = {
  //       ...this.instance.cfnOptions.creationPolicy,
  //       resourceSignal: {
  //         ...this.instance.cfnOptions.creationPolicy?.resourceSignal,
  //         timeout:
  //           props.resourceSignalTimeout &&
  //           props.resourceSignalTimeout.toIsoString(),
  //       },
  //     };
  //   }
  // }
}

// /**
//  * Options for applying CloudFormation init to an instance or instance group
//  */
// export interface ApplyCloudFormationInitOptions {
//   /**
//    * ConfigSet to activate
//    *
//    * @default ['default']
//    */
//   readonly configSets?: string[];

//   /**
//    * Timeout waiting for the configuration to be applied
//    *
//    * @default Duration.minutes(5)
//    */
//   readonly timeout?: Duration;

//   /**
//    * Force instance replacement by embedding a config fingerprint
//    *
//    * If `true` (the default), a hash of the config will be embedded into the
//    * UserData, so that if the config changes, the UserData changes.
//    *
//    * - If the EC2 instance is instance-store backed or
//    *   `userDataCausesReplacement` is set, this will cause the instance to be
//    *   replaced and the new configuration to be applied.
//    * - If the instance is EBS-backed and `userDataCausesReplacement` is not
//    *   set, the change of UserData will make the instance restart but not be
//    *   replaced, and the configuration will not be applied automatically.
//    *
//    * If `false`, no hash will be embedded, and if the CloudFormation Init
//    * config changes nothing will happen to the running instance. If a
//    * config update introduces errors, you will not notice until after the
//    * CloudFormation deployment successfully finishes and the next instance
//    * fails to launch.
//    *
//    * @default true
//    */
//   readonly embedFingerprint?: boolean;

//   /**
//    * Print the results of running cfn-init to the Instance System Log
//    *
//    * By default, the output of running cfn-init is written to a log file
//    * on the instance. Set this to `true` to print it to the System Log
//    * (visible from the EC2 Console), `false` to not print it.
//    *
//    * (Be aware that the system log is refreshed at certain points in
//    * time of the instance life cycle, and successful execution may
//    * not always show up).
//    *
//    * @default true
//    */
//   readonly printLog?: boolean;

//   /**
//    * Don't fail the instance creation when cfn-init fails
//    *
//    * You can use this to prevent CloudFormation from rolling back when
//    * instances fail to start up, to help in debugging.
//    *
//    * @default false
//    */
//   readonly ignoreFailures?: boolean;

//   /**
//    * Include --url argument when running cfn-init and cfn-signal commands
//    *
//    * This will be the cloudformation endpoint in the deployed region
//    * e.g. https://cloudformation.us-east-1.amazonaws.com
//    *
//    * @default false
//    */
//   readonly includeUrl?: boolean;

//   /**
//    * Include --role argument when running cfn-init and cfn-signal commands
//    *
//    * This will be the IAM instance profile attached to the EC2 instance
//    *
//    * @default false
//    */
//   readonly includeRole?: boolean;
// }
