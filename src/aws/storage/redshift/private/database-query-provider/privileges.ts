// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query-provider/privileges.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/database-query-provider/privileges.ts --
//
//
// import type * as AWSLambda from 'aws-lambda';
// import type { TablePrivilege, UserTablePrivilegesHandlerProps } from '../handler-props';
// import { quoteIdentifier, quoteQualifiedIdentifier } from './escape';
// import { executeStatement } from './redshift-data';
// import type { ClusterProps } from './types';
// import { makePhysicalId } from './util';
//
// export async function handler(props: UserTablePrivilegesHandlerProps & ClusterProps, event: AWSLambda.CloudFormationCustomResourceEvent) {
//   const username = props.username;
//   const tablePrivileges = props.tablePrivileges;
//   const clusterProps = props;
//
//   if (event.RequestType === 'Create') {
//     await grantPrivileges(username, tablePrivileges, clusterProps, event.StackId);
//     return { PhysicalResourceId: makePhysicalId(username, clusterProps, event.RequestId) };
//   } else if (event.RequestType === 'Delete') {
//     await revokePrivileges(username, tablePrivileges, clusterProps, event.StackId);
//     return;
//   } else if (event.RequestType === 'Update') {
//     const { replace } = await updatePrivileges(
//       username,
//       tablePrivileges,
//       clusterProps,
//       event.OldResourceProperties as unknown as UserTablePrivilegesHandlerProps & ClusterProps,
//       event.StackId,
//     );
//     const physicalId = replace ? makePhysicalId(username, clusterProps, event.RequestId) : event.PhysicalResourceId;
//     return { PhysicalResourceId: physicalId };
//   } else {
//     /* eslint-disable-next-line dot-notation */
//     throw new Error(`Unrecognized event type: ${event['RequestType']}`);
//   }
// }
//
// async function revokePrivileges(
//   username: string,
//   tablePrivileges: TablePrivilege[],
//   clusterProps: ClusterProps,
//   stackId: string,
// ) {
//   // Limited by human input
//   // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
//   await Promise.all(tablePrivileges.map(({ tableName, actions }) => {
//     return executeStatement(
//       `REVOKE ${actions.join(', ')} ON ${quoteQualifiedIdentifier(normalizedTableName(tableName, stackId))} FROM ${quoteIdentifier(username)}`,
//       clusterProps,
//     );
//   }));
// }
//
// async function grantPrivileges(
//   username: string,
//   tablePrivileges: TablePrivilege[],
//   clusterProps: ClusterProps,
//   stackId: string,
// ) {
//   // Limited by human input
//   // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
//   await Promise.all(tablePrivileges.map(({ tableName, actions }) => {
//     return executeStatement(
//       `GRANT ${actions.join(', ')} ON ${quoteQualifiedIdentifier(normalizedTableName(tableName, stackId))} TO ${quoteIdentifier(username)}`,
//       clusterProps,
//     );
//   }));
// }
//
// async function updatePrivileges(
//   username: string,
//   tablePrivileges: TablePrivilege[],
//   clusterProps: ClusterProps,
//   oldResourceProperties: UserTablePrivilegesHandlerProps & ClusterProps,
//   stackId: string,
// ): Promise<{ replace: boolean }> {
//   const oldClusterProps = oldResourceProperties;
//   if (clusterProps.clusterName !== oldClusterProps.clusterName || clusterProps.databaseName !== oldClusterProps.databaseName) {
//     await grantPrivileges(username, tablePrivileges, clusterProps, stackId);
//     return { replace: true };
//   }
//
//   const oldUsername = oldResourceProperties.username;
//   if (oldUsername !== username) {
//     await grantPrivileges(username, tablePrivileges, clusterProps, stackId);
//     return { replace: true };
//   }
//
//   const oldTablePrivileges = oldResourceProperties.tablePrivileges;
//   const tablesToRevoke = oldTablePrivileges.filter(({ tableId, actions }) => (
//     tablePrivileges.find(({ tableId: otherTableId, actions: otherActions }) => (
//       tableId === otherTableId && actions.some(action => !otherActions.includes(action))
//     ))
//   ));
//   if (tablesToRevoke.length > 0) {
//     await revokePrivileges(username, tablesToRevoke, clusterProps, stackId);
//   }
//
//   const tablesToGrant = tablePrivileges.filter(({ tableId, tableName, actions }) => {
//     const tableAdded = !oldTablePrivileges.find(({ tableId: otherTableId, tableName: otherTableName }) => (
//       tableId === otherTableId && tableName === otherTableName
//     ));
//     const actionsAdded = oldTablePrivileges.find(({ tableId: otherTableId, actions: otherActions }) => (
//       tableId === otherTableId && otherActions.some(action => !actions.includes(action))
//     ));
//     return tableAdded || actionsAdded;
//   });
//   if (tablesToGrant.length > 0) {
//     await grantPrivileges(username, tablesToGrant, clusterProps, stackId);
//   }
//
//   return { replace: false };
// }
//
// /**
//  * We need this normalization logic because some of the `TableName` values
//  * are physical IDs generated in the {@link makePhysicalId} function.
//  * */
// const normalizedTableName = (tableName: string, stackId: string): string => {
//   const segments = tableName.split(':');
//   const suffix = segments.slice(-1);
//   if (suffix != null && stackId.endsWith(suffix[0])) {
//     return segments.slice(-2)[0] ?? tableName;
//   }
//   return tableName;
// };
//
// -- END fully commented-out upstream port of lib/private/database-query-provider/privileges.ts --
