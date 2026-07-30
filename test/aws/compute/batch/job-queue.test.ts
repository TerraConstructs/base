// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/job-queue.test.ts

import { batchJobQueue } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { Vpc } from "../../../../src/aws/compute";
import * as batch from "../../../../src/aws/compute/batch";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("JobQueue respects computeEnvironments", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const ce = new batch.ManagedEc2EcsComputeEnvironment(stack, "CE", {
    vpc,
  });
  new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: ce,
        order: 1,
      },
    ],
    priority: 10,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobQueue.BatchJobQueue,
    {
      compute_environment_order: [
        {
          compute_environment: stack.resolve(ce.computeEnvironmentArn),
          order: 1,
        },
      ],
      priority: 10,
      state: "ENABLED",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   ComputeEnvironmentOrder: [{
  //     ComputeEnvironment: { 'Fn::GetAtt': ['CE1BFE03A1', 'ComputeEnvironmentArn'] },
  //     Order: 1,
  //   }],
  //   Priority: 10,
  //   State: 'ENABLED',
  // });
});

test("JobQueue respects enabled", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const ce = new batch.ManagedEc2EcsComputeEnvironment(stack, "CE", {
    vpc,
  });
  new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: ce,
        order: 1,
      },
    ],
    priority: 10,
    enabled: false,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobQueue.BatchJobQueue,
    {
      compute_environment_order: [
        {
          compute_environment: stack.resolve(ce.computeEnvironmentArn),
          order: 1,
        },
      ],
      priority: 10,
      state: "DISABLED",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   ComputeEnvironmentOrder: [{
  //     ComputeEnvironment: { 'Fn::GetAtt': ['CE1BFE03A1', 'ComputeEnvironmentArn'] },
  //     Order: 1,
  //   }],
  //   Priority: 10,
  //   State: 'DISABLED',
  // });
});

test("JobQueue respects name", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const ce = new batch.ManagedEc2EcsComputeEnvironment(stack, "CE", {
    vpc,
  });
  new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: ce,
        order: 1,
      },
    ],
    priority: 10,
    jobQueueName: "JoBBQ",
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobQueue.BatchJobQueue,
    {
      compute_environment_order: [
        {
          compute_environment: stack.resolve(ce.computeEnvironmentArn),
          order: 1,
        },
      ],
      priority: 10,
      name: "JoBBQ",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   ComputeEnvironmentOrder: [{
  //     ComputeEnvironment: { 'Fn::GetAtt': ['CE1BFE03A1', 'ComputeEnvironmentArn'] },
  //     Order: 1,
  //   }],
  //   Priority: 10,
  //   JobQueueName: 'JoBBQ',
  // });
});

// TERRACONSTRUCTS DEVIATION (provider-shape difference): upstream `CfnJobQueue`'s `Ref` resolves
// to the job queue ARN (not the name), so CDK's `JobQueue.jobQueueName` getter has to parse the
// name back out of `Fn::GetAtt(..., 'JobQueueArn')` via the `Fn::Select`/`Fn::Split` token tree
// asserted below. The `aws_batch_job_queue` Terraform resource instead echoes the given `name`
// back as a first-class top-level computed attribute (`BatchJobQueueConfig.name`), so
// `JobQueue.jobQueueName` in this port is simply `this.resource.name` (a single
// `${aws_batch_job_queue....name}` token - see src/aws/compute/batch/job-queue.ts) and there is no
// Fn::Select/Fn::Split parsing machinery to exercise. See the replacement test immediately below.
// test('JobQueue name is parsed from arn', () => {
//   // GIVEN
//   const stack = new Stack();
//   const vpc = new ec2.Vpc(stack, 'vpc');
//
//   // WHEN
//   const queue = new JobQueue(stack, 'joBBQ', {
//     computeEnvironments: [{
//       computeEnvironment: new ManagedEc2EcsComputeEnvironment(stack, 'CE', {
//         vpc,
//       }),
//       order: 1,
//     }],
//     priority: 10,
//     jobQueueName: 'JoBBQ',
//   });
//
//   // THEN
//   expect(Tokenization.resolve(queue.jobQueueName, {
//     scope: stack,
//     resolver: new DefaultTokenResolver(new StringConcat()),
//   })).toEqual({
//     'Fn::Select': [
//       1,
//       {
//         'Fn::Split': [
//           '/',
//           {
//             'Fn::Select': [
//               5,
//               {
//                 'Fn::Split': [
//                   ':',
//                   {
//                     'Fn::GetAtt': [
//                       'joBBQ9FD52DAF',
//                       'JobQueueArn',
//                     ],
//                   },
//                 ],
//               },
//             ],
//           },
//         ],
//       },
//     ],
//   });
// });
test("JobQueue jobQueueName resolves directly from the resource's name attribute", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const queue = new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
          stack,
          "CE",
          {
            vpc,
          },
        ),
        order: 1,
      },
    ],
    priority: 10,
    jobQueueName: "JoBBQ",
  });

  // THEN
  expect(stack.resolve(queue.jobQueueName)).toEqual(
    expect.stringMatching(/^\$\{aws_batch_job_queue\..+\.name\}$/),
  );
});

