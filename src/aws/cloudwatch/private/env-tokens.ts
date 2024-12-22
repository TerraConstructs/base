// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-cloudwatch/lib/private/env-tokens.ts

import { Token, IResolvable, IResolveContext } from "cdktf";
import { AwsSpec } from "../../";

/**
 * Make a Token that renders to given region if used in a different stack, otherwise undefined
 */
export function regionIfDifferentFromStack(region: string): string {
  return Token.asString(
    new StackDependentToken(region, (stack) => stack.region),
  );
}

/**
 * Make a Token that renders to given account if used in a different stack, otherwise undefined
 */
export function accountIfDifferentFromStack(account: string): string {
  return Token.asString(
    new StackDependentToken(account, (stack) => stack.account),
  );
}

/**
 * A lazy token that requires an instance of Stack to evaluate
 */
class StackDependentToken implements IResolvable {
  public readonly creationStack: string[];
  constructor(
    private readonly originalValue: string,
    private readonly fn: (stack: AwsSpec) => string,
  ) {
    // TODO: Implement stack traces
    // ref: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/core/lib/stack-trace.ts#L22
    this.creationStack = ["stack traces disabled"];
  }

  public resolve(context: IResolveContext) {
    const stackValue = this.fn(AwsSpec.ofAwsBeacon(context.scope));

    // Don't render if the values are definitely the same. If the stack
    // is unresolved we don't know, better output the value.
    if (!Token.isUnresolved(stackValue) && stackValue === this.originalValue) {
      return undefined;
    }

    return this.originalValue;
  }

  public toString() {
    return Token.asString(this);
  }

  public toJSON() {
    return this.originalValue;
  }
}
