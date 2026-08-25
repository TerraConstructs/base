// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/index.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.
//
// The index.ts files contains a list of files we want to include as part of the public API of
// this module. In general, all files including L2 classes will be listed here, while all files
// including only utility functions (`./permissions.ts`, `./util.ts`) are omitted, matching
// upstream's own convention verbatim.

export * from "./table-bucket";
export * from "./table-bucket-policy";
export * from "./namespace";
export * from "./table";
export * from "./table-policy";

// TODO: omitted — upstream also re-exports the generated CFN L1 (`./s3tables.generated`, i.e.
// `CfnTableBucket`/`CfnTableBucketPolicy`/`CfnNamespace`/`CfnTable`/`CfnTablePolicy`). This repo
// has no CloudFormation-generated L1 layer to re-export (Terraform L1s come from
// `@cdktn/provider-aws` instead, already consumed directly by
// `./table-bucket.ts`/`./table-bucket-policy.ts`/`./namespace.ts`/`./table.ts`/`./table-policy.ts`)
// — identical omission to every other ported module in this repo (e.g. `../docdb/index.ts`,
// `../neptune/index.ts`, `../redshift/index.ts`) —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/index.ts
