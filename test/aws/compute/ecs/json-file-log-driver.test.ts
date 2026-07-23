// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/json-file-log-driver.test.ts

import { ecsTaskDefinition } from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as ecs from "../../../../src/aws/compute/ecs";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let stack: AwsStack;
let td: ecs.Ec2TaskDefinition;
const image = ecs.ContainerImage.fromRegistry("test-image");

describe("json file log driver", () => {
  beforeEach(() => {
    stack = new AwsStack(Testing.app());
    td = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
  });

  test("create a json-file log driver with options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.JsonFileLogDriver({
        env: ["hello"],
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "json-file",
          options: {
            env: "hello",
          },
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'json-file',
    //         Options: {
    //           env: 'hello',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a json-file log driver without options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.JsonFileLogDriver(),
      memoryLimitMiB: 128,
    });

    // THEN
    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "json-file",
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'json-file',
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a json-file log driver using json-file", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.jsonFile(),
      memoryLimitMiB: 128,
    });

    // THEN
    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "json-file",
          options: {},
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'json-file',
    //         Options: {},
    //       },
    //     }),
    //   ],
    // });
  });
});

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/auto-scaling/warm-pool.test.ts
// for the harness idiom) - guards against emitted-Terraform drift for the
// jsonencoded `container_definitions` blob the json-file log driver
// contributes `logConfiguration` to.
describe("json file log driver synth", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app = Testing.app();
    const synthStack = new AwsStack(app);
    new HttpBackend(synthStack, gridBackendConfig);
    const taskDefinition = new ecs.Ec2TaskDefinition(
      synthStack,
      "TaskDefinition",
    );

    // WHEN
    taskDefinition.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("test-image"),
      logging: ecs.LogDrivers.jsonFile({
        env: ["hello"],
        maxSize: "10m",
        maxFile: 3,
        compress: true,
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });
});

/**
 * Synth `s` and return the parsed `container_definitions` JSON blob (a
 * single jsonencode()'d string attribute on the sole `aws_ecs_task_definition`
 * resource) as a plain array of container definition objects.
 *
 * TERRACONSTRUCTS DEVIATION: upstream asserts against the CloudFormation
 * `ContainerDefinitions` list via `Template.hasResourceProperties` +
 * `Match.objectLike`. The TF provider models `container_definitions` as a
 * single jsonencode()'d string (see base/task-definition.ts), so there is no
 * nested-block matcher to assert against -- decode the string and use Jest's
 * `toMatchObject` (subset/partial match, mirroring `Match.objectLike`
 * semantics) instead.
 */
function renderContainerDefinitions(s: AwsStack): any[] {
  const template = new Template(s);
  const [taskDef] = template.resourceTypeArray(
    ecsTaskDefinition.EcsTaskDefinition,
  ) as { container_definitions: string }[];
  return JSON.parse(taskDef.container_definitions);
}
