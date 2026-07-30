// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/multinode-job-definition.test.ts

import { batchJobDefinition } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  batch,
} from "../../../../src/aws/compute";
import * as ecs from "../../../../src/aws/compute/ecs";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

test("MultiNodeJobDefinition respects mainNode", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
    containers: [
      {
        container: new batch.EcsEc2ContainerDefinition(
          stack,
          "MultinodeContainer",
          {
            cpu: 256,
            memory: Size.mebibytes(2048),
            image: ecs.ContainerImage.fromRegistry(
              "amazon/amazon-ecs-sample",
            ),
          },
        ),
        startNode: 0,
        endNode: 9,
      },
    ],
    mainNode: 5,
  });

  // THEN
  const [jobDefinition] = batchJobDefinitionsFor(stack);
  expect(jobDefinition.platform_capabilities).toEqual([
    batch.Compatibility.EC2,
  ]);
  const nodeProperties = JSON.parse(jobDefinition.node_properties);
  expect(nodeProperties.mainNode).toEqual(5);
  expect(nodeProperties.numNodes).toEqual(10);
  expect(nodeProperties.nodeRangeProperties).toEqual([
    expect.objectContaining({
      targetNodes: "0:9",
    }),
  ]);
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   NodeProperties: {
  //     MainNode: 5,
  //     NodeRangeProperties: [{
  //       Container: { },
  //       TargetNodes: '0:9',
  //     }],
  //     NumNodes: 10,
  //   },
  //   PlatformCapabilities: [Compatibility.EC2],
  // });
});

test("EcsJobDefinition respects propagateTags", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
    propagateTags: true,
    containers: [
      {
        container: new batch.EcsEc2ContainerDefinition(
          stack,
          "MultinodeContainer",
          {
            cpu: 256,
            memory: Size.mebibytes(2048),
            image: ecs.ContainerImage.fromRegistry(
              "amazon/amazon-ecs-sample",
            ),
          },
        ),
        startNode: 0,
        endNode: 9,
      },
    ],
    mainNode: 0,
  });

  // THEN
  const [jobDefinition] = batchJobDefinitionsFor(stack);
  expect(jobDefinition.propagate_tags).toEqual(true);
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   PropagateTags: true,
  // });
});

test("MultiNodeJobDefinition respects instanceType", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
    containers: [
      {
        container: new batch.EcsEc2ContainerDefinition(
          stack,
          "MultinodeContainer",
          {
            cpu: 256,
            memory: Size.mebibytes(2048),
            image: ecs.ContainerImage.fromRegistry(
              "amazon/amazon-ecs-sample",
            ),
          },
        ),
        startNode: 0,
        endNode: 9,
      },
    ],
    instanceType: InstanceType.of(InstanceClass.R4, InstanceSize.LARGE),
  });

  // THEN
  const [jobDefinition] = batchJobDefinitionsFor(stack);
  expect(jobDefinition.platform_capabilities).toEqual([
    batch.Compatibility.EC2,
  ]);
  const nodeProperties = JSON.parse(jobDefinition.node_properties);
  expect(nodeProperties.numNodes).toEqual(10);
  expect(nodeProperties.nodeRangeProperties).toEqual([
    expect.objectContaining({
      targetNodes: "0:9",
    }),
  ]);
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   NodeProperties: {
  //     NodeRangeProperties: [{
  //       Container: {
  //       },
  //       TargetNodes: '0:9',
  //     }],
  //     NumNodes: 10,
  //   },
  //   PlatformCapabilities: [Compatibility.EC2],
  // });
});

test("MultiNodeJobDefinition one container", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
    containers: [
      {
        container: new batch.EcsEc2ContainerDefinition(
          stack,
          "MultinodeContainer",
          {
            cpu: 256,
            memory: Size.mebibytes(2048),
            image: ecs.ContainerImage.fromRegistry(
              "amazon/amazon-ecs-sample",
            ),
          },
        ),
        startNode: 0,
        endNode: 9,
      },
    ],
    mainNode: 0,
  });

  // THEN
  const [jobDefinition] = batchJobDefinitionsFor(stack);
  expect(jobDefinition.platform_capabilities).toEqual([
    batch.Compatibility.EC2,
  ]);
  const nodeProperties = JSON.parse(jobDefinition.node_properties);
  expect(nodeProperties.mainNode).toEqual(0);
  expect(nodeProperties.numNodes).toEqual(10);
  expect(nodeProperties.nodeRangeProperties).toEqual([
    expect.objectContaining({
      targetNodes: "0:9",
    }),
  ]);
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   NodeProperties: {
  //     MainNode: 0,
  //     NodeRangeProperties: [{
  //       Container: {
  //       },
  //       TargetNodes: '0:9',
  //     }],
  //     NumNodes: 10,
  //   },
  //   PlatformCapabilities: [Compatibility.EC2],
  // });
});

