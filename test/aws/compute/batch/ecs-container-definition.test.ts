// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/ecs-container-definition.test.ts

import {
  batchJobDefinition,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { HttpBackend, Testing, Token } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { ArnFormat, AwsStack, RetentionDays } from "../../../../src/aws";
import { batch } from "../../../../src/aws/compute";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as encryption from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import * as storage from "../../../../src/aws/storage";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";
// TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/ecs-container-definition.test.ts#L4-L8
// import { Vpc } from "../../../../src/aws/compute";
// import * as efs from "../../../../src/aws/efs";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

// GIVEN
const defaultContainerProps: batch.EcsContainerDefinitionProps = {
  cpu: 256,
  image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
  memory: Size.mebibytes(2048),
};

let stack: AwsStack;

describe.each([
  batch.EcsEc2ContainerDefinition,
  batch.EcsFargateContainerDefinition,
])("%p", (ContainerDefinition) => {
  // GIVEN
  beforeEach(() => {
    stack = newStack();
  });

  test("ecs container defaults", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    expect(jobDefinition.type).toEqual("container");
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      image: "amazon/amazon-ecs-sample",
      executionRoleArn: stack.resolve(container.executionRole.roleArn),
      resourceRequirements: [
        { type: "MEMORY", value: "2048" },
        { type: "VCPU", value: "256" },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ExecutionRoleArn: {
    //       'Fn::GetAtt': ['EcsContainerExecutionRole3B199293', 'Arn'],
    //     },
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_ecs-tasks.name}",
                ],
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    //   AssumeRolePolicyDocument: {
    //     Statement: [
    //       {
    //         Action: 'sts:AssumeRole',
    //         Effect: 'Allow',
    //         Principal: { Service: 'ecs-tasks.amazonaws.com' },
    //       },
    //     ],
    //     Version: '2012-10-17',
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [
              stack.resolve(
                stack.formatArn({
                  service: "logs",
                  resource: "log-group",
                  arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                  resourceName: "/aws/batch/job:*",
                }),
              ),
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           'logs:CreateLogStream',
    //           'logs:PutLogEvents',
    //         ],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': [
    //             '',
    //             [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               ':logs:',
    //               { Ref: 'AWS::Region' },
    //               ':',
    //               { Ref: 'AWS::AccountId' },
    //               ':log-group:/aws/batch/job:*',
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //     Version: '2012-10-17',
    //   },
    //   PolicyName: 'EcsContainerExecutionRoleDefaultPolicy6F59CD37',
    //   Roles: [{
    //     Ref: 'EcsContainerExecutionRole3B199293',
    //   }],
    // });
  });

  test("respects command", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      command: ["echo", "foo"],
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      command: ["echo", "foo"],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Command: ['echo', 'foo'],
    //   },
    // });
  });

  test("respects environment", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      privileged: true,
      environment: {
        foo: "bar",
      },
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      environment: [
        {
          name: "foo",
          value: "bar",
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Environment: [{
    //       Name: 'foo',
    //       Value: 'bar',
    //     }],
    //   },
    // });
  });

  test("respects executionRole", () => {
    // WHEN
    const execRole = new iam.Role(stack, "execRole", {
      assumedBy: new iam.ArnPrincipal(
        "arn:aws:iam:123456789012:user/user-name",
      ),
    });
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      privileged: true,
      executionRole: execRole,
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      executionRoleArn: stack.resolve(execRole.roleArn),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     ExecutionRoleArn: {
    //       'Fn::GetAtt': ['execRole623CB63A', 'Arn'],
    //     },
    //   },
    // });
  });

  test("respects jobRole", () => {
    // WHEN
    const jobRole = new iam.Role(stack, "jobRole", {
      assumedBy: new iam.ArnPrincipal(
        "arn:aws:iam:123456789012:user/user-name",
      ),
    });
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      privileged: true,
      jobRole,
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      jobRoleArn: stack.resolve(jobRole.roleArn),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     JobRoleArn: {
    //       'Fn::GetAtt': ['jobRoleA2173686', 'Arn'],
    //     },
    //   },
    // });
  });

  test("respects linuxParameters", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      privileged: true,
      linuxParameters: new batch.LinuxParameters(stack, "linuxParameters", {
        initProcessEnabled: true,
        maxSwap: Size.kibibytes(4096),
        sharedMemorySize: Size.mebibytes(256),
        swappiness: 30,
      }),
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      linuxParameters: {
        initProcessEnabled: true,
        maxSwap: 4,
        sharedMemorySize: 256,
        swappiness: 30,
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     LinuxParameters: {
    //       InitProcessEnabled: true,
    //       MaxSwap: 4,
    //       SharedMemorySize: 256,
    //       Swappiness: 30,
    //     },
    //   },
    // });
  });

  test("respects logging", () => {
    // WHEN
    const logging = new ecs.AwsLogDriver({
      datetimeFormat: "format",
      logRetention: RetentionDays.ONE_MONTH,
      multilinePattern: "pattern",
      streamPrefix: "hello",
    });
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      logging,
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      executionRoleArn: stack.resolve(container.executionRole.roleArn),
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-datetime-format": "format",
          "awslogs-group": stack.resolve(logging.logGroup!.logGroupName),
          "awslogs-multiline-pattern": "pattern",
          "awslogs-region": expect.any(String),
          "awslogs-stream-prefix": "hello",
        },
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ExecutionRoleArn: {
    //       'Fn::GetAtt': ['EcsContainerExecutionRole3B199293', 'Arn'],
    //     },
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     LogConfiguration: {
    //       Options: {
    //         'awslogs-datetime-format': 'format',
    //         'awslogs-group': { Ref: 'EcsContainerLogGroup6C5D5962' },
    //         'awslogs-multiline-pattern': 'pattern',
    //         'awslogs-region': { Ref: 'AWS::Region' },
    //         'awslogs-stream-prefix': 'hello',
    //       },
    //     },
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_ecs-tasks.name}",
                ],
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    //   AssumeRolePolicyDocument: {
    //     Statement: [
    //       {
    //         Action: 'sts:AssumeRole',
    //         Effect: 'Allow',
    //         Principal: { Service: 'ecs-tasks.amazonaws.com' },
    //       },
    //     ],
    //     Version: '2012-10-17',
    //   },
    // });
  });

  test("respects readonlyRootFilesystem", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      readonlyRootFilesystem: true,
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      readonlyRootFilesystem: true,
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     ReadonlyRootFilesystem: true,
    //   },
    // });
  });

  test("respects secrets from secrestsmanager", () => {
    // WHEN
    const secret = new encryption.Secret(stack, "testSecret");
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      secrets: {
        envName: batch.Secret.fromSecretsManager(secret),
      },
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      secrets: [
        {
          name: "envName",
          valueFrom: stack.resolve(secret.secretArn),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Secrets: [
    //       {
    //         Name: 'envName',
    //         ValueFrom: { Ref: 'testSecretB96AD12C' },
    //       },
    //     ],
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [
              stack.resolve(
                stack.formatArn({
                  service: "logs",
                  resource: "log-group",
                  arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                  resourceName: "/aws/batch/job:*",
                }),
              ),
            ],
          },
          {
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            effect: "Allow",
            resources: [stack.resolve(secret.secretArn)],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': [
    //             '', [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               ':logs:',
    //               { Ref: 'AWS::Region' },
    //               ':',
    //               { Ref: 'AWS::AccountId' },
    //               ':log-group:/aws/batch/job:*',
    //             ],
    //           ],
    //         },
    //       },
    //       {
    //         Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
    //         Effect: 'Allow',
    //         Resource: { Ref: 'testSecretB96AD12C' },
    //       },
    //     ],
    //   },
    // });
  });

  test("respects versioned secrets from secrestsmanager", () => {
    // WHEN
    const secret = new encryption.Secret(stack, "testSecret");
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      secrets: {
        envName: batch.Secret.fromSecretsManagerVersion(secret, {
          versionId: "versionID",
          versionStage: "stage",
        }),
      },
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      secrets: [
        {
          name: "envName",
          valueFrom: `${stack.resolve(secret.secretArn)}::stage:versionID`,
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Secrets: [
    //       {
    //         Name: 'envName',
    //         ValueFrom: {
    //           'Fn::Join': [
    //             '', [
    //               { Ref: 'testSecretB96AD12C' },
    //               '::stage:versionID',
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [
              stack.resolve(
                stack.formatArn({
                  service: "logs",
                  resource: "log-group",
                  arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                  resourceName: "/aws/batch/job:*",
                }),
              ),
            ],
          },
          {
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            effect: "Allow",
            resources: [stack.resolve(secret.secretArn)],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': [
    //             '', [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               ':logs:',
    //               { Ref: 'AWS::Region' },
    //               ':',
    //               { Ref: 'AWS::AccountId' },
    //               ':log-group:/aws/batch/job:*',
    //             ],
    //           ],
    //         },
    //       },
    //       {
    //         Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
    //         Effect: 'Allow',
    //         Resource: { Ref: 'testSecretB96AD12C' },
    //       },
    //     ],
    //   },
    // });
  });

  test("respects secrets from ssm", () => {
    // WHEN
    const parameter = new storage.StringParameter(stack, "myParam", {
      stringValue: "super secret",
    });
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      secrets: {
        envName: batch.Secret.fromSsmParameter(parameter),
      },
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      secrets: [
        {
          name: "envName",
          valueFrom: stack.resolve(parameter.parameterArn),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Secrets: [
    //       {
    //         Name: 'envName',
    //         ValueFrom: {
    //           'Fn::Join': [
    //             '', [
    //               'arn:',
    //               {
    //                 Ref: 'AWS::Partition',
    //               },
    //               ':ssm:',
    //               { Ref: 'AWS::Region' },
    //               ':',
    //               { Ref: 'AWS::AccountId' },
    //               ':parameter/',
    //               { Ref: 'myParam03610B68' },
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [
              stack.resolve(
                stack.formatArn({
                  service: "logs",
                  resource: "log-group",
                  arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                  resourceName: "/aws/batch/job:*",
                }),
              ),
            ],
          },
          {
            actions: [
              "ssm:DescribeParameters",
              "ssm:GetParameters",
              "ssm:GetParameter",
              "ssm:GetParameterHistory",
            ],
            effect: "Allow",
            resources: [stack.resolve(parameter.parameterArn)],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': [
    //             '', [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               ':logs:',
    //               { Ref: 'AWS::Region' },
    //               ':',
    //               { Ref: 'AWS::AccountId' },
    //               ':log-group:/aws/batch/job:*',
    //             ],
    //           ],
    //         },
    //       },
    //       {
    //         Action: ['ssm:DescribeParameters', 'ssm:GetParameters', 'ssm:GetParameter', 'ssm:GetParameterHistory'],
    //         Effect: 'Allow',
    //         Resource: {
    //           'Fn::Join': [
    //             '',
    //             [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               ':ssm:',
    //               { Ref: 'AWS::Region' },
    //               ':',
    //               { Ref: 'AWS::AccountId' },
    //               ':parameter/',
    //               { Ref: 'myParam03610B68' },
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("respects user", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      user: "foo",
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      user: "foo",
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     User: 'foo',
    //   },
    // });
  });

  // TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/ecs-container-definition.test.ts#L538-L610

  test("respects host volumes", () => {
    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      volumes: [
        batch.EcsVolume.host({
          containerPath: "/container/path",
          name: "EcsHostPathVolume",
          hostPath: "/host/path",
        }),
      ],
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      volumes: [
        {
          name: "EcsHostPathVolume",
          host: {
            sourcePath: "/host/path",
          },
        },
      ],
      mountPoints: [
        {
          containerPath: "/container/path",
          sourceVolume: "EcsHostPathVolume",
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Volumes: [
    //       {
    //         Name: 'EcsHostPathVolume',
    //         Host: {
    //           SourcePath: '/host/path',
    //         },
    //       },
    //     ],
    //     MountPoints: [
    //       {
    //         ContainerPath: '/container/path',
    //         SourceVolume: 'EcsHostPathVolume',
    //       },
    //     ],
    //   },
    // });
  });

  // TODO: EFS volume support omitted (blocked on aws-efs port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/ecs-container-definition.test.ts#L650-L686

  test("respects addVolume() with a host volume", () => {
    // GIVEN
    const jobDefn = new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new ContainerDefinition(stack, "EcsContainer", {
        ...defaultContainerProps,
      }),
    });

    // WHEN
    jobDefn.container.addVolume(
      batch.EcsVolume.host({
        containerPath: "/container/path/new",
        name: "hostName",
        hostPath: "/host/path",
        readonly: false,
      }),
    );

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      volumes: [
        {
          name: "hostName",
          host: {
            sourcePath: "/host/path",
          },
        },
      ],
      mountPoints: [
        {
          containerPath: "/container/path/new",
          sourceVolume: "hostName",
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Volumes: [{
    //       Name: 'hostName',
    //       Host: {
    //         SourcePath: '/host/path',
    //       },
    //     }],
    //     MountPoints: [{
    //       ContainerPath: '/container/path/new',
    //       SourceVolume: 'hostName',
    //     }],
    //   },
    // });
  });

  // NOTE: `test/batchjob-image/` (the Dockerfile fixture this test builds
  // `DockerImageAsset` from) has not been ported -- ECR-asset image sources are out of scope
  // for this port (see mappings/aws-batch.json testFixtureNotes). Kept commented for when the
  // fixture is ported.
  // test('correctly renders docker images', () => {
  //   // WHEN
  //   new batch.EcsJobDefinition(stack, 'ECSJobDefn', {
  //     container: new ContainerDefinition(stack, 'EcsContainer', {
  //       ...defaultContainerProps,
  //       image: ecs.ContainerImage.fromDockerImageAsset(new storage.DockerImageAsset(stack, 'dockerImageAsset', {
  //         directory: path.join(__dirname, 'batchjob-image'),
  //       })),
  //     }),
  //   });
  //
  //   // THEN
  //   const [jobDefinition] = batchJobDefinitionsFor(stack);
  //   const containerProperties = JSON.parse(jobDefinition.container_properties);
  //   expect(containerProperties).toMatchObject({
  //     image: stack.resolve(...),
  //   });
  // });

  test("correctly renders images from repositories", () => {
    // GIVEN
    const repo = new storage.Repository(stack, "Repo");

    // WHEN
    const container = new ContainerDefinition(stack, "EcsContainer", {
      ...defaultContainerProps,
      image: ecs.ContainerImage.fromEcrRepository(repo, "my-tag"),
    });
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      image: stack.resolve(repo.repositoryUriForTagOrDigest("my-tag")),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Image: {
    //       'Fn::Join': [
    //         '',
    //         [
    //           {
    //             'Fn::Select': [
    //               4,
    //               {
    //                 'Fn::Split': [
    //                   ':',
    //                   { 'Fn::GetAtt': ['Repo02AC86CF', 'Arn'] },
    //                 ],
    //               },
    //             ],
    //           },
    //           '.dkr.ecr.',
    //           {
    //             'Fn::Select': [
    //               3,
    //               {
    //                 'Fn::Split': [
    //                   ':',
    //                   { 'Fn::GetAtt': ['Repo02AC86CF', 'Arn'] },
    //                 ],
    //               },
    //             ],
    //           },
    //           '.',
    //           { Ref: 'AWS::URLSuffix' },
    //           '/',
    //           { Ref: 'Repo02AC86CF' },
    //           ':my-tag',
    //         ],
    //       ],
    //     },
    //   },
    // });
  });
});

describe("EC2 containers", () => {
  // GIVEN
  beforeEach(() => {
    stack = newStack();
  });

  test("respects addUlimit()", () => {
    // GIVEN
    const jobDefn = new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsEc2ContainerDefinition(stack, "EcsEc2Container", {
        ...defaultContainerProps,
      }),
    });

    // WHEN
    (jobDefn.container as batch.IEcsEc2ContainerDefinition).addUlimit({
      hardLimit: 10,
      name: batch.UlimitName.SIGPENDING,
      softLimit: 1,
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      ulimits: [
        {
          hardLimit: 10,
          softLimit: 1,
          name: "sigpending",
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Ulimits: [{
    //       HardLimit: 10,
    //       SoftLimit: 1,
    //       Name: 'sigpending',
    //     }],
    //   },
    // });
  });

  test("respects ulimits", () => {
    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsEc2ContainerDefinition(stack, "EcsEc2Container", {
        ...defaultContainerProps,
        ulimits: [
          {
            hardLimit: 100,
            name: batch.UlimitName.CORE,
            softLimit: 10,
          },
        ],
      }),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      ulimits: [
        {
          hardLimit: 100,
          name: "core",
          softLimit: 10,
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Ulimits: [
    //       {
    //         HardLimit: 100,
    //         Name: 'core',
    //         SoftLimit: 10,
    //       },
    //     ],
    //   },
    // });
  });

  test("respects privileged", () => {
    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsEc2ContainerDefinition(stack, "EcsEc2Container", {
        ...defaultContainerProps,
        privileged: true,
      }),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      privileged: true,
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     Privileged: true,
    //   },
    // });
  });

  test("respects gpu", () => {
    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsEc2ContainerDefinition(stack, "EcsEc2Container", {
        ...defaultContainerProps,
        privileged: true,
        gpu: 12,
      }),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      resourceRequirements: [
        {
          type: "MEMORY",
          value: "2048",
        },
        {
          type: "VCPU",
          value: "256",
        },
        {
          type: "GPU",
          value: "12",
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     ResourceRequirements: [
    //       {
    //         Type: 'MEMORY',
    //         Value: '2048',
    //       },
    //       {
    //         Type: 'VCPU',
    //         Value: '256',
    //       },
    //       {
    //         Type: 'GPU',
    //         Value: '12',
    //       },
    //     ],
    //   },
    // });
  });

  // NOTE: `test/batchjob-image/` (the Dockerfile fixture `ContainerImage.fromAsset` builds
  // from) has not been ported -- ECR-asset image sources are out of scope for this port (see
  // mappings/aws-batch.json testFixtureNotes). Kept commented for when the fixture is ported.
  // test('can use an assset as a container', () => {
  //   // WHEN
  //   new batch.EcsJobDefinition(stack, 'ECSJobDefn', {
  //     container: new batch.EcsEc2ContainerDefinition(stack, 'EcsEc2Container', {
  //       ...defaultContainerProps,
  //       image: ecs.ContainerImage.fromAsset(
  //         path.join(__dirname, 'batchjob-image'),
  //       ),
  //     }),
  //   });
  //
  //   // THEN
  //   const [jobDefinition] = batchJobDefinitionsFor(stack);
  //   const containerProperties = JSON.parse(jobDefinition.container_properties);
  //   expect(containerProperties.image).toBeDefined();
  // });
});

describe("Fargate containers", () => {
  // GIVEN
  beforeEach(() => {
    stack = newStack();
  });

  test("create executionRole by default", () => {
    // WHEN
    const container = new batch.EcsFargateContainerDefinition(
      stack,
      "EcsFargateContainer",
      {
        ...defaultContainerProps,
      },
    );
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      executionRoleArn: stack.resolve(container.executionRole.roleArn),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     ExecutionRoleArn: {
    //       'Fn::GetAtt': ['EcsFargateContainerExecutionRole3286EAFE', 'Arn'],
    //     },
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_ecs-tasks.name}",
                ],
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    //   AssumeRolePolicyDocument: {
    //     Statement: [{
    //       Action: 'sts:AssumeRole',
    //       Effect: 'Allow',
    //       Principal: { Service: 'ecs-tasks.amazonaws.com' },
    //     }],
    //     Version: '2012-10-17',
    //   },
    // });
  });

  test("can set ephemeralStorageSize", () => {
    // WHEN
    const container = new batch.EcsFargateContainerDefinition(
      stack,
      "EcsFargateContainer",
      {
        ...defaultContainerProps,
        fargatePlatformVersion: ecs.FargatePlatformVersion.LATEST,
        ephemeralStorageSize: Size.gibibytes(100),
      },
    );
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      executionRoleArn: stack.resolve(container.executionRole.roleArn),
      ephemeralStorage: {
        sizeInGiB: Size.gibibytes(100).toGibibytes(),
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     ExecutionRoleArn: {
    //       'Fn::GetAtt': ['EcsFargateContainerExecutionRole3286EAFE', 'Arn'],
    //     },
    //     EphemeralStorage: {
    //       SizeInGiB: Size.gibibytes(100).toGibibytes(),
    //     },
    //   },
    // });
  });

  test("can set ephemeralStorageSize as token", () => {
    const ephemeralStorageValue: number = Token.asNumber(150);

    // WHEN
    const container = new batch.EcsFargateContainerDefinition(
      stack,
      "EcsFargateContainer",
      {
        ...defaultContainerProps,
        fargatePlatformVersion: ecs.FargatePlatformVersion.LATEST,
        ephemeralStorageSize: Size.gibibytes(ephemeralStorageValue),
      },
    );
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      executionRoleArn: stack.resolve(container.executionRole.roleArn),
      ephemeralStorage: {
        sizeInGiB: Size.gibibytes(150).toGibibytes(),
      },
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ...pascalCaseExpectedProps,
    //   ContainerProperties: {
    //     ...pascalCaseExpectedProps.ContainerProperties,
    //     ExecutionRoleArn: {
    //       'Fn::GetAtt': ['EcsFargateContainerExecutionRole3286EAFE', 'Arn'],
    //     },
    //     EphemeralStorage: {
    //       SizeInGiB: Size.gibibytes(150).toGibibytes(),
    //     },
    //   },
    // });
  });

  test("ephemeralStorageSize throws error when out of range", () => {
    expect(
      () =>
        new batch.EcsJobDefinition(stack, "ECSJobDefn", {
          container: new batch.EcsFargateContainerDefinition(
            stack,
            "EcsFargateContainer",
            {
              ...defaultContainerProps,
              fargatePlatformVersion: ecs.FargatePlatformVersion.LATEST,
              ephemeralStorageSize: Size.gibibytes(19),
            },
          ),
        }),
    ).toThrow(
      "ECS Fargate container 'EcsFargateContainer' specifies 'ephemeralStorageSize' at 19 < 21 GB",
    );

    expect(
      () =>
        new batch.EcsJobDefinition(stack, "ECSJobDefn2", {
          container: new batch.EcsFargateContainerDefinition(
            stack,
            "EcsFargateContainer2",
            {
              ...defaultContainerProps,
              fargatePlatformVersion: ecs.FargatePlatformVersion.LATEST,
              ephemeralStorageSize: Size.gibibytes(201),
            },
          ),
        }),
    ).toThrow(
      "ECS Fargate container 'EcsFargateContainer2' specifies 'ephemeralStorageSize' at 201 > 200 GB",
    );
  });

  test("readonlyRootFilesystem can't be true with Windows family", () => {
    expect(
      () =>
        new batch.EcsJobDefinition(stack, "ECSJobDefn", {
          container: new batch.EcsFargateContainerDefinition(
            stack,
            "EcsFargateContainer",
            {
              ...defaultContainerProps,
              readonlyRootFilesystem: true,
              fargateOperatingSystemFamily:
                ecs.OperatingSystemFamily.WINDOWS_SERVER_2004_CORE,
            },
          ),
        }),
    ).toThrow(
      "Readonly root filesystem is not possible on Windows; write access is required for registry & system processes to run inside the container",
    );
  });

  test("readonlyRootFilesystem is undefined with Windows family", () => {
    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsFargateContainerDefinition(
        stack,
        "EcsFargateContainer",
        {
          ...defaultContainerProps,
          fargateOperatingSystemFamily:
            ecs.OperatingSystemFamily.WINDOWS_SERVER_2004_CORE,
        },
      ),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties.readonlyRootFilesystem).toBeUndefined();
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ContainerProperties: {
    //     ReadonlyRootFilesystem: Match.absent(),
    //   },
    // });
  });

  test("enableExecuteCommand creates job role with SSM permissions when no job role provided", () => {
    // WHEN
    const container = new batch.EcsFargateContainerDefinition(
      stack,
      "EcsContainer",
      {
        ...defaultContainerProps,
        enableExecuteCommand: true,
      },
    );
    new batch.EcsJobDefinition(stack, "ECSJobDefn", { container });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      enableExecuteCommand: true,
      jobRoleArn: stack.resolve(container.jobRole!.roleArn),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ContainerProperties: {
    //     EnableExecuteCommand: true,
    //     JobRoleArn: {
    //       'Fn::GetAtt': ['EcsContainerJobRoleBF960830', 'Arn'],
    //     },
    //   },
    // });

    // Job role should be created with required SSM permissions
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_ecs-tasks.name}",
                ],
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    //   AssumeRolePolicyDocument: {
    //     Statement: [{
    //       Action: 'sts:AssumeRole',
    //       Effect: 'Allow',
    //       Principal: { Service: 'ecs-tasks.amazonaws.com' },
    //     }],
    //     Version: '2012-10-17',
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "ssmmessages:CreateControlChannel",
              "ssmmessages:CreateDataChannel",
              "ssmmessages:OpenControlChannel",
              "ssmmessages:OpenDataChannel",
            ],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [{
    //       Action: [
    //         'ssmmessages:CreateControlChannel',
    //         'ssmmessages:CreateDataChannel',
    //         'ssmmessages:OpenControlChannel',
    //         'ssmmessages:OpenDataChannel',
    //       ],
    //       Effect: 'Allow',
    //       Resource: '*',
    //     }],
    //     Version: '2012-10-17',
    //   },
    //   Roles: [{
    //     Ref: 'EcsContainerJobRoleBF960830',
    //   }],
    // });
  });

  test("enableExecuteCommand adds SSM permissions to existing job role", () => {
    const existingJobRole = new iam.Role(stack, "ExistingJobRole", {
      assumedBy: new iam.ArnPrincipal(
        "arn:aws:iam:123456789012:user/user-name",
      ),
    });

    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsFargateContainerDefinition(
        stack,
        "EcsContainer",
        {
          ...defaultContainerProps,
          enableExecuteCommand: true,
          jobRole: existingJobRole,
        },
      ),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties).toMatchObject({
      enableExecuteCommand: true,
      jobRoleArn: stack.resolve(existingJobRole.roleArn),
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ContainerProperties: {
    //     EnableExecuteCommand: true,
    //     JobRoleArn: {
    //       'Fn::GetAtt': ['ExistingJobRole8F750976', 'Arn'],
    //     },
    //   },
    // });

    // Existing job role should have SSM permissions added
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "ssmmessages:CreateControlChannel",
              "ssmmessages:CreateDataChannel",
              "ssmmessages:OpenControlChannel",
              "ssmmessages:OpenDataChannel",
            ],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [{
    //       Action: [
    //         'ssmmessages:CreateControlChannel',
    //         'ssmmessages:CreateDataChannel',
    //         'ssmmessages:OpenControlChannel',
    //         'ssmmessages:OpenDataChannel',
    //       ],
    //       Effect: 'Allow',
    //       Resource: '*',
    //     }],
    //     Version: '2012-10-17',
    //   },
    //   Roles: [{
    //     Ref: 'ExistingJobRole8F750976',
    //   }],
    // });
  });

  test("enableExecuteCommand false does not create job role", () => {
    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsFargateContainerDefinition(
        stack,
        "EcsContainer",
        {
          ...defaultContainerProps,
          enableExecuteCommand: false,
        },
      ),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties.enableExecuteCommand).toEqual(false);
    expect(containerProperties.jobRoleArn).toBeUndefined();
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ContainerProperties: {
    //     EnableExecuteCommand: false,
    //     JobRoleArn: Match.absent(),
    //   },
    // });
  });

  test("enableExecuteCommand undefined does not affect job role", () => {
    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsFargateContainerDefinition(
        stack,
        "EcsContainer",
        {
          ...defaultContainerProps,
          // enableExecuteCommand not specified
        },
      ),
    });

    // THEN
    const [jobDefinition] = batchJobDefinitionsFor(stack);
    const containerProperties = JSON.parse(jobDefinition.container_properties);
    expect(containerProperties.enableExecuteCommand).toBeUndefined();
    expect(containerProperties.jobRoleArn).toBeUndefined();
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::JobDefinition', {
    //   ContainerProperties: {
    //     EnableExecuteCommand: Match.absent(),
    //     JobRoleArn: Match.absent(),
    //   },
    // });
  });
});

// Repo-specific snapshot coverage (see test/aws/compute/batch/ecs-job-definition.test.ts /
// test/aws/notify/queue.test.ts for the harness idiom): guards against emitted-Terraform drift
// for the aws_batch_job_definition resource that EcsJobDefinition + EcsContainerDefinition render.
describe("EcsContainerDefinition", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);

    // WHEN
    new batch.EcsJobDefinition(stack, "ECSJobDefn", {
      container: new batch.EcsFargateContainerDefinition(
        stack,
        "EcsContainer",
        {
          ...defaultContainerProps,
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

/**
 * `aws_batch_job_definition.container_properties` is a single jsonencode()'d string on the
 * Terraform resource (there is no per-container CFN-style typed `ContainerPropertiesProperty`
 * block -- see mappings/aws-batch.json CfnJobDefinition notes and the `// TERRACONSTRUCTS
 * DEVIATION` note on `EcsContainerDefinitionBase._renderContainerDefinition`). Return the raw
 * resource attribute map so both top-level (snake_case) and jsonencoded nested fields can be
 * asserted against, mirroring what upstream's `hasResourceProperties('AWS::Batch::JobDefinition',
 * ...)` checked against the CFN `ContainerProperties` object.
 */
function batchJobDefinitionsFor(forStack: AwsStack): any[] {
  const template = new Template(forStack);
  return template.resourceTypeArray(
    batchJobDefinition.BatchJobDefinition,
  ) as any[];
}
