// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/firelens-log-driver.test.ts

import {
  dataAwsIamPolicyDocument,
  ecsTaskDefinition,
} from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as encryption from "../../../../src/aws/encryption";
import * as storage from "../../../../src/aws/storage";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

let stack: AwsStack;
let td: ecs.Ec2TaskDefinition;
const image = ecs.ContainerImage.fromRegistry("test-image");

/**
 * TERRACONSTRUCTS DEVIATION: upstream renders each container to a typed
 * `CfnTaskDefinition.ContainerDefinitionProperty` array element and asserts on it via
 * `Template.hasResourceProperties('AWS::ECS::TaskDefinition', { ContainerDefinitions: [...] })`.
 * The `aws_ecs_task_definition` TF resource instead jsonencodes the whole containers array into a
 * single `container_definitions` string attribute (see mappings/aws-ecs.json). `Template` (from
 * `test/assertions.ts`) forces `prepareStack()` before synth same as upstream; the containers array
 * still needs to be pulled out of that one string attribute and JSON-parsed here.
 */
function containersOf(template: Template): any[] {
  const taskDefs = template.resourcesByType(
    ecsTaskDefinition.EcsTaskDefinition,
  );
  const taskDef = Object.values(taskDefs)[0] as {
    container_definitions: string;
  };
  return JSON.parse(taskDef.container_definitions);
}

function policyDocumentsOf(template: Template): any[] {
  return template.dataSourceTypeArray(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
  );
}

describe("firelens log driver snapshots", () => {
  test("Should synth and match SnapShot with default options", () => {
    // GIVEN
    const app = Testing.app();
    const snapStack = new AwsStack(app, "TestStack");
    new HttpBackend(snapStack, gridBackendConfig);
    const snapTd = new ecs.Ec2TaskDefinition(snapStack, "TaskDefinition");

    // WHEN
    snapTd.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({}),
      memoryLimitMiB: 128,
    });

    // THEN
    snapStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(snapStack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with secret options", () => {
    // GIVEN
    const app = Testing.app();
    const snapStack = new AwsStack(app, "TestStack");
    new HttpBackend(snapStack, gridBackendConfig);
    const snapTd = new ecs.Ec2TaskDefinition(snapStack, "TaskDefinition");
    const secret = new encryption.Secret(snapStack, "Secret");
    const parameter =
      storage.StringParameter.fromSecureStringParameterAttributes(
        snapStack,
        "Parameter",
        {
          parameterName: "/host",
          version: 1,
        },
      );

    // WHEN
    snapTd.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: "datadog",
          TLS: "on",
          dd_service: "my-httpd-service",
          dd_source: "httpd",
          dd_tags: "project:example",
          provider: "ecs",
        },
        secretOptions: {
          apikey: ecs.Secret.fromSecretsManager(secret),
          Host: ecs.Secret.fromSsmParameter(parameter),
        },
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    snapStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(snapStack)).toMatchSnapshot();
  });
});

