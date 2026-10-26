// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/lib/custom-resource-provider/custom-resource-provider.ts

import { FactName } from "@aws-cdk/region-info";
import { Construct } from "constructs";
import { AwsStack } from "./aws-stack";

/**
 * The name of the latest Lambda node runtime available by AWS region.
 *
 * Upstream v2.233.0 falls back to `nodejs18.x` for regions without the fact;
 * this uses the v2.263.0 fallback (`nodejs24.x`) since `nodejs18.x` is a
 * deprecated Lambda runtime.
 *
 * @internal
 *
 * Upstream exports this from `custom-resource-provider.ts`; TerraConstructs
 * keeps it in this module, which is not exported from the package barrel, so
 * it stays internal (used by providers that extend
 * `CustomResourceProviderBase`).
 */
export function determineLatestNodeRuntimeName(scope: Construct): string {
  // TERRACONSTRUCTS DEVIATION: fallback is `nodejs24.x` (upstream v2.233.0: `nodejs18.x`).
  return AwsStack.ofAwsConstruct(scope).regionalFact(
    FactName.LATEST_NODE_RUNTIME,
    "nodejs24.x",
  );
}