test("JobQueue respects schedulingPolicy", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const policy = new batch.FairshareSchedulingPolicy(
    stack,
    "FairsharePolicy",
  );
  const ce = new batch.ManagedEc2EcsComputeEnvironment(stack, "CE", {
    vpc,
  });
  new batch.JobQueue(stack, "JobQueue", {
    computeEnvironments: [
      {
        computeEnvironment: ce,
        order: 1,
      },
    ],
    priority: 10,
    schedulingPolicy: policy,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobQueue.BatchJobQueue,
    {
      compute_environment_order: [
        {
          compute_environment: stack.resolve(ce.computeEnvironmentArn),
          order: 1,
        },
      ],
      priority: 10,
      scheduling_policy_arn: stack.resolve(policy.schedulingPolicyArn),
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   ComputeEnvironmentOrder: [{
  //     ComputeEnvironment: { 'Fn::GetAtt': ['CE1BFE03A1', 'ComputeEnvironmentArn'] },
  //     Order: 1,
  //   }],
  //   Priority: 10,
  //   SchedulingPolicyArn: {
  //     'Fn::GetAtt': ['FairsharePolicyA0C549BE', 'Arn'],
  //   },
  // });
});

test("JobQueue respects addComputeEnvironment", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const firstCe = new batch.ManagedEc2EcsComputeEnvironment(
    stack,
    "FirstCE",
    {
      vpc,
    },
  );
  const policy = new batch.FairshareSchedulingPolicy(
    stack,
    "FairsharePolicy",
  );
  const queue = new batch.JobQueue(stack, "JobQueue", {
    computeEnvironments: [
      {
        computeEnvironment: firstCe,
        order: 1,
      },
    ],
    priority: 10,
    schedulingPolicy: policy,
  });

  const secondCe = new batch.ManagedEc2EcsComputeEnvironment(
    stack,
    "SecondCE",
    {
      vpc,
    },
  );
  queue.addComputeEnvironment(secondCe, 2);

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobQueue.BatchJobQueue,
    {
      compute_environment_order: [
        {
          compute_environment: stack.resolve(firstCe.computeEnvironmentArn),
          order: 1,
        },
        {
          compute_environment: stack.resolve(secondCe.computeEnvironmentArn),
          order: 2,
        },
      ],
      priority: 10,
      scheduling_policy_arn: stack.resolve(policy.schedulingPolicyArn),
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   ComputeEnvironmentOrder: [
  //     {
  //       ComputeEnvironment: { 'Fn::GetAtt': ['FirstCEAD3794AD', 'ComputeEnvironmentArn'] },
  //       Order: 1,
  //     },
  //     {
  //       ComputeEnvironment: { 'Fn::GetAtt': ['SecondCEEBA93938', 'ComputeEnvironmentArn'] },
  //       Order: 2,
  //     },
  //   ],
  //   Priority: 10,
  //   SchedulingPolicyArn: {
  //     'Fn::GetAtt': ['FairsharePolicyA0C549BE', 'Arn'],
  //   },
  // });
});

test("can be imported from ARN", () => {
  // GIVEN
  const stack = new AwsStack();

  // WHEN
  const queue = batch.JobQueue.fromJobQueueArn(
    stack,
    "importedJobQueue",
    "arn:aws:batch:us-east-1:123456789012:job-queue/importedJobQueue",
  );

  // THEN
  expect(queue.jobQueueArn).toEqual(
    "arn:aws:batch:us-east-1:123456789012:job-queue/importedJobQueue",
  );
});

test("JobQueue throws when the same order is assigned to multiple ComputeEnvironments", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  const joBBQ = new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
          stack,
          "FirstCE",
          {
            vpc,
          },
        ),
        order: 1,
      },
    ],
    priority: 10,
  });

  joBBQ.addComputeEnvironment(
    new batch.ManagedEc2EcsComputeEnvironment(stack, "SecondCE", {
      vpc,
    }),
    1,
  );

  expect(() => {
    Template.synth(stack, { runValidations: true });
  }).toThrow(/assigns the same order to different ComputeEnvironments/);
});

test("JobQueue throws when there are no linked ComputeEnvironments", () => {
  // GIVEN
  const stack = new AwsStack();

  // WHEN
  new batch.JobQueue(stack, "joBBQ");

  expect(() => {
    Template.synth(stack, { runValidations: true });
  }).toThrow(/This JobQueue does not link any ComputeEnvironments/);
});

