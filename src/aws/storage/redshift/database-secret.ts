// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/database-secret.ts

import type { Construct } from "constructs";
import { Duration } from "../../../duration";
import * as secretsmanager from "../../encryption";
import type { IKey } from "../../encryption";

/**
 * Construction properties for a DatabaseSecret.
 */
export interface DatabaseSecretProps {
  /**
   * The username.
   */
  readonly username: string;

  /**
   * The KMS key to use to encrypt the secret.
   *
   * @default default master key
   */
  readonly encryptionKey?: IKey;

  /**
   * Characters to not include in the generated password.
   *
   * @default '"@/\\\ \''
   */
  readonly excludeCharacters?: string;

  /**
   * The number of days that Secrets Manager waits before it can delete the secret.
   *
   * TERRACONSTRUCTS DEVIATION: not present upstream (CloudFormation deletes secrets immediately
   * on stack delete; deletion recovery is a Terraform-provider concept,
   * `recovery_window_in_days`). Exposed as a pass-through to `encryption.SecretProps.recoveryWindow`
   * so deterministic secret names can be re-created promptly (e.g. integ fixtures use
   * `Duration.days(0)`). Mirrors the identical deviation on `../rds/database-secret.ts`
   * (`../docdb/database-secret.ts` does not expose it, since upstream aws-docdb's `DatabaseSecret`
   * has no `replaceOnPasswordCriteriaChanges`-adjacent lifecycle concerns tying into it either --
   * same as here).
   *
   * @default - AWS default of 30 days
   */
  readonly recoveryWindow?: Duration;
}

/**
 * A database secret.
 *
 * @resource aws_secretsmanager_secret
 */
export class DatabaseSecret extends secretsmanager.Secret {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.redshift.DatabaseSecret";

  constructor(scope: Construct, id: string, props: DatabaseSecretProps) {
    super(scope, id, {
      encryptionKey: props.encryptionKey,
      generateSecretString: {
        passwordLength: 30, // Redshift password could be up to 64 characters
        secretStringTemplate: JSON.stringify({ username: props.username }),
        generateStringKey: "password",
        excludeCharacters: props.excludeCharacters ?? "\"@/\\ '",
      },
      // TERRACONSTRUCTS DEVIATION: see the `recoveryWindow` prop note above.
      recoveryWindow: props.recoveryWindow,
    });
  }
}
