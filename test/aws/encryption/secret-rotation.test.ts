// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-secretsmanager/test/secret-rotation.test.ts

import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as ec2 from "../../../src/aws/compute";
import * as encryption from "../../../src/aws/encryption";

// Repo-specific coverage (see conventions.md "Test-suite conventions": snapshots are the repo's
// main defense against emitted-Terraform drift). `SecretRotation` has no successful synth path to
// snapshot -- see the "TERRACONSTRUCTS DEVIATION (HARD BLOCKER)" doc comment on the class in
// src/aws/encryption/secret-rotation.ts: upstream deploys the rotation Lambda via an AWS-published
// Serverless Application Repository (SAR) app (`AWS::Serverless::Application`), and
// `terraform-provider-aws` has no `serverlessrepo` resource, so the constructor unconditionally
// throws a `ValidationError` instead of ever synthesizing a half/invalid resource. This test
// defends that deviation (an intentional, permanent throw) against silent regressions.
describe("SecretRotation", () => {
  test("always throws: no Terraform serverlessrepo resource for the SAR rotation app", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    const vpc = new ec2.Vpc(stack, "VPC");
    const secret = new encryption.Secret(stack, "Secret");
    const securityGroup = new ec2.SecurityGroup(stack, "SecurityGroup", {
      vpc,
    });
    const target = new ec2.Connections({
      defaultPort: ec2.Port.tcp(3306),
      securityGroups: [securityGroup],
    });

    // WHEN / THEN
    expect(
      () =>
        new encryption.SecretRotation(stack, "SecretRotation", {
          application:
            encryption.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
          secret,
          target,
          vpc,
        }),
    ).toThrow(/SecretRotation is not supported/);
  });
});

let app: App;
let stack: AwsStack;
let vpc: ec2.IVpc;
let secret: encryption.ISecret;
let securityGroup: ec2.SecurityGroup;
let target: ec2.Connections;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app);
  vpc = new ec2.Vpc(stack, "VPC");
  secret = new encryption.Secret(stack, "Secret");
  securityGroup = new ec2.SecurityGroup(stack, "SecurityGroup", { vpc });
  target = new ec2.Connections({
    defaultPort: ec2.Port.tcp(3306),
    securityGroups: [securityGroup],
  });
});

