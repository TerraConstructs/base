// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query-provider/index.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/database-query-provider/index.ts --
//
//
// import type * as AWSLambda from 'aws-lambda';
// import { HandlerName } from './handler-name';
// import { handler as managePrivileges } from './privileges';
// import { handler as manageTable } from './table';
// import { handler as manageUser } from './user';
//
// const HANDLERS: { [key in HandlerName]: ((props: any, event: AWSLambda.CloudFormationCustomResourceEvent) => Promise<any>) } = {
//   [HandlerName.Table]: manageTable,
//   [HandlerName.User]: manageUser,
//   [HandlerName.UserTablePrivileges]: managePrivileges,
// };
//
// export async function handler(event: AWSLambda.CloudFormationCustomResourceEvent) {
//   const subHandler = HANDLERS[event.ResourceProperties.handler as HandlerName];
//   if (!subHandler) {
//     throw new Error(`Requested handler ${event.ResourceProperties.handler} is not in supported set: ${JSON.stringify(Object.keys(HANDLERS))}`);
//   }
//   return subHandler(event.ResourceProperties, event);
// }
//
// -- END fully commented-out upstream port of lib/private/database-query-provider/index.ts --