describe("firelens log driver", () => {
  beforeEach(() => {
    stack = new AwsStack(Testing.app());
    td = new ecs.Ec2TaskDefinition(stack, "TaskDefinition");
  });

  test("create a firelens log driver with default options", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({}),
      memoryLimitMiB: 128,
    });

    // THEN
    const containers = containersOf(new Template(stack));
    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "awsfirelens",
          },
        }),
        expect.objectContaining({
          essential: true,
          firelensConfiguration: {
            type: "fluentbit",
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awsfirelens',
    //       },
    //     }),
    //     Match.objectLike({
    //       Essential: true,
    //       FirelensConfiguration: {
    //         Type: 'fluentbit',
    //       },
    //     }),
    //   ],
    // });
  });

  test("create a firelens log driver with secret options", () => {
    const secret = new encryption.Secret(stack, "Secret");
    const parameter =
      storage.StringParameter.fromSecureStringParameterAttributes(
        stack,
        "Parameter",
        {
          parameterName: "/host",
          version: 1,
        },
      );

    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: "datadog",
          TLS: "on",
          dd_service: "my-httpd-service",
          dd_source: "httpd",
          dd_tags: "project:example",
          provider: "ecs",
        },
        secretOptions: {
          apikey: ecs.Secret.fromSecretsManager(secret),
          Host: ecs.Secret.fromSsmParameter(parameter),
        },
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const template = new Template(stack);
    const containers = containersOf(template);

    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "awsfirelens",
            options: {
              Name: "datadog",
              TLS: "on",
              dd_service: "my-httpd-service",
              dd_source: "httpd",
              dd_tags: "project:example",
              provider: "ecs",
            },
            secretOptions: [
              { name: "apikey", valueFrom: stack.resolve(secret.secretArn) },
              {
                name: "Host",
                valueFrom: stack.resolve(parameter.parameterArn),
              },
            ],
          },
        }),
        expect.objectContaining({
          essential: true,
          firelensConfiguration: {
            type: "fluentbit",
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awsfirelens',
    //         Options: {
    //           Name: 'datadog',
    //           TLS: 'on',
    //           dd_service: 'my-httpd-service',
    //           dd_source: 'httpd',
    //           dd_tags: 'project:example',
    //           provider: 'ecs',
    //         },
    //         SecretOptions: [
    //           {
    //             Name: 'apikey',
    //             ValueFrom: { Ref: 'SecretA720EF05' },
    //           },
    //           {
    //             Name: 'Host',
    //             ValueFrom: {
    //               'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ssm:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':parameter/host']],
    //             },
    //           },
    //         ],
    //       },
    //     }),
    //     Match.objectLike({
    //       Essential: true,
    //       FirelensConfiguration: { Type: 'fluentbit' },
    //     }),
    //   ],
    // });

    expect(policyDocumentsOf(template)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
              ],
              effect: "Allow",
              resources: [stack.resolve(secret.secretArn)],
            }),
          ]),
        }),
        expect.objectContaining({
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: [
                "ssm:DescribeParameters",
                "ssm:GetParameters",
                "ssm:GetParameter",
                "ssm:GetParameterHistory",
              ],
              effect: "Allow",
              resources: [stack.resolve(parameter.parameterArn)],
            }),
          ]),
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: Match.arrayWith([
    //       {
    //         Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
    //         Effect: 'Allow',
    //         Resource: { Ref: 'SecretA720EF05' },
    //       },
    //       {
    //         Action: ['ssm:DescribeParameters', 'ssm:GetParameters', 'ssm:GetParameter', 'ssm:GetParameterHistory'],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ssm:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':parameter/host']],
    //         },
    //       },
    //     ]),
    //     Version: '2012-10-17',
    //   },
    // });
  });

  test("create a firelens log driver to route logs to CloudWatch Logs with Fluent Bit", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: "cloudwatch",
          region: "us-west-2",
          log_group_name: "firelens-fluent-bit",
          auto_create_group: "true",
          log_stream_prefix: "from-fluent-bit",
        },
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const containers = containersOf(new Template(stack));
    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "awsfirelens",
            options: {
              Name: "cloudwatch",
              region: "us-west-2",
              log_group_name: "firelens-fluent-bit",
              auto_create_group: "true",
              log_stream_prefix: "from-fluent-bit",
            },
          },
        }),
        expect.objectContaining({
          essential: true,
          firelensConfiguration: {
            type: "fluentbit",
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awsfirelens',
    //         Options: {
    //           Name: 'cloudwatch',
    //           region: 'us-west-2',
    //           log_group_name: 'firelens-fluent-bit',
    //           auto_create_group: 'true',
    //           log_stream_prefix: 'from-fluent-bit',
    //         },
    //       },
    //     }),
    //     Match.objectLike({
    //       Essential: true,
    //       FirelensConfiguration: { Type: 'fluentbit' },
    //     }),
    //   ],
    // });
  });

  test("create a firelens log driver to route logs to CloudWatch Logs with log_retention_days option", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: "cloudwatch",
          region: "us-west-2",
          log_group_name: "firelens-fluent-bit",
          auto_create_group: "true",
          log_stream_prefix: "from-fluent-bit",
          log_retention_days: "1",
        },
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const template = new Template(stack);
    const containers = containersOf(template);
    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "awsfirelens",
            options: {
              Name: "cloudwatch",
              region: "us-west-2",
              log_group_name: "firelens-fluent-bit",
              auto_create_group: "true",
              log_stream_prefix: "from-fluent-bit",
              log_retention_days: "1",
            },
          },
        }),
        expect.objectContaining({
          essential: true,
          firelensConfiguration: {
            type: "fluentbit",
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awsfirelens',
    //         Options: {
    //           Name: 'cloudwatch',
    //           region: 'us-west-2',
    //           log_group_name: 'firelens-fluent-bit',
    //           auto_create_group: 'true',
    //           log_stream_prefix: 'from-fluent-bit',
    //           log_retention_days: '1',
    //         },
    //       },
    //     }),
    //     Match.objectLike({
    //       Essential: true,
    //       FirelensConfiguration: { Type: 'fluentbit' },
    //     }),
    //   ],
    // });

    expect(policyDocumentsOf(template)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
                "logs:PutRetentionPolicy",
              ],
              effect: "Allow",
              resources: ["*"],
            }),
          ]),
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: Match.arrayWith([
    //       {
    //         Action: [
    //           'logs:CreateLogGroup',
    //           'logs:CreateLogStream',
    //           'logs:DescribeLogStreams',
    //           'logs:PutLogEvents',
    //           'logs:PutRetentionPolicy',
    //         ],
    //         Effect: 'Allow',
    //         Resource: '*',
    //       },
    //     ]),
    //     Version: '2012-10-17',
    //   },
    // });
  });

  test("create a firelens log driver to route logs to kinesis firehose Logs with Fluent Bit", () => {
    // WHEN
    td.addContainer("Container", {
      image,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: "firehose",
          region: "us-west-2",
          delivery_stream: "my-stream",
        },
      }),
      memoryLimitMiB: 128,
    });

    // THEN
    const containers = containersOf(new Template(stack));
    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logConfiguration: {
            logDriver: "awsfirelens",
            options: {
              Name: "firehose",
              region: "us-west-2",
              delivery_stream: "my-stream",
            },
          },
        }),
        expect.objectContaining({
          essential: true,
          firelensConfiguration: {
            type: "fluentbit",
          },
        }),
      ]),
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awsfirelens',
    //         Options: {
    //           Name: 'firehose',
    //           region: 'us-west-2',
    //           delivery_stream: 'my-stream',
    //         },
    //       },
    //     }),
    //     Match.objectLike({
    //       Essential: true,
    //       FirelensConfiguration: { Type: 'fluentbit' },
    //     }),
    //   ],
    // });
  });

  describe("Firelens Configuration", () => {
    test("fluentd log router container", () => {
      // GIVEN
      td.addFirelensLogRouter("log_router", {
        image: ecs.ContainerImage.fromRegistry("fluent/fluentd"),
        firelensConfig: {
          type: ecs.FirelensLogRouterType.FLUENTD,
        },
        memoryReservationMiB: 50,
      });

      // THEN
      const containers = containersOf(new Template(stack));
      expect(containers).toEqual([
        expect.objectContaining({
          essential: true,
          image: "fluent/fluentd",
          memoryReservation: 50,
          name: "log_router",
          firelensConfiguration: {
            type: "fluentd",
          },
        }),
      ]);
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [
      //     {
      //       Essential: true,
      //       Image: 'fluent/fluentd',
      //       MemoryReservation: 50,
      //       Name: 'log_router',
      //       FirelensConfiguration: {
      //         Type: 'fluentd',
      //       },
      //     },
      //   ],
      // });
    });

    test("fluent-bit log router container with options", () => {
      // GIVEN
      const stack2 = new AwsStack(Testing.app(), "Stack2", {
        providerConfig: { region: "us-east-1" },
      });
      const td2 = new ecs.Ec2TaskDefinition(stack2, "TaskDefinition");
      td2.addFirelensLogRouter("log_router", {
        image: ecs.obtainDefaultFluentBitECRImage(td2, undefined, "2.1.0"),
        firelensConfig: {
          type: ecs.FirelensLogRouterType.FLUENTBIT,
          options: {
            enableECSLogMetadata: false,
            configFileValue: "arn:aws:s3:::mybucket/fluent.conf",
            configFileType: ecs.FirelensConfigFileType.S3,
          },
        },
        logging: new ecs.AwsLogDriver({ streamPrefix: "firelens" }),
        memoryReservationMiB: 50,
      });

      // THEN
      const containers = containersOf(new Template(stack2));
      expect(containers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memoryReservation: 50,
            name: "log_router",
            firelensConfiguration: {
              type: "fluentbit",
              options: {
                "enable-ecs-log-metadata": "false",
                "config-file-type": "s3",
                "config-file-value": "arn:aws:s3:::mybucket/fluent.conf",
              },
            },
          }),
        ]),
      );
      // Template.fromStack(stack2).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [
      //     Match.objectLike({
      //       Essential: true,
      //       MemoryReservation: 50,
      //       Name: 'log_router',
      //       FirelensConfiguration: {
      //         Type: 'fluentbit',
      //         Options: {
      //           'enable-ecs-log-metadata': 'false',
      //           'config-file-type': 's3',
      //           'config-file-value': 'arn:aws:s3:::mybucket/fluent.conf',
      //         },
      //       },
      //     }),
      //   ],
      // });
    });

    test("fluent-bit log router with file config type", () => {
      // GIVEN
      td.addFirelensLogRouter("log_router", {
        image: ecs.obtainDefaultFluentBitECRImage(td, undefined, "2.1.0"),
        firelensConfig: {
          type: ecs.FirelensLogRouterType.FLUENTBIT,
          options: {
            enableECSLogMetadata: false,
            configFileType: ecs.FirelensConfigFileType.FILE,
            configFileValue: "/my/working/dir/firelens/config",
          },
        },
        logging: new ecs.AwsLogDriver({ streamPrefix: "firelens" }),
        memoryReservationMiB: 50,
      });

      // THEN
      const containers = containersOf(new Template(stack));
      expect(containers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memoryReservation: 50,
            name: "log_router",
            firelensConfiguration: {
              type: "fluentbit",
              options: {
                "enable-ecs-log-metadata": "false",
                "config-file-type": "file",
                "config-file-value": "/my/working/dir/firelens/config",
              },
            },
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [
      //     Match.objectLike({
      //       Essential: true,
      //       MemoryReservation: 50,
      //       Name: 'log_router',
      //       FirelensConfiguration: {
      //         Type: 'fluentbit',
      //         Options: {
      //           'enable-ecs-log-metadata': 'false',
      //           'config-file-type': 'file',
      //           'config-file-value': '/my/working/dir/firelens/config',
      //         },
      //       },
      //     }),
      //   ],
      // });
    });

    test("firelens config options are fully optional", () => {
      // GIVEN
      td.addFirelensLogRouter("log_router", {
        image: ecs.obtainDefaultFluentBitECRImage(td, undefined, "2.1.0"),
        firelensConfig: {
          type: ecs.FirelensLogRouterType.FLUENTBIT,
          options: {
            enableECSLogMetadata: false,
          },
        },
        logging: new ecs.AwsLogDriver({ streamPrefix: "firelens" }),
        memoryReservationMiB: 50,
      });

      // THEN
      const containers = containersOf(new Template(stack));
      expect(containers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memoryReservation: 50,
            name: "log_router",
            firelensConfiguration: {
              type: "fluentbit",
              options: {
                "enable-ecs-log-metadata": "false",
              },
            },
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [
      //     Match.objectLike({
      //       Essential: true,
      //       MemoryReservation: 50,
      //       Name: 'log_router',
      //       FirelensConfiguration: {
      //         Type: 'fluentbit',
      //         Options: {
      //           'enable-ecs-log-metadata': 'false',
      //         },
      //       },
      //     }),
      //   ],
      // });
    });
  });
});
