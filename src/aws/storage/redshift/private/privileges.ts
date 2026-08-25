// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/privileges.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/privileges.ts --
//
// import type { IArrayBox } from 'aws-cdk-lib/core/lib/helpers-internal';
// import { Box, noBoxStackTraces } from 'aws-cdk-lib/core/lib/helpers-internal';
// import { Construct } from 'constructs';
// import type { DatabaseOptions } from '../database-options';
// import type { ITable } from '../table';
// import { TableAction } from '../table';
// import type { IUser } from '../user';
// import { DatabaseQuery } from './database-query';
// import { HandlerName } from './database-query-provider/handler-name';
// import type { UserTablePrivilegesHandlerProps } from './handler-props';
//
// /**
//  * The Redshift table and action that make up a privilege that can be granted to a Redshift user.
//  */
// export interface TablePrivilege {
//   /**
//    * The table on which privileges will be granted.
//    */
//   readonly table: ITable;
//
//   /**
//    * The actions that will be granted.
//    */
//   readonly actions: TableAction[];
// }
//
// /**
//  * Properties for specifying privileges granted to a Redshift user on Redshift tables.
//  */
// export interface UserTablePrivilegesProps extends DatabaseOptions {
//   /**
//    * The user to which privileges will be granted.
//    */
//   readonly user: IUser;
//
//   /**
//    * The privileges to be granted.
//    *
//    * @default [] - use `addPrivileges` to grant privileges after construction
//    */
//   readonly privileges?: TablePrivilege[];
// }
//
// /**
//  * Privileges granted to a Redshift user on Redshift tables.
//  *
//  * This construct is located in the `private` directory to ensure that it is not exported for direct public use. This
//  * means that user privileges must be managed through the `Table.grant` method or the `User.addTablePrivileges`
//  * method. Thus, each `User` will have at most one `UserTablePrivileges` construct to manage its privileges. For details
//  * on why this is a Good Thing, see the README, under "Granting Privileges".
//  */
// @noBoxStackTraces
// export class UserTablePrivileges extends Construct {
//   private privileges: IArrayBox<TablePrivilege>;
//
//   constructor(scope: Construct, id: string, props: UserTablePrivilegesProps) {
//     super(scope, id);
//
//     this.privileges = Box.fromArray(props.privileges ?? [], { omitEmpty: false });
//
//     new DatabaseQuery<UserTablePrivilegesHandlerProps>(this, 'Resource', {
//       ...props,
//       handler: HandlerName.UserTablePrivileges,
//       properties: {
//         username: props.user.username,
//         tablePrivileges: this.privileges.derive(privs =>
//           Object.entries(groupPrivilegesByTable(privs))
//             .map(([tableId, tablePrivileges]) => ({
//               tableId,
//               // The first element always exists since the groupBy element is at least a singleton.
//               tableName: tablePrivileges[0]!.table.tableName,
//               actions: unifyTableActions(tablePrivileges).map(action => TableAction[action]),
//             })),
//         ) as any,
//       },
//     });
//   }
//
//   /**
//    * Grant this user additional privileges.
//    */
//   addPrivileges(table: ITable, ...actions: TableAction[]): void {
//     this.privileges.push({ table, actions });
//   }
// }
//
// const unifyTableActions = (tablePrivileges: TablePrivilege[]): TableAction[] => {
//   const set = new Set<TableAction>(tablePrivileges.flatMap(x => x.actions));
//
//   if (set.has(TableAction.ALL)) {
//     return [TableAction.ALL];
//   }
//
//   if (set.has(TableAction.UPDATE) || set.has(TableAction.DELETE)) {
//     set.add(TableAction.SELECT);
//   }
//
//   return [...set];
// };
//
// const groupPrivilegesByTable = (privileges: readonly TablePrivilege[]): Record<string, TablePrivilege[]> => {
//   return privileges.reduce((grouped, privilege) => {
//     const { table } = privilege;
//     const tableId = table.node.id;
//     const tablePrivileges = grouped[tableId] ?? [];
//     return {
//       ...grouped,
//       [tableId]: [...tablePrivileges, privilege],
//     };
//   }, {} as Record<string, TablePrivilege[]>);
// };
//
// -- END fully commented-out upstream port of lib/private/privileges.ts --
