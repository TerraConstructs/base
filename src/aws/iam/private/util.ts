import {
  IPostProcessor,
  IResolvable,
  IResolveContext,
  Lazy,
  Token,
} from "cdktn";
import { IPolicy } from "../policy";

export const MAX_POLICY_NAME_LEN = 128;

export function undefinedIfEmpty(f: () => string[]): string[] {
  return Lazy.listValue({
    produce: () => {
      const array = f();
      return array && array.length > 0 ? array : undefined;
    },
  });
}

/**
 * Helper class that maintains the set of attached policies for a principal.
 */
export class AttachedPolicies {
  private policies = new Array<IPolicy>();

  /**
   * Adds a policy to the list of attached policies.
   *
   * If this policy is already, attached, returns false.
   * If there is another policy attached with the same name, throws an exception.
   */
  public attach(policy: IPolicy) {
    if (this.policies.find((p) => p === policy)) {
      return; // already attached
    }

    if (this.policies.find((p) => p.policyName === policy.policyName)) {
      throw new Error(
        `A policy named "${policy.policyName}" is already attached`,
      );
    }

    this.policies.push(policy);
  }
}

/**
 * Lazy string set token that dedupes entries
 *
 * Needs to operate post-resolve, because the inputs could be
 * `[ '${Token[TOKEN.9]}', '${Token[TOKEN.10]}', '${Token[TOKEN.20]}' ]`, which
 * still all resolve to the same string value.
 *
 * Needs to JSON.stringify() results because strings could resolve to literal
 * strings but could also resolve to `${index(...)}`.
 */
export class UniqueStringSet implements IResolvable, IPostProcessor {
  public static from(fn: () => string[]) {
    return Token.asList(new UniqueStringSet(fn));
  }

  public readonly creationStack: string[];

  private constructor(private readonly fn: () => string[]) {
    // TODO: Implement stack traces
    // ref: https://github.com/hashicorp/terraform-cdk/blob/v0.20.7/packages/cdktf/lib/app.ts#L111
    // ref: https://github.com/hashicorp/terraform-cdk/blob/v0.20.9/packages/cdktf/lib/tokens/private/stack-trace.ts#L9
    // ref: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/core/lib/stack-trace.ts#L22
    this.creationStack = ["stack traces disabled"];
  }

  public resolve(context: IResolveContext) {
    context.registerPostProcessor(this);
    return this.fn();
  }

  public postProcess(input: any, _context: IResolveContext) {
    if (!Array.isArray(input)) {
      return input;
    }
    if (input.length === 0) {
      return undefined;
    }

    const uniq: Record<string, any> = {};
    for (const el of input) {
      uniq[JSON.stringify(el)] = el;
    }
    return Object.values(uniq);
  }

  public toString(): string {
    return Token.asString(this);
  }
}

export function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
