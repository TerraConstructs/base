// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/gelf-log-driver.test.ts

import { ecsTaskDefinition } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { compute, AwsStack } from "../../../../src/aws";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let stack: AwsStack;
let td: compute.ecs.Ec2TaskDefinition;
const image = compute.ecs.ContainerImage.fromRegistry("test-image");

describe("gelf log driver", () => {
  beforeEach(() => {
    stack = newStack();
    td = new compute.ecs.Ec2TaskDefinition(stack, "TaskDefinition");
  });

  test("create a gelf log driver with minimum options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new compute.ecs.GelfLogDriver({
        address: "my-gelf-address",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const containerDefinitions = renderedContainerDefinitions(stack);
    expect(containerDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "gelf",
            options: {
              "gelf-address": "my-gelf-address",
            },
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'gelf',
    //         Options: {
    //           'gelf-address': 'my-gelf-address',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a gelf log driver using gelf with minimum options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: compute.ecs.LogDrivers.gelf({
        address: "my-gelf-address",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const containerDefinitions = renderedContainerDefinitions(stack);
    expect(containerDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "gelf",
            options: {
              "gelf-address": "my-gelf-address",
            },
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'gelf',
    //         Options: {
    //           'gelf-address': 'my-gelf-address',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });
});

// NOTE: not part of the upstream suite - added per harness convention (see
// test/aws/notify/queue.test.ts / test/aws/compute/auto-scaling/scheduled-action.test.ts
// for the idiom) to guard against emitted-Terraform drift for the
// aws_ecs_task_definition.container_definitions jsonencoded blob the GelfLogDriver
// contributes to.
describe("gelf log driver synth", () => {
  test("Should synth and match SnapShot with minimum options", () => {
    // GIVEN
    const synthStack = newStack();
    new HttpBackend(synthStack, gridBackendConfig);
    const synthTd = new compute.ecs.Ec2TaskDefinition(
      synthStack,
      "TaskDefinition",
    );

    // WHEN
    synthTd.addContainer("Container", {
      image,
      logging: new compute.ecs.GelfLogDriver({
        address: "my-gelf-address",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });
});

function newStack(): AwsStack {
  const app: App = Testing.app();
  return new AwsStack(app);
}

/**
 * `aws_ecs_task_definition.container_definitions` is a single jsonencode()'d string on
 * TerraConstructs (there is no CFN L1 layer / typed `ContainerDefinitionProperty[]` here -
 * see the `// TERRACONSTRUCTS DEVIATION` note on `ContainerDefinition.renderContainerDefinition`).
 * Parse it back out so assertions can target the `logConfiguration` of a single container the
 * same way upstream's `Match.objectLike` does against the CFN `ContainerDefinitions` array.
 */
function renderedContainerDefinitions(forStack: AwsStack): any[] {
  const template = new Template(forStack);
  const taskDefs = template.resourceTypeArray(
    ecsTaskDefinition.EcsTaskDefinition,
  ) as Array<{ container_definitions: string }>;
  expect(taskDefs).toHaveLength(1);
  return JSON.parse(taskDefs[0].container_definitions);
}
