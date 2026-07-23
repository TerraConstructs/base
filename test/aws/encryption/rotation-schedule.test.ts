// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-secretsmanager/test/rotation-schedule.test.ts

import {
  secretsmanagerSecretRotation,
  lambdaPermission,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as compute from "../../../src/aws/compute";
import * as encryption from "../../../src/aws/encryption";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

describe("default tests", () => {
  let app: App;
  let stack: AwsStack;
  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
  });

  test("create a rotation schedule with a rotation Lambda", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    new encryption.RotationSchedule(stack, "RotationSchedule", {
      secret,
      rotationLambda,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          schedule_expression: "rate(30 days)",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
    //   SecretId: {
    //     Ref: 'SecretA720EF05',
    //   },
    //   RotationLambdaARN: {
    //     'Fn::GetAtt': [
    //       'LambdaD247545B',
    //       'Arn',
    //     ],
    //   },
    //   RotationRules: {
    //     ScheduleExpression: 'rate(30 days)',
    //   },
    // });
  });

  test("create a rotation schedule without immediate rotation", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    new encryption.RotationSchedule(stack, "RotationSchedule", {
      secret,
      rotationLambda,
      rotateImmediatelyOnUpdate: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_rules: {
          schedule_expression: "rate(30 days)",
        },
        rotate_immediately: false,
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
    //   SecretId: {
    //     Ref: 'SecretA720EF05',
    //   },
    //   RotationRules: {
    //     ScheduleExpression: 'rate(30 days)',
    //   },
    //   RotateImmediatelyOnUpdate: false,
    // });
  });

  test("assign kms permissions for rotation schedule with a rotation Lambda", () => {
    // GIVEN
    const encryptionKey = new encryption.Key(stack, "Key");
    const secret = new encryption.Secret(stack, "Secret", { encryptionKey });
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    new encryption.RotationSchedule(stack, "RotationSchedule", {
      secret,
      rotationLambda,
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: [
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
            ],
            effect: "Allow",
            condition: [
              {
                test: "StringEquals",
                variable: "kms:ViaService",
                values: [
                  "secretsmanager.${data.aws_region.Region.name}.amazonaws.com",
                ],
              },
            ],
            principals: [
              {
                identifiers: [stack.resolve(rotationLambda.role!.roleArn)],
                type: "AWS",
              },
            ],
            resources: ["*"],
          },
        ]),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::KMS::Key', {
    //   KeyPolicy: {
    //     Statement: [Match.anyValue(), Match.anyValue(), Match.anyValue(),
    //       {
    //         Action: [
    //           'kms:Decrypt',
    //           'kms:Encrypt',
    //           'kms:ReEncrypt*',
    //           'kms:GenerateDataKey*',
    //         ],
    //         Condition: {
    //           StringEquals: {
    //             'kms:ViaService': {
    //               'Fn::Join': [
    //                 '',
    //                 [
    //                   'secretsmanager.',
    //                   {
    //                     Ref: 'AWS::Region',
    //                   },
    //                   '.amazonaws.com',
    //                 ],
    //               ],
    //             },
    //           },
    //         },
    //         Effect: 'Allow',
    //         Principal: {
    //           AWS: {
    //             'Fn::GetAtt': [
    //               'LambdaServiceRoleA8ED4D3B',
    //               'Arn',
    //             ],
    //           },
    //         },
    //         Resource: '*',
    //       }],
    //   },
    // });
  });

  // NOTE (TerraConstructs deviation): `HostedRotation` is preserved in src/aws/encryption/
  // rotation-schedule.ts for API compatibility only -- its `bind()` always throws (see the
  // "TERRACONSTRUCTS DEVIATION" doc comment on the `HostedRotation` class there).
  // `aws_secretsmanager_secret_rotation` has no equivalent of CloudFormation's `HostedRotationLambda`,
  // which relies on the `AWS::SecretsManager-2024-09-16` transform to auto-provision a fully managed
  // rotation Lambda from an AWS-published SAR template -- Terraform cannot do this. Because `bind()`
  // is invoked unconditionally and immediately at the top of the `RotationSchedule` constructor
  // (before any of the VPC/securityGroups/excludeCharacters/masterSecret logic below would run),
  // every test in this suite that calls `secret.addRotationSchedule(..., { hostedRotation })` now
  // throws the "not supported by the Terraform AWS provider" `ValidationError` immediately -- none of
  // the CloudFormation-shaped assertions below are reachable. See
  // test/aws/encryption/secret-rotation.test.ts for the analogous "always throws" coverage for the
  // sibling `SecretRotation`/SAR construct.
  // describe('hosted rotation', () => {
  //   test('single user not in a vpc', () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     stack = new cdk.Stack(app, 'TestStack');
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //
  //     // WHEN
  //     secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.mysqlSingleUser(),
  //     });
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //       HostedRotationLambda: {
  //         RotationType: 'MySQLSingleUser',
  //         ExcludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
  //       },
  //       RotationRules: {
  //         ScheduleExpression: 'rate(30 days)',
  //       },
  //     });
  //
  //     expect(app.synth().getStackByName(stack.stackName).template).toEqual(expect.objectContaining({
  //       Transform: 'AWS::SecretsManager-2024-09-16',
  //     }));
  //
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
  //       ResourcePolicy: {
  //         Statement: [
  //           {
  //             Action: 'secretsmanager:DeleteSecret',
  //             Effect: 'Deny',
  //             Principal: {
  //               AWS: {
  //                 'Fn::Join': [
  //                   '',
  //                   [
  //                     'arn:',
  //                     {
  //                       Ref: 'AWS::Partition',
  //                     },
  //                     ':iam::',
  //                     {
  //                       Ref: 'AWS::AccountId',
  //                     },
  //                     ':root',
  //                   ],
  //                 ],
  //               },
  //             },
  //             Resource: '*',
  //           },
  //         ],
  //         Version: '2012-10-17',
  //       },
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //     });
  //   });
  //
  //   test('multi user not in a vpc', () => {
  //     // GIVEN
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //     const masterSecret = new secretsmanager.Secret(stack, 'MasterSecret');
  //
  //     // WHEN
  //     secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.postgreSqlMultiUser({
  //         masterSecret,
  //       }),
  //     });
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //       HostedRotationLambda: {
  //         MasterSecretArn: {
  //           Ref: 'MasterSecretA11BF785',
  //         },
  //         RotationType: 'PostgreSQLMultiUser',
  //       },
  //       RotationRules: {
  //         ScheduleExpression: 'rate(30 days)',
  //       },
  //     });
  //
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
  //       ResourcePolicy: {
  //         Statement: [
  //           {
  //             Action: 'secretsmanager:DeleteSecret',
  //             Effect: 'Deny',
  //             Principal: {
  //               AWS: {
  //                 'Fn::Join': [
  //                   '',
  //                   [
  //                     'arn:',
  //                     {
  //                       Ref: 'AWS::Partition',
  //                     },
  //                     ':iam::',
  //                     {
  //                       Ref: 'AWS::AccountId',
  //                     },
  //                     ':root',
  //                   ],
  //                 ],
  //               },
  //             },
  //             Resource: '*',
  //           },
  //         ],
  //         Version: '2012-10-17',
  //       },
  //       SecretId: {
  //         Ref: 'MasterSecretA11BF785',
  //       },
  //     });
  //   });
  //
  //   test('single user in a vpc', () => {
  //     // GIVEN
  //     const vpc = new ec2.Vpc(stack, 'Vpc');
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //     const dbSecurityGroup = new ec2.SecurityGroup(stack, 'SecurityGroup', { vpc });
  //     const dbConnections = new ec2.Connections({
  //       defaultPort: ec2.Port.tcp(3306),
  //       securityGroups: [dbSecurityGroup],
  //     });
  //
  //     // WHEN
  //     const hostedRotation = secretsmanager.HostedRotation.mysqlSingleUser({ vpc });
  //     secret.addRotationSchedule('RotationSchedule', { hostedRotation });
  //     dbConnections.allowDefaultPortFrom(hostedRotation);
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //       HostedRotationLambda: {
  //         RotationType: 'MySQLSingleUser',
  //         VpcSecurityGroupIds: {
  //           'Fn::GetAtt': [
  //             'SecretRotationScheduleSecurityGroup3F1F76EA',
  //             'GroupId',
  //           ],
  //         },
  //         VpcSubnetIds: {
  //           'Fn::Join': [
  //             '',
  //             [
  //               {
  //                 Ref: 'VpcPrivateSubnet1Subnet536B997A',
  //               },
  //               ',',
  //               {
  //                 Ref: 'VpcPrivateSubnet2Subnet3788AAA1',
  //               },
  //             ],
  //           ],
  //         },
  //       },
  //       RotationRules: {
  //         ScheduleExpression: 'rate(30 days)',
  //       },
  //     });
  //
  //     Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
  //       FromPort: 3306,
  //       GroupId: {
  //         'Fn::GetAtt': [
  //           'SecurityGroupDD263621',
  //           'GroupId',
  //         ],
  //       },
  //       SourceSecurityGroupId: {
  //         'Fn::GetAtt': [
  //           'SecretRotationScheduleSecurityGroup3F1F76EA',
  //           'GroupId',
  //         ],
  //       },
  //       ToPort: 3306,
  //     });
  //   });
  //
  //   test('single user in a vpc with security groups', () => {
  //     // GIVEN
  //     const vpc = new ec2.Vpc(stack, 'Vpc');
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //     const dbSecurityGroup = new ec2.SecurityGroup(stack, 'SecurityGroup', { vpc });
  //     const dbConnections = new ec2.Connections({
  //       defaultPort: ec2.Port.tcp(3306),
  //       securityGroups: [dbSecurityGroup],
  //     });
  //
  //     // WHEN
  //     const hostedRotation = secretsmanager.HostedRotation.mysqlSingleUser({
  //       vpc,
  //       securityGroups: [
  //         new ec2.SecurityGroup(stack, 'SG1', { vpc }),
  //         new ec2.SecurityGroup(stack, 'SG2', { vpc }),
  //       ],
  //     });
  //     secret.addRotationSchedule('RotationSchedule', { hostedRotation });
  //     dbConnections.allowDefaultPortFrom(hostedRotation);
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //       HostedRotationLambda: {
  //         RotationType: 'MySQLSingleUser',
  //         VpcSecurityGroupIds: {
  //           'Fn::Join': [
  //             '',
  //             [
  //               {
  //                 'Fn::GetAtt': [
  //                   'SG1BA065B6E',
  //                   'GroupId',
  //                 ],
  //               },
  //               ',',
  //               {
  //                 'Fn::GetAtt': [
  //                   'SG20CE3219C',
  //                   'GroupId',
  //                 ],
  //               },
  //             ],
  //           ],
  //         },
  //         VpcSubnetIds: {
  //           'Fn::Join': [
  //             '',
  //             [
  //               {
  //                 Ref: 'VpcPrivateSubnet1Subnet536B997A',
  //               },
  //               ',',
  //               {
  //                 Ref: 'VpcPrivateSubnet2Subnet3788AAA1',
  //               },
  //             ],
  //           ],
  //         },
  //       },
  //       RotationRules: {
  //         ScheduleExpression: 'rate(30 days)',
  //       },
  //     });
  //
  //     Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
  //       FromPort: 3306,
  //       GroupId: {
  //         'Fn::GetAtt': [
  //           'SecurityGroupDD263621',
  //           'GroupId',
  //         ],
  //       },
  //       SourceSecurityGroupId: {
  //         'Fn::GetAtt': [
  //           'SG20CE3219C',
  //           'GroupId',
  //         ],
  //       },
  //       ToPort: 3306,
  //     });
  //   });
  //
  //   test('throws with security groups and no vpc', () => {
  //     // GIVEN
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //
  //     // THEN
  //     expect(() => secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.oracleSingleUser({
  //         securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(secret, 'SG', 'sg-12345678')],
  //       }),
  //     })).toThrow(/`vpc` must be specified when specifying `securityGroups`/);
  //   });
  //
  //   test('throws when accessing the connections object when not in a vpc', () => {
  //     // GIVEN
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //
  //     // WHEN
  //     const hostedRotation = secretsmanager.HostedRotation.sqlServerSingleUser();
  //     secret.addRotationSchedule('RotationSchedule', { hostedRotation });
  //
  //     // THEN
  //     expect(() => hostedRotation.connections.allowToAnyIpv4(ec2.Port.allTraffic()))
  //       .toThrow(/Cannot use connections for a hosted rotation that is not deployed in a VPC/);
  //   });
  //
  //   test('can customize exclude characters', () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     stack = new cdk.Stack(app, 'TestStack');
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //
  //     // WHEN
  //     secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.mysqlSingleUser({
  //         excludeCharacters: '()',
  //       }),
  //     });
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       HostedRotationLambda: {
  //         RotationType: 'MySQLSingleUser',
  //         ExcludeCharacters: '()',
  //       },
  //     });
  //   });
  //
  //   test('exclude characters default to secret exclude characters', () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     stack = new cdk.Stack(app, 'TestStack');
  //     const secret = new secretsmanager.Secret(stack, 'Secret', {
  //       generateSecretString: {
  //         excludeCharacters: '[]',
  //       },
  //     });
  //
  //     // WHEN
  //     secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.mysqlSingleUser(),
  //     });
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       HostedRotationLambda: {
  //         RotationType: 'MySQLSingleUser',
  //         ExcludeCharacters: '[]',
  //       },
  //     });
  //   });
  //
  //   test('the arn is used as it is when specifying masterSecret as an imported secret with full arn', () => {
  //     // GIVEN
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //     const importedSecret = secretsmanager.Secret.fromSecretCompleteArn(stack, 'MasterSecretImported', 'arn:aws:secretsmanager:us-east-1:123456789012:secret:MySecret-123456');
  //
  //     // WHEN
  //     secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.postgreSqlMultiUser({
  //         masterSecret: importedSecret,
  //       }),
  //     });
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //       HostedRotationLambda: {
  //         MasterSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:MySecret-123456',
  //       },
  //     });
  //   });
  //
  //   test('the arn is used with -?????? when specifying masterSecret as an imported secret with partial arn', () => {
  //     // GIVEN
  //     const secret = new secretsmanager.Secret(stack, 'Secret');
  //     const importedSecret = secretsmanager.Secret.fromSecretNameV2(stack, 'MasterSecretImported', 'MySecret');
  //
  //     // WHEN
  //     secret.addRotationSchedule('RotationSchedule', {
  //       hostedRotation: secretsmanager.HostedRotation.postgreSqlMultiUser({
  //         masterSecret: importedSecret,
  //       }),
  //     });
  //
  //     // THEN
  //     Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
  //       SecretId: {
  //         Ref: 'SecretA720EF05',
  //       },
  //       HostedRotationLambda: {
  //         MasterSecretArn: {
  //           'Fn::Join': [
  //             '',
  //             [
  //               'arn:',
  //               { Ref: 'AWS::Partition' },
  //               ':secretsmanager:',
  //               { Ref: 'AWS::Region' },
  //               ':',
  //               { Ref: 'AWS::AccountId' },
  //               ':secret:MySecret-??????',
  //             ],
  //           ],
  //         },
  //       },
  //     });
  //   });
  // });

  describe("manual rotations", () => {
    // TERRACONSTRUCTS DEVIATION: upstream expects a zero `automaticallyAfter` duration (of any
    // unit) to leave `RotationRules` unset entirely -- CloudFormation's sentinel for "manual
    // rotation only". Terraform's `aws_secretsmanager_secret_rotation` resource requires a
    // populated `rotation_rules` block (see the "Never synthesize provider-invalid config for CFN
    // sentinel semantics" rule in conventions.md, and the JSDoc on
    // `RotationScheduleOptions.automaticallyAfter` in src/aws/encryption/rotation-schedule.ts) -- an
    // empty block fails `tofu validate`. Every zero-valued `Duration` therefore throws a
    // `ValidationError` at construct time instead of silently synthesizing an invalid resource; this
    // test asserts that throw rather than the (unreachable) "RotationRules unset" shape.
    test("automaticallyAfter with any duration of zero throws (no Terraform equivalent of CFN's 'leave RotationRules unset' sentinel)", () => {
      const checkRotationThrows = (automaticallyAfter: Duration) => {
        // GIVEN
        const localApp = Testing.app();
        const localStack = new AwsStack(localApp);
        const secret = new encryption.Secret(localStack, "Secret");
        const rotationLambda = new compute.LambdaFunction(
          localStack,
          "Lambda",
          {
            runtime: compute.Runtime.NODEJS_LATEST,
            code: compute.Code.fromInline("export.handler = event => event;"),
            handler: "index.handler",
          },
        );

        // WHEN / THEN
        expect(
          () =>
            new encryption.RotationSchedule(localStack, "RotationSchedule", {
              secret,
              rotationLambda,
              automaticallyAfter,
            }),
        ).toThrow(/`automaticallyAfter` cannot be `Duration\.days\(0\)`/);
      };

      checkRotationThrows(Duration.days(0));
      checkRotationThrows(Duration.hours(0));
      checkRotationThrows(Duration.minutes(0));
      checkRotationThrows(Duration.seconds(0));
      checkRotationThrows(Duration.millis(0));
    });
    // Template.fromStack(localStack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', Match.objectEquals({
    //   SecretId: { Ref: 'SecretA720EF05' },
    //   RotationLambdaARN: {
    //     'Fn::GetAtt': [
    //       'LambdaD247545B',
    //       'Arn',
    //     ],
    //   },
    // }));
  });

  test("rotation schedule should have a dependency on lambda permissions", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_20_X,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    secret.addRotationSchedule("RotationSchedule", {
      rotationLambda,
    });

    // THEN
    const t = new Template(stack);
    const rotations = t.resourceTypeArray(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
    ) as any[];
    expect(rotations).toHaveLength(1);
    // NOTE (TerraConstructs deviation): the depended-on `aws_lambda_permission` logical id is
    // derived from a content hash of the grantee principal (see `grantInvoke()` in
    // src/aws/compute/function-base.ts), analogous to -- but not byte-identical with -- upstream's
    // own CDK-side hash (`LambdaInvokeN0a2GKfZP0JmDqDEVhhu6A0TUv3NyNbk4YMFKNc69846677`). Assert the
    // shape of the dependency (a `depends_on` entry pointing at the generated
    // `aws_lambda_permission` resource) rather than the exact hash string.
    expect(rotations[0].depends_on).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^aws_lambda_permission\./),
      ]),
    );
    // Template.fromStack(stack).hasResource('AWS::SecretsManager::RotationSchedule', {
    //   DependsOn: [
    //     'LambdaInvokeN0a2GKfZP0JmDqDEVhhu6A0TUv3NyNbk4YMFKNc69846677',
    //   ],
    // });
  });

  test("automaticallyAfter set scheduleExpression with days duration", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    new encryption.RotationSchedule(stack, "RotationSchedule", {
      secret,
      rotationLambda,
      automaticallyAfter: Duration.days(90),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          schedule_expression: "rate(90 days)",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', Match.objectEquals({
    //   SecretId: { Ref: 'SecretA720EF05' },
    //   RotationLambdaARN: {
    //     'Fn::GetAtt': [
    //       'LambdaD247545B',
    //       'Arn',
    //     ],
    //   },
    //   RotationRules: {
    //     ScheduleExpression: 'rate(90 days)',
    //   },
    // }));
  });

  test("automaticallyAfter set scheduleExpression with hours duration", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    new encryption.RotationSchedule(stack, "RotationSchedule", {
      secret,
      rotationLambda,
      automaticallyAfter: Duration.hours(6),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          schedule_expression: "rate(6 hours)",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', Match.objectEquals({
    //   SecretId: { Ref: 'SecretA720EF05' },
    //   RotationLambdaARN: {
    //     'Fn::GetAtt': [
    //       'LambdaD247545B',
    //       'Arn',
    //     ],
    //   },
    //   RotationRules: {
    //     ScheduleExpression: 'rate(6 hours)',
    //   },
    // }));
  });

  test("automaticallyAfter must not be smaller than 4 hours", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    // THEN
    expect(
      () =>
        new encryption.RotationSchedule(stack, "RotationSchedule", {
          secret,
          rotationLambda,
          automaticallyAfter: Duration.hours(2),
        }),
    ).toThrow(
      /automaticallyAfter must not be smaller than 4 hours, got 2 hours/,
    );
  });

  test("automaticallyAfter must not be greater than 1000 days", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    // THEN
    expect(
      () =>
        new encryption.RotationSchedule(stack, "RotationSchedule", {
          secret,
          rotationLambda,
          automaticallyAfter: Duration.days(1001),
        }),
    ).toThrow(
      /automaticallyAfter must not be greater than 1000 days, got 1001 days/,
    );
  });
});

