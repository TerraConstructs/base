// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/scheduling-policy.test.ts

import { batchSchedulingPolicy } from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import { batch } from "../../../../src/aws/compute";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("empty fairshare policy", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy");

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchSchedulingPolicy.BatchSchedulingPolicy,
    {
      fair_share_policy: {
        share_distribution: [],
      },
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::SchedulingPolicy', {
  //   FairsharePolicy: {
  //     ShareDistribution: [],
  //   },
  // });
});

test("fairshare policy respects computeReservation", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy", {
    computeReservation: 75,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchSchedulingPolicy.BatchSchedulingPolicy,
    {
      fair_share_policy: {
        compute_reservation: 75,
        share_distribution: [],
      },
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::SchedulingPolicy', {
  //   FairsharePolicy: {
  //     ComputeReservation: 75,
  //     ShareDistribution: [],
  //   },
  // });
});

test("fairshare policy respects name", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy", {
    schedulingPolicyName: "FairsharePolicyName",
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchSchedulingPolicy.BatchSchedulingPolicy,
    {
      name: "FairsharePolicyName",
      fair_share_policy: {
        share_distribution: [],
      },
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::SchedulingPolicy', {
  //   Name: 'FairsharePolicyName',
  //   FairsharePolicy: {
  //     ShareDistribution: [],
  //   },
  // });
});

test("fairshare policy respects shareDecay", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy", {
    shareDecay: Duration.hours(1),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchSchedulingPolicy.BatchSchedulingPolicy,
    {
      fair_share_policy: {
        share_decay_seconds: 3600,
        share_distribution: [],
      },
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::SchedulingPolicy', {
  //   FairsharePolicy: {
  //     ShareDecaySeconds: 3600,
  //     ShareDistribution: [],
  //   },
  // });
});

test("fairshare policy respects shares", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy", {
    shares: [
      {
        shareIdentifier: "myShareId",
        weightFactor: 0.5,
      },
      {
        shareIdentifier: "myShareId2",
        weightFactor: 1,
      },
    ],
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchSchedulingPolicy.BatchSchedulingPolicy,
    {
      fair_share_policy: {
        share_distribution: [
          {
            share_identifier: "myShareId",
            weight_factor: 0.5,
          },
          {
            share_identifier: "myShareId2",
            weight_factor: 1,
          },
        ],
      },
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::SchedulingPolicy', {
  //   FairsharePolicy: {
  //     ShareDistribution: [
  //       {
  //         ShareIdentifier: 'myShareId',
  //         WeightFactor: 0.5,
  //       },
  //       {
  //         ShareIdentifier: 'myShareId2',
  //         WeightFactor: 1,
  //       },
  //     ],
  //   },
  // });
});

test("addShare() works", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  const policy = new batch.FairshareSchedulingPolicy(
    stack,
    "schedulingPolicy",
    {
      shares: [
        {
          shareIdentifier: "myShareId",
          weightFactor: 0.5,
        },
      ],
    },
  );
  policy.addShare({
    shareIdentifier: "addedShareId",
    weightFactor: 0.5,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchSchedulingPolicy.BatchSchedulingPolicy,
    {
      fair_share_policy: {
        share_distribution: [
          {
            share_identifier: "myShareId",
            weight_factor: 0.5,
          },
          {
            share_identifier: "addedShareId",
            weight_factor: 0.5,
          },
        ],
      },
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::SchedulingPolicy', {
  //   FairsharePolicy: {
  //     ShareDistribution: [
  //       {
  //         ShareIdentifier: 'myShareId',
  //         WeightFactor: 0.5,
  //       },
  //       {
  //         ShareIdentifier: 'addedShareId',
  //         WeightFactor: 0.5,
  //       },
  //     ],
  //   },
  // });
});

test("can be imported from ARN", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  const policy =
    batch.FairshareSchedulingPolicy.fromFairshareSchedulingPolicyArn(
      stack,
      "policyImport",
      "arn:aws:batch:us-east-1:123456789012:scheduling-policy/policyImport",
    );

  // THEN
  expect(policy.schedulingPolicyArn).toEqual(
    "arn:aws:batch:us-east-1:123456789012:scheduling-policy/policyImport",
  );
});

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/auto-scaling/lifecyclehooks.test.ts
// for the harness idiom) - guards against emitted-Terraform drift for the
// aws_batch_scheduling_policy resource that FairshareSchedulingPolicy creates.
describe("FairshareSchedulingPolicy", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);

    // WHEN
    new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy");

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with shares and computeReservation", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);

    // WHEN
    new batch.FairshareSchedulingPolicy(stack, "schedulingPolicy", {
      schedulingPolicyName: "FairsharePolicyName",
      computeReservation: 75,
      shareDecay: Duration.hours(1),
      shares: [
        {
          shareIdentifier: "myShareId",
          weightFactor: 0.5,
        },
        {
          shareIdentifier: "myShareId2",
          weightFactor: 1,
        },
      ],
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function newStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack");
}
