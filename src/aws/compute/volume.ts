// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/volume.ts

import { ebsVolume } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { AccountRootPrincipal, Grant, IGrantable } from "../iam";
import { IInstance } from "./instance";
import { md5hash } from "../../helpers-internal";
import { Size, SizeRoundingBehavior } from "../../size";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
// TODO: Use TagManager and tag-aspect instead
import { Tags } from "../aws-tags";
// import { Tags } from "../tag-aspect";
import { IKey, ViaServicePrincipal } from "../encryption";

/**
 * Block device
 */
export interface BlockDevice {
  /**
   * The device name exposed to the EC2 instance
   *
   * For example, a value like `/dev/sdh`, `xvdh`.
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html
   */
  readonly deviceName: string;

  /**
   * Defines the block device volume, to be either an Amazon EBS volume or an ephemeral instance store volume
   *
   * For example, a value like `BlockDeviceVolume.ebs(15)`, `BlockDeviceVolume.ephemeral(0)`.
   */
  readonly volume: BlockDeviceVolume;

  /**
   * If false, the device mapping will be suppressed.
   * If set to false for the root device, the instance might fail the Amazon EC2 health check.
   * Amazon EC2 Auto Scaling launches a replacement instance if the instance fails the health check.
   *
   * NOTE: Terraform Provider AWS does not support this for aws_instance non-ephemeral Block Devices
   *
   * @default true - device mapping is left untouched
   */
  readonly mappingEnabled?: boolean;
}

/**
 * Base block device options for an EBS volume
 */
export interface EbsDeviceOptionsBase {
  /**
   * Indicates whether to delete the volume when the instance is terminated.
   *
   * @default - true for Amazon EC2 Auto Scaling, false otherwise (e.g. EBS)
   */
  readonly deleteOnTermination?: boolean;

  /**
   * The number of I/O operations per second (IOPS) to provision for the volume.
   *
   * Must only be set for `volumeType`: `EbsDeviceVolumeType.IO1`
   *
   * The maximum ratio of IOPS to volume size (in GiB) is 50:1, so for 5,000 provisioned IOPS,
   * you need at least 100 GiB storage on the volume.
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSVolumeTypes.html
   *
   * @default - none, required for `EbsDeviceVolumeType.IO1`
   */
  readonly iops?: number;

  /**
   * The EBS volume type
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSVolumeTypes.html
   *
   * @default `EbsDeviceVolumeType.GENERAL_PURPOSE_SSD` or `EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3` if
   * `@aws-cdk/aws-ec2:ebsDefaultGp3Volume` is enabled.
   */
  readonly volumeType?: EbsDeviceVolumeType;

  /**
   * The throughput to provision for a `gp3` volume.
   *
   * Valid Range: Minimum value of 125. Maximum value of 1000.
   *
   * `gp3` volumes deliver a consistent baseline throughput performance of 125 MiB/s.
   * You can provision additional throughput for an additional cost at a ratio of 0.25 MiB/s per provisioned IOPS.
   *
   * @see https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html#gp3-performance
   *
   * @default - 125 MiB/s.
   */
  readonly throughput?: number;
}

/**
 * Block device options for an EBS volume
 */
export interface EbsDeviceOptions extends EbsDeviceOptionsBase {
  /**
   * Specifies whether the EBS volume is encrypted.
   * Encrypted EBS volumes can only be attached to instances that support Amazon EBS encryption
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html#EBSEncryption_supported_instances
   *
   * @default false
   */
  readonly encrypted?: boolean;

  /**
   * The ARN of the AWS Key Management Service (AWS KMS) CMK used for encryption.
   *
   * You have to ensure that the KMS CMK has the correct permissions to be used by the service launching the ec2 instances.
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html#ebs-encryption-requirements
   *
   * @default - If encrypted is true, the default aws/ebs KMS key will be used.
   */
  readonly kmsKey?: IKey;
}

