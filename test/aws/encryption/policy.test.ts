// https://github.com/aws/aws-cdk/blob/v2.261.0/packages/aws-cdk-lib/aws-secretsmanager/test/policy.test.ts

import { secretsmanagerSecretPolicy } from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
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

  // NOTE: run-3 (v2.233 breadth) also carried a `test.skip` here exercising the same
  // "attach() + addToResourcePolicy on both the secret and the attachment forwards to a single
  // policy" scenario through a `MockAttachmentTarget` that supplies `connectionFields`. It isn't
  // ported: under the combined `attach()` design (see `SecretTargetAttachment` in
  // `src/aws/encryption/secret.ts`), attaching a target with `connectionFields` to a default
  // `Secret` (a scalar generated password) throws `ValidationError` (`_attachConnectionFields`
  // requires a JSON-object base) rather than reproducing the skipped test's scenario, and the
  // "connectionFields forwarding + single policy" combination it was trying to reach is already
  // covered by the `describe("attachment")` block in `secret.test.ts`
  // ("addToResourcePolicy on the attachment forwards to the original secret (single policy)").
});

// Repo-specific snapshot coverage (see conventions.md "Test-suite conventions": snapshots are the
// repo's main defense against emitted-Terraform drift).
describe("ResourcePolicy", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });
    const secret = new encryption.Secret(stack, "Secret");

    // WHEN
    new encryption.ResourcePolicy(stack, "Policy", { secret });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
