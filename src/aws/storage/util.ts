import { Token } from "cdktf";
import { IConstruct } from "constructs";
import { ArnFormat } from "../arn";
import { AwsStack } from "../aws-stack";
import { BucketAttributes } from "./bucket";

export function parseBucketArn(
  construct: IConstruct,
  props: BucketAttributes,
): string {
  // if we have an explicit bucket ARN, use it.
  if (props.bucketArn) {
    return props.bucketArn;
  }

  if (props.bucketName) {
    return AwsStack.ofAwsConstruct(construct).formatArn({
      // S3 Bucket names are globally unique in a partition,
      // and so their ARNs have empty region and account components
      region: "",
      account: "",
      service: "s3",
      resource: props.bucketName,
    });
  }

  throw new Error(
    "Cannot determine bucket ARN. At least `bucketArn` or `bucketName` is needed",
  );
}

export function parseBucketName(
  construct: IConstruct,
  props: BucketAttributes,
): string | undefined {
  // if we have an explicit bucket name, use it.
  if (props.bucketName) {
    return props.bucketName;
  }

  // extract bucket name from bucket arn
  if (props.bucketArn) {
    return AwsStack.ofAwsConstruct(construct).splitArn(
      props.bucketArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).resource;
  }

  // no bucket name is okay since it's optional.
  return undefined;
}

/**
 * All http request methods
 */
export enum HttpMethods {
  /**
   * The GET method requests a representation of the specified resource.
   */
  GET = "GET",
  /**
   * The PUT method replaces all current representations of the target resource with the request payload.
   */
  PUT = "PUT",
  /**
   * The HEAD method asks for a response identical to that of a GET request, but without the response body.
   */
  HEAD = "HEAD",
  /**
   * The POST method is used to submit an entity to the specified resource, often causing a change in state or side effects on the server.
   */
  POST = "POST",
  /**
   * The DELETE method deletes the specified resource.
   */
  DELETE = "DELETE",
}

/**
 * All http request methods
 */
export enum RedirectProtocol {
  HTTP = "http",
  HTTPS = "https",
}

/**
 * Normalize windows paths to be posix-like.
 */
export function normalPath(path: string) {
  // ref: https://github.com/winglang/wing/blob/v0.83.8/libs/wingsdk/src/shared/misc.ts#L15
  if (process.platform === "win32") {
    return (
      path
        // force posix path separator
        .replace(/\\+/g, "/")
    );
  } else {
    return path;
  }
}

// https://github.com/aws/aws-cdk/blob/v2.181.1/packages/aws-cdk-lib/region-info/lib/aws-entities.ts#L27

/**
 * regions introduced before s3 website started using a regional subdomain
 * After this point, S3 website domains look like `s3-website.REGION.s3.amazonaws.com`
 *
 * Before this point, S3 website domains look like `s3-website-REGION.s3.amazonaws.com`.
 */
const BEFORE_S3_WEBSITE_REGIONAL_SUBDOMAIN: string[] = [
  "us-east-1", // US East (N. Virginia)
  "eu-west-1", // Europe (Ireland)
  "us-west-1", // US West (N. California)
  "ap-southeast-1", // Asia Pacific (Singapore)
  "ap-northeast-1", // Asia Pacific (Tokyo)
  "us-gov-west-1", // AWS GovCloud (US-West)
  "us-west-2", // US West (Oregon)
  "sa-east-1", // South America (São Paulo)
  "ap-southeast-2", // Asia Pacific (Sydney)
];

// https://github.com/aws/aws-cdk/blob/v2.181.1/packages/aws-cdk-lib/region-info/build-tools/generate-static-data.ts#L73
export function s3StaticWebsiteEndpoint(region: string): string {
  // NOTE: This function is not used instead we use the s3 bucket datasource
  if (Token.isUnresolved(region)) {
    throw new Error(
      "Cannot determine S3 website endpoint for unresolved region",
    );
  }
  const { domainSuffix } = partitionLookup(region);
  if (BEFORE_S3_WEBSITE_REGIONAL_SUBDOMAIN.includes(region)) {
    return `s3-website-${region}.${domainSuffix}`;
  }
  return `s3-website.${region}.${domainSuffix}`;
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

enum Partition {
  Default = "aws",
  Cn = "aws-cn",
  UsGov = "aws-us-gov",
  UsIso = "aws-iso",
  UsIsoB = "aws-iso-b",
  UsIsoF = "aws-iso-f",
  EuIsoE = "aws-iso-e",
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