/**
 * Block device options for an EBS volume created from a snapshot
 */
export interface EbsDeviceSnapshotOptions extends EbsDeviceOptionsBase {
  /**
   * The volume size, in Gibibytes (GiB)
   *
   * If you specify volumeSize, it must be equal or greater than the size of the snapshot.
   *
   * @default - The snapshot size
   */
  readonly volumeSize?: number;
}

/**
 * Properties of an EBS block device
 */
export interface EbsDeviceProps
  extends EbsDeviceSnapshotOptions,
    EbsDeviceOptions {
  /**
   * The snapshot ID of the volume to use
   *
   * @default - No snapshot will be used
   */
  readonly snapshotId?: string;
}

/**
 * Describes a block device mapping for an EC2 instance or Auto Scaling group.
 */
export class BlockDeviceVolume {
  /**
   * Creates a new Elastic Block Storage device
   *
   * @param volumeSize The volume size, in Gibibytes (GiB)
   * @param options additional device options
   */
  public static ebs(
    volumeSize: number,
    options: EbsDeviceOptions = {},
  ): BlockDeviceVolume {
    return new this({ ...options, volumeSize });
  }

  /**
   * Creates a new Elastic Block Storage device from an existing snapshot
   *
   * @param snapshotId The snapshot ID of the volume to use
   * @param options additional device options
   */
  public static ebsFromSnapshot(
    snapshotId: string,
    options: EbsDeviceSnapshotOptions = {},
  ): BlockDeviceVolume {
    return new this({ ...options, snapshotId });
  }

  /**
   * Creates a virtual, ephemeral device.
   * The name will be in the form ephemeral{volumeIndex}.
   *
   * @param volumeIndex the volume index. Must be equal or greater than 0
   */
  public static ephemeral(volumeIndex: number) {
    if (volumeIndex < 0) {
      throw new Error(
        `volumeIndex must be a number starting from 0, got "${volumeIndex}"`,
      );
    }

    return new this(undefined, `ephemeral${volumeIndex}`);
  }

  /**
   * @param ebsDevice EBS device info
   * @param virtualName Virtual device name
   */
  protected constructor(
    public readonly ebsDevice?: EbsDeviceProps,
    public readonly virtualName?: string,
  ) {}

  public isEphemeral(): this is BlockDeviceVolume & { virtualName: string } {
    return this.virtualName !== undefined;
  }
}

/**
 * Supported EBS volume types for blockDevices
 */
export enum EbsDeviceVolumeType {
  /**
   * Magnetic
   */
  STANDARD = "standard",

  /**
   *  Provisioned IOPS SSD - IO1
   */
  IO1 = "io1",

  /**
   *  Provisioned IOPS SSD - IO2
   */
  IO2 = "io2",

  /**
   * General Purpose SSD - GP2
   */
  GP2 = "gp2",

  /**
   * General Purpose SSD - GP3
   */
  GP3 = "gp3",

  /**
   * Throughput Optimized HDD
   */
  ST1 = "st1",

  /**
   * Cold HDD
   */
  SC1 = "sc1",

  /**
   * General purpose SSD volume (GP2) that balances price and performance for a wide variety of workloads.
   */
  GENERAL_PURPOSE_SSD = GP2,

  /**
   * General purpose SSD volume (GP3) that balances price and performance for a wide variety of workloads.
   */
  GENERAL_PURPOSE_SSD_GP3 = GP3,

  /**
   * Highest-performance SSD volume (IO1) for mission-critical low-latency or high-throughput workloads.
   */
  PROVISIONED_IOPS_SSD = IO1,

  /**
   * Highest-performance SSD volume (IO2) for mission-critical low-latency or high-throughput workloads.
   */
  PROVISIONED_IOPS_SSD_IO2 = IO2,

  /**
   * Low-cost HDD volume designed for frequently accessed, throughput-intensive workloads.
   */
  THROUGHPUT_OPTIMIZED_HDD = ST1,

