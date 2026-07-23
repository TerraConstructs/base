// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/fluentd-log-driver.test.ts

import { ecsTaskDefinition } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as ecs from "../../../../src/aws/compute/ecs";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

let stack: AwsStack;
let td: ecs.Ec2TaskDefinition;
const image = ecs.ContainerImage.fromRegistry("test-image");

describe("fluentd log driver", () => {
  beforeEach(() => {
    stack = getAwsStack();
    td = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
  });

  test("create a fluentd log driver with options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.FluentdLogDriver({
        tag: "hello",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = renderedContainerDefinitions(stack);
    expect(container.logConfiguration).toEqual(
      expect.objectContaining({
        logDriver: "fluentd",
        options: expect.objectContaining({
          tag: "hello",
        }),
      }),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'fluentd',
    //         Options: {
    //           tag: 'hello',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a fluentd log driver without options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.FluentdLogDriver(),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = renderedContainerDefinitions(stack);
    expect(container.logConfiguration).toEqual(
      expect.objectContaining({
        logDriver: "fluentd",
      }),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'fluentd',
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a fluentd log driver with all possible options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.FluentdLogDriver({
        address: "localhost:24224",
        asyncConnect: true,
        async: true,
        bufferLimit: 128,
        retryWait: Duration.seconds(1),
        maxRetries: 4294967295,
        subSecondPrecision: false,
        tag: "my-tag",
        labels: ["one", "two", "three"],
        env: ["one", "two", "three"],
        envRegex: "[0-9]{1}",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = renderedContainerDefinitions(stack);
    expect(container.logConfiguration).toEqual(
      expect.objectContaining({
        logDriver: "fluentd",
        options: expect.objectContaining({
          "fluentd-address": "localhost:24224",
          "fluentd-async-connect": "true",
          "fluentd-async": "true",
          "fluentd-buffer-limit": "128",
          "fluentd-retry-wait": "1",
          "fluentd-max-retries": "4294967295",
          "fluentd-sub-second-precision": "false",
          tag: "my-tag",
          labels: "one,two,three",
          env: "one,two,three",
          "env-regex": "[0-9]{1}",
        }),
      }),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'fluentd',
    //         Options: {
    //           'fluentd-address': 'localhost:24224',
    //           'fluentd-async-connect': 'true',
    //           'fluentd-async': 'true',
    //           'fluentd-buffer-limit': '128',
    //           'fluentd-retry-wait': '1',
    //           'fluentd-max-retries': '4294967295',
    //           'fluentd-sub-second-precision': 'false',
    //           'tag': 'my-tag',
    //           'labels': 'one,two,three',
    //           'env': 'one,two,three',
    //           'env-regex': '[0-9]{1}',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a fluentd log driver using fluentd", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.fluentd(),
      memoryLimitMiB: 128,
    });

    // THEN
    const [container] = renderedContainerDefinitions(stack);
    expect(container.logConfiguration).toEqual(
      expect.objectContaining({
        logDriver: "fluentd",
      }),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'fluentd',
    //       },
    //     }),
    //   ],
    // });
  });
});

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/ecs/app-mesh-proxy-configuration.test.ts
// for the harness idiom) - guards against emitted-Terraform drift for the jsonencode()'d
// `container_definitions` string that FluentdLogDriver's rendered options land in.
describe("FluentdLogDriver", () => {
  test("Should synth and match SnapShot with all possible options", () => {
    // GIVEN
    const snapStack = getAwsStack();
    const snapTd = new ecs.Ec2TaskDefinition(snapStack, "TaskDefinition");

    // WHEN
    snapTd.addContainer("Container", {
      image,
      logging: new ecs.FluentdLogDriver({
        address: "localhost:24224",
        asyncConnect: true,
        async: true,
        bufferLimit: 128,
        retryWait: Duration.seconds(1),
        maxRetries: 4294967295,
        subSecondPrecision: false,
        tag: "my-tag",
        labels: ["one", "two", "three"],
        env: ["one", "two", "three"],
        envRegex: "[0-9]{1}",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    snapStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(snapStack)).toMatchSnapshot();
  });
});

/**
 * Parses the jsonencode()'d `container_definitions` string off the single
 * `aws_ecs_task_definition` resource in the stack (see the `TERRACONSTRUCTS DEVIATION` note on
 * `TaskDefinition` in `src/aws/compute/ecs/base/task-definition.ts` -- upstream's typed
 * `ContainerDefinitions` Cfn array has no typed TF counterpart, it is rendered as a single JSON
 * string instead).
 */
function renderedContainerDefinitions(target: AwsStack): any[] {
  const resources = Template.resourceObjects(
    target,
    ecsTaskDefinition.EcsTaskDefinition,
  ) as Record<string, { container_definitions: string }>;
  const [taskDef] = Object.values(resources);
  return JSON.parse(taskDef.container_definitions);
}

function getAwsStack(): AwsStack {
  const app = Testing.app();
  const newStack = new AwsStack(app, "TestStack", {
    gridBackendConfig: { address: "http://localhost:3000" },
  });
  return newStack;
}