test("MultiNodeJobDefinition two containers", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
    containers: [
      {
        container: new batch.EcsEc2ContainerDefinition(
          stack,
          "MultinodeContainer1",
          {
            cpu: 256,
            memory: Size.mebibytes(2048),
            image: ecs.ContainerImage.fromRegistry(
              "amazon/amazon-ecs-sample",
            ),
          },
        ),
        startNode: 0,
        endNode: 9,
      },
      {
        container: new batch.EcsEc2ContainerDefinition(
          stack,
          "MultinodeContainer2",
          {
            cpu: 512,
            memory: Size.mebibytes(4096),
            image: ecs.ContainerImage.fromRegistry(
              "amazon/amazon-ecs-sample",
            ),
          },
        ),
        startNode: 10,
        endNode: 14,
      },
    ],
    instanceType: InstanceType.of(InstanceClass.R4, InstanceSize.LARGE),
  });

  // THEN
  const [jobDefinition] = batchJobDefinitionsFor(stack);
  expect(jobDefinition.platform_capabilities).toEqual([
    batch.Compatibility.EC2,
  ]);
  const nodeProperties = JSON.parse(jobDefinition.node_properties);
  expect(nodeProperties.mainNode).toEqual(0);
  expect(nodeProperties.numNodes).toEqual(15);
  expect(nodeProperties.nodeRangeProperties).toEqual([
    expect.objectContaining({
      targetNodes: "0:9",
      container: expect.objectContaining({ instanceType: "r4.large" }),
    }),
    expect.objectContaining({
      targetNodes: "10:14",
      container: expect.objectContaining({ instanceType: "r4.large" }),
    }),
  ]);
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
  //   NodeProperties: {
  //     MainNode: 0,
  //     NodeRangeProperties: [
  //       {
  //         Container: {
  //           InstanceType: 'r4.large',
  //         },
  //         TargetNodes: '0:9',
  //       },
  //       {
  //         Container: {
  //           InstanceType: 'r4.large',
  //         },
  //         TargetNodes: '10:14',
  //       },
  //
  //     ],
  //     NumNodes: 15,
  //   },
  //   PlatformCapabilities: [Compatibility.EC2],
  // });
});

test("multinode job requires at least one container", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new batch.MultiNodeJobDefinition(stack, "ECSJobDefn");

  // THEN
  expect(() => {
    Template.fromStack(stack, { runValidations: true });
  }).toThrow(/multinode job has no containers!/);
  // expect(() => Template.fromStack(stack)).toThrow(/multinode job has no containers!/);
});

test("multinode job returns a dummy instance type when accessing `instanceType`", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  const jobDef = new batch.MultiNodeJobDefinition(stack, "ECSJobDefn");

  // THEN
  expect(jobDef.instanceType).toBeInstanceOf(batch.OptimalInstanceType);
});

// Repo-specific snapshot coverage (see conventions.md "Test-suite conventions": snapshots are the
// repo's main defense against emitted-Terraform drift).
describe("MultiNodeJobDefinition", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app: App = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });

    // WHEN
    new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
      containers: [
        {
          container: new batch.EcsEc2ContainerDefinition(
            stack,
            "MultinodeContainer1",
            {
              cpu: 256,
              memory: Size.mebibytes(2048),
              image: ecs.ContainerImage.fromRegistry(
                "amazon/amazon-ecs-sample",
              ),
            },
          ),
          startNode: 0,
          endNode: 9,
        },
        {
          container: new batch.EcsEc2ContainerDefinition(
            stack,
            "MultinodeContainer2",
            {
              cpu: 512,
              memory: Size.mebibytes(4096),
              image: ecs.ContainerImage.fromRegistry(
                "amazon/amazon-ecs-sample",
              ),
            },
          ),
          startNode: 10,
          endNode: 14,
        },
      ],
      instanceType: InstanceType.of(InstanceClass.R4, InstanceSize.LARGE),
      mainNode: 1,
      propagateTags: true,
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    gridBackendConfig,
  });
}

/**
 * `aws_batch_job_definition.node_properties` is a single jsonencode()'d string on the Terraform
 * resource (there is no per-node-range CFN-style typed `NodeRangePropertyProperty` block -- see
 * mappings/aws-batch.json CfnJobDefinition notes). Return the raw resource attribute map so both
 * top-level (snake_case) and jsonencoded nested fields can be asserted against, mirroring what the
 * upstream CFN `NodeProperties`/`PlatformCapabilities`/`PropagateTags` assertions checked.
 */
function batchJobDefinitionsFor(forStack: AwsStack): any[] {
  const template = new Template(forStack);
  return template.resourceTypeArray(
    batchJobDefinition.BatchJobDefinition,
  ) as any[];
}