test("JobQueue with JobStateTimeLimitActions", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
          stack,
          "CE",
          {
            vpc,
          },
        ),
        order: 1,
      },
    ],
    jobStateTimeLimitActions: [
      {
        action: batch.JobStateTimeLimitActionsAction.CANCEL,
        maxTime: Duration.minutes(10),
        reason:
          batch.JobStateTimeLimitActionsReason.INSUFFICIENT_INSTANCE_CAPACITY,
        state: batch.JobStateTimeLimitActionsState.RUNNABLE,
      },
      {
        action: batch.JobStateTimeLimitActionsAction.CANCEL,
        maxTime: Duration.minutes(10),
        reason:
          batch.JobStateTimeLimitActionsReason.COMPUTE_ENVIRONMENT_MAX_RESOURCE,
        state: batch.JobStateTimeLimitActionsState.RUNNABLE,
      },
      {
        maxTime: Duration.minutes(10),
        reason: batch.JobStateTimeLimitActionsReason.JOB_RESOURCE_REQUIREMENT,
      },
    ],
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobQueue.BatchJobQueue,
    {
      job_state_time_limit_action: [
        {
          action: "CANCEL",
          max_time_seconds: 600,
          reason: "CAPACITY:INSUFFICIENT_INSTANCE_CAPACITY",
          state: "RUNNABLE",
        },
        {
          action: "CANCEL",
          max_time_seconds: 600,
          reason: "MISCONFIGURATION:COMPUTE_ENVIRONMENT_MAX_RESOURCE",
          state: "RUNNABLE",
        },
        {
          action: "CANCEL",
          max_time_seconds: 600,
          reason: "MISCONFIGURATION:JOB_RESOURCE_REQUIREMENT",
          state: "RUNNABLE",
        },
      ],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   JobStateTimeLimitActions: [
  //     {
  //       Action: 'CANCEL',
  //       MaxTimeSeconds: 600,
  //       Reason: 'CAPACITY:INSUFFICIENT_INSTANCE_CAPACITY',
  //       State: 'RUNNABLE',
  //     },
  //     {
  //       Action: 'CANCEL',
  //       MaxTimeSeconds: 600,
  //       Reason: 'MISCONFIGURATION:COMPUTE_ENVIRONMENT_MAX_RESOURCE',
  //       State: 'RUNNABLE',
  //     },
  //     {
  //       Action: 'CANCEL',
  //       MaxTimeSeconds: 600,
  //       Reason: 'MISCONFIGURATION:JOB_RESOURCE_REQUIREMENT',
  //       State: 'RUNNABLE',
  //     },
  //   ],
  // });
});

test("JobQueue with JobStateTimeLimitActions throws when maxTime has an illegal value", () => {
  const stack = new AwsStack();

  expect(
    () =>
      new batch.JobQueue(stack, "joBBQ", {
        jobStateTimeLimitActions: [
          {
            action: batch.JobStateTimeLimitActionsAction.CANCEL,
            maxTime: Duration.seconds(90000),
            reason:
              batch.JobStateTimeLimitActionsReason
                .COMPUTE_ENVIRONMENT_MAX_RESOURCE,
            state: batch.JobStateTimeLimitActionsState.RUNNABLE,
          },
        ],
      }),
  ).toThrow(
    "maxTime must be between 600 and 86400 seconds, got 90000 seconds at jobStateTimeLimitActions[0]",
  );
});

test("JobQueue with an empty array of JobStateTimeLimitActions", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpc = new Vpc(stack, "vpc");

  // WHEN
  new batch.JobQueue(stack, "joBBQ", {
    computeEnvironments: [
      {
        computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
          stack,
          "CE",
          {
            vpc,
          },
        ),
        order: 1,
      },
    ],
    jobStateTimeLimitActions: [],
  });

  // THEN
  // `toHaveResourceWithProperties` cannot express "must be absent" (it only checks that asserted
  // keys match, see test/aws/compute/auto-scaling/auto-scaling-group.test.ts's `synthAsg` helper
  // for the established pattern) - so read the synthesized resource object directly.
  const [jobQueue] = Object.values(
    Template.resourceObjects(stack, batchJobQueue.BatchJobQueue),
  ) as any[];
  expect(jobQueue.job_state_time_limit_action).toBeUndefined();
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobQueue', {
  //   JobStateTimeLimitActions: Match.absent(),
  // });
});

describe("JobQueue (job-queue.test.ts snapshot)", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
    new HttpBackend(stack, gridBackendConfig);
  });

  test("Should synth and match SnapShot", () => {
    // GIVEN
    const vpc = new Vpc(stack, "vpc");

    // WHEN
    new batch.JobQueue(stack, "joBBQ", {
      computeEnvironments: [
        {
          computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
            stack,
            "CE",
            {
              vpc,
            },
          ),
          order: 1,
        },
      ],
      priority: 10,
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth with schedulingPolicy and jobStateTimeLimitActions and match SnapShot", () => {
    // GIVEN
    const vpc = new Vpc(stack, "vpc");

    // WHEN
    new batch.JobQueue(stack, "joBBQ", {
      computeEnvironments: [
        {
          computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
            stack,
            "CE",
            {
              vpc,
            },
          ),
          order: 1,
        },
      ],
      priority: 10,
      schedulingPolicy: new batch.FairshareSchedulingPolicy(
        stack,
        "FairsharePolicy",
      ),
      jobStateTimeLimitActions: [
        {
          action: batch.JobStateTimeLimitActionsAction.CANCEL,
          maxTime: Duration.minutes(10),
          reason:
            batch.JobStateTimeLimitActionsReason
              .INSUFFICIENT_INSTANCE_CAPACITY,
          state: batch.JobStateTimeLimitActionsState.RUNNABLE,
        },
      ],
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