  /**
   * Lowest cost HDD volume designed for less frequently accessed workloads.
   */
  COLD_HDD = SC1,

  /**
   * Magnetic volumes are backed by magnetic drives and are suited for workloads where data is accessed infrequently, and scenarios where low-cost
   * storage for small volume sizes is important.
   */
  MAGNETIC = STANDARD,
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface VolumeOutputs {
  /**
   * The EBS Volume's ID
   *
   * @attribute
   */
  readonly volumeId: string;

  /**
   * The availability zone that the EBS Volume is contained within (ex: us-west-2a)
   */
  readonly availabilityZone: string;

  /**
   * The customer-managed encryption key that is used to encrypt the Volume.
   *
   * @attribute
   */
  readonly encryptionKeyId?: string;
}

/**
 * An EBS Volume in AWS EC2.
 */
export interface IVolume extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly volumeOutputs: VolumeOutputs;
  /**
   * The EBS Volume's ID
   *
   * @attribute
   */
  readonly volumeId: string;

  /**
   * The availability zone that the EBS Volume is contained within (ex: us-west-2a)
   */
  readonly availabilityZone: string;

  /**
   * The customer-managed encryption key that is used to encrypt the Volume.
   *
   * @attribute
   */
  readonly encryptionKey?: IKey;

  /**
   * Grants permission to attach this Volume to an instance.
   * CAUTION: Granting an instance permission to attach to itself using this method will lead to
   * an unresolvable circular reference between the instance role and the instance.
   * Use `IVolume.grantAttachVolumeToSelf` to grant an instance permission to attach this
   * volume to itself.
   *
   * @param grantee  the principal being granted permission.
   * @param instances the instances to which permission is being granted to attach this
   *                 volume to. If not specified, then permission is granted to attach
   *                 to all instances in this account.
   */
  grantAttachVolume(grantee: IGrantable, instances?: IInstance[]): Grant;

  /**
   * Grants permission to attach the Volume by a ResourceTag condition. If you are looking to
   * grant an Instance, AutoScalingGroup, EC2-Fleet, SpotFleet, ECS host, etc the ability to attach
   * this volume to **itself** then this is the method you want to use.
   *
   * This is implemented by adding a Tag with key `VolumeGrantAttach-<suffix>` to the given
   * constructs and this Volume, and then conditioning the Grant such that the grantee is only
   * given the ability to AttachVolume if both the Volume and the destination Instance have that
   * tag applied to them.
   *
   * @param grantee    the principal being granted permission.
   * @param constructs The list of constructs that will have the generated resource tag applied to them.
   * @param tagKeySuffix A suffix to use on the generated Tag key in place of the generated hash value.
   *                     Defaults to a hash calculated from this volume and list of constructs. (DEPRECATED)
   */
  grantAttachVolumeByResourceTag(
    grantee: IGrantable,
    constructs: Construct[],
    tagKeySuffix?: string,
  ): Grant;

  /**
   * Grants permission to detach this Volume from an instance
   * CAUTION: Granting an instance permission to detach from itself using this method will lead to
   * an unresolvable circular reference between the instance role and the instance.
   * Use `IVolume.grantDetachVolumeFromSelf` to grant an instance permission to detach this
   * volume from itself.
   *
   * @param grantee  the principal being granted permission.
   * @param instances the instances to which permission is being granted to detach this
   *                 volume from. If not specified, then permission is granted to detach
   *                 from all instances in this account.
   */
  grantDetachVolume(grantee: IGrantable, instances?: IInstance[]): Grant;

