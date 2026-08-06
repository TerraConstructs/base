// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/ecs-job-definition.test.ts

import {
  batchJobDefinition,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import { Vpc, batch } from "../../../../src/aws/compute";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as iam from "../../../../src/aws/iam";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("EcsJobDefinition respects propagateTags", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.EcsJobDefinition(stack, "JobDefn", {
    propagateTags: true,
    container: new batch.EcsEc2ContainerDefinition(stack, "EcsContainer", {
      cpu: 256,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memory: Size.mebibytes(2048),
    }),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobDefinition.BatchJobDefinition,
    {
      propagate_tags: true,
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   PropagateTags: true,
  // });
});

test("EcsJobDefinition uses Compatibility.EC2 for EC2 containers", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.EcsJobDefinition(stack, "ECSJobDefn", {
    container: new batch.EcsEc2ContainerDefinition(stack, "EcsContainer", {
      cpu: 256,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memory: Size.mebibytes(2048),
    }),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobDefinition.BatchJobDefinition,
    {
      platform_capabilities: [batch.Compatibility.EC2],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   PlatformCapabilities: [Compatibility.EC2],
  // });
});

test("EcsJobDefinition uses Compatibility.FARGATE for Fargate containers", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.EcsJobDefinition(stack, "ECSJobDefn", {
    container: new batch.EcsFargateContainerDefinition(stack, "EcsContainer", {
      cpu: 256,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memory: Size.mebibytes(2048),
    }),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobDefinition.BatchJobDefinition,
    {
      platform_capabilities: [batch.Compatibility.FARGATE],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   PlatformCapabilities: [Compatibility.FARGATE],
  // });
});

test("EcsJobDefinition uses runtimePlatform for Fargate containers", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  new batch.EcsJobDefinition(stack, "ECSJobDefn", {
    container: new batch.EcsFargateContainerDefinition(stack, "EcsContainer", {
      cpu: 256,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memory: Size.mebibytes(2048),
      fargateCpuArchitecture: ecs.CpuArchitecture.ARM64,
      fargateOperatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    }),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchJobDefinition.BatchJobDefinition,
    {
      platform_capabilities: [batch.Compatibility.FARGATE],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   PlatformCapabilities: [Compatibility.FARGATE],
  // });
});

test("can be imported from ARN", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  const importedJob = batch.EcsJobDefinition.fromJobDefinitionArn(
    stack,
    "importedJobDefinition",
    "arn:aws:batch:us-east-1:123456789012:job-definition/job-def-name:1",
  );

  // THEN
  expect(importedJob.jobDefinitionArn).toEqual(
    "arn:aws:batch:us-east-1:123456789012:job-definition/job-def-name:1",
  );
});

test("JobDefinitionName is parsed from arn", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  const jobDefinition = new batch.EcsJobDefinition(stack, "JobDefn", {
    propagateTags: true,
    container: new batch.EcsEc2ContainerDefinition(stack, "EcsContainer", {
      cpu: 256,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memory: Size.mebibytes(2048),
    }),
  });

  // THEN
  // TERRACONSTRUCTS DEVIATION: upstream has no first-class "name" attribute on
  // AWS::Batch::JobDefinition, so jobDefinitionName is derived from the CFN-generated ARN via
  // nested Fn::Select/Fn::Split intrinsics (see the commented assertion below). The
  // aws_batch_job_definition Terraform resource instead exposes `name` as its own computed
  // attribute (ecs-job-definition.ts binds `this.jobDefinitionName = this.resource.name`
  // directly), so jobDefinitionName here resolves to a reference into that resource's `name`
  // attribute rather than to a derived ARN-parsing expression.
  expect(stack.resolve(jobDefinition.jobDefinitionName)).toEqual(
    expect.stringMatching(/^\$\{aws_batch_job_definition\.\w+\.name\}$/),
  );
  // expect(Tokenization.resolve(jobDefinition.jobDefinitionName, {
  //   scope: stack,
  //   resolver: new DefaultTokenResolver(new StringConcat()),
  // })).toEqual({
  //   'Fn::Select': [
  //     1,
  //     {
  //       'Fn::Split': [
  //         '/',
  //         {
  //           'Fn::Select': [
  //             5,
  //             {
  //               'Fn::Split': [
  //                 ':',
  //                 {
  //                   Ref: 'JobDefnA747EE6E',
  //                 },
  //               ],
  //             },
  //           ],
  //         },
  //       ],
  //     },
  //   ],
  // });
});

test("JobDefinitionName is parsed from arn in imported job", () => {
  // GIVEN
  const stack = newStack();

  // WHEN
  const importedJob = batch.EcsJobDefinition.fromJobDefinitionArn(
    stack,
    "importedJobDefinition",
    "arn:aws:batch:us-east-1:123456789012:job-definition/job-def-name:1",
  );

  // THEN
  expect(importedJob.jobDefinitionName).toEqual("job-def-name");
});

test("grantSubmitJob() grants the job role the correct actions", () => {
  // GIVEN
  const stack = newStack();
  const ecsJob = new batch.EcsJobDefinition(stack, "ECSJob", {
    container: new batch.EcsFargateContainerDefinition(stack, "EcsContainer", {
      cpu: 256,
      memory: Size.mebibytes(2048),
      image: ecs.ContainerImage.fromRegistry("foorepo/fooimage"),
    }),
  });
  const queue = new batch.JobQueue(stack, "queue");

  queue.addComputeEnvironment(
    new batch.ManagedEc2EcsComputeEnvironment(stack, "env", {
      vpc: new Vpc(stack, "VPC"),
    }),
    1,
  );

  const user = new iam.User(stack, "MyUser");

  // WHEN
  ecsJob.grantSubmitJob(user, queue);

  // THEN
  Template.synth(stack).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["batch:SubmitJob"],
          effect: "Allow",
          resources: [
            stack.resolve(ecsJob.jobDefinitionArn),
            stack.resolve(queue.jobQueueArn),
          ],
        },
      ],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
  //   PolicyDocument: {
  //     Statement: [{
  //       Action: 'batch:SubmitJob',
  //       Effect: 'Allow',
  //       Resource: [
  //         { Ref: 'ECSJobFFFEA569' },
  //         { 'Fn::GetAtt': ['queue276F7297', 'JobQueueArn'] },
  //       ],
  //     }],
  //     Version: '2012-10-17',
  //   },
  //   PolicyName: 'MyUserDefaultPolicy7B897426',
  // });
});

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/batch/scheduling-policy.test.ts for the
// harness idiom) - guards against emitted-Terraform drift for the aws_batch_job_definition
// resource that EcsJobDefinition creates.
describe("EcsJobDefinition", () => {
  test("Should synth and match SnapShot for EC2 container", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);

    // WHEN
    new batch.EcsJobDefinition(stack, "JobDefn", {
      propagateTags: true,
      container: new batch.EcsEc2ContainerDefinition(stack, "EcsContainer", {
        cpu: 256,
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memory: Size.mebibytes(2048),
      }),
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot for Fargate container with runtimePlatform", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);

    // WHEN
    new batch.EcsJobDefinition(stack, "JobDefn", {
      container: new batch.EcsFargateContainerDefinition(
        stack,
        "EcsContainer",
        {
          cpu: 256,
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memory: Size.mebibytes(2048),
          fargateCpuArchitecture: ecs.CpuArchitecture.ARM64,
          fargateOperatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      ),
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