// Not supported by Terraform Provider: `SecretRotation` always throws at construction time (see
// the "TERRACONSTRUCTS DEVIATION" doc comment in src/aws/encryption/secret-rotation.ts) because it
// deploys its rotation Lambda via an AWS Serverless Application Repository (SAR) app
// (`AWS::Serverless::Application`), and `terraform-provider-aws` has no `serverlessrepo` resource.
// This test asserted the synthesized `AWS::EC2::SecurityGroupIngress` / `AWS::SecretsManager::
// RotationSchedule` / `AWS::EC2::SecurityGroup` / `AWS::Serverless::Application` /
// `AWS::SecretsManager::ResourcePolicy` CloudFormation resources produced by a successful
// construction, which can never happen here.
// test('secret rotation single user', () => {
//   // GIVEN
//   const excludeCharacters = ' ;+%{}' + '@\'"`/\\#'; // DMS and BASH problem chars
//
//   // WHEN
//   new secretsmanager.SecretRotation(stack, 'SecretRotation', {
//     application: secretsmanager.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
//     secret,
//     target,
//     vpc,
//     excludeCharacters: excludeCharacters,
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
//     IpProtocol: 'tcp',
//     Description: 'from SecretRotationSecurityGroupAEC520AB:3306',
//     FromPort: 3306,
//     GroupId: {
//       'Fn::GetAtt': [
//         'SecurityGroupDD263621',
//         'GroupId',
//       ],
//     },
//     SourceSecurityGroupId: {
//       'Fn::GetAtt': [
//         'SecretRotationSecurityGroup9985012B',
//         'GroupId',
//       ],
//     },
//     ToPort: 3306,
//   });
//
//   Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
//     SecretId: {
//       Ref: 'SecretA720EF05',
//     },
//     RotationLambdaARN: {
//       'Fn::GetAtt': [
//         'SecretRotationA9FFCFA9',
//         'Outputs.RotationLambdaARN',
//       ],
//     },
//     RotationRules: {
//       ScheduleExpression: 'rate(30 days)',
//     },
//   });
//
//   Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
//     GroupDescription: 'Default/SecretRotation/SecurityGroup',
//   });
//
//   Template.fromStack(stack).hasResource('AWS::Serverless::Application', {
//     Properties: {
//       Location: {
//         ApplicationId: {
//           'Fn::FindInMap': ['SecretRotationSARMappingC10A2F5D', { Ref: 'AWS::Partition' }, 'applicationId'],
//         },
//         SemanticVersion: {
//           'Fn::FindInMap': ['SecretRotationSARMappingC10A2F5D', { Ref: 'AWS::Partition' }, 'semanticVersion'],
//         },
//       },
//       Parameters: {
//         endpoint: {
//           'Fn::Join': [
//             '',
//             [
//               'https://secretsmanager.',
//               {
//                 Ref: 'AWS::Region',
//               },
//               '.',
//               {
//                 Ref: 'AWS::URLSuffix',
//               },
//             ],
//           ],
//         },
//         functionName: 'SecretRotation',
//         excludeCharacters: excludeCharacters,
//         vpcSecurityGroupIds: {
//           'Fn::GetAtt': [
//             'SecretRotationSecurityGroup9985012B',
//             'GroupId',
//           ],
//         },
//         vpcSubnetIds: {
//           'Fn::Join': [
//             '',
//             [
//               {
//                 Ref: 'VPCPrivateSubnet1Subnet8BCA10E0',
//               },
//               ',',
//               {
//                 Ref: 'VPCPrivateSubnet2SubnetCFCDAA7A',
//               },
//             ],
//           ],
//         },
//       },
//     },
//     DeletionPolicy: 'Delete',
//     UpdateReplacePolicy: 'Delete',
//   });
//
//   Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
//     ResourcePolicy: {
//       Statement: [
//         {
//           Action: 'secretsmanager:DeleteSecret',
//           Effect: 'Deny',
//           Principal: {
//             AWS: {
//               'Fn::Join': [
//                 '',
//                 [
//                   'arn:',
//                   {
//                     Ref: 'AWS::Partition',
//                   },
//                   ':iam::',
//                   {
//                     Ref: 'AWS::AccountId',
//                   },
//                   ':root',
//                 ],
//               ],
//             },
//           },
//           Resource: '*',
//         },
//       ],
//       Version: '2012-10-17',
//     },
//     SecretId: {
//       Ref: 'SecretA720EF05',
//     },
//   });
// });

// Not supported by Terraform Provider: see reason above ('secret rotation single user').
// test('secret rotation multi user', () => {
//   // GIVEN
//   const masterSecret = new secretsmanager.Secret(stack, 'MasterSecret');
//
//   // WHEN
//   new secretsmanager.SecretRotation(stack, 'SecretRotation', {
//     application: secretsmanager.SecretRotationApplication.MYSQL_ROTATION_MULTI_USER,
//     secret,
//     masterSecret,
//     target,
//     vpc,
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::Serverless::Application', {
//     Parameters: {
//       endpoint: {
//         'Fn::Join': [
//           '',
//           [
//             'https://secretsmanager.',
//             {
//               Ref: 'AWS::Region',
//             },
//             '.',
//             {
//               Ref: 'AWS::URLSuffix',
//             },
//           ],
//         ],
//       },
//       functionName: 'SecretRotation',
//       vpcSecurityGroupIds: {
//         'Fn::GetAtt': [
//           'SecretRotationSecurityGroup9985012B',
//           'GroupId',
//         ],
//       },
//       vpcSubnetIds: {
//         'Fn::Join': [
//           '',
//           [
//             {
//               Ref: 'VPCPrivateSubnet1Subnet8BCA10E0',
//             },
//             ',',
//             {
//               Ref: 'VPCPrivateSubnet2SubnetCFCDAA7A',
//             },
//           ],
//         ],
//       },
//       masterSecretArn: {
//         Ref: 'MasterSecretA11BF785',
//       },
//     },
//   });
//
//   Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
//     ResourcePolicy: {
//       Statement: [
//         {
//           Action: 'secretsmanager:DeleteSecret',
//           Effect: 'Deny',
//           Principal: {
//             AWS: {
//               'Fn::Join': [
//                 '',
//                 [
//                   'arn:',
//                   {
//                     Ref: 'AWS::Partition',
//                   },
//                   ':iam::',
//                   {
//                     Ref: 'AWS::AccountId',
//                   },
//                   ':root',
//                 ],
//               ],
//             },
//           },
//           Resource: '*',
//         },
//       ],
//       Version: '2012-10-17',
//     },
//     SecretId: {
//       Ref: 'MasterSecretA11BF785',
//     },
//   });
// });

