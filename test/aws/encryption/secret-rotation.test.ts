// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/test/secret-rotation.test.ts

import {
  vpcSecurityGroupIngressRule,
  secretsmanagerSecretRotation,
  secretsmanagerSecretVersion,
  securityGroup as securityGroupResource,
  serverlessapplicationrepositoryCloudformationStack,
  secretsmanagerSecretPolicy,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as ec2 from "../../../src/aws/compute";
import * as encryption from "../../../src/aws/encryption";
import { Template } from "../../assertions";

let app: App;
let stack: AwsStack;
let vpc: ec2.IVpc;
let secret: encryption.ISecret;
let securityGroup: ec2.SecurityGroup;
let target: ec2.Connections;
beforeEach(() => {
  app = Testing.app();
  // Snapshotted stacks must not use the default local backend -- it embeds a
  // machine-dependent absolute tfstate path in synth output. Repo pattern:
  // pass gridBackendConfig to the AwsStack constructor (see secret.test.ts).
  stack = new AwsStack(app, undefined, {
    gridBackendConfig: { address: "http://localhost:3000" },
  });
  vpc = new ec2.Vpc(stack, "VPC");
  secret = new encryption.Secret(stack, "Secret");
  securityGroup = new ec2.SecurityGroup(stack, "SecurityGroup", { vpc });
  target = new ec2.Connections({
    defaultPort: ec2.Port.tcp(3306),
    securityGroups: [securityGroup],
  });
});

test("secret rotation single user", () => {
  // GIVEN
  const excludeCharacters = " ;+%{}${}" + "@'\"`/\\#"; // DMS and BASH problem chars
  // `excludeCharacters` is free text written into a Terraform (JSON) resource argument, where
  // `${`/`%{` are template directives -- `%{}`/`${}` above must come out escaped as `%%{}`/`$${}`
  // or synthesis would emit invalid Terraform (see `escapeTerraformTemplateLiteral` in
  // src/aws/util.ts). Additionally, CloudFormation trims edge whitespace from stack parameter
  // values, so the leading space above must be moved inward (the value is a character set --
  // order is irrelevant) or the SAR stack parameter drifts on every post-apply plan
  // (live-verified by integ/aws/encryption TestSecretRotation's drift oracle).
  const expectedExcludeCharacters = "; +%{}${}@'\"`/\\#"
    .replace(/\$\{/g, "$$${")
    .replace(/%\{/g, "%%{");

  // WHEN
  new encryption.SecretRotation(stack, "SecretRotation", {
    application:
      encryption.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
    secret,
    target,
    vpc,
    excludeCharacters,
  });

  const template = new Template(stack, { snapshot: true });
  const synthesized = template.expect;

  // THEN
  // The rotation Lambda's security group is the source of the ingress rule on `target`'s
  // security group -- pins the rule to `allowDefaultPortFrom(securityGroup)`, distinguishing it
  // from `allowDefaultPortInternally()` or a CIDR-sourced rule.
  synthesized.toHaveResourceWithProperties(
    vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
    {
      ip_protocol: "tcp",
      from_port: 3306,
      to_port: 3306,
      security_group_id: stack.resolve(securityGroup.securityGroupId),
      referenced_security_group_id:
        "${aws_security_group.SecretRotation_SecurityGroup_9985012B.id}",
      description: "from SecretRotationSecurityGroupAEC520AB:3306",
    },
  );

  synthesized.toHaveResourceWithProperties(
    secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
    {
      secret_id: stack.resolve(secret.secretArn),
      rotation_lambda_arn:
        '${aws_serverlessapplicationrepository_cloudformation_stack.SecretRotation_A9FFCFA9.outputs["RotationLambdaARN"]}',
      rotation_rules: {
        schedule_expression: "rate(30 days)",
      },
    },
  );

  synthesized.toHaveResourceWithProperties(
    securityGroupResource.SecurityGroup,
    {
      description: "Default/SecretRotation/SecurityGroup",
    },
  );

  synthesized.toHaveResourceWithProperties(
    serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
    {
      application_id:
        "arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSMySQLRotationSingleUser",
      semantic_version: "1.1.618",
      capabilities: ["CAPABILITY_IAM", "CAPABILITY_RESOURCE_POLICY"],
      parameters: {
        endpoint: stack.resolve(
          `https://secretsmanager.${stack.region}.${stack.urlSuffix}`,
        ),
        functionName: "SecretRotation",
        excludeCharacters: expectedExcludeCharacters,
        vpcSecurityGroupIds:
          "${aws_security_group.SecretRotation_SecurityGroup_9985012B.id}",
        vpcSubnetIds:
          "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id},${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id},${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
      },
    },
  );

  // The emitted value must never contain a bare, unescaped `%{` or `${` -- either would make
  // the synthesized Terraform config unparseable (a stray template directive/interpolation).
  // Assert against the actual synthesized output (not the test-local `expectedExcludeCharacters`
  // computation) so a regression in `escapeTerraformTemplateLiteral` itself is caught here.
  const [sarApp]: any[] = template.resourceTypeArray(
    serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
  );
  expect(sarApp.parameters.excludeCharacters).toEqual(
    expectedExcludeCharacters,
  );
  expect(sarApp.parameters.excludeCharacters).not.toMatch(/(?<!%)%\{/);
  expect(sarApp.parameters.excludeCharacters).not.toMatch(/(?<!\$)\$\{/);
  // CloudFormation trims edge whitespace from stack parameter values on read-back, so the
  // construct must never emit it (perpetual drift otherwise -- see moveEdgeWhitespaceInward).
  expect(sarApp.parameters.excludeCharacters).toMatch(/^\S/);
  expect(sarApp.parameters.excludeCharacters).toMatch(/\S$/);

  synthesized.toHaveResourceWithProperties(
    secretsmanagerSecretPolicy.SecretsmanagerSecretPolicy,
    {
      secret_arn: stack.resolve(secret.secretArn),
    },
  );

  // Rotation is in place -> the rotated secret itself also gets a deny-delete resource policy
  // (RotationSchedule.denyAccountRootDelete()), tying the policy assertion above to the actual
  // Deny/secretsmanager:DeleteSecret statement rather than to any secret policy's mere existence.
  synthesized.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["secretsmanager:DeleteSecret"],
          effect: "Deny",
          principals: [
            {
              identifiers: [
                "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
              ],
              type: "AWS",
            },
          ],
          resources: ["*"],
        },
      ],
    },
  );
});

test("rotation ownership adds ignore_changes to the secret's initial version", () => {
  // WHEN
  new encryption.SecretRotation(stack, "SecretRotation", {
    application:
      encryption.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
    secret,
    target,
    vpc,
  });

  // THEN -- the rotation Lambda replaces AWSCURRENT out-of-band; without
  // ignore_changes the next apply would clobber the rotated credentials with
  // the stale Terraform-held initial value, and every post-apply plan would
  // report drift (live-verified by integ/aws/encryption TestSecretRotation's
  // drift oracle).
  const template = new Template(stack);
  const [version]: any[] = template.resourceTypeArray(
    secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
  );
  expect(version.lifecycle.ignore_changes).toEqual([
    "secret_string",
    "version_stages",
  ]);
});

test("secret without rotation keeps its version enforced (no ignore_changes)", () => {
  // GIVEN -- `secret` from beforeEach, no rotation attached
  const template = new Template(stack);

  // THEN
  const [version]: any[] = template.resourceTypeArray(
    secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
  );
  expect(version.lifecycle).toBeUndefined();
});

test("secret rotation multi user", () => {
  // GIVEN
  const masterSecret = new encryption.Secret(stack, "MasterSecret");

  // WHEN
  new encryption.SecretRotation(stack, "SecretRotation", {
    application: encryption.SecretRotationApplication.MYSQL_ROTATION_MULTI_USER,
    secret,
    masterSecret,
    target,
    vpc,
  });

  const synthesized = Template.synth(stack);

  // THEN
  synthesized.toHaveResourceWithProperties(
    serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
    {
      parameters: {
        endpoint: stack.resolve(
          `https://secretsmanager.${stack.region}.${stack.urlSuffix}`,
        ),
        functionName: "SecretRotation",
        masterSecretArn: stack.resolve(masterSecret.secretArn),
        vpcSecurityGroupIds:
          "${aws_security_group.SecretRotation_SecurityGroup_9985012B.id}",
        vpcSubnetIds:
          "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id},${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id},${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
      },
    },
  );

  // Rotation is in place -> the master secret gets a deny-delete resource policy
  synthesized.toHaveResourceWithProperties(
    secretsmanagerSecretPolicy.SecretsmanagerSecretPolicy,
    {
      secret_arn: stack.resolve(masterSecret.secretArn),
    },
  );
  synthesized.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["secretsmanager:DeleteSecret"],
          effect: "Deny",
          principals: [
            {
              identifiers: [
                "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
              ],
              type: "AWS",
            },
          ],
          resources: ["*"],
        },
      ],
    },
  );
});

