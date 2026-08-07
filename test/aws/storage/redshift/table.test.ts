// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/table.test.ts
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
test.skip("scope-reduction: test/table.test.ts ported commented-out, see TODO above", () => {});

// -- BEGIN fully commented-out upstream port of test/table.test.ts --
//
// import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
// import * as ec2 from 'aws-cdk-lib/aws-ec2';
//
// import { REDSHIFT_COLUMN_ID } from 'aws-cdk-lib/cx-api';
// import * as redshift from '../lib';
//
// describe('cluster table', () => {
//   const tableName = 'tableName';
//   const tableColumns: redshift.Column[] = [
//     { name: 'col1', dataType: 'varchar(4)' },
//     { name: 'col2', dataType: 'float' },
//   ];
//
//   let stack: cdk.Stack;
//   let vpc: ec2.Vpc;
//   let cluster: redshift.ICluster;
//   let databaseOptions: redshift.DatabaseOptions;
//
//   beforeEach(() => {
//     stack = new cdk.Stack();
//     vpc = new ec2.Vpc(stack, 'VPC');
//     cluster = new redshift.Cluster(stack, 'Cluster', {
//       vpc: vpc,
//       vpcSubnets: {
//         subnetType: ec2.SubnetType.PUBLIC,
//       },
//       masterUser: {
//         masterUsername: 'admin',
//       },
//       publiclyAccessible: true,
//     });
//     databaseOptions = {
//       cluster: cluster,
//       databaseName: 'databaseName',
//     };
//   });
//
//   it('creates using custom resource', () => {
//     new redshift.Table(stack, 'Table', {
//       ...databaseOptions,
//       tableColumns,
//     });
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       tableName: {
//         prefix: 'Table',
//         generateSuffix: 'true',
//       },
//       tableColumns,
//     });
//   });
//
//   it('tableName property is pulled from custom resource', () => {
//     const table = new redshift.Table(stack, 'Table', {
//       ...databaseOptions,
//       tableColumns,
//     });
//
//     expect(stack.resolve(table.tableName)).toStrictEqual({
//       Ref: 'Table7ABB320E',
//     });
//   });
//
//   it('uses table name when provided', () => {
//     new redshift.Table(stack, 'Table', {
//       ...databaseOptions,
//       tableName,
//       tableColumns,
//     });
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       tableName: {
//         prefix: tableName,
//         generateSuffix: 'false',
//       },
//     });
//   });
//
//   it('can import from name and columns', () => {
//     const table = redshift.Table.fromTableAttributes(stack, 'Table', {
//       tableName,
//       tableColumns,
//       cluster,
//       databaseName: 'databaseName',
//     });
//
//     expect(table.tableName).toBe(tableName);
//     expect(table.tableColumns).toStrictEqual(tableColumns);
//     expect(table.cluster).toBe(cluster);
//     expect(table.databaseName).toBe('databaseName');
//   });
//
//   it('grant adds privileges to user', () => {
//     const user = redshift.User.fromUserAttributes(stack, 'User', {
//       ...databaseOptions,
//       username: 'username',
//       password: cdk.SecretValue.unsafePlainText('INSECURE_NOT_FOR_PRODUCTION'),
//     });
//     const table = redshift.Table.fromTableAttributes(stack, 'Table', {
//       tableName,
//       tableColumns,
//       cluster,
//       databaseName: 'databaseName',
//     });
//
//     table.grant(user, redshift.TableAction.INSERT);
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       handler: 'user-table-privileges',
//     });
//   });
//
//   it('retains table on deletion by default', () => {
//     new redshift.Table(stack, 'Table', {
//       ...databaseOptions,
//       tableColumns,
//     });
//
//     Template.fromStack(stack).hasResource('Custom::RedshiftDatabaseQuery', {
//       Properties: {
//         handler: 'table',
//       },
//       DeletionPolicy: 'Retain',
//     });
//   });
//
//   it('destroys table on deletion if requested', () => {
//     const table = new redshift.Table(stack, 'Table', {
//       ...databaseOptions,
//       tableColumns,
//     });
//
//     table.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
//
//     Template.fromStack(stack).hasResource('Custom::RedshiftDatabaseQuery', {
//       Properties: {
//         handler: 'table',
//       },
//       DeletionPolicy: 'Delete',
//     });
//   });
//
//   describe('columnId', () => {
//     it('throws if column ids are not unique', async () => {
//       const updatedTableColumns: redshift.Column[] = [
//         { id: 'col1', name: 'col1', dataType: 'varchar(4)' },
//         { id: 'col1', name: 'col2', dataType: 'float' },
//       ];
//
//       expect(() => new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns: updatedTableColumns,
//       }),
//       ).toThrow("Column id 'col1' is not unique.");
//     });
//
//     it('populates column id if no id provided', () => {
//       const updatedTableColumns: redshift.Column[] = [
//         { id: 'col1', name: 'col1', dataType: 'varchar(4)' },
//         { name: 'col2', dataType: 'float' },
//       ];
//
//       new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns: updatedTableColumns,
//       });
//
//       Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         tableColumns: [
//           { id: 'col1', name: 'col1', dataType: 'varchar(4)' },
//           { id: 'col2', name: 'col2', dataType: 'float' },
//         ],
//       });
//     });
//   });
//
//   describe('@aws-cdk/aws-redshift:columnId', () => {
//     it('uses column ids if feature flag provided', () => {
//       const app = new cdk.App({ context: { [REDSHIFT_COLUMN_ID]: true } });
//       const newStack = new cdk.Stack(app, 'NewStack');
//       vpc = new ec2.Vpc(newStack, 'VPC');
//       cluster = new redshift.Cluster(newStack, 'Cluster', {
//         vpc: vpc,
//         vpcSubnets: {
//           subnetType: ec2.SubnetType.PUBLIC,
//         },
//         masterUser: {
//           masterUsername: 'admin',
//         },
//         publiclyAccessible: true,
//       });
//       databaseOptions = {
//         cluster: cluster,
//         databaseName: 'databaseName',
//       };
//
//       new redshift.Table(newStack, 'Table', {
//         ...databaseOptions,
//         tableColumns,
//       });
//
//       Template.fromStack(newStack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         useColumnIds: true,
//       });
//     });
//
//     it('does not use column ids if feature flag not provided', () => {
//       new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns,
//       });
//
//       Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         useColumnIds: false,
//       });
//     });
//   });
//
//   describe('distKey and distStyle', () => {
//     it('throws if more than one distKeys are configured', () => {
//       const updatedTableColumns: redshift.Column[] = [
//         ...tableColumns,
//         { name: 'col3', dataType: 'varchar(4)', distKey: true },
//         { name: 'col4', dataType: 'float', distKey: true },
//       ];
//
//       expect(
//         () => new redshift.Table(stack, 'Table', {
//           ...databaseOptions,
//           tableColumns: updatedTableColumns,
//         }),
//       ).toThrow(/Only one column can be configured as distKey./);
//     });
//
//     it('throws if distStyle other than KEY is configured with configured distKey column', () => {
//       const updatedTableColumns: redshift.Column[] = [
//         ...tableColumns,
//         { name: 'col3', dataType: 'varchar(4)', distKey: true },
//       ];
//
//       expect(
//         () => new redshift.Table(stack, 'Table', {
//           ...databaseOptions,
//           tableColumns: updatedTableColumns,
//           distStyle: redshift.TableDistStyle.EVEN,
//         }),
//       ).toThrow(`Only 'TableDistStyle.KEY' can be configured when distKey is also configured. Found ${redshift.TableDistStyle.EVEN}`);
//     });
//
//     it('throws if KEY distStyle is configired with no distKey column', () => {
//       expect(
//         () => new redshift.Table(stack, 'Table', {
//           ...databaseOptions,
//           tableColumns,
//           distStyle: redshift.TableDistStyle.KEY,
//         }),
//       ).toThrow('distStyle of "TableDistStyle.KEY" can only be configured when distKey is also configured.');
//     });
//   });
//
//   describe('sortKeys and sortStyle', () => {
//     it('configures default sortStyle based on sortKeys if no sortStyle is passed: AUTO', () => {
//       // GIVEN
//       const tableColumnsWithoutSortKey = tableColumns;
//
//       // WHEN
//       new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns: tableColumnsWithoutSortKey,
//       });
//
//       // THEN
//       Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         sortStyle: redshift.TableSortStyle.AUTO,
//       });
//     });
//
//     it('configures default sortStyle based on sortKeys if no sortStyle is passed: COMPOUND', () => {
//       // GIVEN
//       const tableColumnsWithSortKey: redshift.Column[] = [
//         ...tableColumns,
//         { name: 'col3', dataType: 'varchar(4)', sortKey: true },
//       ];
//
//       // WHEN
//       new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns: tableColumnsWithSortKey,
//       });
//
//       // THEN
//       Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         sortStyle: redshift.TableSortStyle.COMPOUND,
//       });
//     });
//
//     it('throws if sortStlye other than AUTO is passed with no configured sortKeys', () => {
//       expect(
//         () => new redshift.Table(stack, 'Table', {
//           ...databaseOptions,
//           tableColumns,
//           sortStyle: redshift.TableSortStyle.COMPOUND,
//         }),
//       ).toThrow(`sortStyle of '${redshift.TableSortStyle.COMPOUND}' can only be configured when sortKey is also configured.`);
//     });
//
//     it('throws if sortStlye of AUTO is passed with some configured sortKeys', () => {
//       // GIVEN
//       const tableColumnsWithSortKey: redshift.Column[] = [
//         ...tableColumns,
//         { name: 'col3', dataType: 'varchar(4)', sortKey: true },
//       ];
//
//       // THEN
//       expect(
//         () => new redshift.Table(stack, 'Table', {
//           ...databaseOptions,
//           tableColumns: tableColumnsWithSortKey,
//           sortStyle: redshift.TableSortStyle.AUTO,
//         }),
//       ).toThrow(`sortStyle of '${redshift.TableSortStyle.AUTO}' cannot be configured when sortKey is also configured.`);
//     });
//   });
//
//   describe('timeout', () => {
//     test('specify timeout', () => {
//       new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns,
//         timeout: cdk.Duration.minutes(5),
//       });
//
//       Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
//         Timeout: 300,
//         Role: { 'Fn::GetAtt': ['QueryRedshiftDatabase3de5bea727da479686625efb56431b5fServiceRole0A90D717', 'Arn'] },
//         Handler: 'index.handler',
//         Code: {
//           S3Bucket: { 'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}' },
//         },
//       });
//     });
//
//     test('throw error for timeout being too short', () => {
//       expect(() => new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns,
//         timeout: cdk.Duration.millis(999),
//       })).toThrow('The timeout for the handler must be BETWEEN 1 second and 15 minutes, got 999 milliseconds.');
//     });
//
//     test('throw error for timeout being too long', () => {
//       expect(() => new redshift.Table(stack, 'Table', {
//         ...databaseOptions,
//         tableColumns,
//         timeout: cdk.Duration.minutes(16),
//       })).toThrow('The timeout for the handler must be between 1 second and 15 minutes, got 960 seconds.');
//     });
//   });
// });
//
// -- END fully commented-out upstream port of test/table.test.ts --
