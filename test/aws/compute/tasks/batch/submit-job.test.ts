// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-stepfunctions-tasks/test/batch/submit-job.test.ts

import { dataAwsIamPolicyDocument, iamRolePolicy } from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import * as batch from "../../../../../src/aws/compute/batch";
import * as ecs from "../../../../../src/aws/compute/ecs";
import { BatchSubmitJob } from "../../../../../src/aws/compute/tasks/batch/submit-job";
import { Duration } from "../../../../../src/duration";
import { Size } from "../../../../../src/size";
import { Template } from "../../../../assertions";

describe("BatchSubmitJob", () => {
  let stack: AwsStack;
  let batchJobDefinition: batch.IJobDefinition;
  let batchJobQueue: batch.IJobQueue;

  beforeEach(() => {
    // GIVEN
    const app = Testing.app();
    stack = new AwsStack(app);

    batchJobDefinition = new batch.EcsJobDefinition(stack, "JobDefinition", {
      container: new batch.EcsEc2ContainerDefinition(stack, "Container", {
        // ContainerImage.fromRegistry avoids the batchjob-image asset upstream
        // uses (ContainerImage.fromAsset), which has no equivalent fixture here.
        image: ecs.ContainerImage.fromRegistry(
          "public.ecr.aws/docker/library/python:3.13-alpine",
        ),
        cpu: 256,
        memory: Size.mebibytes(2048),
      }),
    });

    batchJobQueue = new batch.JobQueue(stack, "JobQueue", {
      computeEnvironments: [
        {
          order: 1,
          computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
            stack,
            "ComputeEnv",
            {
              vpc: new compute.Vpc(stack, "vpc"),
            },
          ),
        },
      ],
    });
  });

  test("Task with only the required parameters", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobName: "JobName",
      jobQueueArn: batchJobQueue.jobQueueArn,
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob.sync",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::batch:submitJob.sync",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        // JobDefinition: { Ref: "JobDefinition24FFE3ED" },
        JobName: "JobName",
        JobQueue: stack.resolve(batchJobQueue.jobQueueArn),
        // JobQueue: {
        //   "Fn::GetAtt": [
        //     "JobQueueEE3AD499",
        //     "JobQueueArn",
        //   ],
        // },
      },
    });
  });

  test("Task with all the parameters", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobName: "JobName",
      jobQueueArn: batchJobQueue.jobQueueArn,
      arraySize: 15,
      containerOverrides: {
        command: ["sudo", "rm"],
        environment: { key: "value" },
        instanceType: new compute.InstanceType("MULTI"),
        memory: Size.mebibytes(1024),
        gpuCount: 1,
        vcpus: 10,
      },
      dependsOn: [{ jobId: "1234", type: "some_type" }],
      payload: compute.TaskInput.fromObject({
        foo: compute.JsonPath.stringAt("$.bar"),
      }),
      attempts: 3,
      taskTimeout: compute.Timeout.duration(Duration.seconds(60)),
      integrationPattern: compute.IntegrationPattern.REQUEST_RESPONSE,
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::batch:submitJob",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        // JobDefinition: { Ref: "JobDefinition24FFE3ED" },
        JobName: "JobName",
        JobQueue: stack.resolve(batchJobQueue.jobQueueArn),
        // JobQueue: {
        //   "Fn::GetAtt": [
        //     "JobQueueEE3AD499",
        //     "JobQueueArn",
        //   ],
        // },
        ArrayProperties: { Size: 15 },
        ContainerOverrides: {
          Command: ["sudo", "rm"],
          Environment: [{ Name: "key", Value: "value" }],
          InstanceType: "MULTI",
          ResourceRequirements: [
            { Type: "GPU", Value: "1" },
            { Type: "MEMORY", Value: "1024" },
            { Type: "VCPU", Value: "10" },
          ],
        },
        DependsOn: [{ JobId: "1234", Type: "some_type" }],
        Parameters: { "foo.$": "$.bar" },
        RetryStrategy: { Attempts: 3 },
        Timeout: { AttemptDurationSeconds: 60 },
      },
    });
  });

  // 'Task with all the parameters - using JSONata' DROPPED - JSONata not ported (base
  // compute.TaskStateBase has no query-language support).

  test("supports tokens", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobName: compute.JsonPath.stringAt("$.jobName"),
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobQueueArn: batchJobQueue.jobQueueArn,
      arraySize: compute.JsonPath.numberAt("$.arraySize"),
      taskTimeout: compute.Timeout.at("$.timeout"),
      attempts: compute.JsonPath.numberAt("$.attempts"),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob.sync",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::batch:submitJob.sync",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        "JobName.$": "$.jobName",
        JobQueue: stack.resolve(batchJobQueue.jobQueueArn),
        ArrayProperties: {
          "Size.$": "$.arraySize",
        },
        RetryStrategy: {
          "Attempts.$": "$.attempts",
        },
        Timeout: {
          "AttemptDurationSeconds.$": "$.timeout",
        },
      },
    });
  });

  test("container overrides are tokens", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobName: "JobName",
      jobQueueArn: batchJobQueue.jobQueueArn,
      containerOverrides: {
        memory: Size.mebibytes(compute.JsonPath.numberAt("$.asdf")),
      },
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob.sync",
      // Resource: { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ":states:::batch:submitJob.sync"]] },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        JobName: "JobName",
        JobQueue: stack.resolve(batchJobQueue.jobQueueArn),
        ContainerOverrides: {
          ResourceRequirements: [{ Type: "MEMORY", "Value.$": "$.asdf" }],
        },
      },
    });
  });

  test("supports passing task input into payload", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobQueueArn: batchJobQueue.jobQueueArn,
      jobName: compute.JsonPath.stringAt("$.jobName"),
      payload: compute.TaskInput.fromJsonPathAt("$.foo"),
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob.sync",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::batch:submitJob.sync",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        "JobName.$": "$.jobName",
        JobQueue: stack.resolve(batchJobQueue.jobQueueArn),
        "Parameters.$": "$.foo",
      },
    });
  });

  test("Task throws if WAIT_FOR_TASK_TOKEN is supplied as service integration pattern", () => {
    expect(() => {
      new BatchSubmitJob(stack, "Task", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        integrationPattern: compute.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      });
    }).toThrow(
      /Unsupported service integration pattern. Supported Patterns: REQUEST_RESPONSE,RUN_JOB. Received: WAIT_FOR_TASK_TOKEN/,
    );
  });

  test("Task throws if environment in containerOverrides contain env with name starting with AWS_BATCH", () => {
    expect(() => {
      new BatchSubmitJob(stack, "Task", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        containerOverrides: {
          environment: { AWS_BATCH_MY_NAME: "MY_VALUE" },
        },
      });
    }).toThrow(
      /Invalid environment variable name: AWS_BATCH_MY_NAME. Environment variable names starting with 'AWS_BATCH' are reserved./,
    );
  });

  test("Task throws if arraySize is out of limits 2-10000", () => {
    expect(() => {
      new BatchSubmitJob(stack, "Task", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        arraySize: 1,
      });
    }).toThrow(/arraySize must be between 2 and 10,000/);

    expect(() => {
      new BatchSubmitJob(stack, "Task2", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        arraySize: 10001,
      });
    }).toThrow(/arraySize must be between 2 and 10,000/);
  });

  test("Task throws if dependencies exceeds 20", () => {
    expect(() => {
      new BatchSubmitJob(stack, "Task", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        dependsOn: [...Array(21).keys()].map((i) => ({
          jobId: `${i}`,
          type: `some_type-${i}`,
        })),
      });
    }).toThrow(/dependencies must be 20 or less/);
  });

  test("Task throws if attempts is out of limits 1-10", () => {
    expect(() => {
      new BatchSubmitJob(stack, "Task", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        attempts: 0,
      });
    }).toThrow(/attempts must be between 1 and 10/);

    expect(() => {
      new BatchSubmitJob(stack, "Task2", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        attempts: 11,
      });
    }).toThrow(/attempts must be between 1 and 10/);
  });

  test("Task throws if attempt duration is less than 60 sec", () => {
    expect(() => {
      new BatchSubmitJob(stack, "Task", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        taskTimeout: compute.Timeout.duration(Duration.seconds(59)),
      });
    }).toThrow(/attempt duration must be greater than 60 seconds./);
  });

  test("supports passing tags", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobQueueArn: batchJobQueue.jobQueueArn,
      jobName: compute.JsonPath.stringAt("$.jobName"),
      tags: {
        test: "this is a tag",
      },
    });

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob.sync",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::batch:submitJob.sync",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        "JobName.$": "$.jobName",
        JobQueue: stack.resolve(batchJobQueue.jobQueueArn),
        Tags: {
          test: "this is a tag",
        },
      },
    });
  });

  test("throws if tags has invalid value", () => {
    expect(() => {
      const tags: { [key: string]: string } = {};
      for (let i = 0; i < 100; i++) {
        tags[i] = "tag";
      }
      new BatchSubmitJob(stack, "Task1", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        tags,
      });
    }).toThrow(/Maximum tag number of entries is 50./);

    expect(() => {
      const keyTooLong = "k".repeat(150);
      const tags: { [key: string]: string } = {};
      tags[keyTooLong] = "tag";
      new BatchSubmitJob(stack, "Task2", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        tags,
      });
    }).toThrow(/Tag key size must be between 1 and 128/);

    expect(() => {
      const tags = { key: "k".repeat(300) };
      new BatchSubmitJob(stack, "Task3", {
        jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
        jobName: "JobName",
        jobQueueArn: batchJobQueue.jobQueueArn,
        tags,
      });
    }).toThrow(/Tag value maximum size is 256/);
  });

  // TERRACONSTRUCTS addition (no upstream counterpart): SubmitJob calls that carry
  // tags also need batch:TagResource - AWS rejects the tagged SubmitJob with
  // AccessDeniedException on the job-definition otherwise (caught live by the
  // sfn.batch-submit-job integ test; upstream grants only batch:SubmitJob and has
  // the same runtime failure).
  test("grants batch:TagResource alongside batch:SubmitJob when tags are set", () => {
    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobQueueArn: batchJobQueue.jobQueueArn,
      jobName: "JobName",
      tags: { key: "value" },
    });
    new compute.StateMachine(stack, "ParentStateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: ["batch:SubmitJob", "batch:TagResource"],
            effect: "Allow",
            resources: [
              expect.stringMatching(/job-definition\/\*/),
              stack.resolve(batchJobQueue.jobQueueArn),
            ],
          }),
        ]),
      },
    );
  });

  test("supports passing jobQueueArn as JsonPath", () => {
    // upstream title: 'supports passing jobQueueArn as JsonPath or JSONata' - the
    // JSONata half is dropped along with the rest of the JSONata surface.

    // WHEN
    const task = new BatchSubmitJob(stack, "Task", {
      jobDefinitionArn: batchJobDefinition.jobDefinitionArn,
      jobQueueArn: compute.JsonPath.stringAt("$.jobQueueArn"),
      jobName: compute.JsonPath.stringAt("$.jobName"),
    });

    const parentStateMachine = new compute.StateMachine(
      stack,
      "ParentStateMachine",
      {
        definitionBody: compute.DefinitionBody.fromChainable(task),
      },
    );

    // THEN
    expect(stack.resolve(task.toStateJson())).toEqual({
      Type: "Task",
      Resource:
        "arn:${data.aws_partition.Partitition.partition}:states:::batch:submitJob.sync",
      // Resource: {
      //   "Fn::Join": [
      //     "",
      //     [
      //       "arn:",
      //       {
      //         Ref: "AWS::Partition",
      //       },
      //       ":states:::batch:submitJob.sync",
      //     ],
      //   ],
      // },
      End: true,
      Parameters: {
        JobDefinition: stack.resolve(batchJobDefinition.jobDefinitionArn),
        "JobName.$": "$.jobName",
        "JobQueue.$": "$.jobQueueArn",
      },
    });

    // Task.taskPolicies are only materialized into the parent StateMachine role's
    // policy once the graph is bound - assert the graph-registered policy via
    // Template.synth (aws_iam_role_policy + its backing policy-document data source),
    // mirroring the sibling idiom in stepfunctions/start-execution.test.ts and
    // authorizers/lambda.test.ts.
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["batch:SubmitJob"],
            effect: "Allow",
            resources: ["*"],
          },
          {
            actions: [
              "events:PutTargets",
              "events:PutRule",
              "events:DescribeRule",
            ],
            effect: "Allow",
            resources: [
              "arn:${data.aws_partition.Partitition.partition}:events:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:rule/StepFunctionsGetEventsForBatchJobsRule",
            ],
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(iamRolePolicy.IamRolePolicy, {
      role: stack.resolve(parentStateMachine.role.roleName),
      policy: expect.stringMatching(
        /^\$\{data\.aws_iam_policy_document\..*\.json\}$/,
      ),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: 'batch:SubmitJob',
    //         Effect: 'Allow',
    //         Resource: '*',
    //       },
    //       {
    //         Action: [
    //           'events:PutTargets',
    //           'events:PutRule',
    //           'events:DescribeRule',
    //         ],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': [
    //             '',
    //             [
    //               'arn:',
    //               {
    //                 Ref: 'AWS::Partition',
    //               },
    //               ':events:',
    //               {
    //                 Ref: 'AWS::Region',
    //               },
    //               ':',
    //               {
    //                 Ref: 'AWS::AccountId',
    //               },
    //               ':rule/StepFunctionsGetEventsForBatchJobsRule',
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //     Version: '2012-10-17',
    //   },
    // });
  });
});

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot (established idiom, see
// test/aws/compute/batch/managed-compute-environment.test.ts).
describe("BatchSubmitJob synth", () => {
  test("BatchSubmitJob synthesizes and matches snapshot", () => {
    // GIVEN
    const app = Testing.app();
    const synthStack = new AwsStack(app, "TestStack");
    new HttpBackend(synthStack, { address: "http://localhost:3000" });

    const jobDefinition = new batch.EcsJobDefinition(
      synthStack,
      "JobDefinition",
      {
        container: new batch.EcsEc2ContainerDefinition(
          synthStack,
          "Container",
          {
            image: ecs.ContainerImage.fromRegistry(
              "public.ecr.aws/docker/library/python:3.13-alpine",
            ),
            cpu: 256,
            memory: Size.mebibytes(2048),
          },
        ),
      },
    );
    const jobQueue = new batch.JobQueue(synthStack, "JobQueue", {
      computeEnvironments: [
        {
          order: 1,
          computeEnvironment: new batch.ManagedEc2EcsComputeEnvironment(
            synthStack,
            "ComputeEnv",
            {
              vpc: new compute.Vpc(synthStack, "vpc"),
            },
          ),
        },
      ],
    });

    // WHEN
    const task = new BatchSubmitJob(synthStack, "Task", {
      jobDefinitionArn: jobDefinition.jobDefinitionArn,
      jobName: "JobName",
      jobQueueArn: jobQueue.jobQueueArn,
    });
    new compute.StateMachine(synthStack, "StateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(task),
    });

    // THEN
    synthStack.prepareStack();
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });
});
