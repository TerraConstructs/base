// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/index.ts

export * from "./cluster";
export * from "./cluster-ref";
export * from "./database-secret";
export * from "./endpoint";
export * from "./instance";
export * from "./parameter-group";
export * from "./props";

export { CaCertificate } from "../rds";

// TODO: omitted — upstream also re-exports the generated CFN L1 (`./docdb.generated`, i.e.
// `CfnDBCluster`/`CfnDBInstance`/`CfnDBClusterParameterGroup`/`CfnDBSubnetGroup`). This repo has no
// CloudFormation-generated L1 layer to re-export (Terraform L1s come from `@cdktn/provider-aws`
// instead, already consumed directly by `./instance.ts`/`./parameter-group.ts`) — identical
// omission to every other ported module in this repo (e.g. `../rds/index.ts`) —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/lib/index.ts#L12
