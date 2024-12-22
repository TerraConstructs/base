// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-cloudwatch/lib/private/drop-empty-object-at-the-end-of-an-array-token.ts

import { IResolvable, IResolveContext, IPostProcessor } from "cdktf";
import { dropUndefined } from "./object";

/**
 * A Token object that will drop the last element of an array if it is an empty object
 *
 * Necessary to prevent options objects that only contain "region" and "account" keys
 * that evaluate to "undefined" from showing up in the rendered JSON.
 */
export class DropEmptyObjectAtTheEndOfAnArray
  implements IResolvable, IPostProcessor
{
  public readonly creationStack: string[];

  constructor(private readonly value: any) {
    // TODO: Implement stack traces
    // ref: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/core/lib/stack-trace.ts#L22
    this.creationStack = ["stack traces disabled"];
  }

  public resolve(context: IResolveContext) {
    context.registerPostProcessor(this);
    return context.resolve(this.value);
  }

  public postProcess(o: any, _context: IResolveContext): any {
    if (!Array.isArray(o)) {
      return o;
    }

    const lastEl = o[o.length - 1];

    if (
      typeof lastEl === "object" &&
      lastEl !== null &&
      Object.keys(dropUndefined(lastEl)).length === 0
    ) {
      return o.slice(0, o.length - 1);
    }

    return o;
  }
}
