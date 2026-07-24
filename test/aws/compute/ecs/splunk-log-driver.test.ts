// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/splunk-log-driver.test.ts

import { ecsTaskDefinition } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as encryption from "../../../../src/aws/encryption";
import * as storage from "../../../../src/aws/storage";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("SplunkLogDriver", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    const snapTd = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
    const snapSecret = encryption.Secret.fromSecretNameV2(
      stack,
      "Secret",
      "my-splunk-token",
    );
    // WHEN
    snapTd.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("test-image"),
      logging: new ecs.SplunkLogDriver({
        secretToken: ecs.Secret.fromSecretsManager(snapSecret),
        url: "my-splunk-url",
      }),
      memoryLimitMiB: 128,
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with sourceType and ssm secret", () => {
    // GIVEN
    const stack = getAwsStack();
    const snapTd = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
    const parameter =
      storage.StringParameter.fromSecureStringParameterAttributes(
        stack,
        "Parameter",
        {
          parameterName: "/token",
          version: 1,
        },
      );
    // WHEN
    snapTd.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("test-image"),
      logging: ecs.LogDrivers.splunk({
        secretToken: ecs.Secret.fromSsmParameter(parameter),
        url: "my-splunk-url",
        sourceType: "my-source-type",
      }),
      memoryLimitMiB: 128,
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

let stack: AwsStack;
let td: ecs.Ec2TaskDefinition;
let secret: encryption.ISecret;
let image: ecs.ContainerImage;

describe("splunk log driver", () => {
  beforeEach(() => {
    stack = getAwsStack();
    td = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
    secret = encryption.Secret.fromSecretNameV2(
      stack,
      "Secret",
      "my-splunk-token",
    );
    image = ecs.ContainerImage.fromRegistry("test-image");
  });

  test("create a splunk log driver with minimum options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.SplunkLogDriver({
        secretToken: ecs.Secret.fromSecretsManager(secret),
        url: "my-splunk-url",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [containerDefinition] = renderedContainerDefinitions(stack);
    expect(containerDefinition).toMatchObject({
      logConfiguration: {
        logDriver: "splunk",
        options: {
          "splunk-url": "my-splunk-url",
        },
        secretOptions: [
          {
            name: "splunk-token",
            valueFrom: stack.resolve(secret.secretArn),
          },
        ],
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'splunk',
    //         Options: {
    //           'splunk-url': 'my-splunk-url',
    //         },
    //         SecretOptions: [{
    //           Name: 'splunk-token',
    //           ValueFrom: {
    //             'Fn::Join': ['', ['arn:',
    //               { Ref: 'AWS::Partition' }, ':secretsmanager:', { Ref: 'AWS::Region' }, ':',
    //               { Ref: 'AWS::AccountId' }, ':secret:my-splunk-token']],
    //           },
    //         }],
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a splunk log driver using splunk with minimum options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.splunk({
        secretToken: ecs.Secret.fromSecretsManager(secret),
        url: "my-splunk-url",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [containerDefinition] = renderedContainerDefinitions(stack);
    expect(containerDefinition).toMatchObject({
      logConfiguration: {
        logDriver: "splunk",
        options: {
          "splunk-url": "my-splunk-url",
        },
        secretOptions: [
          {
            name: "splunk-token",
            valueFrom: stack.resolve(secret.secretArn),
          },
        ],
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'splunk',
    //         Options: {
    //           'splunk-url': 'my-splunk-url',
    //         },
    //         SecretOptions: [{
    //           Name: 'splunk-token',
    //           ValueFrom: {
    //             'Fn::Join': ['', ['arn:',
    //               { Ref: 'AWS::Partition' }, ':secretsmanager:', { Ref: 'AWS::Region' }, ':',
    //               { Ref: 'AWS::AccountId' }, ':secret:my-splunk-token']],
    //           },
    //         }],
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a splunk log driver using splunk with sourcetype defined", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.splunk({
        secretToken: ecs.Secret.fromSecretsManager(secret),
        url: "my-splunk-url",
        sourceType: "my-source-type",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [containerDefinition] = renderedContainerDefinitions(stack);
    expect(containerDefinition).toMatchObject({
      logConfiguration: {
        logDriver: "splunk",
        options: {
          "splunk-url": "my-splunk-url",
          "splunk-sourcetype": "my-source-type",
        },
        secretOptions: [
          {
            name: "splunk-token",
            valueFrom: stack.resolve(secret.secretArn),
          },
        ],
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'splunk',
    //         Options: {
    //           'splunk-url': 'my-splunk-url',
    //           'splunk-sourcetype': 'my-source-type',
    //         },
    //         SecretOptions: [{
    //           Name: 'splunk-token',
    //           ValueFrom: {
    //             'Fn::Join': ['', ['arn:',
    //               { Ref: 'AWS::Partition' }, ':secretsmanager:', { Ref: 'AWS::Region' }, ':',
    //               { Ref: 'AWS::AccountId' }, ':secret:my-splunk-token']],
    //           },
    //         }],
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a splunk log driver using secret splunk token from a new secret", () => {
    const secret2 = new encryption.Secret(stack, "Secret2");
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.splunk({
        secretToken: ecs.Secret.fromSecretsManager(secret2),
        url: "my-splunk-url",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [containerDefinition] = renderedContainerDefinitions(stack);
    expect(containerDefinition).toMatchObject({
      logConfiguration: {
        logDriver: "splunk",
        options: {
          "splunk-url": "my-splunk-url",
        },
        secretOptions: [
          {
            name: "splunk-token",
            valueFrom: stack.resolve(secret2.secretArn),
          },
        ],
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'splunk',
    //         Options: {
    //           'splunk-url': 'my-splunk-url',
    //         },
    //         SecretOptions: [
    //           {
    //             Name: 'splunk-token',
    //             ValueFrom: {
    //               Ref: 'Secret244EA3BB5',
    //             },
    //           },
    //         ],
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a splunk log driver using secret splunk token from systems manager parameter store", () => {
    const parameter =
      storage.StringParameter.fromSecureStringParameterAttributes(
        stack,
        "Parameter",
        {
          parameterName: "/token",
          version: 1,
        },
      );
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.splunk({
        secretToken: ecs.Secret.fromSsmParameter(parameter),
        url: "my-splunk-url",
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const [containerDefinition] = renderedContainerDefinitions(stack);
    expect(containerDefinition).toMatchObject({
      logConfiguration: {
        logDriver: "splunk",
        options: {
          "splunk-url": "my-splunk-url",
        },
        secretOptions: [
          {
            name: "splunk-token",
            valueFrom: stack.resolve(parameter.parameterArn),
          },
        ],
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'splunk',
    //         Options: {
    //           'splunk-url': 'my-splunk-url',
    //         },
    //         SecretOptions: [
    //           {
    //             Name: 'splunk-token',
    //             ValueFrom: {
    //               'Fn::Join': [
    //                 '',
    //                 [
    //                   'arn:',
    //                   {
    //                     Ref: 'AWS::Partition',
    //                   },
    //                   ':ssm:',
    //                   {
    //                     Ref: 'AWS::Region',
    //                   },
    //                   ':',
    //                   {
    //                     Ref: 'AWS::AccountId',
    //                   },
    //                   ':parameter/token',
    //                 ],
    //               ],
    //             },
    //           },
    //         ],
    //       },
    //     }),
    //   ],
    // });
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    gridBackendConfig,
  });
}

/**
 * Renders the (jsonencoded) `container_definitions` of the single
 * `aws_ecs_task_definition` resource in the stack back into plain JS objects,
 * so individual container `logConfiguration` entries can be asserted against
 * -- mirroring the partial-match semantics of upstream's `Match.objectLike`
 * over `ContainerDefinitions`.
 */
function renderedContainerDefinitions(s: AwsStack): any[] {
  const template = new Template(s);
  const resources = template.resourcesByType(
    ecsTaskDefinition.EcsTaskDefinition,
  ) as Record<string, { container_definitions: string }>;
  const [taskDefinition] = Object.values(resources);
  return JSON.parse(taskDefinition.container_definitions);
}
