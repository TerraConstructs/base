// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/journald-log-driver.test.ts

import { ecsTaskDefinition } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as compute from "../../../../src/aws/compute";
import { Template } from "../../../assertions";

const ecs = compute.ecs;

let stack: AwsStack;
let td: compute.ecs.TaskDefinition;
const image = ecs.ContainerImage.fromRegistry("test-image");

describe("journald log driver", () => {
  beforeEach(() => {
    stack = getAwsStack();
    td = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
  });

  test("create a journald log driver with options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.JournaldLogDriver({
        tag: "hello",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = containerDefinitionsFor(stack);
    expect(container.logConfiguration).toEqual({
      logDriver: "journald",
      options: {
        tag: "hello",
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'journald',
    //         Options: {
    //           tag: 'hello',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a journald log driver without options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.JournaldLogDriver(),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = containerDefinitionsFor(stack);
    expect(container.logConfiguration).toMatchObject({
      logDriver: "journald",
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'journald',
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a journald log driver using journald", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.journald(),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = containerDefinitionsFor(stack);
    expect(container.logConfiguration).toEqual({
      logDriver: "journald",
      options: {},
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'journald',
    //         Options: {},
    //       },
    //     }),
    //   ],
    // });
  });
});

// Repo-specific snapshot coverage (see conventions.md "Test-suite conventions": snapshots are the
// repo's main defense against emitted-Terraform drift).
describe("JournaldLogDriver", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app: App = Testing.app();
    const snapStack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(snapStack, { address: "http://localhost:3000" });
    const snapTd = new ecs.Ec2TaskDefinition(snapStack, "TaskDefinition");

    // WHEN
    snapTd.addContainer("Container", {
      image,
      logging: new ecs.JournaldLogDriver({
        tag: "hello",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    snapStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(snapStack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app: App = Testing.app();
  return new AwsStack(app);
}

/**
 * `aws_ecs_task_definition.container_definitions` is a single jsonencode()'d
 * string on the Terraform resource (there is no per-container CFN-style
 * nested block -- see conventions.md mapping notes for CfnTaskDefinition).
 * Parse it back out so individual container `logConfiguration` entries can be
 * asserted against, mirroring what the upstream CFN `ContainerDefinitions[].LogConfiguration`
 * assertions checked.
 */
function containerDefinitionsFor(forStack: AwsStack): any[] {
  const template = new Template(forStack);
  const [taskDefinition] = template.resourceTypeArray(
    ecsTaskDefinition.EcsTaskDefinition,
  ) as Array<{ container_definitions: string }>;
  return JSON.parse(taskDefinition.container_definitions);
}
