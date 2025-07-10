import { Token } from "cdktf";
import { IConstruct } from "constructs";
import { ArnFormat } from "../arn";
import { AwsStack } from "../aws-stack";
import { BucketAttributes } from "./bucket";
import { partitionLookup } from "../partition";

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
// ref: AWS_REGIONS_AND_RULES > RULE_S3_WEBSITE_REGIONAL_SUBDOMAIN
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

// Replicated to avoid CDKTF Tokens
// https://github.com/hashicorp/terraform-provider-aws/blob/v6.0.0/internal/service/s3/hosted_zones.go#L55
// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/region-info/build-tools/fact-tables.ts#L7

/**
 * The hosted zone Id if using an alias record in Route53.
 *
 * @see https://docs.aws.amazon.com/general/latest/gr/s3.html#s3_region
 */
export const ROUTE_53_BUCKET_WEBSITE_ZONE_IDS: { [region: string]: string } = {
  "af-south-1": "Z11KHD8FBVPUYU",
  "ap-east-1": "ZNB98KWMFR0R6",
  "ap-northeast-1": "Z2M4EHUR26P7ZW",
  "ap-northeast-2": "Z3W03O7B5YMIYP",
  "ap-northeast-3": "Z2YQB5RD63NC85",
  "ap-south-1": "Z11RGJOFQNVJUP",
  "ap-south-2": "Z02976202B4EZMXIPMXF7",
  "ap-southeast-1": "Z3O0J2DXBE1FTB",
  "ap-southeast-2": "Z1WCIGYICN2BYD",
  "ap-southeast-3": "Z01846753K324LI26A3VV",
  "ap-southeast-4": "Z0312387243XT5FE14WFO",
  "ap-southeast-5": "Z08660063OXLMA7F1FJHU",
  "ca-central-1": "Z1QDHH18159H29",
  "cn-north-1": "Z5CN8UMXT92WN",
  "cn-northwest-1": "Z282HJ1KT0DH03",
  "eu-central-1": "Z21DNDUVLTQW6Q",
  "eu-central-2": "Z030506016YDQGETNASS",
  "eu-north-1": "Z3BAZG2TWCNX0D",
  "eu-south-1": "Z3IXVV8C73GIO3",
  "eu-south-2": "Z0081959F7139GRJC19J",
  "eu-west-1": "Z1BKCTXD74EZPE",
  "eu-west-2": "Z3GKZC51ZF0DB4",
  "eu-west-3": "Z3R1K369G5AVDG",
  "il-central-1": "Z09640613K4A3MN55U7GU",
  "me-central-1": "Z06143092I8HRXZRUZROF",
  "me-south-1": "Z1MPMWCPA7YB62",
  "sa-east-1": "Z7KQH4QJS55SO",
  "us-east-1": "Z3AQBSTGFYJSTF",
  "us-east-2": "Z2O1EMRO9K5GLX",
  "us-gov-east-1": "Z2NIFVYYW2VKV1",
  "us-gov-west-1": "Z31GFT0UA1I2HV",
  "us-west-1": "Z2F56UZL2M1ACD",
  "us-west-2": "Z3BJ6K6RIION7M",
};

// https://github.com/aws/aws-cdk/blob/v2.181.1/packages/aws-cdk-lib/region-info/build-tools/generate-static-data.ts#L77
export function s3StaticWebsiteHostedZoneId(region: string): string {
  if (Token.isUnresolved(region)) {
    throw new Error("Cannot determine S3 hosted ZoneId for unresolved region");
  }
  const hostedZoneId = ROUTE_53_BUCKET_WEBSITE_ZONE_IDS[region];
  if (!hostedZoneId) {
    throw new Error(
      `No hosted zone ID found for S3 static website in region: ${region}`,
    );
  }
  return hostedZoneId;
}
