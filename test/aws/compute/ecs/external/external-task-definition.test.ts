// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/external/external-task-definition.test.ts

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
import * as compute from "../../../../../src/aws/compute";
import * as encryption from "../../../../../src/aws/encryption";
import * as iam from "../../../../../src/aws/iam";
import * as storage from "../../../../../src/aws/storage";
import { Duration } from "../../../../../src/duration";
import { Annotations, Template } from "../../../../assertions";

const ecs = compute.ecs;

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("external task definition", () => {
  describe("When creating an External TaskDefinition", () => {
    test("with only required properties set, it correctly sets default properties", () => {
      // GIVEN
      const stack = newStack();
      const taskDefinition = new ecs.ExternalTaskDefinition(
        stack,
        "ExternalTaskDef",
      );

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          // TERRACONSTRUCTS DEVIATION: HARD REPO INVARIANT #1 (stack-scoped
          // physical naming) -- `family` has no TF `name`/`name_prefix` pair
          // (`aws_ecs_task_definition` only has `family`), so it falls back
          // to `props.family ?? this.stack.uniqueResourceName(this)`
          // (see `TaskDefinition` constructor) instead of the bare
          // construct-id literal ('ExternalTaskDef') CFN's logical-id-based
          // naming produces upstream.
          family: stack.resolve(taskDefinition.family),
          network_mode: ecs.NetworkMode.BRIDGE,
          requires_compatibilities: ["EXTERNAL"],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'ExternalTaskDef',
      //   NetworkMode: ecs.NetworkMode.BRIDGE,
      //   RequiresCompatibilities: ['EXTERNAL'],
      // });
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
      new ecs.ExternalTaskDefinition(stack, "ExternalTaskDef", {
        executionRole,
        family: "ecs-tasks",
        networkMode: ecs.NetworkMode.HOST,
        taskRole,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          execution_role_arn: stack.resolve(executionRole.roleArn),
          family: "ecs-tasks",
          network_mode: "host",
          requires_compatibilities: ["EXTERNAL"],
          task_role_arn: stack.resolve(taskRole.roleArn),
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
      //   NetworkMode: 'host',
      //   RequiresCompatibilities: [
      //     'EXTERNAL',
      //   ],
      //   TaskRoleArn: {
      //     'Fn::GetAtt': [
      //       'TaskRole30FC0FBB',
      //       'Arn',
      //     ],
      //   },
      // });
    });

    test("error when an invalid networkmode is set", () => {
      // GIVEN
      const stack = newStack();

      // THEN
      expect(() => {
        new ecs.ExternalTaskDefinition(stack, "ExternalTaskDef", {
          networkMode: ecs.NetworkMode.AWS_VPC,
        });
      }).toThrow(
        "External tasks can only have Bridge, Host or None network mode, got: awsvpc",
      );
    });

    test("correctly sets containers", () => {
      // GIVEN
      const stack = newStack();

      const taskDefinition = new ecs.ExternalTaskDefinition(
        stack,
        "ExternalTaskDef",
      );

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

      container.addToExecutionPolicy(
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["ecs:*"],
        }),
      );

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsTaskDefinition.EcsTaskDefinition,
        {
          family: stack.resolve(taskDefinition.family),
          network_mode: ecs.NetworkMode.BRIDGE,
          requires_compatibilities: ["EXTERNAL"],
        },
      );
      const [containerDef] = renderedContainerDefinitions(stack);
      expect(containerDef).toMatchObject({
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
      });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'ExternalTaskDef',
      //   NetworkMode: ecs.NetworkMode.BRIDGE,
      //   RequiresCompatibilities: ['EXTERNAL'],
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
      //   }],
      // });

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: ["ecs:*"],
              effect: "Allow",
              resources: ["*"],
            }),
          ]),
        },
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
      const stack = newStack();

      const taskDefinition = new ecs.ExternalTaskDefinition(
        stack,
        "ExternalTaskDef",
      );
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
        logging: new ecs.AwsLogDriver({ streamPrefix: "prefix" }),
        memoryReservationMiB: 1024,
        secrets: {
          SECRET: ecs.Secret.fromSecretsManager(secret),
          PARAMETER: ecs.Secret.fromSsmParameter(parameter),
        },
        user: "amazon",
        workingDirectory: "app/",
      });

      // THEN
      const [containerDef] = renderedContainerDefinitions(stack);
      expect(containerDef).toMatchObject({
        command: ["CMD env"],
        cpu: 256,
        disableNetworking: true,
        dnsSearchDomains: ["0.0.0.0"],
        dnsServers: ["1.1.1.1"],
        dockerLabels: { LABEL: "label" },
        dockerSecurityOptions: ["ECS_SELINUX_CAPABLE=true"],
        entryPoint: ["/app/node_modules/.bin/cdk"],
        environment: [
          {
            name: "TEST_ENVIRONMENT_VARIABLE",
            value: "test environment variable value",
          },
        ],
        // TERRACONSTRUCTS DEVIATION: `EnvironmentFileEntryConfig.value` is
        // built from the S3 asset's (deterministically-hashed, but not
        // reproduced here) bucket/key rather than upstream's CFN asset
        // parameter `Fn::Join` -- assert the shape, not the exact digest.
        // The bucket/key are themselves unresolved `aws_s3_bucket`/
        // `aws_s3_object` attribute-reference tokens (not the literal source
        // filename), so the match can't require a `.env` suffix either.
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
          options: expect.objectContaining({
            "awslogs-stream-prefix": "prefix",
            "awslogs-group": expect.any(String),
            "awslogs-region": expect.any(String),
          }),
        },
        memory: 2048,
        memoryReservation: 1024,
        name: "web",
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
      });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'ExternalTaskDef',
      //   NetworkMode: ecs.NetworkMode.BRIDGE,
      //   RequiresCompatibilities: ['EXTERNAL'],
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
      //               {
      //                 Ref: 'AWS::Partition',
      //               },
      //               ':s3:::',
      //               {
      //                 'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}',
      //               },
      //               '/872561bf078edd1685d50c9ff821cdd60d2b2ddfb0013c4087e79bf2bb50724d.env',
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
      //           'awslogs-group': {
      //             Ref: 'ExternalTaskDefwebLogGroup827719D6',
      //           },
      //           'awslogs-stream-prefix': 'prefix',
      //           'awslogs-region': {
      //             Ref: 'AWS::Region',
      //           },
      //         },
      //       },
      //       Memory: 2048,
      //       MemoryReservation: 1024,
      //       Name: 'web',
      //       Secrets: [
      //         {
      //           Name: 'SECRET',
      //           ValueFrom: {
      //             Ref: 'SecretA720EF05',
      //           },
      //         },
      //         {
      //           Name: 'PARAMETER',
      //           ValueFrom: {
      //             'Fn::Join': [
      //               '',
      //               [
      //                 'arn:',
      //                 {
      //                   Ref: 'AWS::Partition',
      //                 },
      //                 ':ssm:',
      //                 {
      //                   Ref: 'AWS::Region',
      //                 },
      //                 ':',
      //                 {
      //                   Ref: 'AWS::AccountId',
      //                 },
      //                 ':parameter/name',
      //               ],
      //             ],
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

      const taskDefinition = new ecs.ExternalTaskDefinition(
        stack,
        "ExternalTaskDef",
      );

      const repo = new storage.Repository(stack, "myECRImage", {
        lifecycleRegistryId: "123456789101",
        lifecycleRules: [
          {
            rulePriority: 10,
            tagPrefixList: ["abc"],
            maxImageCount: 1,
          },
        ],
        // TERRACONSTRUCTS DEVIATION: upstream also passes `removalPolicy:
        // cdk.RemovalPolicy.DESTROY` here -- `storage.Repository` does not
        // yet expose a `removalPolicy` prop (see the TODO in
        // src/aws/storage/ecr-repository.ts), so it is dropped.
        repositoryName: "project-a/amazon-ecs-sample",
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromEcrRepository(repo),
        memoryLimitMiB: 512,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecrLifecyclePolicy.EcrLifecyclePolicy,
        {
          repository: stack.resolve(repo.repositoryName),
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
      Template.synth(stack).toHaveResourceWithProperties(
        ecrRepository.EcrRepository,
        {
          name: "project-a/amazon-ecs-sample",
        },
      );
      // TERRACONSTRUCTS DEVIATION: `lifecycleRegistryId` has no terraform-provider-aws
      // equivalent for ECR lifecycle policies (see the `@deprecated` note on
      // `RepositoryProps.lifecycleRegistryId`) -- the value is dropped and a
      // warning is emitted instead of being rendered as `RegistryId`.
      Annotations.fromStack(stack).hasWarnings({
        message:
          "lifecycleRegistryId is not supported by the Terraform AWS provider and will be ignored.",
      });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECR::Repository', {
      //   LifecyclePolicy: {
      //
      //     LifecyclePolicyText: '{"rules":[{"rulePriority":10,"selection":{"tagStatus":"tagged","tagPrefixList":["abc"],"countType":"imageCountMoreThan","countNumber":1},"action":{"type":"expire"}}]}',
      //     RegistryId: '123456789101',
      //   },
      //   RepositoryName: 'project-a/amazon-ecs-sample',
      // });

      const [containerDef] = renderedContainerDefinitions(stack);
      expect(containerDef).toMatchObject({
        essential: true,
        memory: 512,
        // TERRACONSTRUCTS DEVIATION: upstream's `Image` renders a CFN
        // `Fn::Join`/`Fn::Select`/`Fn::Split` expression that parses the
        // repository ARN apart to rebuild the registry URI. The
        // `aws_ecr_repository` resource instead exposes a ready-made
        // `repository_url` attribute, so `EcrImage`/`Repository` just
        // concatenate the tag onto it directly.
        image: stack.resolve(repo.repositoryUriForTag("latest")),
        name: "web",
      });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   Family: 'ExternalTaskDef',
      //   NetworkMode: ecs.NetworkMode.BRIDGE,
      //   RequiresCompatibilities: ['EXTERNAL'],
      //   ContainerDefinitions: [{
      //     Essential: true,
      //     Memory: 512,
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
      //                   {
      //                     'Fn::GetAtt': [
      //                       'myECRImage7DEAE474',
      //                       'Arn',
      //                     ],
      //                   },
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
      //                   {
      //                     'Fn::GetAtt': [
      //                       'myECRImage7DEAE474',
      //                       'Arn',
      //                     ],
      //                   },
      //                 ],
      //               },
      //             ],
      //           },
      //           '.',
      //           {
      //             Ref: 'AWS::URLSuffix',
      //           },
      //           '/',
      //           {
      //             Ref: 'myECRImage7DEAE474',
      //           },
      //           ':latest',
      //         ],
      //       ],
      //     },
      //     Name: 'web',
      //   }],
      // });
    });
  });

  test("correctly sets containers from ECR repository using an image tag", () => {
    // GIVEN
    const stack = newStack();

    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
    );
    const repo = new storage.Repository(stack, "myECRImage");
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(repo, "myTag"),
      memoryLimitMiB: 512,
    });

    // THEN
    const [containerDef] = renderedContainerDefinitions(stack);
    expect(containerDef).toMatchObject({
      essential: true,
      memory: 512,
      image: stack.resolve(repo.repositoryUriForTag("myTag")),
      name: "web",
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   Family: 'ExternalTaskDef',
    //   NetworkMode: ecs.NetworkMode.BRIDGE,
    //   RequiresCompatibilities: ['EXTERNAL'],
    //   ContainerDefinitions: [{
    //     Essential: true,
    //     Memory: 512,
    //     Image: {
    //       'Fn::Join': [
    //         '',
    //         [
    //           {
    //             'Fn::Select': [4, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }],
    //           },
    //           '.dkr.ecr.',
    //           {
    //             'Fn::Select': [3, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }],
    //           },
    //           '.',
    //           { Ref: 'AWS::URLSuffix' },
    //           '/',
    //           { Ref: 'myECRImage7DEAE474' },
    //           ':myTag',
    //         ],
    //       ],
    //     },
    //     Name: 'web',
    //   }],
    // });
  });

  test("correctly sets containers from ECR repository using an image digest", () => {
    // GIVEN
    const stack = newStack();
    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
    );
    const repo = new storage.Repository(stack, "myECRImage");
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(
        repo,
        "sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE",
      ),
      memoryLimitMiB: 512,
    });

    // THEN
    const [containerDef] = renderedContainerDefinitions(stack);
    expect(containerDef).toMatchObject({
      essential: true,
      memory: 512,
      image: stack.resolve(
        repo.repositoryUriForDigest(
          "sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE",
        ),
      ),
      name: "web",
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   Family: 'ExternalTaskDef',
    //   NetworkMode: ecs.NetworkMode.BRIDGE,
    //   RequiresCompatibilities: ['EXTERNAL'],
    //   ContainerDefinitions: [{
    //     Essential: true,
    //     Memory: 512,
    //     Image: {
    //       'Fn::Join': [
    //         '',
    //         [
    //           {
    //             'Fn::Select': [4, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }],
    //           },
    //           '.dkr.ecr.',
    //           {
    //             'Fn::Select': [3, { 'Fn::Split': [':', { 'Fn::GetAtt': ['myECRImage7DEAE474', 'Arn'] }] }],
    //           },
    //           '.',
    //           { Ref: 'AWS::URLSuffix' },
    //           '/',
    //           { Ref: 'myECRImage7DEAE474' },
    //           '@sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE',
    //         ],
    //       ],
    //     },
    //     Name: 'web',
    //   }],
    // });
  });

  test("correctly sets containers from ECR repository using default props", () => {
    // GIVEN
    const stack = newStack();
    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
    );

    // WHEN
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(
        new storage.Repository(stack, "myECRImage"),
      ),
      memoryLimitMiB: 512,
    });

    // THEN
    Template.resources(stack, ecrRepository.EcrRepository).toHaveLength(1);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECR::Repository', {});
  });

  test("warns when setting containers from ECR repository using fromRegistry method", () => {
    // GIVEN
    const stack = newStack();

    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
    );

    // WHEN
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry(
        "ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY",
      ),
      memoryLimitMiB: 512,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: `RepositoryImage.bind()` (src/aws/compute/ecs/images/repository.ts)
    // has a `// TODO: Annotations.of(scope).addWarningV2(...)` breadcrumb and
    // still uses the plain `addWarning()` -- the emitted message therefore
    // lacks upstream's `[ack: @aws-cdk/aws-ecs:ecrImageRequiresPolicy]` suffix.
    Annotations.fromStack(stack).hasWarnings({
      message:
        "Proper policies need to be attached before pulling from ECR repository, or use 'fromEcrRepository'.",
    });
    // Annotations.fromStack(stack).hasWarning('/Default/ExternalTaskDef/web', "Proper policies need to be attached before pulling from ECR repository, or use 'fromEcrRepository'. [ack: @aws-cdk/aws-ecs:ecrImageRequiresPolicy]");
  });

  test("correctly sets volumes", () => {
    // GIVEN
    const stack = newStack();
    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
      {},
    );

    // WHEN
    taskDefinition.addVolume({
      host: {
        sourcePath: "/tmp/cache",
      },
      name: "scratch",
    });

    // THEN
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

  test("error when interferenceAccelerators set", () => {
    const stack = newStack();
    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
      {},
    );

    // THEN
    expect(() =>
      taskDefinition.addInferenceAccelerator({
        deviceName: "device1",
        deviceType: "eia2.medium",
      }),
    ).toThrow(
      "Cannot use inference accelerators on tasks that run on External service",
    );
  });

  test("can import an External Task Definition using attributes", () => {
    // GIVEN
    const stack = newStack();
    const expectTaskDefinitionArn = "TD_ARN";
    const expectCompatibility = ecs.Compatibility.EXTERNAL;
    const expectNetworkMode = ecs.NetworkMode.AWS_VPC;
    const expectTaskRole = new iam.Role(stack, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    const expectExecutionRole = new iam.Role(stack, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // WHEN
    const taskDefinition =
      ecs.ExternalTaskDefinition.fromExternalTaskDefinitionAttributes(
        stack,
        "TD_ID",
        {
          taskDefinitionArn: expectTaskDefinitionArn,
          networkMode: expectNetworkMode,
          taskRole: expectTaskRole,
          executionRole: expectExecutionRole,
        },
      );

    // THEN
    expect(taskDefinition.taskDefinitionArn).toEqual(expectTaskDefinitionArn);
    expect(taskDefinition.compatibility).toEqual(expectCompatibility);
    expect(taskDefinition.executionRole).toEqual(expectExecutionRole);
    expect(taskDefinition.networkMode).toEqual(expectNetworkMode);
    expect(taskDefinition.taskRole).toEqual(expectTaskRole);
  });
});

