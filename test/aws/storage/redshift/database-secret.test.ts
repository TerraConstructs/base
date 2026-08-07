// upstream @aws-cdk/aws-redshift-alpha has no dedicated `test/database-secret.test.ts` (its
// `DatabaseSecret` is exercised only indirectly, via cluster.test.ts fixtures). This file mirrors
// the sibling `../rds/database-secret.test.ts` port style (itself from
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/database-secret.test.ts),
// scoped down to the props `redshift.DatabaseSecret` actually accepts (username, encryptionKey,
// excludeCharacters, recoveryWindow — no dbname/secretName/masterSecret/
// replaceOnPasswordCriteriaChanges, none of which exist on upstream redshift-alpha's
// `DatabaseSecretProps`).

import {
  dataAwsSecretsmanagerRandomPassword,
  secretsmanagerSecret,
  secretsmanagerSecretVersion,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import { DatabaseSecret } from "../../../../src/aws/storage/redshift";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let app: App;
let stack: AwsStack;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

describe("database secret", () => {
  test("create a database secret", () => {
    // WHEN
    new DatabaseSecret(stack, "Secret", {
      username: "admin-username",
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecret.SecretsmanagerSecret,
      {},
    );
    // TERRACONSTRUCTS DEVIATION: the Terraform `aws_secretsmanager_secret`
    // resource has no CFN-style `GenerateSecretString` block -- the
    // generated password comes from a `data.aws_secretsmanager_random_password`
    // data source instead, merged into the secret's `secret_string` via
    // `jsonencode()`. See `src/aws/encryption/secret.ts`.
    t.expect.toHaveDataSourceWithProperties(
      dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
      {
        password_length: 30,
        exclude_characters: "\"@/\\ '",
      },
    );
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
      {
        secret_string: expect.stringMatching(
          /^\$\{jsonencode\(\{"username" = "admin-username", "password" = data\.aws_secretsmanager_random_password\.Secret_RandomPassword_[0-9A-F]+\.random_password\}\)\}$/,
        ),
      },
    );
  });

  test("custom excludeCharacters", () => {
    // WHEN
    new DatabaseSecret(stack, "Secret", {
      username: "admin-username",
      excludeCharacters: '"@/\\',
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
      {
        exclude_characters: '"@/\\',
      },
    );
  });

  test("recoveryWindow is passed through", () => {
    // WHEN
    new DatabaseSecret(stack, "Secret", {
      username: "admin-username",
      recoveryWindow: Duration.days(0),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecret.SecretsmanagerSecret,
      {
        recovery_window_in_days: 0,
      },
    );
  });
});
