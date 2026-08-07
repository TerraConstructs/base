// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/index.ts

export * from "./vault";
export * from "./plan";
export * from "./rule";
export * from "./selection";
export * from "./resource";

// TODO: omitted — upstream also re-exports the generated CFN L1 (`./backup.generated`, i.e.
// `CfnBackupPlan`/`CfnBackupSelection`/`CfnBackupVault`/...). This repo has no
// CloudFormation-generated L1 layer to re-export (Terraform L1s come from `@cdktn/provider-aws`
// instead, already consumed directly by `./vault.ts`/`./plan.ts`/`./selection.ts`) — identical
// omission to every other ported module in this repo (e.g. `../docdb/index.ts`) —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/index.ts#L6