  /**
   * Grants permission to detach the Volume by a ResourceTag condition.
   *
   * This is implemented via the same mechanism as `IVolume.grantAttachVolumeByResourceTag`,
   * and is subject to the same conditions.
   *
   * @param grantee    the principal being granted permission.
   * @param constructs The list of constructs that will have the generated resource tag applied to them.
   * @param tagKeySuffix A suffix to use on the generated Tag key in place of the generated hash value.
   *                     Defaults to a hash calculated from this volume and list of constructs. (DEPRECATED)
   */
  grantDetachVolumeByResourceTag(
    grantee: IGrantable,
    constructs: Construct[],
    tagKeySuffix?: string,
  ): Grant;
}

/**
 * Properties of an EBS Volume
 */
export interface VolumeProps extends AwsConstructProps {
  /**
   * The value of the physicalName property of this resource.
   *
   * @default The physical name will be allocated by CloudFormation at deployment time
   */
  readonly volumeName?: string;

  /**
   * The Availability Zone in which to create the volume.
   */
  readonly availabilityZone: string;

  /**
   * The size of the volume, in GiBs. You must specify either a snapshot ID or a volume size.
   * See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html
   * for details on the allowable size for each type of volume.
   *
   * @default If you're creating the volume from a snapshot and don't specify a volume size, the default is the snapshot size.
   */
  readonly size?: Size;

  /**
   * The snapshot from which to create the volume. You must specify either a snapshot ID or a volume size.
   *
   * @default The EBS volume is not created from a snapshot.
   */
  readonly snapshotId?: string;

  /**
   * Indicates whether Amazon EBS Multi-Attach is enabled.
   * See [Considerations and limitations](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-volumes-multi.html#considerations)
   * for the constraints of multi-attach.
   *
   * @default false
   */
  readonly enableMultiAttach?: boolean;

  /**
   * Specifies whether the volume should be encrypted. The effect of setting the encryption state to true depends on the volume origin
   * (new or from a snapshot), starting encryption state, ownership, and whether encryption by default is enabled. For more information,
   * see [Encryption by Default](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html#encryption-by-default)
   * in the Amazon Elastic Compute Cloud User Guide.
   *
   * Encrypted Amazon EBS volumes must be attached to instances that support Amazon EBS encryption. For more information, see
   * [Supported Instance Types](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html#EBSEncryption_supported_instances).
   *
   * @default false
   */
  readonly encrypted?: boolean;

  /**
   * The customer-managed encryption key that is used to encrypt the Volume. The encrypted property must
   * be true if this is provided.
   *
   * Note: If using an `aws-kms.IKey` created from a `aws-kms.Key.fromKeyArn()` here,
   * then the KMS key **must** have the following in its Key policy; otherwise, the Volume
   * will fail to create.
   *
   *     {
   *       "Effect": "Allow",
   *       "Principal": { "AWS": "<arn for your account-user> ex: arn:aws:iam::00000000000:root" },
   *       "Resource": "*",
   *       "Action": [
   *         "kms:DescribeKey",
   *         "kms:GenerateDataKeyWithoutPlainText",
   *       ],
   *       "Condition": {
   *         "StringEquals": {
   *           "kms:ViaService": "ec2.<Region>.amazonaws.com", (eg: ec2.us-east-1.amazonaws.com)
   *           "kms:CallerAccount": "0000000000" (your account ID)
   *         }
   *       }
   *     }
   *
   * @default The default KMS key for the account, region, and EC2 service is used.
   */
  readonly encryptionKey?: IKey;

  // TODO: Support for autoEnableIo
  // https://github.com/hashicorp/terraform-provider-aws/issues/34110
  // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html#cfn-ec2-volume-autoenableio
  // /**
  //  * Indicates whether the volume is auto-enabled for I/O operations. By default, Amazon EBS disables I/O to the volume from attached EC2
  //  * instances when it determines that a volume's data is potentially inconsistent. If the consistency of the volume is not a concern, and
  //  * you prefer that the volume be made available immediately if it's impaired, you can configure the volume to automatically enable I/O.
  //  *
  //  * @default false
  //  */
  // readonly autoEnableIo?: boolean;

