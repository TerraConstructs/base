// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/job-definition-base.test.ts

import { batchJobDefinition } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
} from "../../../../src/aws/compute";
import * as batch from "../../../../src/aws/compute/batch";
import * as ecs from "../../../../src/aws/compute/ecs";
import { Duration } from "../../../../src/duration";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

// TERRACONSTRUCTS DEVIATION: upstream's `defaultExpectedEcsProps`/`defaultExpectedEksProps` are
// CfnJobDefinitionProps (CloudFormation L1 property bags) run through `capitalizePropertyNames`
// (test/utils.ts) to produce PascalCase CFN assertion shapes. There is no CFN L1 here -- the
// `aws_batch_job_definition` Terraform resource's config is already snake_case -- so the expected
// props below are asserted directly in Terraform attribute shape via
// `toHaveResourceWithProperties`, which is a subset ("contains") match just like upstream's
// `hasResourceProperties`.
const defaultExpectedEcsProps: Record<string, any> = {
  type: "container",
  platform_capabilities: [batch.Compatibility.EC2],
};
// TODO: EKS support omitted (blocked on aws-eks port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/job-definition-base.test.ts#L13-L15
const defaultExpectedMultiNodeProps: Record<string, any> = {
  type: "multinode",
};

let stack: AwsStack;

let defaultEcsProps: batch.EcsJobDefinitionProps;
let defaultMultiNodeProps: batch.MultiNodeJobDefinitionProps;

let expectedProps: any;
let defaultProps: any;

