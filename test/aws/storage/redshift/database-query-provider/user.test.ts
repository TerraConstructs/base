// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/user.test.ts
//
// TODO(scope-reduction): omitted in this port. Upstream's Table/User test surface (this file
// and its siblings test/table.test.ts, test/user.test.ts, test/privileges.test.ts,
// test/database-query.test.ts, and test/database-query-provider/**) exercises the Table/User L2s
// and their Lambda custom-resource handler (`Custom::RedshiftDatabaseQuery`), which are
// themselves ported as fully commented-out files -- see the leading TODO block in
// `../table.ts` / `../user.ts` / `../private/database-query.ts` for the full rationale
// (TerraConstructs has no framework equivalent to CDK's `Provider`/`CustomResource` L2s in this
// repo yet). Per the "comment out, never delete" scope-reduction directive for this PR, this
// test file is ported here verbatim but fully commented out rather than dropped, so
// re-enablement is a de-commenting exercise (in lockstep with `../table.ts` / `../user.ts` /
// `../private/**`) once a custom-resource Lambda framework lands in this repo.
//
// Permalinks (v2.263.0):
//   test/table.test.ts                            https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/table.test.ts
//   test/user.test.ts                             https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/user.test.ts
//   test/privileges.test.ts                       https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/privileges.test.ts
//   test/database-query.test.ts                   https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query.test.ts
//   test/database-query-provider/escape.test.ts   https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/escape.test.ts
//   test/database-query-provider/index.test.ts    https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/index.test.ts
//   test/database-query-provider/privileges.test.ts https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/privileges.test.ts
//   test/database-query-provider/table.test.ts    https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/table.test.ts
//   test/database-query-provider/user.test.ts     https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/user.test.ts

// Placeholder so this suite satisfies Jest's "must contain at least one test" requirement while
// every upstream test below stays fully commented out (never deleted, per the scope-reduction
// directive). Remove this stub in the same de-commenting pass that re-enables the tests below.
test.skip("scope-reduction: test/database-query-provider/user.test.ts ported commented-out, see TODO above", () => {});

