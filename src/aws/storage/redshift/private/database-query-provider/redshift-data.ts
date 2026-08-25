// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query-provider/redshift-data.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/database-query-provider/redshift-data.ts --
//
// /* eslint-disable-next-line import/no-extraneous-dependencies */
// import { RedshiftData } from '@aws-sdk/client-redshift-data';
// import type { ClusterProps } from './types';
//
// const redshiftData = new RedshiftData({});
//
// export async function executeStatement(statement: string, clusterProps: ClusterProps): Promise<void> {
//   const executeStatementProps = {
//     ClusterIdentifier: clusterProps.clusterName,
//     Database: clusterProps.databaseName,
//     SecretArn: clusterProps.adminUserArn,
//     Sql: statement,
//   };
//   const executedStatement = await redshiftData.executeStatement(executeStatementProps);
//   if (!executedStatement.Id) {
//     throw new Error('Service error: Statement execution did not return a statement ID');
//   }
//   await waitForStatementComplete(executedStatement.Id);
// }
//
// const waitTimeout = 100;
// async function waitForStatementComplete(statementId: string): Promise<void> {
//   await new Promise((resolve: (value: void) => void) => {
//     setTimeout(() => resolve(), waitTimeout);
//   });
//   const statement = await redshiftData.describeStatement({ Id: statementId });
//   if (statement.Status !== 'FINISHED' && statement.Status !== 'FAILED' && statement.Status !== 'ABORTED') {
//     return waitForStatementComplete(statementId);
//   } else if (statement.Status === 'FINISHED') {
//     return;
//   } else {
//     throw new Error(`Statement status was ${statement.Status}: ${statement.Error}`);
//   }
// }
//
// -- END fully commented-out upstream port of lib/private/database-query-provider/redshift-data.ts --
