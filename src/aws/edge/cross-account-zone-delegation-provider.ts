// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk/custom-resource-handlers/lib/custom-resources-framework/classes.ts
// (generated upstream as `custom-resource-handlers/dist/aws-route53/cross-account-zone-delegation-provider.generated.ts`)

import * as path from "path";
import { Construct } from "constructs";
import { AwsStack } from "../aws-stack";
import { CustomResourceProviderBase } from "../custom-resource-provider-base";
import { determineLatestNodeRuntimeName } from "../custom-resource-provider-runtime";
import { CustomResourceProviderOptions } from "../custom-resource-provider-shared";

/**
 * Custom resource provider backing `CrossAccountZoneDelegationRecord`.
 *
 * Hand-written equivalent of the provider class aws-cdk generates for
 * `aws-route53/cross-account-zone-delegation-provider`. The handler code is
 * the vendored, pre-transpiled upstream handler under
 * `src/aws/custom-resource-handlers/aws-route53/cross-account-zone-delegation-handler`
 * (copied into `lib/` by the compile task).
 *
 * Not exported from the package barrel (upstream only exports it from the
 * private `custom-resource-handlers/dist` module).
 *
 * @internal
 */
export class CrossAccountZoneDelegationProvider extends CustomResourceProviderBase {
  /**
   * Returns a stack-level singleton ARN (service token) for the custom resource provider.
   */
  public static getOrCreate(
    scope: Construct,
    uniqueid: string,
    props?: CustomResourceProviderOptions,
  ): string {
    return this.getOrCreateProvider(scope, uniqueid, props).serviceToken;
  }

  /**
   * Returns a stack-level singleton for the custom resource provider.
   */
  public static getOrCreateProvider(
    scope: Construct,
    uniqueid: string,
    props?: CustomResourceProviderOptions,
  ): CrossAccountZoneDelegationProvider {
    const id = `${uniqueid}CustomResourceProvider`;
    const stack = AwsStack.ofAwsConstruct(scope);
    const existing = stack.node.tryFindChild(id) as
      | CrossAccountZoneDelegationProvider
      | undefined;
    return existing ?? new CrossAccountZoneDelegationProvider(stack, id, props);
  }

  private constructor(
    scope: Construct,
    id: string,
    props?: CustomResourceProviderOptions,
  ) {
    super(scope, id, {
      ...props,
      codeDirectory: path.join(
        __dirname,
        "..",
        "custom-resource-handlers",
        "aws-route53",
        "cross-account-zone-delegation-handler",
      ),
      runtimeName: determineLatestNodeRuntimeName(scope),
    });
    this.node.addMetadata(
      "aws:cdk:is-custom-resource-handler-customResourceProvider",
      true,
    );
  }
}
