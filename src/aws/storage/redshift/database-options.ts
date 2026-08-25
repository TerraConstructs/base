// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/database-options.ts

import type { ICluster } from "./cluster";
import type * as secretsmanager from "../../encryption";

/**
 * Properties for accessing a Redshift database
 */
export interface DatabaseOptions {
  /**
   * The cluster containing the database.
   */
  readonly cluster: ICluster;

  /**
   * The name of the database.
   */
  readonly databaseName: string;

  /**
   * The secret containing credentials to a Redshift user with administrator privileges.
   *
   * Secret JSON schema: `{ username: string; password: string }`.
   *
   * @default - the admin secret is taken from the cluster
   */
  readonly adminUser?: secretsmanager.ISecret;
}
