// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/index.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-redshift-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.

export * from "./cluster";
export * from "./parameter-group";
export * from "./database-options";
export * from "./database-secret";
export * from "./endpoint";
export * from "./subnet-group";

// TODO(scope-reduction): omitted — `./table` and `./user` (upstream's `Table`/`ITable`,
// `User`/`IUser`, and their shared `private/` custom-resource machinery) are ported in this repo
// as FULLY COMMENTED-OUT files, not re-exported here. They are backed entirely by a
// `Custom::RedshiftDatabaseQuery` CloudFormation custom resource (a Lambda function under
// `private/database-query-provider/`) that TerraConstructs has no framework equivalent for yet.
// See the leading TODO block in `./table.ts` / `./user.ts` / `./private/database-query.ts` for the
// full rationale and permalinks; re-enabling these exports is a de-commenting exercise once a
// custom-resource Lambda framework lands in this repo —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/index.ts#L7-L8
// export * from "./table";
// export * from "./user";

// TODO: omitted — upstream also re-exports the generated CFN L1 (`./redshift.generated`, i.e.
// `CfnCluster`/`CfnClusterParameterGroup`/`CfnClusterSubnetGroup`/`CfnEndpointAccess`/
// `CfnEndpointAuthorization`/`CfnScheduledAction`). This repo has no CloudFormation-generated L1
// layer to re-export (Terraform L1s come from `@cdktn/provider-aws` instead, already consumed
// directly by `./cluster.ts`/`./parameter-group.ts`/`./subnet-group.ts`) — identical omission to
// every other ported module in this repo (e.g. `../neptune/index.ts`, `../docdb/index.ts`) —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/index.ts
