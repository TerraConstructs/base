// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/privileges.test.ts
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
test.skip("scope-reduction: test/privileges.test.ts ported commented-out, see TODO above", () => {});

// -- BEGIN fully commented-out upstream port of test/privileges.test.ts --
//
// import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
// import * as ec2 from 'aws-cdk-lib/aws-ec2';
// import * as redshift from '../lib';
//
// describe('table privileges', () => {
//   let stack: cdk.Stack;
//   let vpc: ec2.Vpc;
//   let cluster: redshift.ICluster;
//   const databaseName = 'databaseName';
//   let databaseOptions: redshift.DatabaseOptions;
//   const tableColumns = [{ name: 'col1', dataType: 'varchar(4)' }, { name: 'col2', dataType: 'float' }];
//   let table: redshift.ITable;
//   let table2: redshift.ITable;
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
//       cluster,
//       databaseName,
//     };
//     table = redshift.Table.fromTableAttributes(stack, 'Table', {
//       tableName: 'tableName',
//       tableColumns,
//       cluster,
//       databaseName,
//     });
//     table2 = redshift.Table.fromTableAttributes(stack, 'Table 2', {
//       tableName: 'tableName2',
//       tableColumns,
//       cluster,
//       databaseName,
//     });
//   });
//
//   it('adding table privilege creates custom resource', () => {
//     const user = new redshift.User(stack, 'User', databaseOptions);
//
//     user.addTablePrivileges(table, redshift.TableAction.INSERT);
//     user.addTablePrivileges(table2, redshift.TableAction.SELECT, redshift.TableAction.DROP);
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       username: {
//         'Fn::GetAtt': [
//           'UserFDDCDD17',
//           'username',
//         ],
//       },
//       tablePrivileges: [{ tableName: 'tableName', actions: ['INSERT'] }, { tableName: 'tableName2', actions: ['SELECT', 'DROP'] }],
//     });
//   });
//
//   it('table privileges are deduplicated', () => {
//     const user = new redshift.User(stack, 'User', databaseOptions);
//
//     user.addTablePrivileges(table, redshift.TableAction.INSERT, redshift.TableAction.INSERT, redshift.TableAction.DELETE);
//     user.addTablePrivileges(table, redshift.TableAction.SELECT, redshift.TableAction.DELETE);
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       username: {
//         'Fn::GetAtt': [
//           'UserFDDCDD17',
//           'username',
//         ],
//       },
//       tablePrivileges: [{ tableName: 'tableName', actions: ['INSERT', 'DELETE', 'SELECT'] }],
//     });
//   });
//
//   it('table privileges are removed when ALL specified', () => {
//     const user = new redshift.User(stack, 'User', databaseOptions);
//
//     user.addTablePrivileges(table, redshift.TableAction.ALL, redshift.TableAction.INSERT);
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       username: {
//         'Fn::GetAtt': [
//           'UserFDDCDD17',
//           'username',
//         ],
//       },
//       tablePrivileges: [{ tableName: 'tableName', actions: ['ALL'] }],
//     });
//   });
//
//   it('SELECT table privilege is added when UPDATE or DELETE is specified', () => {
//     const user = new redshift.User(stack, 'User', databaseOptions);
//
//     user.addTablePrivileges(table, redshift.TableAction.UPDATE);
//     user.addTablePrivileges(table2, redshift.TableAction.DELETE);
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       username: {
//         'Fn::GetAtt': [
//           'UserFDDCDD17',
//           'username',
//         ],
//       },
//       tablePrivileges: [{ tableName: 'tableName', actions: ['UPDATE', 'SELECT'] }, { tableName: 'tableName2', actions: ['DELETE', 'SELECT'] }],
//     });
//   });
// });
//
// -- END fully commented-out upstream port of test/privileges.test.ts --
