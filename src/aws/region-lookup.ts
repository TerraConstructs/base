// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/core/lib/private/region-lookup.ts

import { RegionInfo } from "@aws-cdk/region-info";
import { Fn, TerraformLocal } from "cdktf";
import * as cxapi from "./cx-api";
import { AwsStack } from "../aws/aws-stack";
import { UnscopedValidationError } from "../errors";

type Mapping = { [k1: string]: { [k2: string]: any } };

const Aws = {
  URL_SUFFIX: "AWS::URLSuffix",
  REGION: "AWS::Region",
};

/**
 * Make sure a Terraform Local Block (to mimic a CloudFormation Mapping) exists
 * in the given stack with the lookup values for the given fact
 *
 * Add to an existing Terraform Local Block if possible.
 */
export function deployTimeLookup(
  stack: AwsStack,
  factName: string,
  lookupMap: Record<string, string>,
  defaultValue?: string,
) {
  // If there are no lookups, just return the default
  if (Object.values(lookupMap).length === 0) {
    if (defaultValue === undefined) {
      throw new UnscopedValidationError(
        `region-info: don't have any information for ${factName}. Use 'Fact.register' to provide values, or add partitions to the '${cxapi.TARGET_PARTITIONS}' context value.`,
      );
    }
    return defaultValue;
  }

  // If the tokenized representation of all values is the same, we can just
  // return the value directly and don't need to produce an actual map.
  const pattern = findValuePattern(lookupMap);
  if (pattern !== undefined) {
    return (
      pattern
        // Replace AWS pseudo parameters with Terraform tokens
        .replace(Aws.REGION, stack.region)
        .replace(Aws.URL_SUFFIX, stack.urlSuffix)
    );
  }

  // Derive map name and lookup key from the factName, splitting on ':' if it exists
  const [factClass, factParam] = factName.includes(":")
    ? factName.split(":")
    : ([factName, "value"] as const);

  const mapId = `${ucfirst(factClass)}Map`;
  const factKey = factParam.replace(/[^a-zA-Z0-9]/g, "x");

  let mapping = stack.node.tryFindChild(mapId) as TerraformLocal | undefined;
  if (!mapping) {
    mapping = new TerraformLocal(stack, mapId, {});
  }
  const temp: Mapping = {};
  for (const [region, value] of Object.entries(lookupMap)) {
    temp[region] = {
      [factKey]: value,
    };
  }
  mapping.expression = temp;
  return Fn.lookup(Fn.lookup(mapping.asStringMap, stack.region), factKey);
}

function ucfirst(x: string) {
  return `${x.slice(0, 1).toUpperCase()}${x.slice(1)}`;
}

/**
 * Try to detect if all values in the map follow the same pattern
 *
 * Do this by replacing region and URLSuffix values in the found strings
 * with their token variant. If at the end all strings have the same format,
 * we can simplify to just the single value.
 *
 * This wouldn't have been necessary if the region-info library had encoded the
 * pattern information instead of the literal values... but let's do it here now.
 */
function findValuePattern(
  regionMap: Record<string, string>,
): string | undefined {
  const simplified: Record<string, string> = { ...regionMap };

  // If they all contain URL_SUFFIX, substitute it, but only if the value is different
  // among some values in the list (we don't want to tokenize unnecessarily, i.e. we don't
  // want to replace `amazonaws.com` with URL_SUFFIX if it's not necessary)
  const urlSuffixes = Object.keys(simplified).map(urlSuffix);
  if (
    !allSame(urlSuffixes) &&
    Object.entries(simplified).every(([region, value]) =>
      value.includes(urlSuffix(region)),
    )
  ) {
    for (const region in simplified) {
      simplified[region] = replaceAll(
        simplified[region],
        urlSuffix(region),
        Aws.URL_SUFFIX,
      );
    }
  }

  // If they all contain REGION, substitute it (no need to do the "is everything different"
  // check, this is true by design for these values)
  if (
    Object.entries(simplified).every(([region, value]) =>
      value.includes(region),
    )
  ) {
    for (const region in simplified) {
      simplified[region] = replaceAll(simplified[region], region, Aws.REGION);
    }
  }

  // If the values are now all the same, return the singleton value
  const values = Object.values(simplified);
  if (allSame(values)) {
    return values[0];
  }

  // Otherwise we failed
  return undefined;
}

function allSame(xs: string[]) {
  return xs.every((x) => x === xs[0]);
}

function urlSuffix(region: string) {
  return RegionInfo.get(region)?.domainSuffix ?? "amazonaws.com";
}

function replaceAll(x: string, pat: string, replacement: string) {
  return x.split(pat).join(replacement);
}