  /**
   * The type of the volume; what type of storage to use to form the EBS Volume.
   *
   * @default `EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3`
   */
  readonly volumeType?: EbsDeviceVolumeType;

  /**
   * The number of I/O operations per second (IOPS) to provision for the volume. The maximum ratio is 50 IOPS/GiB for PROVISIONED_IOPS_SSD,
   * and 500 IOPS/GiB for both PROVISIONED_IOPS_SSD_IO2 and GENERAL_PURPOSE_SSD_GP3.
   * See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html
   * for more information.
   *
   * This parameter is valid only for PROVISIONED_IOPS_SSD, PROVISIONED_IOPS_SSD_IO2 and GENERAL_PURPOSE_SSD_GP3 volumes.
   *
   * @default None -- Required for io1 and io2 volumes. The default for gp3 volumes is 3,000 IOPS if omitted.
   */
  readonly iops?: number;

  /**
   * The throughput that the volume supports, in MiB/s
   * Takes a minimum of 125 and maximum of 1000.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html#cfn-ec2-volume-throughput
   * @default - 125 MiB/s. Only valid on gp3 volumes.
   */
  readonly throughput?: number;
}

/**
 * Attributes required to import an existing EBS Volume into the Stack.
 */
export interface VolumeAttributes {
  /**
   * The EBS Volume's ID
   */
  readonly volumeId: string;

  /**
   * The availability zone that the EBS Volume is contained within (ex: us-west-2a)
   */
  readonly availabilityZone: string;

  /**
   * The customer-managed encryption key that is used to encrypt the Volume.
   *
   * @default None -- The EBS Volume is not using a customer-managed KMS key for encryption.
   */
  readonly encryptionKey?: IKey;
}

/**
 * Common behavior of Volumes. Users should not use this class directly, and instead use ``Volume``.
 */
