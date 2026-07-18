export * from "./aspects";
export * from "./auto-scaling-group";
export * from "./schedule";
export * from "./lifecycle-hook";
export * from "./lifecycle-hook-target";
export * from "./scheduled-action";
export * from "./step-scaling-action";
export * from "./step-scaling-policy";
export * from "./target-tracking-scaling-policy";
export * from "./termination-policy";
export * from "./warm-pool";

// upstream aws-autoscaling/lib/volume.ts is a byte-for-byte duplicate of the
// EC2 block-device types already ported at ../volume; re-export them here so
// the autoscaling.* namespace preserves the upstream API surface
// (autoscaling.BlockDeviceVolume, autoscaling.EbsDeviceVolumeType, ...)
// instead of duplicating the port.
export { BlockDeviceVolume, EbsDeviceVolumeType } from "../volume";
export type {
  BlockDevice,
  EbsDeviceOptions,
  EbsDeviceOptionsBase,
  EbsDeviceSnapshotOptions,
  EbsDeviceProps,
} from "../volume";
