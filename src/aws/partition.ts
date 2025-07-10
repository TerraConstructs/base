// not exported on purpose for JSII compatibility
// NOTE: this file should be under core/private ...

import { Token } from "cdktf";

// JSII requires enum members to be ALL_CAPS
export enum Partition {
  Default = "aws",
  Cn = "aws-cn",
  UsGov = "aws-us-gov",
  UsIso = "aws-iso",
  UsIsoB = "aws-iso-b",
  UsIsoF = "aws-iso-f",
  EuIsoE = "aws-iso-e",
}

export function partitionLookup(region: string): {
  partition: Partition;
  domainSuffix: string;
} {
  if (Token.isUnresolved(region)) {
    throw new Error("Cannot determine region partition for unresolved region");
  }
  let partition = PARTITION_MAP.default.partition;
  let domainSuffix = PARTITION_MAP.default.domainSuffix;

  for (const key in PARTITION_MAP) {
    if (region.startsWith(key)) {
      partition = PARTITION_MAP[key].partition;
      domainSuffix = PARTITION_MAP[key].domainSuffix;
    }
  }
  return { partition, domainSuffix };
}

interface Region {
  partition: Partition;
  domainSuffix: string;
}
export const PARTITION_MAP: { [region: string]: Region } = {
  default: { partition: Partition.Default, domainSuffix: "amazonaws.com" },
  "cn-": { partition: Partition.Cn, domainSuffix: "amazonaws.com.cn" },
  "us-gov-": { partition: Partition.UsGov, domainSuffix: "amazonaws.com" },
  "us-iso-": { partition: Partition.UsIso, domainSuffix: "c2s.ic.gov" },
  "us-isob-": { partition: Partition.UsIsoB, domainSuffix: "sc2s.sgov.gov" },
  "us-isof-": { partition: Partition.UsIsoF, domainSuffix: "csp.hci.ic.gov" },
  "eu-isoe-": { partition: Partition.EuIsoE, domainSuffix: "cloud.adc-e.uk" },
};