abstract class VolumeBase extends AwsConstructBase implements IVolume {
  public abstract readonly volumeId: string;
  public abstract readonly availabilityZone: string;
  public abstract readonly encryptionKey?: IKey;
  public get volumeOutputs(): VolumeOutputs {
    return {
      volumeId: this.volumeId,
      availabilityZone: this.availabilityZone,
      encryptionKeyId: this.encryptionKey?.keyId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.volumeOutputs;
  }

  public grantAttachVolume(
    grantee: IGrantable,
    instances?: IInstance[],
  ): Grant {
    const result = Grant.addToPrincipal({
      grantee,
      actions: ["ec2:AttachVolume"],
      resourceArns: this.collectGrantResourceArns(instances),
    });

    if (this.encryptionKey) {
      // When attaching a volume, the EC2 Service will need to grant to itself permission
      // to be able to decrypt the encryption key. We restrict the CreateGrant for principle
      // of least privilege, in accordance with best practices.
      // See: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html#ebs-encryption-permissions
      const kmsGrant: Grant = this.encryptionKey.grant(
        grantee,
        "kms:CreateGrant",
      );
      kmsGrant.principalStatement!.addConditions(
        {
          test: "Bool",
          variable: "kms:GrantIsForAWSResource",
          values: ["true"],
        },
        {
          test: "StringEquals",
          variable: "kms:ViaService",
          values: [`ec2.${AwsStack.ofAwsConstruct(this).region}.amazonaws.com`],
        },
        {
          test: "StringEquals",
          variable: "kms:GrantConstraintType",
          values: ["EncryptionContextSubset"],
        },
      );
    }

    return result;
  }

  public grantAttachVolumeByResourceTag(
    grantee: IGrantable,
    constructs: Construct[],
    tagKeySuffix?: string,
  ): Grant {
    const tagValue = this.calculateResourceTagValue([this, ...constructs]);
    const tagKey = `VolumeGrantAttach-${tagKeySuffix ?? tagValue.slice(0, 10).toUpperCase()}`;
    const result = this.grantAttachVolume(grantee);
    result.principalStatement!.addCondition({
      test: "ForAnyValue:StringEquals",
      variable: `ec2:ResourceTag/${tagKey}`,
      values: [tagValue],
    });

    // The ResourceTag condition requires that all resources involved in the operation have
    // the given tag, so we tag this and all constructs given.
    Tags.of(this).add(tagKey, tagValue);
    constructs.forEach((construct) => Tags.of(construct).add(tagKey, tagValue));

    return result;
  }

  public grantDetachVolume(
    grantee: IGrantable,
    instances?: IInstance[],
  ): Grant {
    const result = Grant.addToPrincipal({
      grantee,
      actions: ["ec2:DetachVolume"],
      resourceArns: this.collectGrantResourceArns(instances),
    });
    // Note: No encryption key permissions are required to detach an encrypted volume.
    return result;
  }

  public grantDetachVolumeByResourceTag(
    grantee: IGrantable,
    constructs: Construct[],
    tagKeySuffix?: string,
  ): Grant {
    const tagValue = this.calculateResourceTagValue([this, ...constructs]);
    const tagKey = `VolumeGrantDetach-${tagKeySuffix ?? tagValue.slice(0, 10).toUpperCase()}`;
    const result = this.grantDetachVolume(grantee);
    result.principalStatement!.addCondition({
      test: "ForAnyValue:StringEquals",
      variable: `ec2:ResourceTag/${tagKey}`,
      values: [tagValue],
    });

    // The ResourceTag condition requires that all resources involved in the operation have
    // the given tag, so we tag this and all constructs given.
    Tags.of(this).add(tagKey, tagValue);
    constructs.forEach((construct) => Tags.of(construct).add(tagKey, tagValue));

    return result;
  }

  private collectGrantResourceArns(instances?: IInstance[]): string[] {
    const stack = AwsStack.ofAwsConstruct(this);
    const resourceArns: string[] = [
      `arn:${stack.partition}:ec2:${stack.region}:${stack.account}:volume/${this.volumeId}`,
    ];
    const instanceArnPrefix = `arn:${stack.partition}:ec2:${stack.region}:${stack.account}:instance`;
    if (instances) {
      instances.forEach((instance) =>
        resourceArns.push(`${instanceArnPrefix}/${instance?.instanceId}`),
      );
    } else {
      resourceArns.push(`${instanceArnPrefix}/*`);
    }
    return resourceArns;
  }

  private calculateResourceTagValue(constructs: Construct[]): string {
    return md5hash(constructs.map((c) => AwsStack.uniqueId(c)).join(""));
  }
}

/**
 * Creates a new EBS Volume in AWS EC2.
 */
export class Volume extends VolumeBase {
  /**
   * Import an existing EBS Volume into the Stack.
   *
   * @param scope the scope of the import.
   * @param id    the ID of the imported Volume in the construct tree.
   * @param attrs the attributes of the imported Volume
   */
  public static fromVolumeAttributes(
    scope: Construct,
    id: string,
    attrs: VolumeAttributes,
  ): IVolume {
    class Import extends VolumeBase {
      public readonly volumeId = attrs.volumeId;
      public readonly availabilityZone = attrs.availabilityZone;
      public readonly encryptionKey = attrs.encryptionKey;
    }
    // Check that the provided volumeId looks like it could be valid.
    if (
      !Token.isUnresolved(attrs.volumeId) &&
      !/^vol-[0-9a-fA-F]+$/.test(attrs.volumeId)
    ) {
      throw new Error(
        "`volumeId` does not match expected pattern. Expected `vol-<hexadecmial value>` (ex: `vol-05abe246af`) or a Token",
      );
    }
    return new Import(scope, id);
  }

  public readonly volumeId: string;
  public readonly availabilityZone: string;
  public readonly encryptionKey?: IKey;

  public readonly resource: ebsVolume.EbsVolume;

