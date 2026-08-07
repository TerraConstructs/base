// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query-provider/util.ts
//
// TODO(scope-reduction): omitted in this port. Upstream's Table/User surface (this file,
// plus its siblings table.ts, user.ts, private/database-query.ts, private/privileges.ts,
// private/handler-props.ts, and private/database-query-provider/**) is backed entirely by a
// `Custom::RedshiftDatabaseQuery` CloudFormation custom resource: a Lambda function
// (private/database-query-provider/) invoked via a `cdk.CustomResource`/`cr.Provider` pair
// that runs arbitrary SQL (CREATE/ALTER/DROP TABLE, CREATE/DROP USER, GRANT/REVOKE) against
// the cluster's database at deploy time, using Data API or direct client connections from
// inside the handler. TerraConstructs has no framework equivalent to CDK's
// `Provider`/`CustomResource` L2s (Lambda-backed custom-resource lifecycle management with
// CREATE/UPDATE/DELETE event routing) in this repo yet, so this entire file is ported here
// verbatim but fully commented out, per the scope-reduction directive for this PR -- see
// `../cluster.ts`'s `addDefaultIamRole()` TERRACONSTRUCTS DEVIATION and
// `enableRebootForParameterChanges()` omission notes for the sibling omissions of the same
// root cause (upstream custom-resource dependency). Re-enabling this file is a de-commenting
// exercise once a custom-resource Lambda framework lands in this repo.
//
// Permalinks (v2.263.0):
//   lib/table.ts:                                 https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/table.ts
//   lib/user.ts:                                   https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/user.ts
//   lib/private/database-query.ts:                 https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query.ts
//   lib/private/handler-props.ts:                  https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/handler-props.ts
//   lib/private/privileges.ts:                     https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/privileges.ts
//   lib/private/database-query-provider/:           https://github.com/aws/aws-cdk/tree/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query-provider
//
// -- BEGIN fully commented-out upstream port of lib/private/database-query-provider/util.ts --
//
// import type { ClusterProps } from './types';
// import type { Column } from '../../table';
//
// export function makePhysicalId(resourceName: string, clusterProps: ClusterProps, requestId: string): string {
//   return `${clusterProps.clusterName}:${clusterProps.databaseName}:${resourceName}:${requestId}`;
// }
//
// export function getDistKeyColumn(columns: Column[]): Column | undefined {
//   // string comparison is required for custom resource since everything is passed as string
//   const distKeyColumns = columns.filter(column => column.distKey === true || (column.distKey as unknown as string) === 'true');
//
//   if (distKeyColumns.length === 0) {
//     return undefined;
//   } else if (distKeyColumns.length > 1) {
//     throw new Error('Multiple dist key columns found');
//   }
//
//   return distKeyColumns[0];
// }
//
// export function getSortKeyColumns(columns: Column[]): Column[] {
//   // string comparison is required for custom resource since everything is passed as string
//   return columns.filter(column => column.sortKey === true || (column.sortKey as unknown as string) === 'true');
// }
//
// export function areColumnsEqual(columnsA: Column[], columnsB: Column[]): boolean {
//   if (columnsA.length !== columnsB.length) {
//     return false;
//   }
//   return columnsA.every(columnA => {
//     return columnsB.find(column => column.name === columnA.name && column.dataType === columnA.dataType);
//   });
// }
//
// -- END fully commented-out upstream port of lib/private/database-query-provider/util.ts --