describe("feature tests", () => {
  // NOTE (TerraConstructs deviation): upstream parameterizes both nested describes below via the
  // `@aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy` context feature flag (cx-api). That
  // per-module context-flag mechanism is not ported in this repo (see src/aws/cx-api.ts -- no such
  // flag entry). `iam.Role.addToPrincipalPolicy` (src/aws/iam/role.ts) always merges granted
  // statements into a single "DefaultPolicy" child resource -- matching only the flag's "disabled"
  // (legacy) behavior. The "enabled" branch (a separate per-grant
  // "...inlinePolicyAddedToExecutionRole..." `Policy` resource) has no code path here, so only the
  // "disabled" test of each pair is portable; the "enabled" test is dropped.
  describe("grants correct permissions for secret imported by name", () => {
    test("@aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy disabled", () => {
      // GIVEN
      const app = Testing.app();
      const stack = new AwsStack(app);
      const secret = encryption.Secret.fromSecretNameV2(
        stack,
        "Secret",
        "mySecretName",
      );
      const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
        runtime: compute.Runtime.NODEJS_LATEST,
        code: compute.Code.fromInline("export.handler = event => event;"),
        handler: "index.handler",
      });

      // WHEN
      new encryption.RotationSchedule(stack, "RotationSchedule", {
        secret,
        rotationLambda,
      });

      // THEN
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: [
                "secretsmanager:DescribeSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:PutSecretValue",
                "secretsmanager:UpdateSecretVersionStage",
              ],
              effect: "Allow",
              resources: [`${stack.resolve(secret.secretArn)}-??????`],
            }),
          ]),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: Match.arrayWith([
      //       {
      //         Action: [
      //           'secretsmanager:DescribeSecret',
      //           'secretsmanager:GetSecretValue',
      //           'secretsmanager:PutSecretValue',
      //           'secretsmanager:UpdateSecretVersionStage',
      //         ],
      //         Effect: 'Allow',
      //         Resource: {
      //           'Fn::Join': ['', [
      //             'arn:',
      //             { Ref: 'AWS::Partition' },
      //             ':secretsmanager:',
      //             { Ref: 'AWS::Region' },
      //             ':',
      //             { Ref: 'AWS::AccountId' },
      //             ':secret:mySecretName-??????',
      //           ]],
      //         },
      //       },
      //     ]),
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'LambdainlinePolicyAddedToExecutionRole06CEA97D1',
      //   Roles: [
      //     {
      //       Ref: 'LambdaServiceRoleA8ED4D3B',
      //     },
      //   ],
      // });
    });
  });

  describe("assign permissions for rotation schedule with a rotation Lambda", () => {
    test("@aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy disabled", () => {
      // GIVEN
      const app = Testing.app();
      const stack = new AwsStack(app);
      const secret = new encryption.Secret(stack, "Secret");
      const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
        runtime: compute.Runtime.NODEJS_LATEST,
        code: compute.Code.fromInline("export.handler = event => event;"),
        handler: "index.handler",
      });

      // WHEN
      new encryption.RotationSchedule(stack, "RotationSchedule", {
        secret,
        rotationLambda,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        lambdaPermission.LambdaPermission,
        {
          action: "lambda:InvokeFunction",
          function_name: stack.resolve(rotationLambda.functionArn),
          principal: "secretsmanager.amazonaws.com",
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Permission', {
      //   Action: 'lambda:InvokeFunction',
      //   FunctionName: {
      //     'Fn::GetAtt': [
      //       'LambdaD247545B',
      //       'Arn',
      //     ],
      //   },
      //   Principal: 'secretsmanager.amazonaws.com',
      // });

      // NOTE: unlike an `arrayContaining`, a plain array requires an exact-length match (see the
      // NOTE on "grantRead with KMS Key" in secret.test.ts) -- the Lambda's inline policy also
      // carries its default X-Ray tracing statement alongside the two secretsmanager statements
      // below, so `arrayContaining` (matching the sibling "grants correct permissions for secret
      // imported by name" test above) is used instead of a fixed-length array.
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: [
                "secretsmanager:DescribeSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:PutSecretValue",
                "secretsmanager:UpdateSecretVersionStage",
              ],
              effect: "Allow",
              resources: [stack.resolve(secret.secretArn)],
            }),
            expect.objectContaining({
              actions: ["secretsmanager:GetRandomPassword"],
              effect: "Allow",
              resources: ["*"],
            }),
          ]),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: [
      //           'secretsmanager:DescribeSecret',
      //           'secretsmanager:GetSecretValue',
      //           'secretsmanager:PutSecretValue',
      //           'secretsmanager:UpdateSecretVersionStage',
      //         ],
      //         Effect: 'Allow',
      //         Resource: {
      //           Ref: 'SecretA720EF05',
      //         },
      //       },
      //     ],
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'LambdainlinePolicyAddedToExecutionRole06CEA97D1',
      //   Roles: [
      //     {
      //       Ref: 'LambdaServiceRoleA8ED4D3B',
      //     },
      //   ],
      // });
      //
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: 'secretsmanager:GetRandomPassword',
      //         Effect: 'Allow',
      //         Resource: '*',
      //       },
      //     ],
      //   },
      // });
    });
  });
});

// Repo-specific snapshot coverage (see conventions.md "Test-suite conventions": snapshots are the
// repo's main defense against emitted-Terraform drift).
describe("RotationSchedule", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    new encryption.RotationSchedule(stack, "RotationSchedule", {
      secret,
      rotationLambda,
      automaticallyAfter: Duration.days(14),
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
