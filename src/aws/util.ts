// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/util.ts

import { Token } from "cdktn";
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

/**
 * Escapes literal `${` and `%{` sequences in free-text values so they are
 * emitted as literal text rather than being interpreted as Terraform
 * interpolation (`${...}`) or template directive (`%{...}`) sequences.
 *
 * Every string argument value in a Terraform (HCL or JSON) configuration is
 * evaluated as a string template, so caller-supplied free text (e.g. a
 * `excludeCharacters` character set that legitimately contains `%{}`) must be
 * escaped before being written into a resource argument, or synthesis
 * produces invalid Terraform. Tokens (unresolved CDKTN references) are left
 * untouched -- they are not free text and must keep interpolating normally.
 *
 * @see src/aws/edge/function.ts for the equivalent treatment of `${` in
 * inline Lambda@Edge function code.
 */
export function escapeTerraformTemplateLiteral(value: string): string {
  if (Token.isUnresolved(value)) {
    return value;
  }
  return value.replace(/\$\{/g, "$$${").replace(/%\{/g, "%%{");
}
