import { Construct } from "constructs";
import { Alias, AliasOptions } from "./function-alias";
import { IFunction } from "./function-base";
// import { IVersion } from "./function-version";

export function addAlias(
  scope: Construct,
  lambda: IFunction,
  version: string,
  aliasName: string,
  options: AliasOptions = {},
) {
  return new Alias(scope, `Alias${aliasName}`, {
    aliasName,
    version,
    function: lambda,
    ...options,
  });
}

/**
 * Map a function over an array and concatenate the results
 */
export function flatMap<T, U>(xs: T[], fn: (x: T, i: number) => U[]): U[] {
  return flatten(xs.map(fn));
}

/**
 * Flatten a list of lists into a list of elements
 */
export function flatten<A>(xs: A[][]): A[] {
  return Array.prototype.concat.apply([], xs);
}
