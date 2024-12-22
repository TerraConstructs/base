// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-kms/lib/key-lookup.ts

/**
 * Properties for looking up an existing Key with Terraform data source.
 */
export interface KeyLookupOptions {
  /**
   * The alias name of the Key
   *
   * Must be in the format `alias/<AliasName>`.
   */
  readonly aliasName: string;
}