// NOTE: not part of the upstream suite - added per harness convention (see
// test/aws/notify/queue.test.ts / test/aws/compute/ecs/app-mesh-proxy-configuration.test.ts
// for the idiom) to guard against emitted-Terraform drift, in particular for
// the aws_ecs_task_definition.container_definitions jsonencoded blob.
describe("ExternalTaskDefinition synth", () => {
  test("Should synth and match SnapShot with defaults", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);
    new ecs.ExternalTaskDefinition(stack, "ExternalTaskDef");

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with a fully configured container", () => {
    // GIVEN
    const stack = newStack();
    new HttpBackend(stack, gridBackendConfig);
    const taskDefinition = new ecs.ExternalTaskDefinition(
      stack,
      "ExternalTaskDef",
    );

    // WHEN
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
      logging: new ecs.AwsLogDriver({ streamPrefix: "prefix" }),
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function newStack(): AwsStack {
  const app: App = Testing.app({ fakeCdktfJsonPath: true });
  return new AwsStack(app);
}

/**
 * Parses the jsonencode()'d `container_definitions` string off the single
 * `aws_ecs_task_definition` resource in the stack (see the `TERRACONSTRUCTS DEVIATION`
 * note on `TaskDefinition` in `src/aws/compute/ecs/base/task-definition.ts` -- upstream's
 * typed `ContainerDefinitions` Cfn array has no typed TF counterpart, it is rendered as a
 * single JSON string instead).
 */
function renderedContainerDefinitions(stack: AwsStack): any[] {
  const resources = Template.resourceObjects(
    stack,
    ecsTaskDefinition.EcsTaskDefinition,
  ) as Record<string, { container_definitions: string }>;
  const [taskDef] = Object.values(resources);
  return JSON.parse(taskDef.container_definitions);
}
