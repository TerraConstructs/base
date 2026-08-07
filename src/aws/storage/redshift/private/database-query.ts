// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/private/database-query.ts
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
// -- BEGIN fully commented-out upstream port of lib/private/database-query.ts --
//
// import * as path from 'path';
// import * as iam from 'aws-cdk-lib/aws-iam';
// import * as lambda from 'aws-cdk-lib/aws-lambda';
// import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// import * as cdk from 'aws-cdk-lib/core';
// import { lit } from 'aws-cdk-lib/core/lib/helpers-internal';
// import * as customresources from 'aws-cdk-lib/custom-resources';
// import { Construct } from 'constructs';
// import type { DatabaseQueryHandlerProps } from './handler-props';
// import { Cluster } from '../cluster';
// import type { DatabaseOptions } from '../database-options';
//
// export interface DatabaseQueryProps<HandlerProps> extends DatabaseOptions {
//   readonly handler: string;
//   readonly properties: HandlerProps;
//   /**
//    * The policy to apply when this resource is removed from the application.
//    *
//    * @default cdk.RemovalPolicy.Destroy
//    */
//   readonly removalPolicy?: cdk.RemovalPolicy;
//
//   /**
//    * The handler timeout duration
//    *
//    * @default cdk.Duration.minutes(1)
//    */
//   readonly timeout?: cdk.Duration;
// }
//
// export class DatabaseQuery<HandlerProps> extends Construct implements iam.IGrantable {
//   readonly grantPrincipal: iam.IPrincipal;
//   readonly ref: string;
//
//   private readonly resource: cdk.CustomResource;
//
//   constructor(scope: Construct, id: string, props: DatabaseQueryProps<HandlerProps>) {
//     super(scope, id);
//
//     if (props.timeout && !cdk.Token.isUnresolved(props.timeout)) {
//       if (props.timeout.toMilliseconds() < cdk.Duration.seconds(1).toMilliseconds()) {
//         throw new cdk.ValidationError(lit`TimeoutTooShort`, `The timeout for the handler must be BETWEEN 1 second and 15 minutes, got ${props.timeout.toMilliseconds()} milliseconds.`, this);
//       }
//       if (props.timeout.toSeconds() > cdk.Duration.minutes(15).toSeconds()) {
//         throw new cdk.ValidationError(lit`TimeoutTooLong`, `The timeout for the handler must be between 1 second and 15 minutes, got ${props.timeout.toSeconds()} seconds.`, this);
//       }
//     }
//
//     const adminUser = this.getAdminUser(props);
//     const handler = new lambda.SingletonFunction(this, 'Handler', {
//       code: lambda.Code.fromAsset(path.join(__dirname, 'database-query-provider'), {
//         exclude: ['*.ts'],
//       }),
//       runtime: lambda.determineLatestNodeRuntime(this),
//       handler: 'index.handler',
//       timeout: props.timeout ?? cdk.Duration.minutes(1),
//       uuid: '3de5bea7-27da-4796-8662-5efb56431b5f',
//       lambdaPurpose: 'Query Redshift Database',
//     });
//     handler.addToRolePolicy(new iam.PolicyStatement({
//       actions: ['redshift-data:DescribeStatement', 'redshift-data:ExecuteStatement'],
//       resources: ['*'],
//     }));
//     adminUser.grantRead(handler);
//
//     const provider = new customresources.Provider(this, 'Provider', {
//       onEventHandler: handler,
//       role: this.getOrCreateInvokerRole(handler),
//     });
//
//     const queryHandlerProps: DatabaseQueryHandlerProps & HandlerProps = {
//       handler: props.handler,
//       clusterName: props.cluster.clusterName,
//       adminUserArn: adminUser.secretArn,
//       databaseName: props.databaseName,
//       ...props.properties,
//     };
//     this.resource = new cdk.CustomResource(this, 'Resource', {
//       resourceType: 'Custom::RedshiftDatabaseQuery',
//       serviceToken: provider.serviceToken,
//       removalPolicy: props.removalPolicy,
//       properties: queryHandlerProps,
//     });
//
//     this.grantPrincipal = handler.grantPrincipal;
//     this.ref = this.resource.ref;
//   }
//
//   public applyRemovalPolicy(policy: cdk.RemovalPolicy): void {
//     this.resource.applyRemovalPolicy(policy);
//   }
//
//   public getAtt(attributeName: string): cdk.Reference {
//     return this.resource.getAtt(attributeName);
//   }
//
//   public getAttString(attributeName: string): string {
//     return this.resource.getAttString(attributeName);
//   }
//
//   private getAdminUser(props: DatabaseOptions): secretsmanager.ISecret {
//     const cluster = props.cluster;
//     let adminUser = props.adminUser;
//     if (!adminUser) {
//       if (cluster instanceof Cluster) {
//         if (cluster.secret) {
//           adminUser = cluster.secret;
//         } else {
//           throw new cdk.ValidationError(
//             lit`AdminUserSecretNotAvailable`,
//             'Administrative access to the Redshift cluster is required but an admin user secret was not provided and the cluster did not generate admin user credentials (they were provided explicitly)',
//             this,
//           );
//         }
//       } else {
//         throw new cdk.ValidationError(
//           lit`AdminUserSecretNotProvided`,
//           'Administrative access to the Redshift cluster is required but an admin user secret was not provided and the cluster was imported',
//           this,
//         );
//       }
//     }
//     return adminUser;
//   }
//
//   /**
//    * Get or create the IAM role for the singleton lambda function.
//    * We only need one function since it's just acting as an invoker.
//    * */
//   private getOrCreateInvokerRole(handler: lambda.SingletonFunction): iam.IRole {
//     const id = handler.constructName + 'InvokerRole';
//     const existing = cdk.Stack.of(this).node.tryFindChild(id);
//     return existing != null
//       ? existing as iam.Role
//       : new iam.Role(cdk.Stack.of(this), id, {
//         assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
//         managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
//       });
//   }
// }
//
// -- END fully commented-out upstream port of lib/private/database-query.ts --
