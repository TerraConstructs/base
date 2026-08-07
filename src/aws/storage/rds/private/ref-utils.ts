// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/private/ref-utils.ts

// TODO: omitted — this entire file is CloudFormation L1 "Ref" plumbing: `IDBSubnetGroupRef` is a
// generated marker interface from `rds.generated.ts` (the CFN L1 codegen artifact) used to narrow a
// loosely-typed CFN `Ref` down to the concrete `ISubnetGroup` L2 interface. TerraConstructs has no
// equivalent L1-Ref indirection layer (Terraform L1s are consumed directly), so `toISubnetGroup`
// has no Terraform-native purpose — `../subnet-group`'s own `ISubnetGroup` likewise drops the
// upstream `dbSubnetGroupRef` member for the same reason (see the TODO on `ISubnetGroup` there).
// Left commented out for reference only.
// — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/private/ref-utils.ts
//
// import { UnscopedValidationError } from "../../../../errors";
// import type { IDBSubnetGroupRef } from "../rds.generated";
// import type { ISubnetGroup } from "../subnet-group";
//
// /**
//  * Convert an IBackupVaultRef to IBackupVault, throwing an error if the instance
//  * doesn't implement the full IBackupVault interface.
//  */
// export function toISubnetGroup(group: IDBSubnetGroupRef): ISubnetGroup {
//   if (!("subnetGroupName" in group)) {
//     throw new UnscopedValidationError(
//       `'group' instance should implement ISubnetGroup, but doesn't: ${group.constructor.name}`,
//     );
//   }
//   return group as ISubnetGroup;
// }
