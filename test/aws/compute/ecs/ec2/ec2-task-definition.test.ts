// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/ec2/ec2-task-definition.test.ts

import * as path from "path";
import {
  dataAwsIamPolicyDocument,
  ecrLifecyclePolicy,
  ecrRepository,
  ecsTaskDefinition,
} from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as ecs from "../../../../../src/aws/compute/ecs";
import * as encryption from "../../../../../src/aws/encryption";
import * as iam from "../../../../../src/aws/iam";
import * as storage from "../../../../../src/aws/storage";
import { Duration } from "../../../../../src/duration";
import { Annotations, Template } from "../../../../assertions";

/**
 * TERRACONSTRUCTS DEVIATION: upstream renders each container to a typed
 * `CfnTaskDefinition.ContainerDefinitionProperty` array element and asserts on it via
 * `Template.hasResourceProperties('AWS::ECS::TaskDefinition', { ContainerDefinitions: [...] })`.
 * The `aws_ecs_task_definition` TF resource instead jsonencodes the whole containers array into a
 * single `container_definitions` string attribute (see mappings/aws-ecs.json), so assertions here
 * synth once and parse that string back into an array (mirrors the idiom in
 * test/aws/compute/ecs/firelens-log-driver.test.ts / gelf-log-driver.test.ts).
 */
function synthTemplate(s: AwsStack): any {
  s.prepareStack();
  return JSON.parse(Testing.synth(s));
}

function soleTaskDefinition(template: any): any {
  const taskDefs =
    template.resource?.[ecsTaskDefinition.EcsTaskDefinition.tfResourceType] ??
    {};
  const values = Object.values(taskDefs) as any[];
  expect(values).toHaveLength(1);
  return values[0];
}

function taskDefinitionContainers(template: any): any[] {
  const taskDef = soleTaskDefinition(template);
  return JSON.parse(taskDef.container_definitions);
}

function policyDocuments(template: any): any[] {
  return Object.values(
    template.data?.[
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument.tfResourceType
    ] ?? {},
  );
}

function newStack(): AwsStack {
  const app: App = Testing.app({ fakeCdktfJsonPath: true });
  return new AwsStack(app);
}

