// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/warm-pool.test.ts

import { autoscalingGroup } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import {
  AmazonLinuxImage,
  InstanceClass,
  InstanceSize,
  InstanceType,
  Vpc,
} from "../../../../src/aws/compute";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import { Template } from "../../../assertions";

describe("warm pool", () => {
  test("we can add a warm pool without properties", () => {
    // GIVEN
    const stack = newStack();
    const asg = newASG(stack);

    // WHEN
    asg.addWarmPool();

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingGroup.AutoscalingGroup,
      {
        warm_pool: {},
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::WarmPool', {
    //   AutoScalingGroupName: {
    //     Ref: 'ASG46ED3070',
    //   },
    // });
  });

  test("we can add a warm pool with all optional properties", () => {
    // GIVEN
    const stack = newStack();
    const asg = newASG(stack);

    // WHEN
    asg.addWarmPool({
      reuseOnScaleIn: true,
      maxGroupPreparedCapacity: 5,
      minSize: 2,
      poolState: autoscaling.PoolState.HIBERNATED,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingGroup.AutoscalingGroup,
      {
        warm_pool: {
          instance_reuse_policy: {
            reuse_on_scale_in: true,
          },
          max_group_prepared_capacity: 5,
          min_size: 2,
          pool_state: "Hibernated",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::WarmPool', {
    //   AutoScalingGroupName: {
    //     Ref: 'ASG46ED3070',
    //   },
    //   InstanceReusePolicy: {
    //     ReuseOnScaleIn: true,
    //   },
    //   MaxGroupPreparedCapacity: 5,
    //   MinSize: 2,
    //   PoolState: 'Hibernated',
    // });
  });
});

test("adding a warm pool with maxGroupPreparedCapacity smaller than -1 throws an error", () => {
  // GIVEN
  const stack = newStack();
  const asg = newASG(stack);

  // WHEN
  expect(() => {
    asg.addWarmPool({
      maxGroupPreparedCapacity: -42,
    });
  }).toThrow(
    /'maxGroupPreparedCapacity' parameter should be greater than or equal to -1/,
  );
});

test("adding a warm pool with negative minSize throws an error", () => {
  // GIVEN
  const stack = newStack();
  const asg = newASG(stack);

  // WHEN
  expect(() => {
    asg.addWarmPool({
      minSize: -1,
    });
  }).toThrow(/'minSize' parameter should be greater than or equal to 0/);
});

function newStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app);
}

function newASG(stack: AwsStack) {
  const vpc = new Vpc(stack, "VPC");

  return new autoscaling.AutoScalingGroup(stack, "ASG", {
    vpc,
    instanceType: InstanceType.of(InstanceClass.M4, InstanceSize.MICRO),
    machineImage: new AmazonLinuxImage(),
  });
}

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/scalable-target.test.ts
// for the harness idiom) - guards against emitted-Terraform drift for the
// warm_pool block that WarmPool merges into the owning AutoscalingGroup.
describe("WarmPool", () => {
  test("Should synth and match SnapShot with no optional properties", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    const asg = newASG(stack);

    // WHEN
    asg.addWarmPool();

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with all optional properties", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    const asg = newASG(stack);

    // WHEN
    asg.addWarmPool({
      reuseOnScaleIn: true,
      maxGroupPreparedCapacity: 5,
      minSize: 2,
      poolState: autoscaling.PoolState.HIBERNATED,
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
