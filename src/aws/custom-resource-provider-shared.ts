// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/lib/custom-resource-provider/shared.ts

import { Duration } from "../duration";
import { Size } from "../size";

// NOTE: upstream's `INLINE_CUSTOM_RESOURCE_CONTEXT`
// (`@aws-cdk/core:inlineCustomResourceIfPossible`) is not ported: the
// Terraform `aws_lambda_function` resource has no inline `ZipFile` code mode,
// so the provider code is always shipped as a zip asset.

/**
 * Initialization options for custom resource providers
 */
export interface CustomResourceProviderOptions {
  /**
   * Whether or not the cloudformation response wrapper (`nodejs-entrypoint.ts`) is used.
   * If set to `true`, `nodejs-entrypoint.js` is bundled in the same asset as the custom resource
   * and set as the entrypoint. If set to `false`, the custom resource provided is the
   * entrypoint.
   *
   * @default true
   */
  readonly useCfnResponseWrapper?: boolean;

  /**
   * A set of IAM policy statements to include in the inline policy of the
   * provider's lambda function.
   *
   * **Please note**: these are direct IAM JSON policy blobs, *not* `iam.PolicyStatement`
   * objects like you will see in the rest of the CDK.
   *
   * @default - no additional inline policy
   *
   * @example
   * const provider = CustomResourceProvider.getOrCreateProvider(this, 'Custom::MyCustomResourceType', {
   *   codeDirectory: `${__dirname}/my-handler`,
   *   runtime: CustomResourceProviderRuntime.NODEJS_22_X,
   *   policyStatements: [
   *     {
   *       Effect: 'Allow',
   *       Action: 's3:PutObject*',
   *       Resource: '*',
   *     }
   *   ],
   * });
   */
  readonly policyStatements?: any[];

  /**
   * AWS Lambda timeout for the provider.
   *
   * @default Duration.minutes(15)
   */
  readonly timeout?: Duration;

  /**
   * The amount of memory that your function has access to. Increasing the
   * function's memory also increases its CPU allocation.
   *
   * @default Size.mebibytes(128)
   */
  readonly memorySize?: Size;

  /**
   * Key-value pairs that are passed to Lambda as Environment
   *
   * @default - No environment variables.
   */
  readonly environment?: { [key: string]: string };

  /**
   * A description of the function.
   *
   * @default - No description.
   */
  readonly description?: string;
}
