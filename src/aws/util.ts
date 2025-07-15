// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/util.ts

import { snakeCase } from "change-case";

/**
 * Returns a copy of `obj` without `undefined` (or `null`) values in maps or arrays.
 */
export function filterUndefined(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.filter((x) => x != null).map((x) => filterUndefined(x));
  }

  if (typeof obj === "object") {
    const ret: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) {
        continue;
      }
      ret[key] = filterUndefined(value);
    }
    return ret;
  }

  return obj;
}

export function toTerraformIdentifier(identifier: string): string {
  return snakeCase(identifier).replace(/-/g, "_");
}