// TERRACONSTRUCTS DEVIATION: upstream's describe.each also covers `batch.EksJobDefinition`. EKS
// support is intentionally omitted in this port (blocked on aws-eks port -- see the eks-job-definition
// / eks-container-definition omission TODOs in src/aws/compute/batch/index.ts), so only the Ecs and
// MultiNode JobDefinition variants are exercised here.
describe.each([batch.EcsJobDefinition, batch.MultiNodeJobDefinition])(
  "%p type JobDefinition",
  (JobDefinition) => {
    // GIVEN
    beforeEach(() => {
      stack = getAwsStack();

      defaultEcsProps = {
        container: new batch.EcsEc2ContainerDefinition(stack, "EcsContainer", {
          cpu: 256,
          memory: Size.mebibytes(2048),
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        }),
      };
      defaultMultiNodeProps = {
        containers: [
          {
            container: new batch.EcsEc2ContainerDefinition(
              stack,
              "MultinodeEcsContainer",
              {
                cpu: 256,
                memory: Size.mebibytes(2048),
                image: ecs.ContainerImage.fromRegistry(
                  "amazon/amazon-ecs-sample",
                ),
              },
            ),
            startNode: 0,
            endNode: 10,
          },
        ],
        mainNode: 0,
        instanceType: InstanceType.of(InstanceClass.R4, InstanceSize.LARGE),
      };
      switch (JobDefinition) {
        case batch.EcsJobDefinition:
          expectedProps = defaultExpectedEcsProps;
          defaultProps = defaultEcsProps;
          break;
        case batch.MultiNodeJobDefinition:
          expectedProps = defaultExpectedMultiNodeProps;
          defaultProps = defaultMultiNodeProps;
          break;
      }
    });

    test("JobDefinition respects name", () => {
      // WHEN
      new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
        jobDefinitionName: "myEcsJob",
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          name: "myEcsJob",
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   JobDefinitionName: 'myEcsJob',
      // });
    });

    test("JobDefinition respects parameters", () => {
      // WHEN
      new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
        parameters: {
          foo: "bar",
        },
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          parameters: {
            foo: "bar",
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   Parameters: {
      //     foo: 'bar',
      //   },
      // });
    });

    test("JobDefinition respects retryAttempts", () => {
      // WHEN
      new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
        retryAttempts: 8,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          retry_strategy: {
            attempts: 8,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   RetryStrategy: {
      //     Attempts: 8,
      //   },
      // });
    });

    test("JobDefinition respects retryStrategies", () => {
      // WHEN
      new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
        retryStrategies: [
          batch.RetryStrategy.of(
            batch.Action.EXIT,
            batch.Reason.CANNOT_PULL_CONTAINER,
          ),
          batch.RetryStrategy.of(
            batch.Action.RETRY,
            batch.Reason.NON_ZERO_EXIT_CODE,
          ),
          batch.RetryStrategy.of(
            batch.Action.RETRY,
            batch.Reason.SPOT_INSTANCE_RECLAIMED,
          ),
          batch.RetryStrategy.of(
            batch.Action.RETRY,
            batch.Reason.custom({
              onExitCode: "40*",
              onReason: "reason*",
              onStatusReason: "statusReason",
            }),
          ),
        ],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          retry_strategy: {
            evaluate_on_exit: [
              {
                action: "EXIT",
                on_reason: "CannotPullContainerError:*",
              },
              {
                action: "RETRY",
                on_exit_code: "*",
              },
              {
                action: "RETRY",
                on_status_reason: "Host EC2*",
              },
              {
                action: "RETRY",
                on_exit_code: "40*",
                on_reason: "reason*",
                on_status_reason: "statusReason",
              },
            ],
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   RetryStrategy: {
      //     EvaluateOnExit: [
      //       {
      //         Action: 'EXIT',
      //         OnReason: 'CannotPullContainerError:*',
      //       },
      //       {
      //         Action: 'RETRY',
      //         OnExitCode: '*',
      //       },
      //       {
      //         Action: 'RETRY',
      //         OnStatusReason: 'Host EC2*',
      //       },
      //       {
      //         Action: 'RETRY',
      //         OnExitCode: '40*',
      //         OnReason: 'reason*',
      //         OnStatusReason: 'statusReason',
      //       },
      //     ],
      //   },
      // });
    });

    test("JobDefinition respects schedulingPriority", () => {
      // WHEN
      new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
        schedulingPriority: 10,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          scheduling_priority: 10,
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   SchedulingPriority: 10,
      // });
    });

    // NOTE: upstream names this test 'JobDefinition respects schedulingPriority' too (verbatim
    // typo carried over from aws-cdk-lib/aws-batch/test/job-definition-base.test.ts) even though it
    // actually exercises `timeout`.
    test("JobDefinition respects schedulingPriority", () => {
      // WHEN
      new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
        timeout: Duration.minutes(10),
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          timeout: {
            attempt_duration_seconds: 600,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   Timeout: {
      //     AttemptDurationSeconds: 600,
      //   },
      // });
    });

    test("JobDefinition respects addRetryStrategy()", () => {
      // WHEN
      const jobDefn = new JobDefinition(stack, "JobDefn", {
        ...defaultProps,
      });

      jobDefn.addRetryStrategy(
        batch.RetryStrategy.of(
          batch.Action.RETRY,
          batch.Reason.SPOT_INSTANCE_RECLAIMED,
        ),
      );

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchJobDefinition.BatchJobDefinition,
        {
          ...expectedProps,
          retry_strategy: {
            evaluate_on_exit: [
              {
                action: "RETRY",
                on_status_reason: "Host EC2*",
              },
            ],
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
      //   ...expectedProps,
      //   RetryStrategy: {
      //     EvaluateOnExit: [
      //       {
      //         Action: 'RETRY',
      //         OnStatusReason: 'Host EC2*',
      //       },
      //     ],
      //   },
      // });
    });
  },
);

// Harness idiom (see test/aws/notify/queue.test.ts): wrap synth-only assertions in a describe with
// toMatchSnapshot(), attaching an HttpBackend (via gridBackendConfig) to every snapshotted stack so
// the default local backend's machine-dependent tfstate path never leaks into the snapshot.
describe("JobDefinitionBase synth", () => {
  test("EcsJobDefinition synthesizes and matches snapshot", () => {
    // GIVEN
    const synthStack = getAwsStack();

    // WHEN
    new batch.EcsJobDefinition(synthStack, "JobDefn", {
      jobDefinitionName: "myEcsJob",
      container: new batch.EcsEc2ContainerDefinition(
        synthStack,
        "EcsContainer",
        {
          cpu: 256,
          memory: Size.mebibytes(2048),
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        },
      ),
      retryAttempts: 8,
      schedulingPriority: 10,
      timeout: Duration.minutes(10),
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });

  test("MultiNodeJobDefinition synthesizes and matches snapshot", () => {
    // GIVEN
    const synthStack = getAwsStack();

    // WHEN
    new batch.MultiNodeJobDefinition(synthStack, "JobDefn", {
      jobDefinitionName: "myMultiNodeJob",
      containers: [
        {
          container: new batch.EcsEc2ContainerDefinition(
            synthStack,
            "MultinodeEcsContainer",
            {
              cpu: 256,
              memory: Size.mebibytes(2048),
              image: ecs.ContainerImage.fromRegistry(
                "amazon/amazon-ecs-sample",
              ),
            },
          ),
          startNode: 0,
          endNode: 10,
        },
      ],
      mainNode: 0,
      instanceType: InstanceType.of(InstanceClass.R4, InstanceSize.LARGE),
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    gridBackendConfig,
  });
}