  constructor(scope: Construct, id: string, props: VolumeProps) {
    super(scope, id, props);
    const volumeName =
      props.volumeName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    this.validateProps(props);

    this.resource = new ebsVolume.EbsVolume(this, "Resource", {
      availabilityZone: props.availabilityZone,
      // autoEnableIo: props.autoEnableIo,
      encrypted: props.encrypted,
      kmsKeyId: props.encryptionKey?.keyArn,
      iops: props.iops,
      multiAttachEnabled: props.enableMultiAttach ?? false,
      size: props.size?.toGibibytes({ rounding: SizeRoundingBehavior.FAIL }),
      snapshotId: props.snapshotId,
      throughput: props.throughput,
      type: props.volumeType ?? EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
    });

    if (props.volumeName) Tags.of(this.resource).add("Name", volumeName);

    this.volumeId = this.resource.id;
    this.availabilityZone = props.availabilityZone;
    this.encryptionKey = props.encryptionKey;

    if (this.encryptionKey) {
      // Per: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html#ebs-encryption-requirements
      const principal = new ViaServicePrincipal(
        `ec2.${AwsStack.ofAwsConstruct(this).region}.amazonaws.com`,
        new AccountRootPrincipal(),
      ).withConditions({
        test: "StringEquals",
        variable: "kms:CallerAccount",
        values: [AwsStack.ofAwsConstruct(this).account],
      });
      const grant = this.encryptionKey.grant(
        principal,
        // Describe & Generate are required to be able to create the CMK-encrypted Volume.
        "kms:DescribeKey",
        "kms:GenerateDataKeyWithoutPlainText",
      );
      if (props.snapshotId) {
        // ReEncrypt is required for when re-encrypting from an encrypted snapshot.
        grant.principalStatement?.addActions("kms:ReEncrypt*");
      }
    }
  }