// Not supported by Terraform Provider: see reason above ('secret rotation single user').
// test('secret rotation allows passing an empty string for excludeCharacters', () => {
//   // WHEN
//   new secretsmanager.SecretRotation(stack, 'SecretRotation', {
//     application: secretsmanager.SecretRotationApplication.MARIADB_ROTATION_SINGLE_USER,
//     secret,
//     target,
//     vpc,
//     excludeCharacters: '',
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::Serverless::Application', {
//     Parameters: {
//       excludeCharacters: '',
//     },
//   });
// });

// Not supported by Terraform Provider: see reason above ('secret rotation single user').
// test('secret rotation without immediate rotation', () => {
//   // WHEN
//   new secretsmanager.SecretRotation(stack, 'SecretRotation', {
//     application: secretsmanager.SecretRotationApplication.MARIADB_ROTATION_SINGLE_USER,
//     secret,
//     target,
//     vpc,
//     rotateImmediatelyOnUpdate: false,
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
//     RotateImmediatelyOnUpdate: false,
//   });
// });

test("throws when connections object has no default port range", () => {
  // WHEN
  const targetWithoutDefaultPort = new ec2.Connections({
    securityGroups: [securityGroup],
  });

  // THEN
  expect(
    () =>
      new encryption.SecretRotation(stack, "Rotation", {
        secret,
        application:
          encryption.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
        vpc,
        target: targetWithoutDefaultPort,
      }),
  ).toThrow(/`target`.+default port range/);
});

test("throws when master secret is missing for a multi user application", () => {
  // THEN
  expect(
    () =>
      new encryption.SecretRotation(stack, "Rotation", {
        secret,
        application:
          encryption.SecretRotationApplication.MYSQL_ROTATION_MULTI_USER,
        vpc,
        target,
      }),
  ).toThrow(
    /The `masterSecret` must be specified for application using the multi user scheme/,
  );
});

// Not supported by Terraform Provider: see reason above ('secret rotation single user'). This
// test asserted the `AWS::Serverless::Application` `functionName` Parameter truncation/collision
// avoidance for long construct ids, which is entirely SAR-CfnApplication-specific.
// test('rotation function name does not exceed 64 chars', () => {
//   // WHEN
//   const id = 'SecretRotation'.repeat(5);
//   new secretsmanager.SecretRotation(stack, id, {
//     application: secretsmanager.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
//     secret,
//     target,
//     vpc,
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::Serverless::Application', {
//     Parameters: {
//       endpoint: {
//         'Fn::Join': [
//           '',
//           [
//             'https://secretsmanager.',
//             {
//               Ref: 'AWS::Region',
//             },
//             '.',
//             {
//               Ref: 'AWS::URLSuffix',
//             },
//           ],
//         ],
//       },
//       functionName: 'RotationSecretRotationSecretRotationSecretRotationSecretRotation',
//       vpcSecurityGroupIds: {
//         'Fn::GetAtt': [
//           'SecretRotationSecretRotationSecretRotationSecretRotationSecretRotationSecurityGroupBFCB171A',
//           'GroupId',
//         ],
//       },
//       vpcSubnetIds: {
//         'Fn::Join': [
//           '',
//           [
//             {
//               Ref: 'VPCPrivateSubnet1Subnet8BCA10E0',
//             },
//             ',',
//             {
//               Ref: 'VPCPrivateSubnet2SubnetCFCDAA7A',
//             },
//           ],
//         ],
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: see reason above ('secret rotation single user'). This
// test additionally exercised `ec2.InterfaceVpcEndpoint` wiring into the SAR CfnApplication's
// `endpoint` Parameter, which is unreachable now that construction always throws.
// test('with interface vpc endpoint', () => {
//   // GIVEN
//   const endpoint = new ec2.InterfaceVpcEndpoint(stack, 'SecretsManagerEndpoint', {
//     service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
//     vpc,
//   });
//
//   // WHEN
//   new secretsmanager.SecretRotation(stack, 'SecretRotation', {
//     application: secretsmanager.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
//     secret,
//     target,
//     vpc,
//     endpoint,
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::Serverless::Application', {
//     Parameters: {
//       endpoint: {
//         'Fn::Join': ['', [
//           'https://',
//           { Ref: 'SecretsManagerEndpoint5E83C66B' },
//           '.secretsmanager.',
//           { Ref: 'AWS::Region' },
//           '.',
//           { Ref: 'AWS::URLSuffix' },
//         ]],
//       },
//     },
//   });
// });
