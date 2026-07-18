// https://github.com/aws/aws-cdk/blob/v2.261.0/packages/aws-cdk-lib/aws-secretsmanager/test/rotation-schedule.test.ts

import {
  secretsmanagerSecretRotation,
  lambdaPermission,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as compute from "../../../src/aws/compute";
import * as encryption from "../../../src/aws/encryption";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("default tests", () => {
  let stack: AwsStack;
  let app: App;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
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
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          automatically_after_days: 30,
        },
      },
    );
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
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          automatically_after_days: 30,
        },
        rotate_immediately: false,
      },
    );
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
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        // This is the KMS key policy
        statement: expect.arrayContaining([
          {
            actions: [
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
            ],
            condition: [
              {
                test: "StringEquals",
                variable: "kms:ViaService",
                values: [
                  `secretsmanager.${providerConfig.region}.amazonaws.com`,
                ],
              },
            ],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: [stack.resolve(rotationLambda.role?.roleArn)],
              },
            ],
            resources: ["*"],
          },
        ]),
      },
    );
  });

  describe("hosted rotation", () => {
    // NOTE: Hosted rotation is a CloudFormation-specific feature (`AWS::SecretsManager-2020-07-23` transform)
    // and is not directly supported by the `aws_secretsmanager_secret_rotation` Terraform resource.
    // These aws-cdk tests cannot be converted 1:1, but the TerraConstructs-specific
    // behavior they'd otherwise leave untested is covered below.

    test("throws when neither rotationLambda nor hostedRotation is specified", () => {
      // GIVEN
      const secret = new encryption.Secret(stack, "Secret");

      // WHEN/THEN
      expect(
        () =>
          new encryption.RotationSchedule(stack, "RotationSchedule", {
            secret,
          }),
      ).toThrow(
        /One of `rotationLambda` or `hostedRotation` must be specified\./,
      );
    });

    test("throws when both rotationLambda and hostedRotation are specified", () => {
      // GIVEN
      const secret = new encryption.Secret(stack, "Secret");
      const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
        runtime: compute.Runtime.NODEJS_LATEST,
        code: compute.Code.fromInline("export.handler = event => event;"),
        handler: "index.handler",
      });

      // WHEN/THEN
      expect(
        () =>
          new encryption.RotationSchedule(stack, "RotationSchedule", {
            secret,
            rotationLambda,
            hostedRotation: encryption.HostedRotation.mysqlSingleUser(),
          }),
      ).toThrow(
        /One of `rotationLambda` or `hostedRotation` must be specified\./,
      );
    });

    test("throws when hostedRotation is specified (unsupported in Terraform provider AWS)", () => {
      // GIVEN
      const secret = new encryption.Secret(stack, "Secret");

      // WHEN/THEN
      expect(
        () =>
          new encryption.RotationSchedule(stack, "RotationSchedule", {
            secret,
            hostedRotation: encryption.HostedRotation.mysqlSingleUser(),
          }),
      ).toThrow(/HostedRotation in Terraform provider AWS/);
    });

    test("HostedRotation.mysqlMultiUser without masterSecret throws", () => {
      expect(() => encryption.HostedRotation.mysqlMultiUser({} as any)).toThrow(
        /The `masterSecret` must be specified/,
      );
    });
  });

  describe("manual rotations", () => {
    test("automaticallyAfter with any duration of zero throws", () => {
      const checkRotationRejected = (
        automaticallyAfter: Duration,
        id: string,
      ) => {
        // GIVEN
        const localStack = new AwsStack(app, `Stack${id}`, {
          environmentName,
          gridUUID,
          providerConfig,
          gridBackendConfig,
        });
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

        // WHEN/THEN
        // NOTE: unlike CloudFormation's optional `RotationRules`, the
        // `aws_secretsmanager_secret_rotation` Terraform resource requires a
        // `rotation_rules` block with `automatically_after_days` or
        // `schedule_expression` set. A zero duration cannot be represented,
        // so it must be rejected at synth time rather than producing an
        // invalid `rotation_rules {}`.
        expect(
          () =>
            new encryption.RotationSchedule(localStack, "RotationSchedule", {
              secret,
              rotationLambda,
              automaticallyAfter,
            }),
        ).toThrow(
          /automaticallyAfter must be a non-zero duration: aws_secretsmanager_secret_rotation requires a rotation_rules block with automatically_after_days or schedule_expression, so a zero duration cannot be represented\./,
        );
      };

      checkRotationRejected(Duration.days(0), "Days");
      checkRotationRejected(Duration.hours(0), "Hours");
      checkRotationRejected(Duration.minutes(0), "Minutes");
      checkRotationRejected(Duration.seconds(0), "Seconds");
    });
  });

  test("rotation schedule should have a dependency on lambda permissions", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN
    secret.addRotationSchedule("RotationSchedule", {
      rotationLambda,
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        depends_on: expect.arrayContaining([
          expect.stringMatching(/^aws_lambda_permission\./),
        ]),
      },
    );
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
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          automatically_after_days: 90,
        },
      },
    );
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
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        secret_id: stack.resolve(secret.secretArn),
        rotation_lambda_arn: stack.resolve(rotationLambda.functionArn),
        rotation_rules: {
          schedule_expression: "rate(6 hours)",
        },
      },
    );
  });

  test("automaticallyAfter must not be smaller than 4 hours", () => {
    // GIVEN
    const secret = new encryption.Secret(stack, "Secret");
    const rotationLambda = new compute.LambdaFunction(stack, "Lambda", {
      runtime: compute.Runtime.NODEJS_LATEST,
      code: compute.Code.fromInline("export.handler = event => event;"),
      handler: "index.handler",
    });

    // WHEN/THEN
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

    // WHEN/THEN
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
  let stack: AwsStack;
  let app: App;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  describe("grants correct permissions for secret imported by name", () => {
    test("TerraConstructs behavior", () => {
      // GIVEN
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
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            {
              actions: [
                "secretsmanager:DescribeSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:PutSecretValue",
                "secretsmanager:UpdateSecretVersionStage",
              ],
              effect: "Allow",
              resources: [
                `arn:\${data.aws_partition.Partitition.partition}:secretsmanager:${providerConfig.region}:\${data.aws_caller_identity.CallerIdentity.account_id}:secret:mySecretName-??????`,
              ],
            },
          ]),
        },
      );
    });
  });

  describe("assign permissions for rotation schedule with a rotation Lambda", () => {
    test("TerraConstructs behavior", () => {
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
      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        lambdaPermission.LambdaPermission,
        {
          action: "lambda:InvokeFunction",
          // `grantInvoke` authorizes the ARN (not the plain function name),
          // matching upstream aws-cdk's `AWS::Lambda::Permission` (`FunctionName`
          // set via `Fn::GetAtt ... Arn`); no `source_arn` is set for a bare
          // `ServicePrincipal` grant.
          function_name: stack.resolve(rotationLambda.functionArn),
          principal: "secretsmanager.amazonaws.com",
        },
      );

      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            {
              actions: [
                "secretsmanager:DescribeSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:PutSecretValue",
                "secretsmanager:UpdateSecretVersionStage",
              ],
              effect: "Allow",
              resources: [stack.resolve(secret.secretArn)],
            },
            {
              actions: ["secretsmanager:GetRandomPassword"],
              effect: "Allow",
              resources: ["*"],
            },
          ]),
        },
      );
    });
  });
});
