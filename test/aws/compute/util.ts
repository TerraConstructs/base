// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-applicationautoscaling/test/util.ts

import {
  appautoscalingTarget,
  appautoscalingPolicy,
} from "@cdktf/provider-aws";
import * as constructs from "constructs";
import * as fc from "fast-check";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as appscaling from "../../../src/aws/compute";
import * as scalingcommon from "../../../src/aws/compute/autoscaling-common";

// Helper function from the original test suite, adapted for AwsStack
export function createScalableTarget(stack: AwsStack) {
  return new appscaling.ScalableTarget(stack, "Target", {
    serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
    scalableDimension: "test:TestCount",
    resourceId: "test:this/test",
    minCapacity: 1,
    maxCapacity: 20,
  });
}

export class ArbitraryInputIntervals extends fc.Arbitrary<
  appscaling.ScalingInterval[]
> {
  public generate(mrng: fc.Random): fc.Value<appscaling.ScalingInterval[]> {
    const ret = scalingcommon.generateArbitraryIntervals(mrng);
    return new fc.Value(ret.intervals, {});
  }

  public canShrinkWithoutContext(
    _value: unknown,
  ): _value is appscaling.ScalingInterval[] {
    return false;
  }

  public shrink(
    _value: appscaling.ScalingInterval[],
    _context: unknown,
  ): fc.Stream<fc.Value<appscaling.ScalingInterval[]>> {
    return fc.Stream.nil();
  }
}

export function arbitrary_input_intervals() {
  return new ArbitraryInputIntervals();
}