  protected validateProps(props: VolumeProps) {
    if (!(props.size || props.snapshotId)) {
      throw new Error("Must provide at least one of `size` or `snapshotId`");
    }

    if (
      props.snapshotId &&
      !Token.isUnresolved(props.snapshotId) &&
      !/^snap-[0-9a-fA-F]+$/.test(props.snapshotId)
    ) {
      throw new Error(
        "`snapshotId` does match expected pattern. Expected `snap-<hexadecmial value>` (ex: `snap-05abe246af`) or Token",
      );
    }

    if (props.encryptionKey && !props.encrypted) {
      throw new Error(
        "`encrypted` must be true when providing an `encryptionKey`.",
      );
    }

    if (
      props.volumeType &&
      [
        EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
        EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
      ].includes(props.volumeType) &&
      !props.iops
    ) {
      throw new Error(
        "`iops` must be specified if the `volumeType` is `PROVISIONED_IOPS_SSD` or `PROVISIONED_IOPS_SSD_IO2`.",
      );
    }

    if (props.iops) {
      const volumeType =
        props.volumeType ?? EbsDeviceVolumeType.GENERAL_PURPOSE_SSD;
      if (
        ![
          EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
          EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
          EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        ].includes(volumeType)
      ) {
        throw new Error(
          "`iops` may only be specified if the `volumeType` is `PROVISIONED_IOPS_SSD`, `PROVISIONED_IOPS_SSD_IO2` or `GENERAL_PURPOSE_SSD_GP3`.",
        );
      }
      // Enforce minimum & maximum IOPS:
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html
      const iopsRanges: { [key: string]: { Min: number; Max: number } } = {};
      iopsRanges[EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3] = {
        Min: 3000,
        Max: 16000,
      };
      iopsRanges[EbsDeviceVolumeType.PROVISIONED_IOPS_SSD] = {
        Min: 100,
        Max: 64000,
      };
      iopsRanges[EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2] = {
        Min: 100,
        Max: 256000,
      };
      const { Min, Max } = iopsRanges[volumeType];
      if (props.iops < Min || props.iops > Max) {
        throw new Error(
          `\`${volumeType}\` volumes iops must be between ${Min} and ${Max}.`,
        );
      }

      // Enforce maximum ratio of IOPS/GiB:
      // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-volume-types.html
      const maximumRatios: { [key: string]: number } = {};
      maximumRatios[EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3] = 500;
      maximumRatios[EbsDeviceVolumeType.PROVISIONED_IOPS_SSD] = 50;
      maximumRatios[EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2] = 500;
      const maximumRatio = maximumRatios[volumeType];
      if (
        props.size &&
        props.iops >
          maximumRatio *
            props.size.toGibibytes({ rounding: SizeRoundingBehavior.FAIL })
      ) {
        throw new Error(
          `\`${volumeType}\` volumes iops has a maximum ratio of ${maximumRatio} IOPS/GiB.`,
        );
      }

      const maximumThroughputRatios: { [key: string]: number } = {};
      maximumThroughputRatios[EbsDeviceVolumeType.GP3] = 0.25;
      const maximumThroughputRatio = maximumThroughputRatios[volumeType];
      if (props.throughput && props.iops) {
        const iopsRatio = props.throughput / props.iops;
        if (iopsRatio > maximumThroughputRatio) {
          throw new Error(
            `Throughput (MiBps) to iops ratio of ${iopsRatio} is too high; maximum is ${maximumThroughputRatio} MiBps per iops`,
          );
        }
      }
    }

    if (props.enableMultiAttach) {
      const volumeType =
        props.volumeType ?? EbsDeviceVolumeType.GENERAL_PURPOSE_SSD;
      if (
        ![
          EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
          EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
        ].includes(volumeType)
      ) {
        throw new Error(
          "multi-attach is supported exclusively on `PROVISIONED_IOPS_SSD` and `PROVISIONED_IOPS_SSD_IO2` volumes.",
        );
      }
    }

    if (props.size) {
      const size = props.size.toGibibytes({
        rounding: SizeRoundingBehavior.FAIL,
      });
      // Enforce minimum & maximum volume size:
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html
      const sizeRanges: { [key: string]: { Min: number; Max: number } } = {};
      sizeRanges[EbsDeviceVolumeType.GENERAL_PURPOSE_SSD] = {
        Min: 1,
        Max: 16384,
      };
      sizeRanges[EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3] = {
        Min: 1,
        Max: 16384,
      };
      sizeRanges[EbsDeviceVolumeType.PROVISIONED_IOPS_SSD] = {
        Min: 4,
        Max: 16384,
      };
      sizeRanges[EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2] = {
        Min: 4,
        Max: 16384,
      };
      sizeRanges[EbsDeviceVolumeType.THROUGHPUT_OPTIMIZED_HDD] = {
        Min: 125,
        Max: 16384,
      };
      sizeRanges[EbsDeviceVolumeType.COLD_HDD] = { Min: 125, Max: 16384 };
      sizeRanges[EbsDeviceVolumeType.MAGNETIC] = { Min: 1, Max: 1024 };
      const volumeType =
        props.volumeType ?? EbsDeviceVolumeType.GENERAL_PURPOSE_SSD;
      const { Min, Max } = sizeRanges[volumeType];
      if (size < Min || size > Max) {
        throw new Error(
          `\`${volumeType}\` volumes must be between ${Min} GiB and ${Max} GiB in size.`,
        );
      }
    }

    if (props.throughput) {
      const throughputRange = { Min: 125, Max: 1000 };
      const { Min, Max } = throughputRange;
      if (props.volumeType != EbsDeviceVolumeType.GP3) {
        throw new Error(
          "throughput property requires volumeType: EbsDeviceVolumeType.GP3",
        );
      }
      if (props.throughput < Min || props.throughput > Max) {
        throw new Error(
          `throughput property takes a minimum of ${Min} and a maximum of ${Max}`,
        );
      }
    }
  }
}