test("secret rotation allows passing an empty string for excludeCharacters", () => {
  // WHEN
  new encryption.SecretRotation(stack, "SecretRotation", {
    application:
      encryption.SecretRotationApplication.MARIADB_ROTATION_SINGLE_USER,
    secret,
    target,
    vpc,
    excludeCharacters: "",
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
    {
      parameters: expect.objectContaining({
        excludeCharacters: "",
      }),
    },
  );
});

test("secret rotation without immediate rotation", () => {
  // WHEN
  new encryption.SecretRotation(stack, "SecretRotation", {
    application:
      encryption.SecretRotationApplication.MARIADB_ROTATION_SINGLE_USER,
    secret,
    target,
    vpc,
    rotateImmediatelyOnUpdate: false,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
    {
      rotate_immediately: false,
    },
  );
});

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

test("rotation function name does not exceed 64 chars", () => {
  // WHEN
  const id = "SecretRotation".repeat(5);
  new encryption.SecretRotation(stack, id, {
    application:
      encryption.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
    secret,
    target,
    vpc,
  });

  // THEN
  const synthesized = new Template(stack);
  const [sarApp]: any[] = synthesized.resourceTypeArray(
    serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
  );
  // TERRACONSTRUCTS DEVIATION: pinned to the exact middle-trimmed name -- see the
  // `rotationFunctionName` comment in src/aws/encryption/secret-rotation.ts. Upstream trims
  // `Names.uniqueId(this)` from the left instead, and asserts the exact resulting string
  // ('RotationSecretRotationSecretRotationSecretRotationSecretRotation'); this asserts the
  // TerraConstructs equivalent so a change to the hashing/separator/trim strategy is caught.
  expect(sarApp.parameters.functionName).toEqual(
    "SecretRotationSecretRotationSecretRotationSecretRotationE64944E4",
  );
  expect(sarApp.name).toEqual(
    "SecretRotationSecretRotationSecretRotationSecretRotationE64944E4",
  );
  expect(sarApp.parameters.functionName.length).toBeLessThanOrEqual(64);
  expect(sarApp.name.length).toBeLessThanOrEqual(64);
});

test("with interface vpc endpoint", () => {
  // GIVEN
  const endpoint = new ec2.InterfaceVpcEndpoint(
    stack,
    "SecretsManagerEndpoint",
    {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      vpc,
    },
  );

  // WHEN
  new encryption.SecretRotation(stack, "SecretRotation", {
    application:
      encryption.SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER,
    secret,
    target,
    vpc,
    endpoint,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
    {
      parameters: expect.objectContaining({
        endpoint: stack.resolve(
          `https://${endpoint.vpcEndpointId}.secretsmanager.${stack.region}.${stack.urlSuffix}`,
        ),
        vpcSecurityGroupIds:
          "${aws_security_group.SecretRotation_SecurityGroup_9985012B.id}",
        vpcSubnetIds:
          "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id},${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id},${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
      }),
    },
  );
});