// -- BEGIN fully commented-out upstream port of test/database-query-provider/user.test.ts --
//
//
// import type * as AWSLambda from 'aws-lambda';
//
// const password = 'password';
// const username = 'username';
// const passwordSecretArn = 'passwordSecretArn';
// const clusterName = 'clusterName';
// const adminUserArn = 'adminUserArn';
// const databaseName = 'databaseName';
// const physicalResourceId = 'PhysicalResourceId';
// const resourceProperties = {
//   username,
//   passwordSecretArn,
//   clusterName,
//   adminUserArn,
//   databaseName,
//   ServiceToken: '',
// };
// const requestId = 'requestId';
// const genericEvent: AWSLambda.CloudFormationCustomResourceEventCommon = {
//   ResourceProperties: resourceProperties,
//   ServiceToken: '',
//   ResponseURL: '',
//   StackId: '',
//   RequestId: requestId,
//   LogicalResourceId: '',
//   ResourceType: '',
// };
//
// const mockExecuteStatement = jest.fn(async () => ({ Id: 'statementId' }));
// jest.mock('@aws-sdk/client-redshift-data', () => {
//   return {
//     RedshiftData: class {
//       executeStatement = mockExecuteStatement;
//       describeStatement = jest.fn(async () => ({ Status: 'FINISHED' }));
//     },
//   };
// });
//
// const mockGetSecretValue = jest.fn(async () => ({
//   SecretString: JSON.stringify({ password }),
// }));
// jest.mock('@aws-sdk/client-secrets-manager', () => ({
//   SecretsManager: class {
//     getSecretValue = mockGetSecretValue;
//   },
// }));
//
// import { handler as manageUser } from '../../lib/private/database-query-provider/user';
//
// beforeEach(() => {
//   jest.clearAllMocks();
// });
//
// describe('create', () => {
//   const baseEvent: AWSLambda.CloudFormationCustomResourceCreateEvent = {
//     RequestType: 'Create',
//     ...genericEvent,
//   };
//
//   test('serializes properties in statement and creates physical resource ID', async () => {
//     const event = baseEvent;
//
//     await expect(manageUser(resourceProperties, event)).resolves.toEqual({
//       PhysicalResourceId: 'clusterName:databaseName:username:requestId',
//       Data: {
//         username: username,
//       },
//     });
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: `CREATE USER username PASSWORD '${password}'`,
//     }));
//   });
// });
//
// describe('delete', () => {
//   const baseEvent: AWSLambda.CloudFormationCustomResourceDeleteEvent = {
//     RequestType: 'Delete',
//     PhysicalResourceId: physicalResourceId,
//     ...genericEvent,
//   };
//
//   test('executes statement', async () => {
//     const event = baseEvent;
//
//     await manageUser(resourceProperties, event);
//
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: 'DROP USER username',
//     }));
//   });
// });
//
// describe('update', () => {
//   const event: AWSLambda.CloudFormationCustomResourceUpdateEvent = {
//     RequestType: 'Update',
//     OldResourceProperties: resourceProperties,
//     PhysicalResourceId: physicalResourceId,
//     ...genericEvent,
//   };
//
//   test('replaces if cluster name changes', async () => {
//     const newClusterName = 'newClusterName';
//     const newResourceProperties = {
//       ...resourceProperties,
//       clusterName: newClusterName,
//     };
//
//     await expect(manageUser(newResourceProperties, event)).resolves.not.toMatchObject({
//       PhysicalResourceId: physicalResourceId,
//     });
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       ClusterIdentifier: newClusterName,
//       Sql: expect.stringMatching(/CREATE USER/),
//     }));
//   });
//
//   test('does not replace if admin user ARN changes', async () => {
//     const newAdminUserArn = 'newAdminUserArn';
//     const newResourceProperties = {
//       ...resourceProperties,
//       adminUserArn: newAdminUserArn,
//     };
//
//     await expect(manageUser(newResourceProperties, event)).resolves.toMatchObject({
//       PhysicalResourceId: physicalResourceId,
//     });
//     expect(mockExecuteStatement).not.toHaveBeenCalled();
//   });
//
//   test('replaces if database name changes', async () => {
//     const newDatabaseName = 'newDatabaseName';
//     const newResourceProperties = {
//       ...resourceProperties,
//       databaseName: newDatabaseName,
//     };
//
//     await expect(manageUser(newResourceProperties, event)).resolves.not.toMatchObject({
//       PhysicalResourceId: physicalResourceId,
//     });
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Database: newDatabaseName,
//       Sql: expect.stringMatching(/CREATE USER/),
//     }));
//   });
//
//   test('replaces if user name changes', async () => {
//     const newUsername = 'newUsername';
//     const newResourceProperties = {
//       ...resourceProperties,
//       username: newUsername,
//     };
//
//     await expect(manageUser(newResourceProperties, event)).resolves.not.toMatchObject({
//       PhysicalResourceId: physicalResourceId,
//     });
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: expect.stringMatching(new RegExp(`CREATE USER ${newUsername}`)),
//     }));
//   });
//
//   test('does not replace if password changes', async () => {
//     const newPassword = 'newPassword';
//     mockGetSecretValue.mockImplementationOnce(async () => ({ SecretString: JSON.stringify({ password: newPassword }) }));
//
//     await expect(manageUser(resourceProperties, event)).resolves.toMatchObject({
//       PhysicalResourceId: physicalResourceId,
//     });
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: expect.stringMatching(new RegExp(`ALTER USER ${username} PASSWORD '${password}'`)),
//     }));
//   });
// });
//
// describe('special-character handling', () => {
//   test('quotes the user name and doubles embedded double quotes in CREATE USER', async () => {
//     const specialUsername = 'ab"c';
//     const event: AWSLambda.CloudFormationCustomResourceCreateEvent = {
//       RequestType: 'Create',
//       ...genericEvent,
//     };
//     mockGetSecretValue.mockImplementationOnce(async () => ({ SecretString: JSON.stringify({ password: 'pw' }) }));
//
//     await manageUser({ ...resourceProperties, username: specialUsername }, event);
//
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: 'CREATE USER "ab""c" PASSWORD \'pw\'',
//     }));
//   });
//
//   test('escapes single quotes in the password literal of CREATE USER', async () => {
//     const event: AWSLambda.CloudFormationCustomResourceCreateEvent = {
//       RequestType: 'Create',
//       ...genericEvent,
//     };
//     mockGetSecretValue.mockImplementationOnce(async () => ({ SecretString: JSON.stringify({ password: "pa'ss" }) }));
//
//     await manageUser({ ...resourceProperties, username: 'u' }, event);
//
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: 'CREATE USER u PASSWORD \'pa\'\'ss\'',
//     }));
//   });
//
//   test('quotes the user name in DROP USER', async () => {
//     const specialUsername = 'u; x';
//     const event: AWSLambda.CloudFormationCustomResourceDeleteEvent = {
//       RequestType: 'Delete',
//       PhysicalResourceId: physicalResourceId,
//       ...genericEvent,
//     };
//
//     await manageUser({ ...resourceProperties, username: specialUsername }, event);
//
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: 'DROP USER "u; x"',
//     }));
//   });
//
//   test('escapes single quotes in the password literal of ALTER USER', async () => {
//     const newPassword = "p'q";
//     const event: AWSLambda.CloudFormationCustomResourceUpdateEvent = {
//       RequestType: 'Update',
//       OldResourceProperties: { ...resourceProperties, username: 'u' },
//       PhysicalResourceId: physicalResourceId,
//       ...genericEvent,
//     };
//     // First lookup resolves the old password, second resolves the new password.
//     mockGetSecretValue.mockImplementationOnce(async () => ({ SecretString: JSON.stringify({ password: 'old' }) }));
//     mockGetSecretValue.mockImplementationOnce(async () => ({ SecretString: JSON.stringify({ password: newPassword }) }));
//
//     await manageUser({ ...resourceProperties, username: 'u' }, event);
//
//     expect(mockExecuteStatement).toHaveBeenCalledWith(expect.objectContaining({
//       Sql: 'ALTER USER u PASSWORD \'p\'\'q\'',
//     }));
//   });
// });
//
// -- END fully commented-out upstream port of test/database-query-provider/user.test.ts --
