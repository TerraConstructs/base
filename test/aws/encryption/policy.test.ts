// https://github.com/aws/aws-cdk/blob/v2.261.0/packages/aws-cdk-lib/aws-secretsmanager/test/policy.test.ts

import { secretsmanagerSecretPolicy } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as encryption from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import { Template } from "../../assertions";

describe("Secret Target Attachment Resource Policy", () => {
  const environmentName = "Test";
  const gridUUID = "a123e4567-e89b-12d3";
  const providerConfig = { region: "us-east-1" };
  const gridBackendConfig = {
    address: "http://localhost:3000",
  };

  // TerraConstructs has no separate CloudFormation-style
  // `AWS::SecretsManager::SecretTargetAttachment` resource: attaching a
  // secret to a target does not create a distinct Terraform resource, and
  // `addToResourcePolicy` calls on the attachment are forwarded to the
  // original secret. This mirrors the upstream aws-cdk behavior gated behind
  // the `SECRETS_MANAGER_TARGET_ATTACHMENT_RESOURCE_POLICY` feature flag
  // (which is always "on" here): granting read on both the secret and its
  // attachment results in a single resource policy on the main secret.
  test("attaching a secret and granting read on both secret and attachment creates one policy", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    const secret = new encryption.Secret(stack, "Secret");
    const servicePrincipalOne = new iam.ServicePrincipal(
      "some-service-a.amazonaws.com",
    );
    const servicePrincipalTwo = new iam.ServicePrincipal(
      "some-service-b.amazonaws.com",
    );
    const secretAttachment = secret.attach({
      asSecretAttachmentTarget: () => ({
        targetId: "mock-id",
        targetType: encryption.AttachmentTargetType.RDS_DB_INSTANCE,
      }),
    });

    // WHEN
    secret.grantRead(servicePrincipalOne);
    secretAttachment.grantRead(servicePrincipalTwo);

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(
      secretsmanagerSecretPolicy.SecretsmanagerSecretPolicy,
      1,
    );
  });
});
