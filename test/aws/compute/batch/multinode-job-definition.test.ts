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
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
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
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
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
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
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
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
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
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
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
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
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

// ---------------------------------------------------------------------------
// TERRACONSTRUCTS additions (no upstream counterparts) - regression tests for
// the PR #136 review findings on MultiNodeJobDefinition.
// ---------------------------------------------------------------------------

function ec2Container(stack: AwsStack, id: string) {
  return new batch.EcsEc2ContainerDefinition(stack, id, {
    cpu: 256,
    memory: Size.mebibytes(2048),
    image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
  });
}

describe("multinode rejects Fargate containers", () => {
  // AWS Batch does not support Fargate for multi-node parallel jobs; the rendered
  // config is rejected at RegisterJobDefinition time (verified live: ClientException
  // "networkConfiguration not applicable for EC2.").
  test("at construction", () => {
    const stack = getAwsStack();
    expect(() => {
      new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
        containers: [
          {
            container: new batch.EcsFargateContainerDefinition(
              stack,
              "FargateCtr",
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
      });
    }).toThrow(/multi-node parallel jobs support only EC2/);
  });

  test("via addContainer()", () => {
    const stack = getAwsStack();
    const jobDefn = new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
      containers: [
        { container: ec2Container(stack, "Ec2Ctr"), startNode: 0, endNode: 9 },
      ],
    });
    expect(() => {
      jobDefn.addContainer({
        container: new batch.EcsFargateContainerDefinition(
          stack,
          "FargateCtr",
          {
            cpu: 256,
            memory: Size.mebibytes(2048),
            image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          },
        ),
        startNode: 10,
        endNode: 14,
      });
    }).toThrow(/multi-node parallel jobs support only EC2/);
  });
});

test("fromJobDefinitionArn strips the :revision suffix like EcsJobDefinition", () => {
  // upstream keeps the revision in the imported name; stripped here for consistency
  // with EcsJobDefinition.fromJobDefinitionArn (the revision belongs to the ARN).
  const stack = getAwsStack();
  const arn =
    "arn:aws:batch:us-east-1:111122223333:job-definition/my-job-def:7";

  const imported = batch.MultiNodeJobDefinition.fromJobDefinitionArn(
    stack,
    "Imported",
    arn,
  );

  expect(imported.jobDefinitionArn).toEqual(arn);
  expect(imported.jobDefinitionName).toEqual("my-job-def");
});

describe("multinode node-range topology validation", () => {
  // upstream only checks non-emptiness: gapped ranges undercount numNodes, overlapping
  // ranges overcount, inverted ranges can produce a negative numNodes, and mainNode is
  // never checked - all deferring a malformed node_properties failure to Terraform/AWS.
  function synthWithRanges(
    ranges: Array<{ startNode: number; endNode: number }>,
    mainNode?: number,
  ) {
    const stack = getAwsStack();
    new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
      mainNode,
      containers: ranges.map((r, i) => ({
        container: ec2Container(stack, `Ctr${i}`),
        ...r,
      })),
    });
    return () => Template.fromStack(stack, { runValidations: true });
  }

  test("rejects gapped ranges", () => {
    expect(
      synthWithRanges([
        { startNode: 0, endNode: 3 },
        { startNode: 8, endNode: 10 },
      ]),
    ).toThrow(/are not covered by any range/);
  });

  test("accepts AWS-supported nested override ranges and derives numNodes from the covered topology", () => {
    // https://docs.aws.amazon.com/batch/latest/APIReference/API_NodeRangeProperty.html:
    // a nested range (4:5 inside 0:10) overrides properties of the enclosing range.
    // numNodes must be 11 (highest node + 1), not 13 (upstream's sum of lengths).
    const stack = getAwsStack();
    new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
      containers: [
        { container: ec2Container(stack, "Outer"), startNode: 0, endNode: 10 },
        { container: ec2Container(stack, "Nested"), startNode: 4, endNode: 5 },
      ],
    });
    Template.fromStack(stack, { runValidations: true });

    const jobDefn = batchJobDefinitionsFor(stack)[0];
    const nodeProperties = JSON.parse(jobDefn.node_properties);
    expect(nodeProperties.numNodes).toEqual(11);
    expect(
      nodeProperties.nodeRangeProperties.map((n: any) => n.targetNodes),
    ).toEqual(["0:10", "4:5"]);
  });

  test("rejects more than five node groups (AWS limit); accepts exactly five", () => {
    // https://docs.aws.amazon.com/batch/latest/userguide/mnp-node-groups.html
    const five = Array.from({ length: 5 }, (_, i) => ({
      startNode: i,
      endNode: i,
    }));
    synthWithRanges(five)();

    const six = Array.from({ length: 6 }, (_, i) => ({
      startNode: i,
      endNode: i,
    }));
    expect(synthWithRanges(six)).toThrow(
      /no more than five node groups, got 6/,
    );
  });

  test("re-validates at synth: Fargate container pushed directly onto the public containers array is rejected", () => {
    // the eager constructor/addContainer guards can be bypassed by mutating the
    // public mutable array - synth-time validation over the current contents
    // must still catch it.
    const stack = getAwsStack();
    const jobDefn = new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
      containers: [
        { container: ec2Container(stack, "Ec2Ctr"), startNode: 0, endNode: 9 },
      ],
    });
    jobDefn.containers.push({
      container: new batch.EcsFargateContainerDefinition(stack, "FargateCtr", {
        cpu: 256,
        memory: Size.mebibytes(2048),
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      }),
      startNode: 10,
      endNode: 14,
    });
    expect(() => Template.fromStack(stack, { runValidations: true })).toThrow(
      /multi-node parallel jobs support only EC2/,
    );
  });

  test("rejects inverted ranges", () => {
    expect(synthWithRanges([{ startNode: 5, endNode: 2 }])).toThrow(
      /endNode must be >= startNode/,
    );
  });

  test("rejects negative startNode", () => {
    expect(synthWithRanges([{ startNode: -1, endNode: 2 }])).toThrow(
      /startNode must be non-negative/,
    );
  });

  test("rejects ranges that do not start at node 0", () => {
    expect(synthWithRanges([{ startNode: 1, endNode: 4 }])).toThrow(
      /must start at node 0/,
    );
  });

  test("rejects mainNode outside the configured ranges", () => {
    expect(synthWithRanges([{ startNode: 0, endNode: 9 }], 99)).toThrow(
      /mainNode 99 is not covered/,
    );
  });

  test("accepts contiguous multi-range topologies and derives a consistent numNodes", () => {
    const stack = getAwsStack();
    new batch.MultiNodeJobDefinition(stack, "ECSJobDefn", {
      mainNode: 5,
      containers: [
        { container: ec2Container(stack, "A"), startNode: 0, endNode: 9 },
        { container: ec2Container(stack, "B"), startNode: 10, endNode: 14 },
      ],
    });
    Template.fromStack(stack, { runValidations: true });

    const jobDefn = batchJobDefinitionsFor(stack)[0];
    const nodeProperties = JSON.parse(jobDefn.node_properties);
    expect(nodeProperties.numNodes).toEqual(15);
    expect(nodeProperties.mainNode).toEqual(5);
  });
});
