// https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/token.ts

import { Token } from "cdktf";

/**
 * An enum-like class that represents the result of comparing two Tokens.
 * The return type of `Token.compareStrings`.
 */
export class TokenComparison {
  /**
   * This means we're certain the two components are NOT
   * Tokens, and identical.
   */
  public static readonly SAME = new TokenComparison();

  /**
   * This means we're certain the two components are NOT
   * Tokens, and different.
   */
  public static readonly DIFFERENT = new TokenComparison();

  /** This means exactly one of the components is a Token. */
  public static readonly ONE_UNRESOLVED = new TokenComparison();

  /** This means both components are Tokens. */
  public static readonly BOTH_UNRESOLVED = new TokenComparison();

  private constructor() {}
}

/** Compare two strings that might contain Tokens with each other. */
export function tokenCompareStrings(
  possibleToken1: string,
  possibleToken2: string,
): TokenComparison {
  const firstIsUnresolved = Token.isUnresolved(possibleToken1);
  const secondIsUnresolved = Token.isUnresolved(possibleToken2);

  if (firstIsUnresolved && secondIsUnresolved) {
    return TokenComparison.BOTH_UNRESOLVED;
  }
  if (firstIsUnresolved || secondIsUnresolved) {
    return TokenComparison.ONE_UNRESOLVED;
  }

  return possibleToken1 === possibleToken2
    ? TokenComparison.SAME
    : TokenComparison.DIFFERENT;
}

/**
 * Call the given function only if all given values are resolved
 *
 * Exported as a function since it will be used by TypeScript modules, but
 * can't be exposed via JSII because of the generics.
 */
export function withResolved<A>(a: A, fn: (a: A) => void): void;
export function withResolved<A, B>(a: A, b: B, fn: (a: A, b: B) => void): void;
export function withResolved<A, B, C>(
  a: A,
  b: B,
  c: C,
  fn: (a: A, b: B, c: C) => void,
): void;
export function withResolved(...args: any[]) {
  if (args.length < 2) {
    return;
  }
  const argArray = args.slice(0, args.length - 1);
  if (argArray.some(Token.isUnresolved)) {
    return;
  }
  args[args.length - 1].apply(arguments, argArray);
}
