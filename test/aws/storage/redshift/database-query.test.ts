// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query.test.ts
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
test.skip("scope-reduction: test/database-query.test.ts ported commented-out, see TODO above", () => {});

// -- BEGIN fully commented-out upstream port of test/database-query.test.ts --
//
// import * as cdk from 'aws-cdk-lib';
// import { Match, Template } from 'aws-cdk-lib/assertions';
// import * as ec2 from 'aws-cdk-lib/aws-ec2';
// import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// import * as redshift from '../lib';
// import type { DatabaseQueryProps } from '../lib/private/database-query';
// import { DatabaseQuery } from '../lib/private/database-query';
//
// describe('database query', () => {
//   let stack: cdk.Stack;
//   let vpc: ec2.Vpc;
//   let cluster: redshift.ICluster;
//   let minimalProps: DatabaseQueryProps<any>;
//
//   beforeEach(() => {
//     stack = new cdk.Stack();
//     vpc = new ec2.Vpc(stack, 'VPC');
//     cluster = new redshift.Cluster(stack, 'Cluster', {
//       vpc: vpc,
//       masterUser: {
//         masterUsername: 'admin',
//       },
//     });
//     minimalProps = {
//       cluster: cluster,
//       databaseName: 'databaseName',
//       handler: 'handler',
//       properties: {},
//     };
//   });
//
//   describe('admin user', () => {
//     it('takes from cluster by default', () => {
//       new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//       });
//
//       Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         adminUserArn: { Ref: 'ClusterSecretAttachment769E6258' },
//       });
//     });
//
//     it('grants read permission to handler', () => {
//       new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//       });
//
//       Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
//         PolicyDocument: {
//           Statement: Match.arrayWith([{
//             Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
//             Effect: 'Allow',
//             Resource: { Ref: 'ClusterSecretAttachment769E6258' },
//           }]),
//         },
//         Roles: [{ Ref: 'QueryRedshiftDatabase3de5bea727da479686625efb56431b5fServiceRole0A90D717' }],
//       });
//     });
//
//     it('uses admin user if provided', () => {
//       cluster = new redshift.Cluster(stack, 'Cluster With Provided Admin Secret', {
//         vpc,
//         vpcSubnets: {
//           subnetType: ec2.SubnetType.PUBLIC,
//         },
//         masterUser: {
//           masterUsername: 'admin',
//           masterPassword: cdk.SecretValue.unsafePlainText('INSECURE_NOT_FOR_PRODUCTION'),
//         },
//         publiclyAccessible: true,
//       });
//
//       new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//         adminUser: secretsmanager.Secret.fromSecretNameV2(stack, 'Imported Admin User', 'imported-admin-secret'),
//         cluster,
//       });
//
//       Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//         adminUserArn: {
//           'Fn::Join': [
//             '',
//             [
//               'arn:',
//               {
//                 Ref: 'AWS::Partition',
//               },
//               ':secretsmanager:',
//               {
//                 Ref: 'AWS::Region',
//               },
//               ':',
//               {
//                 Ref: 'AWS::AccountId',
//               },
//               ':secret:imported-admin-secret',
//             ],
//           ],
//         },
//       });
//     });
//
//     it('throws error if admin user not provided and cluster was provided a admin password', () => {
//       cluster = new redshift.Cluster(stack, 'Cluster With Provided Admin Secret', {
//         vpc,
//         vpcSubnets: {
//           subnetType: ec2.SubnetType.PUBLIC,
//         },
//         masterUser: {
//           masterUsername: 'admin',
//           masterPassword: cdk.SecretValue.unsafePlainText('INSECURE_NOT_FOR_PRODUCTION'),
//         },
//         publiclyAccessible: true,
//       });
//
//       expect(() => new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//         cluster,
//       })).toThrow('Administrative access to the Redshift cluster is required but an admin user secret was not provided and the cluster did not generate admin user credentials (they were provided explicitly)');
//     });
//
//     it('throws error if admin user not provided and cluster was imported', () => {
//       cluster = redshift.Cluster.fromClusterAttributes(stack, 'Imported Cluster', {
//         clusterName: 'imported-cluster',
//         clusterEndpointAddress: 'imported-cluster.abcdefghijk.xx-west-1.redshift.amazonaws.com',
//         clusterEndpointPort: 5439,
//       });
//
//       expect(() => new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//         cluster,
//       })).toThrow('Administrative access to the Redshift cluster is required but an admin user secret was not provided and the cluster was imported');
//     });
//   });
//
//   it('provides database params to Lambda handler', () => {
//     new DatabaseQuery(stack, 'Query', {
//       ...minimalProps,
//     });
//
//     Template.fromStack(stack).hasResourceProperties('Custom::RedshiftDatabaseQuery', {
//       clusterName: {
//         Ref: 'ClusterEB0386A7',
//       },
//       adminUserArn: {
//         Ref: 'ClusterSecretAttachment769E6258',
//       },
//       databaseName: 'databaseName',
//       handler: 'handler',
//     });
//   });
//
//   it('grants statement permissions to handler', () => {
//     new DatabaseQuery(stack, 'Query', {
//       ...minimalProps,
//     });
//
//     Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
//       PolicyDocument: {
//         Statement: Match.arrayWith([{
//           Action: ['redshift-data:DescribeStatement', 'redshift-data:ExecuteStatement'],
//           Effect: 'Allow',
//           Resource: '*',
//         }]),
//       },
//       Roles: [{ Ref: 'QueryRedshiftDatabase3de5bea727da479686625efb56431b5fServiceRole0A90D717' }],
//     });
//   });
//
//   describe('timeout', () => {
//     it('passes timeout', () => {
//       new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
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
//     it('throw error for timeout being too short', () => {
//       expect(() => new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//         timeout: cdk.Duration.millis(999),
//       })).toThrow('The timeout for the handler must be BETWEEN 1 second and 15 minutes, got 999 milliseconds.');
//     });
//
//     it('throw error for timeout being too long', () => {
//       expect(() => new DatabaseQuery(stack, 'Query', {
//         ...minimalProps,
//         timeout: cdk.Duration.minutes(16),
//       })).toThrow('The timeout for the handler must be between 1 second and 15 minutes, got 960 seconds.');
//     });
//   });
//
//   it('passes removal policy through', () => {
//     new DatabaseQuery(stack, 'Query', {
//       ...minimalProps,
//       removalPolicy: cdk.RemovalPolicy.DESTROY,
//     });
//
//     Template.fromStack(stack).hasResource('Custom::RedshiftDatabaseQuery', {
//       DeletionPolicy: 'Delete',
//     });
//   });
//
//   it('passes applyRemovalPolicy through', () => {
//     const query = new DatabaseQuery(stack, 'Query', {
//       ...minimalProps,
//     });
//
//     query.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
//
//     Template.fromStack(stack).hasResource('Custom::RedshiftDatabaseQuery', {
//       DeletionPolicy: 'Delete',
//     });
//   });
//
//   it('passes gettAtt through', () => {
//     const query = new DatabaseQuery(stack, 'Query', {
//       ...minimalProps,
//     });
//
//     expect(stack.resolve(query.getAtt('attribute'))).toStrictEqual({ 'Fn::GetAtt': ['Query435140A1', 'attribute'] });
//     expect(stack.resolve(query.getAttString('attribute'))).toStrictEqual({ 'Fn::GetAtt': ['Query435140A1', 'attribute'] });
//   });
//
//   it('creates at most one IAM invoker role for handler', () => {
//     new DatabaseQuery(stack, 'Query0', {
//       ...minimalProps,
//     });
//
//     new DatabaseQuery(stack, 'Query1', {
//       ...minimalProps,
//     });
//
//     new DatabaseQuery(stack, 'Query2', {
//       ...minimalProps,
//     });
//
//     const template = Template.fromStack(stack).toJSON();
//     const iamRoles = Object.entries(template.Resources)
//       .map(([k, v]) => [k, Object.getOwnPropertyDescriptor(v, 'Type')?.value])
//       .filter(([k, v]) => v === 'AWS::IAM::Role' && k.toString().includes('InvokerRole'));
//
//     expect(iamRoles.length === 1);
//   });
// });
//
// -- END fully commented-out upstream port of test/database-query.test.ts --
