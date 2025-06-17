// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/private/ebs-util.ts

import { instance, launchTemplate } from "@cdktf/provider-aws";
import {
  Annotations,
  //IResolvable
} from "cdktf";
import { Construct } from "constructs";
import { AmazonLinuxVirt } from "../machine-image/common";
import { BlockDevice, BlockDeviceVolume, EbsDeviceVolumeType } from "../volume";

export function instanceEbsBlockDeviceMappings(
  construct: Construct,
  blockDevices: BlockDevice[],
  tags?: Record<string, string>,
): instance.InstanceEbsBlockDevice[] | undefined {
  const result: instance.InstanceEbsBlockDevice[] = [];
  blockDevices
    .filter((x) => !isEphemeral(x) && !isRootBlockDevice(x))
    .forEach((blockDevice) => {
      const { deviceName, volume } = blockDevice;
      const common = blockDeviceCommon(construct, volume);
      result.push({
        deviceName,
        ...common,
        tags,
      });
    });
  return result.length === 0 ? undefined : result;
}

export function launchTemplateBlockDeviceMappings(
  construct: Construct,
  blockDevices: BlockDevice[],
): launchTemplate.LaunchTemplateBlockDeviceMappings[] | undefined {
  const result: launchTemplate.LaunchTemplateBlockDeviceMappings[] = [];
  for (const blockDevice of blockDevices) {
    const { deviceName, volume, mappingEnabled } = blockDevice;
    const common = blockDeviceCommon(construct, volume);
    // convert EbsBlockVolume common properties for LaunchTemplateBlockDeviceMappings
    const deleteOnTermination =
      common?.deleteOnTermination !== undefined
        ? common.deleteOnTermination.toString()
        : undefined;
    const encrypted =
      common?.encrypted !== undefined ? common.encrypted.toString() : undefined;
    result.push({
      deviceName,
      noDevice: mappingEnabled === false ? "" : undefined,
      virtualName: volume.virtualName,
      ...(volume.virtualName
        ? {}
        : {
            ebs: {
              ...common,
              encrypted,
              deleteOnTermination,
            },
          }),
    });
  }
  return result.length === 0 ? undefined : result;
}

export function instanceEphemeralBlockDeviceMappings(
  blockDevices: BlockDevice[],
): instance.InstanceEphemeralBlockDevice[] | undefined {
  const ephemeralBlockDevices = blockDevices
    .filter(isEphemeral)
    .map((blockDevice) => {
      const { deviceName, volume, mappingEnabled } = blockDevice;
      const noDevice = mappingEnabled === false;
      const virtualName = noDevice ? volume.virtualName : undefined;
      return { deviceName, virtualName, noDevice };
    });
  return ephemeralBlockDevices.length === 0 ? undefined : ephemeralBlockDevices;
}

export function instanceRootBlockDeviceMapping(
  construct: Construct,
  blockDevices: BlockDevice[],
  tags?: Record<string, string>,
): instance.InstanceRootBlockDevice | undefined {
  for (const blockDevice of blockDevices) {
    if (isRootBlockDevice(blockDevice)) {
      return {
        ...blockDeviceCommon(construct, blockDevice.volume),
        tags,
      };
    }
  }
  return undefined;
}

function blockDeviceCommon(construct: Construct, volume: BlockDeviceVolume) {
  const { ebsDevice: ebs } = volume;
  if (ebs) {
    const { iops, throughput, volumeType, kmsKey, ...rest } = ebs;

    if (throughput) {
      if (volumeType !== EbsDeviceVolumeType.GP3) {
        throw new Error(
          `'throughput' requires 'volumeType': ${EbsDeviceVolumeType.GP3}, got: ${volumeType}.`,
        );
      }

      if (!Number.isInteger(throughput)) {
        throw new Error(`'throughput' must be an integer, got: ${throughput}.`);
      }

      if (throughput < 125 || throughput > 1000) {
        throw new Error(
          `'throughput' must be between 125 and 1000, got ${throughput}.`,
        );
      }

      const maximumThroughputRatio = 0.25;
      if (iops) {
        const iopsRatio = throughput / iops;
        if (iopsRatio > maximumThroughputRatio) {
          throw new Error(
            `Throughput (MiBps) to iops ratio of ${iopsRatio} is too high; maximum is ${maximumThroughputRatio} MiBps per iops`,
          );
        }
      }
    }

    if (!iops) {
      if (
        volumeType === EbsDeviceVolumeType.IO1 ||
        volumeType === EbsDeviceVolumeType.IO2
      ) {
        throw new Error(
          "iops property is required with volumeType: EbsDeviceVolumeType.IO1 and EbsDeviceVolumeType.IO2",
        );
      }
    } else if (
      volumeType !== EbsDeviceVolumeType.IO1 &&
      volumeType !== EbsDeviceVolumeType.IO2 &&
      volumeType !== EbsDeviceVolumeType.GP3
    ) {
      // "@aws-cdk/aws-ec2:iopsIgnored",
      Annotations.of(construct).addWarning(
        "iops will be ignored without volumeType: IO1, IO2, or GP3",
      );
    }

    /**
     * Because the Ebs properties of the L2 Constructs do not match the Ebs properties
     * of the TF *BlockDevice structs, we have to do some transformation
     */

    return {
      ...rest,
      iops,
      throughput,
      volumeType,
      kmsKeyId: kmsKey?.keyArn,
    };
  }
  return undefined;
}

/**
 * Determines if the given device name is the reserved name for root volume.
 *
 * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html#available-ec2-device-names
 */
export function isRootBlockDevice(
  blockDevice: BlockDevice,
  virtType: AmazonLinuxVirt = AmazonLinuxVirt.HVM,
): boolean {
  switch (virtType) {
    case AmazonLinuxVirt.HVM:
      return (
        blockDevice.deviceName === "/dev/sda1" ||
        blockDevice.deviceName === "/dev/xvda"
      );
    case AmazonLinuxVirt.PV:
      return blockDevice.deviceName === "/dev/sda1";
  }
}

function isEphemeral(blockDevice: BlockDevice): blockDevice is BlockDevice & {
  volume: BlockDeviceVolume & { virtualName: string };
} {
  return blockDevice.volume.isEphemeral();
}
