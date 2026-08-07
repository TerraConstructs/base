// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/handler-props.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/handler-props.ts --
//
// import type { Column, TableDistStyle, TableSortStyle } from '../table';
//
// export interface DatabaseQueryHandlerProps {
//   readonly handler: string;
//   readonly clusterName: string;
//   readonly adminUserArn: string;
//   readonly databaseName: string;
// }
//
// export interface UserHandlerProps {
//   readonly username: string;
//   readonly passwordSecretArn: string;
// }
//
// export interface TableHandlerProps {
//   readonly tableName: {
//     readonly prefix: string;
//     readonly generateSuffix: string;
//   };
//   readonly tableColumns: Column[];
//   readonly distStyle?: TableDistStyle;
//   readonly sortStyle: TableSortStyle;
//   readonly tableComment?: string;
//   readonly useColumnIds: boolean;
// }
//
// export interface TablePrivilege {
//   readonly tableId: string;
//   readonly tableName: string;
//   readonly actions: string[];
// }
//
// export interface UserTablePrivilegesHandlerProps {
//   readonly username: string;
//   readonly tablePrivileges: TablePrivilege[];
// }
//
// -- END fully commented-out upstream port of lib/private/handler-props.ts --
