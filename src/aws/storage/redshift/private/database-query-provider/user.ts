// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query-provider/user.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/database-query-provider/user.ts --
//
// /* eslint-disable import/no-extraneous-dependencies */
//
// import { SecretsManager } from '@aws-sdk/client-secrets-manager';
// import type * as AWSLambda from 'aws-lambda';
//
// import { quoteIdentifier, quoteLiteral } from './escape';
// import { executeStatement } from './redshift-data';
// import type { ClusterProps } from './types';
// import { makePhysicalId } from './util';
// import type { UserHandlerProps } from '../handler-props';
//
// const secretsManager = new SecretsManager({});
//
// export async function handler(props: UserHandlerProps & ClusterProps, event: AWSLambda.CloudFormationCustomResourceEvent) {
//   const username = props.username;
//   const passwordSecretArn = props.passwordSecretArn;
//   const clusterProps = props;
//
//   if (event.RequestType === 'Create') {
//     await createUser(username, passwordSecretArn, clusterProps);
//     return { PhysicalResourceId: makePhysicalId(username, clusterProps, event.RequestId), Data: { username: username } };
//   } else if (event.RequestType === 'Delete') {
//     await dropUser(username, clusterProps);
//     return;
//   } else if (event.RequestType === 'Update') {
//     const { replace } = await updateUser(
//       username,
//       passwordSecretArn,
//       clusterProps,
//       event.OldResourceProperties as unknown as UserHandlerProps & ClusterProps);
//     const physicalId = replace ? makePhysicalId(username, clusterProps, event.RequestId) : event.PhysicalResourceId;
//     return { PhysicalResourceId: physicalId, Data: { username: username } };
//   } else {
//     /* eslint-disable-next-line dot-notation */
//     throw new Error(`Unrecognized event type: ${event['RequestType']}`);
//   }
// }
//
// async function dropUser(username: string, clusterProps: ClusterProps) {
//   await executeStatement(`DROP USER ${quoteIdentifier(username)}`, clusterProps);
// }
//
// async function createUser(username: string, passwordSecretArn: string, clusterProps: ClusterProps) {
//   const password = await getPasswordFromSecret(passwordSecretArn);
//
//   await executeStatement(`CREATE USER ${quoteIdentifier(username)} PASSWORD ${quoteLiteral(password)}`, clusterProps);
// }
//
// async function updateUser(
//   username: string,
//   passwordSecretArn: string,
//   clusterProps: ClusterProps,
//   oldResourceProperties: UserHandlerProps & ClusterProps,
// ): Promise<{ replace: boolean }> {
//   const oldClusterProps = oldResourceProperties;
//   if (clusterProps.clusterName !== oldClusterProps.clusterName || clusterProps.databaseName !== oldClusterProps.databaseName) {
//     await createUser(username, passwordSecretArn, clusterProps);
//     return { replace: true };
//   }
//
//   const oldUsername = oldResourceProperties.username;
//   const oldPasswordSecretArn = oldResourceProperties.passwordSecretArn;
//   const oldPassword = await getPasswordFromSecret(oldPasswordSecretArn);
//   const password = await getPasswordFromSecret(passwordSecretArn);
//
//   if (username !== oldUsername) {
//     await createUser(username, passwordSecretArn, clusterProps);
//     return { replace: true };
//   }
//
//   if (password !== oldPassword) {
//     await executeStatement(`ALTER USER ${quoteIdentifier(username)} PASSWORD ${quoteLiteral(password)}`, clusterProps);
//     return { replace: false };
//   }
//
//   return { replace: false };
// }
//
// async function getPasswordFromSecret(passwordSecretArn: string): Promise<string> {
//   const secretValue = await secretsManager.getSecretValue({
//     SecretId: passwordSecretArn,
//   });
//   const secretString = secretValue.SecretString;
//   if (!secretString) {
//     throw new Error(`Secret string for ${passwordSecretArn} was empty`);
//   }
//   const { password } = JSON.parse(secretString);
//
//   return password;
// }
//
// -- END fully commented-out upstream port of lib/private/database-query-provider/user.ts --