describe("ec2 task definition", () => {
  describe("When creating an ECS TaskDefinition", () => {
    test("with only required properties set, it correctly sets default properties", () => {
      // GIVEN
      const stack = newStack();
      new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          family: "Ec2TaskDef",
          network_mode: ecs.NetworkMode.BRIDGE,
          requires_compatibilities: ["EC2"],
          // TERRACONSTRUCTS DEVIATION: `inferenceAccelerators` (@deprecated upstream too) has no
          // counterpart anywhere on `EcsTaskDefinitionConfig` (confirmed: grep of
          // ecs-task-definition/index.d.ts finds no "inference" hit at all -- see
          // mappings/aws-ecs.json CfnTaskDefinition attributeNotes). There is no TF field to assert
          // "absent" against, so the `InferenceAccelerators: Match.absent()` assertion is dropped.
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   NetworkMode: ecs.NetworkMode.BRIDGE,
      //   RequiresCompatibilities: ['EC2'],
      //   InferenceAccelerators: Match.absent(),
      // });

      // test error if no container defs?
    });

    test("with all properties set", () => {
      // GIVEN
      const stack = newStack();
      const executionRole = new iam.Role(stack, "ExecutionRole", {
        path: "/",
        assumedBy: new iam.CompositePrincipal(
          new iam.ServicePrincipal("ecs.amazonaws.com"),
          new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        ),
      });
      const taskRole = new iam.Role(stack, "TaskRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      });
      new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        executionRole,
        family: "ecs-tasks",
        networkMode: ecs.NetworkMode.AWS_VPC,
        ipcMode: ecs.IpcMode.HOST,
        pidMode: ecs.PidMode.TASK,
        placementConstraints: [
          ecs.PlacementConstraint.memberOf(
            "attribute:ecs.instance-type =~ t2.*",
          ),
        ],
        taskRole,
        volumes: [
          {
            host: {
              sourcePath: "/tmp/cache",
            },
            name: "scratch",
          },
        ],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          execution_role_arn: stack.resolve(executionRole.roleArn),
          family: "ecs-tasks",
          network_mode: "awsvpc",
          ipc_mode: "host",
          pid_mode: "task",
          placement_constraints: [
            {
              expression: "attribute:ecs.instance-type =~ t2.*",
              type: "memberOf",
            },
          ],
          requires_compatibilities: ["EC2"],
          task_role_arn: stack.resolve(taskRole.roleArn),
          volume: [
            {
              host_path: "/tmp/cache",
              name: "scratch",
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ExecutionRoleArn: {
      //     'Fn::GetAtt': [
      //       'ExecutionRole605A040B',
      //       'Arn',
      //     ],
      //   },
      //   Family: 'ecs-tasks',
      //   NetworkMode: 'awsvpc',
      //   IpcMode: 'host',
      //   PidMode: 'task',
      //   PlacementConstraints: [
      //     {
      //       Expression: 'attribute:ecs.instance-type =~ t2.*',
      //       Type: 'memberOf',
      //     },
      //   ],
      //   RequiresCompatibilities: [
      //     'EC2',
      //   ],
      //   TaskRoleArn: {
      //     'Fn::GetAtt': [
      //       'TaskRole30FC0FBB',
      //       'Arn',
      //     ],
      //   },
      //   Volumes: [
      //     {
      //       Host: {
      //         SourcePath: '/tmp/cache',
      //       },
      //       Name: 'scratch',
      //     },
      //   ],
      // });
    });

    test("correctly sets placement constraint", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // WHEN
      taskDefinition.addPlacementConstraint(
        ecs.PlacementConstraint.memberOf("attribute:ecs.instance-type =~ t2.*"),
      );

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          placement_constraints: [
            {
              expression: "attribute:ecs.instance-type =~ t2.*",
              type: "memberOf",
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   PlacementConstraints: [
      //     {
      //       Expression: 'attribute:ecs.instance-type =~ t2.*',
      //       Type: 'memberOf',
      //     },
      //   ],
      // });
    });

    test("correctly sets network mode", () => {
      // GIVEN
      const stack = newStack();
      new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          network_mode: ecs.NetworkMode.AWS_VPC,
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   NetworkMode: ecs.NetworkMode.AWS_VPC,
      // });
    });

    test("correctly sets ipc mode", () => {
      // GIVEN
      const stack = newStack();
      new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        ipcMode: ecs.IpcMode.TASK,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          ipc_mode: ecs.IpcMode.TASK,
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   IpcMode: ecs.IpcMode.TASK,
      // });
    });

    test("correctly sets pid mode", () => {
      // GIVEN
      const stack = newStack();
      new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        pidMode: ecs.PidMode.HOST,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          pid_mode: ecs.PidMode.HOST,
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   PidMode: ecs.PidMode.HOST,
      // });
    });

    test("correctly sets containers", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512, // add validation?
      });

      container.addPortMappings({
        containerPort: 3000,
      });

      container.addUlimits({
        hardLimit: 128,
        name: ecs.UlimitName.RSS,
        softLimit: 128,
      });

      container.addVolumesFrom({
        sourceContainer: "foo",
        readOnly: true,
      });

      container.addToExecutionPolicy(
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["ecs:*"],
        }),
      );

      // THEN
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).family).toEqual("Ec2TaskDef");
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memory: 512,
            image: "amazon/amazon-ecs-sample",
            name: "web",
            portMappings: [
              {
                containerPort: 3000,
                hostPort: 0,
                protocol: ecs.Protocol.TCP,
              },
            ],
            ulimits: [
              {
                hardLimit: 128,
                name: "rss",
                softLimit: 128,
              },
            ],
            volumesFrom: [
              {
                readOnly: true,
                sourceContainer: "foo",
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   ContainerDefinitions: [{
      //     Essential: true,
      //     Memory: 512,
      //     Image: 'amazon/amazon-ecs-sample',
      //     Name: 'web',
      //     PortMappings: [{
      //       ContainerPort: 3000,
      //       HostPort: 0,
      //       Protocol: Protocol.TCP,
      //     }],
      //     Ulimits: [
      //       {
      //         HardLimit: 128,
      //         Name: 'rss',
      //         SoftLimit: 128,
      //       },
      //     ],
      //     VolumesFrom: [
      //       {
      //         ReadOnly: true,
      //         SourceContainer: 'foo',
      //       },
      //     ],
      //   }],
      // });

      expect(policyDocuments(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["ecs:*"],
                effect: "Allow",
                resources: ["*"],
              }),
            ]),
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Version: '2012-10-17',
      //     Statement: [
      //       {
      //         Action: 'ecs:*',
      //         Effect: 'Allow',
      //         Resource: '*',
      //       },
      //     ],
      //   },
      // });
    });

    test("all container definition options defined", () => {
      // GIVEN
      // TERRACONSTRUCTS DEVIATION: upstream toggles cx-api's NEW_STYLE_STACK_SYNTHESIS_CONTEXT to
      // exercise legacy CFN asset parameters (the `AssetParameters...S3Bucket`/`S3VersionKey` Refs
      // asserted below in the commented-out CFN block). cdktn has no CFN asset-parameter concept --
      // assets resolve straight to literal bucket/key values -- so the context toggle is dropped.
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const secret = new encryption.Secret(stack, "Secret");
      const parameter =
        storage.StringParameter.fromSecureStringParameterAttributes(
          stack,
          "Parameter",
          {
            parameterName: "/name",
            version: 1,
          },
        );
      const awsLogDriver = new ecs.AwsLogDriver({ streamPrefix: "prefix" });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 2048,
        cpu: 256,
        disableNetworking: true,
        command: ["CMD env"],
        dnsSearchDomains: ["0.0.0.0"],
        dnsServers: ["1.1.1.1"],
        dockerLabels: { LABEL: "label" },
        dockerSecurityOptions: ["ECS_SELINUX_CAPABLE=true"],
        entryPoint: ["/app/node_modules/.bin/cdk"],
        environment: {
          TEST_ENVIRONMENT_VARIABLE: "test environment variable value",
        },
        environmentFiles: [
          ecs.EnvironmentFile.fromAsset(
            path.join(__dirname, "..", "demo-envfiles", "test-envfile.env"),
          ),
        ],
        essential: true,
        extraHosts: { EXTRAHOST: "extra host" },
        healthCheck: {
          command: ["curl localhost:8000"],
          interval: Duration.seconds(20),
          retries: 5,
          startPeriod: Duration.seconds(10),
        },
        hostname: "webHost",
        linuxParameters: new ecs.LinuxParameters(stack, "LinuxParameters", {
          initProcessEnabled: true,
          sharedMemorySize: 1024,
        }),
        logging: awsLogDriver,
        memoryReservationMiB: 1024,
        privileged: true,
        pseudoTerminal: true,
        readonlyRootFilesystem: true,
        secrets: {
          SECRET: ecs.Secret.fromSecretsManager(secret),
          PARAMETER: ecs.Secret.fromSsmParameter(parameter),
        },
        user: "amazon",
        workingDirectory: "app/",
      });

      // THEN
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).family).toEqual("Ec2TaskDef");
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: ["CMD env"],
            cpu: 256,
            disableNetworking: true,
            dnsSearchDomains: ["0.0.0.0"],
            dnsServers: ["1.1.1.1"],
            dockerLabels: {
              LABEL: "label",
            },
            dockerSecurityOptions: ["ECS_SELINUX_CAPABLE=true"],
            entryPoint: ["/app/node_modules/.bin/cdk"],
            environment: [
              {
                name: "TEST_ENVIRONMENT_VARIABLE",
                value: "test environment variable value",
              },
            ],
            // NOTE: the S3 asset's bucket/key are unresolved attribute-reference
            // tokens (not the literal source filename), so the match can't
            // require a `test-envfile.env` suffix.
            environmentFiles: [
              {
                type: "s3",
                value: expect.stringMatching(/^arn:.*:s3:::.+$/),
              },
            ],
            essential: true,
            extraHosts: [
              {
                hostname: "EXTRAHOST",
                ipAddress: "extra host",
              },
            ],
            healthCheck: {
              command: ["CMD-SHELL", "curl localhost:8000"],
              interval: 20,
              retries: 5,
              startPeriod: 10,
              timeout: 5,
            },
            hostname: "webHost",
            image: "amazon/amazon-ecs-sample",
            linuxParameters: {
              capabilities: {},
              initProcessEnabled: true,
              sharedMemorySize: 1024,
            },
            logConfiguration: {
              logDriver: "awslogs",
              options: {
                "awslogs-group": stack.resolve(
                  awsLogDriver.logGroup!.logGroupName,
                ),
                "awslogs-stream-prefix": "prefix",
                "awslogs-region": expect.any(String),
              },
            },
            memory: 2048,
            memoryReservation: 1024,
            name: "web",
            privileged: true,
            pseudoTerminal: true,
            readonlyRootFilesystem: true,
            secrets: [
              {
                name: "SECRET",
                valueFrom: stack.resolve(secret.secretArn),
              },
              {
                name: "PARAMETER",
                valueFrom: stack.resolve(parameter.parameterArn),
              },
            ],
            user: "amazon",
            workingDirectory: "app/",
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   ContainerDefinitions: [
      //     {
      //       Command: [
      //         'CMD env',
      //       ],
      //       Cpu: 256,
      //       DisableNetworking: true,
      //       DnsSearchDomains: [
      //         '0.0.0.0',
      //       ],
      //       DnsServers: [
      //         '1.1.1.1',
      //       ],
      //       DockerLabels: {
      //         LABEL: 'label',
      //       },
      //       DockerSecurityOptions: [
      //         'ECS_SELINUX_CAPABLE=true',
      //       ],
      //       EntryPoint: [
      //         '/app/node_modules/.bin/cdk',
      //       ],
      //       Environment: [
      //         {
      //           Name: 'TEST_ENVIRONMENT_VARIABLE',
      //           Value: 'test environment variable value',
      //         },
      //       ],
      //       EnvironmentFiles: [{
      //         Type: 's3',
      //         Value: {
      //           'Fn::Join': [
      //             '',
      //             [
      //               'arn:',
      //               { Ref: 'AWS::Partition' },
      //               ':s3:::',
      //               { Ref: 'AssetParameters872561bf078edd1685d50c9ff821cdd60d2b2ddfb0013c4087e79bf2bb50724dS3Bucket7B2069B7' },
      //               '/',
      //               { 'Fn::Select': [0, { 'Fn::Split': ['||', { Ref: 'AssetParameters872561bf078edd1685d50c9ff821cdd60d2b2ddfb0013c4087e79bf2bb50724dS3VersionKey40E12C15' }] }] },
      //               { 'Fn::Select': [1, { 'Fn::Split': ['||', { Ref: 'AssetParameters872561bf078edd1685d50c9ff821cdd60d2b2ddfb0013c4087e79bf2bb50724dS3VersionKey40E12C15' }] }] },
      //             ],
      //           ],
      //         },
      //       }],
      //       Essential: true,
      //       ExtraHosts: [
      //         {
      //           Hostname: 'EXTRAHOST',
      //           IpAddress: 'extra host',
      //         },
      //       ],
      //       HealthCheck: {
      //         Command: [
      //           'CMD-SHELL',
      //           'curl localhost:8000',
      //         ],
      //         Interval: 20,
      //         Retries: 5,
      //         StartPeriod: 10,
      //         Timeout: 5,
      //       },
      //       Hostname: 'webHost',
      //       Image: 'amazon/amazon-ecs-sample',
      //       LinuxParameters: {
      //         Capabilities: {},
      //         InitProcessEnabled: true,
      //         SharedMemorySize: 1024,
      //       },
      //       LogConfiguration: {
      //         LogDriver: 'awslogs',
      //         Options: {
      //           'awslogs-group': { Ref: 'Ec2TaskDefwebLogGroup7F786C6B' },
      //           'awslogs-stream-prefix': 'prefix',
      //           'awslogs-region': { Ref: 'AWS::Region' },
      //         },
      //       },
      //       Memory: 2048,
      //       MemoryReservation: 1024,
      //       Name: 'web',
      //       Privileged: true,
      //       PseudoTerminal: true,
      //       ReadonlyRootFilesystem: true,
      //       Secrets: [
      //         {
      //           Name: 'SECRET',
      //           ValueFrom: { Ref: 'SecretA720EF05' },
      //         },
      //         {
      //           Name: 'PARAMETER',
      //           ValueFrom: {
      //             'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ssm:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':parameter/name']],
      //           },
      //         },
      //       ],
      //       User: 'amazon',
      //       WorkingDirectory: 'app/',
      //     },
      //   ],
      // });
    });

    test("correctly sets containers from ECR repository using all props", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const repository = new storage.Repository(stack, "myECRImage", {
        // TERRACONSTRUCTS DEVIATION: `lifecycleRegistryId` is `@deprecated` on `RepositoryProps` --
        // "not supported by the Terraform AWS provider for ECR lifecycle policies" (see
        // src/aws/storage/ecr-repository.ts) -- so it is dropped rather than passed through.
        // `removalPolicy` has no counterpart on `RepositoryProps` either (no removal-policy concept
        // implemented in this repo yet, see test/aws/storage/ecr-repository.test.ts TODO), dropped too.
        lifecycleRules: [
          {
            rulePriority: 10,
            tagPrefixList: ["abc"],
            maxImageCount: 1,
          },
        ],
        repositoryName: "project-a/amazon-ecs-sample",
      });
      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromEcrRepository(repository),
        memoryLimitMiB: 512,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecrRepository.EcrRepository,
        {
          name: "project-a/amazon-ecs-sample",
        },
      );
      Template.synth(stack).toHaveResourceWithProperties(
        ecrLifecyclePolicy.EcrLifecyclePolicy,
        {
          repository: stack.resolve(repository.repositoryName),
          policy: JSON.stringify({
            rules: [
              {
                rulePriority: 10,
                selection: {
                  tagStatus: "tagged",
                  tagPrefixList: ["abc"],
                  countType: "imageCountMoreThan",
                  countNumber: 1,
                },
                action: { type: "expire" },
              },
            ],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECR::Repository', {
      //   LifecyclePolicy: {
      //     LifecyclePolicyText: '{"rules":[{"rulePriority":10,"selection":{"tagStatus":"tagged","tagPrefixList":["abc"],"countType":"imageCountMoreThan","countNumber":1},"action":{"type":"expire"}}]}',
      //     RegistryId: '123456789101',
      //   },
      //   RepositoryName: 'project-a/amazon-ecs-sample',
      // });

      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).family).toEqual("Ec2TaskDef");
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memory: 512,
            image: stack.resolve(repository.repositoryUriForTag("latest")),
            name: "web",
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   ContainerDefinitions: [{
      //     Essential: true,
      //     Memory: 512,
      //     Image: {
      //       'Fn::Join': ['', [
      //         { 'Fn::Select': [4, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }] },
      //         '.dkr.ecr.',
      //         { 'Fn::Select': [3, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }] },
      //         '.',
      //         { Ref: 'AWS::URLSuffix' },
      //         '/',
      //         { Ref: 'myECRImage7DEAE474' },
      //         ':latest',
      //       ]],
      //     },
      //     Name: 'web',
      //   }],
      // });
    });

    test("correctly sets containers from ECR repository using an image tag", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const repository = new storage.Repository(stack, "myECRImage");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromEcrRepository(repository, "myTag"),
        memoryLimitMiB: 512,
      });

      // THEN
      const template = synthTemplate(stack);
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memory: 512,
            image: stack.resolve(repository.repositoryUriForTag("myTag")),
            name: "web",
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [{
      //     Essential: true,
      //     Memory: 512,
      //     Image: {
      //       'Fn::Join': ['', [
      //         { 'Fn::Select': [4, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }] },
      //         '.dkr.ecr.',
      //         { 'Fn::Select': [3, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }] },
      //         '.',
      //         { Ref: 'AWS::URLSuffix' },
      //         '/',
      //         { Ref: 'myECRImage7DEAE474' },
      //         ':myTag',
      //       ]],
      //     },
      //     Name: 'web',
      //   }],
      // });
    });

    test("correctly sets containers from ECR repository using an image digest", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const repository = new storage.Repository(stack, "myECRImage");
      const digest = "sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE";

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromEcrRepository(repository, digest),
        memoryLimitMiB: 512,
      });

      // THEN
      const template = synthTemplate(stack);
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            essential: true,
            memory: 512,
            image: stack.resolve(repository.repositoryUriForDigest(digest)),
            name: "web",
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [{
      //     Essential: true,
      //     Memory: 512,
      //     Image: {
      //       'Fn::Join': ['', [
      //         { 'Fn::Select': [4, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }] },
      //         '.dkr.ecr.',
      //         { 'Fn::Select': [3, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }] },
      //         '.',
      //         { Ref: 'AWS::URLSuffix' },
      //         '/',
      //         { Ref: 'myECRImage7DEAE474' },
      //         '@sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE',
      //       ]],
      //     },
      //     Name: 'web',
      //   }],
      // });
    });

    test("correctly sets containers from ECR repository using default props", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // WHEN
      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromEcrRepository(
          new storage.Repository(stack, "myECRImage"),
        ),
        memoryLimitMiB: 512,
      });

      // THEN
      new Template(stack).resourceCountIs(ecrRepository.EcrRepository, 1);
      // Template.fromStack(stack).hasResourceProperties('AWS::ECR::Repository', {});
    });

    test("warns when setting containers from ECR repository using fromRegistry method", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // WHEN
      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry(
          "ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY",
        ),
        memoryLimitMiB: 512,
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: /Ec2TaskDef\/web$/,
        // TERRACONSTRUCTS DEVIATION: upstream's message carries an
        // "[ack: @aws-cdk/aws-ecs:ecrImageRequiresPolicy]" suffix from `addWarningV2`; the repo port
        // (src/aws/compute/ecs/images/repository.ts) has a `// TODO: Annotations.of(scope).addWarningV2(...)`
        // and still calls the plain `addWarning` without the ack code, so the suffix is dropped here.
        message:
          "Proper policies need to be attached before pulling from ECR repository, or use 'fromEcrRepository'.",
      });
      // Annotations.fromStack(stack).hasWarning('/Default/Ec2TaskDef/web', "Proper policies need to be attached before pulling from ECR repository, or use 'fromEcrRepository'. [ack: @aws-cdk/aws-ecs:ecrImageRequiresPolicy]");
    });

    test("warns when setting containers from ECR repository by creating a RepositoryImage class", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const repo = new ecs.RepositoryImage(
        "ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY",
      );

      // WHEN
      taskDefinition.addContainer("web", {
        image: repo,
        memoryLimitMiB: 512,
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: /Ec2TaskDef\/web$/,
        message:
          "Proper policies need to be attached before pulling from ECR repository, or use 'fromEcrRepository'.",
      });
      // Annotations.fromStack(stack).hasWarning('/Default/Ec2TaskDef/web', "Proper policies need to be attached before pulling from ECR repository, or use 'fromEcrRepository'. [ack: @aws-cdk/aws-ecs:ecrImageRequiresPolicy]");
    });

    test("correctly sets containers from asset using all props", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromAsset(
          path.join(__dirname, "..", "demo-image"),
          {
            buildArgs: { HTTP_PROXY: "http://10.20.30.2:1234" },
          },
        ),
        memoryLimitMiB: 512,
      });
    });

    test("correctly sets scratch space", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      container.addScratch({
        containerPath: "./cache",
        readOnly: true,
        sourcePath: "/tmp/cache",
        name: "scratch",
      });

      // THEN
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).family).toEqual("Ec2TaskDef");
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mountPoints: [
              {
                containerPath: "./cache",
                readOnly: true,
                sourceVolume: "scratch",
              },
            ],
          }),
        ]),
      );
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          volume: [
            {
              host_path: "/tmp/cache",
              name: "scratch",
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   ContainerDefinitions: [Match.objectLike({
      //     MountPoints: [
      //       {
      //         ContainerPath: './cache',
      //         ReadOnly: true,
      //         SourceVolume: 'scratch',
      //       },
      //     ],
      //   })],
      //   Volumes: [{
      //     Host: {
      //       SourcePath: '/tmp/cache',
      //     },
      //     Name: 'scratch',
      //   }],
      // });
    });

    test("correctly sets container dependenices", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const dependency1 = taskDefinition.addContainer("dependency1", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const dependency2 = taskDefinition.addContainer("dependency2", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      container.addContainerDependencies(
        {
          container: dependency1,
        },
        {
          container: dependency2,
          condition: ecs.ContainerDependencyCondition.SUCCESS,
        },
      );

      // THEN
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).family).toEqual("Ec2TaskDef");
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "dependency1" }),
          expect.objectContaining({ name: "dependency2" }),
          expect.objectContaining({
            name: "web",
            dependsOn: [
              {
                condition: "HEALTHY",
                containerName: "dependency1",
              },
              {
                condition: "SUCCESS",
                containerName: "dependency2",
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   ContainerDefinitions: [Match.objectLike({
      //     Name: 'dependency1',
      //   }),
      //   Match.objectLike({
      //     Name: 'dependency2',
      //   }),
      //   Match.objectLike({
      //     Name: 'web',
      //     DependsOn: [{
      //       Condition: 'HEALTHY',
      //       ContainerName: 'dependency1',
      //     },
      //     {
      //       Condition: 'SUCCESS',
      //       ContainerName: 'dependency2',
      //     }],
      //   })],
      // });
    });

    test("correctly sets links", () => {
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const linkedContainer1 = taskDefinition.addContainer("linked1", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const linkedContainer2 = taskDefinition.addContainer("linked2", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      container.addLink(linkedContainer1, "linked");
      container.addLink(linkedContainer2);

      // THEN
      const template = synthTemplate(stack);
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            links: ["linked1:linked", "linked2"],
            name: "web",
          }),
          expect.objectContaining({ name: "linked1" }),
          expect.objectContaining({ name: "linked2" }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [
      //     Match.objectLike({
      //       Links: [
      //         'linked1:linked',
      //         'linked2',
      //       ],
      //       Name: 'web',
      //     }),
      //     Match.objectLike({
      //       Name: 'linked1',
      //     }),
      //     Match.objectLike({
      //       Name: 'linked2',
      //     }),
      //   ],
      // });
    });

    test("correctly set policy statement to the task IAM role", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // WHEN
      taskDefinition.addToTaskRolePolicy(
        new iam.PolicyStatement({
          actions: ["test:SpecialName"],
          resources: ["*"],
        }),
      );

      // THEN
      const template = synthTemplate(stack);
      expect(policyDocuments(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["test:SpecialName"],
                effect: "Allow",
                resources: ["*"],
              }),
            ]),
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Version: '2012-10-17',
      //     Statement: [
      //       {
      //         Action: 'test:SpecialName',
      //         Effect: 'Allow',
      //         Resource: '*',
      //       },
      //     ],
      //   },
      // });
    });

    test("correctly sets volumes from", () => {
      const stack = newStack();

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {});

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      container.addVolumesFrom({
        sourceContainer: "SourceContainer",
        readOnly: true,
      });

      // THEN
      const template = synthTemplate(stack);
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            volumesFrom: [
              {
                sourceContainer: "SourceContainer",
                readOnly: true,
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [Match.objectLike({
      //     VolumesFrom: [
      //       {
      //         SourceContainer: 'SourceContainer',
      //         ReadOnly: true,
      //       },
      //     ],
      //   })],
      // });
    });

    test("correctly set policy statement to the task execution IAM role", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // WHEN
      taskDefinition.addToExecutionRolePolicy(
        new iam.PolicyStatement({
          actions: ["test:SpecialName"],
          resources: ["*"],
        }),
      );

      // THEN
      const template = synthTemplate(stack);
      expect(policyDocuments(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["test:SpecialName"],
                effect: "Allow",
                resources: ["*"],
              }),
            ]),
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Version: '2012-10-17',
      //     Statement: [
      //       {
      //         Action: 'test:SpecialName',
      //         Effect: 'Allow',
      //         Resource: '*',
      //       },
      //     ],
      //   },
      // });
    });

    test("correctly sets volumes", () => {
      // GIVEN
      const stack = newStack();
      const volume = {
        host: {
          sourcePath: "/tmp/cache",
        },
        name: "scratch",
      };

      // Adding volumes via props is a bit clunky
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        volumes: [volume],
      });

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // this needs to be a better API -- should auto-add volumes
      container.addMountPoints({
        containerPath: "./cache",
        readOnly: true,
        sourceVolume: "scratch",
      });

      // THEN
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).family).toEqual("Ec2TaskDef");
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mountPoints: [
              {
                containerPath: "./cache",
                readOnly: true,
                sourceVolume: "scratch",
              },
            ],
          }),
        ]),
      );
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          volume: [
            {
              host_path: "/tmp/cache",
              name: "scratch",
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   ContainerDefinitions: [Match.objectLike({
      //     MountPoints: [
      //       {
      //         ContainerPath: './cache',
      //         ReadOnly: true,
      //         SourceVolume: 'scratch',
      //       },
      //     ],
      //   })],
      //   Volumes: [{
      //     Host: {
      //       SourcePath: '/tmp/cache',
      //     },
      //     Name: 'scratch',
      //   }],
      // });
    });

    test("correctly sets placement constraints", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        placementConstraints: [
          ecs.PlacementConstraint.memberOf(
            "attribute:ecs.instance-type =~ t2.*",
          ),
        ],
      });

      taskDefinition.addContainer("web", {
        memoryLimitMiB: 1024,
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          placement_constraints: [
            {
              expression: "attribute:ecs.instance-type =~ t2.*",
              type: "memberOf",
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   PlacementConstraints: [
      //     {
      //       Expression: 'attribute:ecs.instance-type =~ t2.*',
      //       Type: 'memberOf',
      //     },
      //   ],
      // });
    });

    test("correctly sets taskRole", () => {
      // GIVEN
      const stack = newStack();
      const taskRole = new iam.Role(stack, "TaskRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        taskRole,
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          task_role_arn: stack.resolve(taskDefinition.taskRole.roleArn),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   TaskRoleArn: stack.resolve(taskDefinition.taskRole.roleArn),
      // });
    });

    test("automatically sets taskRole by default", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          task_role_arn: stack.resolve(taskDefinition.taskRole.roleArn),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   TaskRoleArn: stack.resolve(taskDefinition.taskRole.roleArn),
      // });
    });

    test("correctly sets dockerVolumeConfiguration", () => {
      // GIVEN
      const stack = newStack();
      const volume = {
        name: "scratch",
        dockerVolumeConfiguration: {
          driver: "local",
          scope: ecs.Scope.TASK,
          driverOpts: {
            key1: "value",
          },
        },
      };

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        volumes: [volume],
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          family: "Ec2TaskDef",
          volume: [
            {
              name: "scratch",
              docker_volume_configuration: {
                driver: "local",
                scope: "task",
                driver_opts: {
                  key1: "value",
                },
              },
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   Volumes: [{
      //     Name: 'scratch',
      //     DockerVolumeConfiguration: {
      //       Driver: 'local',
      //       Scope: 'task',
      //       DriverOpts: {
      //         key1: 'value',
      //       },
      //     },
      //   }],
      // });
    });

    test("correctly sets efsVolumeConfiguration", () => {
      // GIVEN
      const stack = newStack();
      const volume = {
        name: "scratch",
        efsVolumeConfiguration: {
          fileSystemId: "local",
        },
      };

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        volumes: [volume],
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          family: "Ec2TaskDef",
          volume: [
            {
              name: "scratch",
              efs_volume_configuration: {
                file_system_id: "local",
              },
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'Ec2TaskDef',
      //   Volumes: [{
      //     Name: 'scratch',
      //     EFSVolumeConfiguration: {
      //       FilesystemId: 'local',
      //     },
      //   }],
      // });
    });

    test("correctly sets env variables when using EC2 capacity provider with AWSVPC mode - with no other user-defined env variables", () => {
      // GIVEN AWS-VPC network mode
      const stack = newStack();
      const taskDefiniton = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      taskDefiniton.addContainer("some-container", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // THEN it should include the AWS_REGION env variable - when no user defined env variables are provided
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).network_mode).toEqual(
        ecs.NetworkMode.AWS_VPC,
      );
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "some-container",
            image: "amazon/amazon-ecs-sample",
            memory: 512,
            environment: [
              {
                name: "AWS_REGION",
                value: stack.resolve(stack.region),
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   NetworkMode: ecs.NetworkMode.AWS_VPC,
      //   ContainerDefinitions: [{
      //     Name: 'some-container',
      //     Image: 'amazon/amazon-ecs-sample',
      //     Memory: 512,
      //     Environment: [{
      //       Name: 'AWS_REGION',
      //       Value: {
      //         Ref: 'AWS::Region',
      //       },
      //     }],
      //   }],
      // });
    });

    test("correctly sets env variables when using EC2 capacity provider with AWSVPC mode - with other user-defined env variables", () => {
      // GIVEN AWS-VPC network mode
      const stack = newStack();
      const taskDefiniton = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      taskDefiniton.addContainer("some-container", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
        environment: {
          SOME_VARIABLE: "some-value",
        },
      });

      // THEN it should include the AWS_REGION env variable
      const template = synthTemplate(stack);
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "some-container",
            image: "amazon/amazon-ecs-sample",
            memory: 512,
            environment: [
              {
                name: "SOME_VARIABLE",
                value: "some-value",
              },
              {
                name: "AWS_REGION",
                value: stack.resolve(stack.region),
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   NetworkMode: ecs.NetworkMode.AWS_VPC,
      //   ContainerDefinitions: [{
      //     Name: 'some-container',
      //     Image: 'amazon/amazon-ecs-sample',
      //     Memory: 512,
      //     Environment: [{
      //       Name: 'SOME_VARIABLE',
      //       Value: 'some-value',
      //     }, {
      //       Name: 'AWS_REGION',
      //       Value: {
      //         Ref: 'AWS::Region',
      //       },
      //     }],
      //   }],
      // });
    });

    test("correctly sets env variables when using EC2 capacity provider with HOST mode", () => {
      // GIVEN HOST network mode
      const stack = newStack();
      const taskDefiniton = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.HOST,
      });
      taskDefiniton.addContainer("some-container", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
        environment: {
          SOME_VARIABLE: "some-value",
        },
      });

      // THEN it should not include the AWS_REGION env variable
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).network_mode).toEqual(
        ecs.NetworkMode.HOST,
      );
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "some-container",
            image: "amazon/amazon-ecs-sample",
            memory: 512,
            environment: [
              {
                name: "SOME_VARIABLE",
                value: "some-value",
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   NetworkMode: ecs.NetworkMode.HOST,
      //   ContainerDefinitions: [{
      //     Name: 'some-container',
      //     Image: 'amazon/amazon-ecs-sample',
      //     Memory: 512,
      //     Environment: [{
      //       Name: 'SOME_VARIABLE',
      //       Value: 'some-value',
      //     }],
      //   }],
      // });
    });

    test("correctly sets env variables when using EC2 capacity provider with BRIDGE mode", () => {
      // GIVEN HOST network mode
      const stack = newStack();
      const taskDefiniton = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });
      taskDefiniton.addContainer("some-container", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
        environment: {
          SOME_VARIABLE: "some-value",
        },
      });

      // THEN it should not include the AWS_REGION env variable
      const template = synthTemplate(stack);
      expect(soleTaskDefinition(template).network_mode).toEqual(
        ecs.NetworkMode.BRIDGE,
      );
      expect(taskDefinitionContainers(template)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "some-container",
            image: "amazon/amazon-ecs-sample",
            memory: 512,
            environment: [
              {
                name: "SOME_VARIABLE",
                value: "some-value",
              },
            ],
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   NetworkMode: ecs.NetworkMode.BRIDGE,
      //   ContainerDefinitions: [{
      //     Name: 'some-container',
      //     Image: 'amazon/amazon-ecs-sample',
      //     Memory: 512,
      //     Environment: [{
      //       Name: 'SOME_VARIABLE',
      //       Value: 'some-value',
      //     }],
      //   }],
      // });
    });
  });

  // TERRACONSTRUCTS DEVIATION: upstream's `describe('setting inferenceAccelerators', ...)` asserts
  // the rendered `InferenceAccelerators` CFN property (via `addInferenceAccelerator()` /
  // the `inferenceAccelerators` prop). `EcsTaskDefinitionConfig` (the TF provider binding for
  // `aws_ecs_task_definition`) has NO `inferenceAccelerators`/`inference_accelerators` field at all
  // (confirmed: grep of ecs-task-definition/index.d.ts finds no "inference" hit -- see
  // mappings/aws-ecs.json CfnTaskDefinition attributeNotes, "UNMAPPABLE / DROPPED"). The upstream
  // accumulator (`addInferenceAccelerator()`, the `inferenceAccelerators` getter, and the
  // compatibility validations) is preserved in base/task-definition.ts purely for
  // interface-compatibility -- see the `// TERRACONSTRUCTS DEVIATION` comment there -- but there is
  // no Terraform attribute to assert the rendered value against, so both tests in this describe
  // block are dropped rather than reduced to a tautology.
  //
  // describe('setting inferenceAccelerators', () => {
  //   test('correctly sets inferenceAccelerators using props', () => { ... });
  //   test('correctly sets inferenceAccelerators using props and addInferenceAccelerator method', () => { ... });
  // });

  describe("When importing from an existing Ec2 TaskDefinition", () => {
    test("can succeed using TaskDefinition Arn", () => {
      // GIVEN
      const stack = newStack();
      const expectTaskDefinitionArn = "TD_ARN";

      // WHEN
      const taskDefinition = ecs.Ec2TaskDefinition.fromEc2TaskDefinitionArn(
        stack,
        "EC2_TD_ID",
        expectTaskDefinitionArn,
      );

      // THEN
      expect(taskDefinition.taskDefinitionArn).toBe(expectTaskDefinitionArn);
    });
  });

  describe("When importing from an existing Ec2 TaskDefinition using attributes", () => {
    test("can set the imported task attribuets successfully", () => {
      // GIVEN
      const stack = newStack();
      const expectTaskDefinitionArn = "TD_ARN";
      const expectNetworkMode = ecs.NetworkMode.AWS_VPC;
      const expectTaskRole = new iam.Role(stack, "TaskRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      });
      const expectExecutionRole = new iam.Role(stack, "ExecutionRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      });

      // WHEN
      const taskDefinition =
        ecs.Ec2TaskDefinition.fromEc2TaskDefinitionAttributes(stack, "TD_ID", {
          taskDefinitionArn: expectTaskDefinitionArn,
          networkMode: expectNetworkMode,
          taskRole: expectTaskRole,
          executionRole: expectExecutionRole,
        });

      // THEN
      expect(taskDefinition.taskDefinitionArn).toBe(expectTaskDefinitionArn);
      expect(taskDefinition.compatibility).toBe(ecs.Compatibility.EC2);
      expect(taskDefinition.isEc2Compatible).toBeTruthy();
      expect(taskDefinition.isFargateCompatible).toBeFalsy();
      expect(taskDefinition.networkMode).toBe(expectNetworkMode);
      expect(taskDefinition.taskRole).toBe(expectTaskRole);
      expect(taskDefinition.executionRole).toEqual(expectExecutionRole);
    });

    test("returns an Ec2 TaskDefinition that will throw an error when trying to access its yet to defined networkMode", () => {
      // GIVEN
      const stack = newStack();
      const expectTaskDefinitionArn = "TD_ARN";
      const expectTaskRole = new iam.Role(stack, "TaskRole", {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      });

      // WHEN
      const taskDefinition =
        ecs.Ec2TaskDefinition.fromEc2TaskDefinitionAttributes(stack, "TD_ID", {
          taskDefinitionArn: expectTaskDefinitionArn,
          taskRole: expectTaskRole,
        });

      // THEN
      expect(() => taskDefinition.networkMode).toThrow(
        "This operation requires the networkMode in ImportedTaskDefinition to be defined. " +
          "Add the 'networkMode' in ImportedTaskDefinitionProps to instantiate ImportedTaskDefinition",
      );
    });

    test("returns an Ec2 TaskDefinition that will throw an error when trying to access its yet to defined taskRole", () => {
      // GIVEN
      const stack = newStack();
      const expectTaskDefinitionArn = "TD_ARN";
      const expectNetworkMode = ecs.NetworkMode.AWS_VPC;

      // WHEN
      const taskDefinition =
        ecs.Ec2TaskDefinition.fromEc2TaskDefinitionAttributes(stack, "TD_ID", {
          taskDefinitionArn: expectTaskDefinitionArn,
          networkMode: expectNetworkMode,
        });

      // THEN
      expect(() => {
        taskDefinition.taskRole;
      }).toThrow(
        "This operation requires the taskRole in ImportedTaskDefinition to be defined. " +
          "Add the 'taskRole' in ImportedTaskDefinitionProps to instantiate ImportedTaskDefinition",
      );
    });
  });

  test("throws when setting proxyConfiguration without networkMode AWS_VPC", () => {
    // GIVEN
    const stack = newStack();

    const proxyConfiguration =
      ecs.ProxyConfigurations.appMeshProxyConfiguration({
        containerName: "envoy",
        properties: {
          ignoredUID: 1337,
          proxyIngressPort: 15000,
          proxyEgressPort: 15001,
          appPorts: [9080, 9081],
          egressIgnoredIPs: ["169.254.170.2", "169.254.169.254"],
        },
      });

    // THEN
    expect(() => {
      new ecs.Ec2TaskDefinition(stack, "TaskDef", {
        networkMode: ecs.NetworkMode.BRIDGE,
        proxyConfiguration,
      });
    }).toThrow(
      /ProxyConfiguration can only be used with AwsVpc network mode, got: bridge/,
    );
  });

  test("throws an error when an invalid constraint is provided", () => {
    // GIVEN
    const stack = newStack();
    const invalidConstraint = ecs.PlacementConstraint.distinctInstances();

    // THEN
    expect(() => {
      new ecs.Ec2TaskDefinition(stack, "TaskDef", {
        placementConstraints: [invalidConstraint],
      });
    }).toThrow(
      /Invalid placement constraint\(s\): distinctInstance. Only 'memberOf' is currently supported in the Ec2TaskDefinition class./,
    );
  });
});

// NOTE: not part of the upstream suite - added per harness convention (see
// test/aws/notify/queue.test.ts / test/aws/compute/ecs/app-mesh-proxy-configuration.test.ts for the
// idiom) to guard against emitted-Terraform drift for the `aws_ecs_task_definition` resource and its
// jsonencoded `container_definitions` blob.
describe("Ec2TaskDefinition synth", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app = Testing.app({ fakeCdktfJsonPath: true });
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });

    // WHEN
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
      placementConstraints: [
        ecs.PlacementConstraint.memberOf("attribute:ecs.instance-type =~ t2.*"),
      ],
    });
    const container = taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
    });
    container.addPortMappings({ containerPort: 3000 });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
