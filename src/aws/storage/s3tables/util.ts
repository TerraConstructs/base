// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/util.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.

import { IConstruct } from "constructs";
import type { TableBucketAttributes } from "./table-bucket";
import { UnscopedValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";

export const S3_TABLES_SERVICE = "s3tables";

export function parseTableBucketArn(
  construct: IConstruct,
  props: TableBucketAttributes,
): string {
  // if we have an explicit table bucket ARN, use it.
  if (props.tableBucketArn) {
    return props.tableBucketArn;
  }

  if (props.tableBucketName) {
    return AwsStack.ofAwsConstruct(construct).formatArn({
      region: props.region,
      account: props.account,
      service: S3_TABLES_SERVICE,
      resource: "bucket",
      resourceName: props.tableBucketName,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
  }

  throw new UnscopedValidationError(
    "Cannot determine bucket ARN. At least `tableBucketArn` is needed",
  );
}

export function parseTableBucketName(
  construct: IConstruct,
  props: TableBucketAttributes,
): string {
  // if we have an explicit bucket name, use it.
  if (props.tableBucketName) {
    return props.tableBucketName;
  }

  // extract table bucket name from bucket arn
  if (props.tableBucketArn) {
    const bucketNameFromArn = AwsStack.ofAwsConstruct(construct).splitArn(
      props.tableBucketArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).resourceName;
    if (bucketNameFromArn) {
      return bucketNameFromArn;
    }
  }

  throw new UnscopedValidationError(
    "tableBucketName is required and could not be inferred from context",
  );
}

export function parseTableBucketRegion(
  construct: IConstruct,
  props: TableBucketAttributes,
): string | undefined {
  // if we have an explicit bucket region, use it.
  if (props.region) {
    return props.region;
  }

  // extract table bucket region from bucket arn
  if (props.tableBucketArn) {
    const regionFromArn = AwsStack.ofAwsConstruct(construct).splitArn(
      props.tableBucketArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).region;
    if (regionFromArn) {
      return regionFromArn;
    }
  }

  // Region is optional, can be inferred later
  return undefined;
}

export function parseTableBucketAccount(
  construct: IConstruct,
  props: TableBucketAttributes,
): string | undefined {
  // if we have an explicit bucket account, use it.
  if (props.account) {
    return props.account;
  }

  // extract table bucket account from bucket arn
  if (props.tableBucketArn) {
    const accountFromArn = AwsStack.ofAwsConstruct(construct).splitArn(
      props.tableBucketArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).account;
    if (accountFromArn) {
      return accountFromArn;
    }
  }

  // Account is optional, can be inferred later
  return undefined;
}

/**
 * @returns populated attributes from given scope and attributes
 * @throws UnscopedValidationError if any of the required attributes are missing
 */
export function validateTableBucketAttributes(
  construct: IConstruct,
  props: TableBucketAttributes,
) {
  return {
    tableBucketName: parseTableBucketName(construct, props),
    account: parseTableBucketAccount(construct, props),
    region: parseTableBucketRegion(construct, props),
    tableBucketArn: parseTableBucketArn(construct, props),
  };
}
