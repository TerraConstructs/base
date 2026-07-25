// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/base-service.test.ts

import { ecsService, iamRole, iamRolePolicy } from "@cdktn/provider-aws";
import { HttpBackend, Lazy, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as encryption from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

/**
 * Grab the single synthesized resource of a given type as a plain object,
 * without hard-coding TerraConstructs' generated (hashed) logical id.
 */
function soleResource(stack: AwsStack, type: any): any {
  return Object.values(Template.resourceObjects(stack, type))[0];
}

describe("When import an ECS Service", () => {
  let stack: AwsStack;

  beforeEach(() => {
    stack = new AwsStack();
  });

  test("with serviceArnWithCluster", () => {
    // GIVEN
    const clusterName = "cluster-name";
    const serviceName = "my-http-service";
    const region = "service-region";
    const account = "service-account";
    const serviceArn = `arn:aws:ecs:${region}:${account}:service/${clusterName}/${serviceName}`;

    // WHEN
    const service = ecs.BaseService.fromServiceArnWithCluster(
      stack,
      "Service",
      serviceArn,
    );

    // THEN
    expect(service.serviceArn).toEqual(serviceArn);
    expect(service.serviceName).toEqual(serviceName);
    expect(service.env.account).toEqual(account);
    expect(service.env.region).toEqual(region);

    expect(service.cluster.clusterName).toEqual(clusterName);
    expect(service.cluster.env.account).toEqual(account);
    expect(service.cluster.env.region).toEqual(region);
  });

  test("throws an expection if no resourceName provided on fromServiceArnWithCluster", () => {
    expect(() => {
      ecs.BaseService.fromServiceArnWithCluster(
        stack,
        "Service",
        "arn:aws:ecs:service-region:service-account:service",
      );
    }).toThrow(
      /Expected resource name in ARN, didn't find one: 'arn:aws:ecs:service-region:service-account:service'/,
    );
  });

  test("throws an expection if not using cluster arn format on fromServiceArnWithCluster", () => {
    expect(() => {
      ecs.BaseService.fromServiceArnWithCluster(
        stack,
        "Service",
        "arn:aws:ecs:service-region:service-account:service/my-http-service",
      );
    }).toThrow(/is not using the ARN cluster format/);
  });

  test("skip validation for tokenized values", () => {
    expect(() =>
      ecs.BaseService.fromServiceArnWithCluster(
        stack,
        "Service",
        Lazy.stringValue({
          produce: () => "arn:aws:ecs:service-region:service-account:service",
        }),
      ),
    ).not.toThrow();
  });

  test("should add a dependency on task role", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["test:SpecialName"],
        resources: ["*"],
      }),
    );

    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // THEN
    const service = soleResource(stack, ecsService.EcsService);
    expect(service.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          new RegExp(
            `^${iamRolePolicy.IamRolePolicy.tfResourceType}\\..*TaskRole.*DefaultPolicy.*`,
          ),
        ),
        expect.stringMatching(
          new RegExp(`^${iamRole.IamRole.tfResourceType}\\..*TaskRole.*`),
        ),
      ]),
    );
    // OLD CFN:
    // Template.fromStack(stack).hasResource('AWS::ECS::Service', {
    //   DependsOn: [
    //     'FargateTaskDefTaskRoleDefaultPolicy8EB25BBD',
    //     'FargateTaskDefTaskRole0B257552',
    //   ],
    // });
  });

  test("should add tls configuration to service connect service", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    const kmsKey = new encryption.Key(stack, "KmsKey");
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
    });
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });
    const service = new ecs.FargateService(stack, "Service", {
      cluster,
      taskDefinition,
    });

    // WHEN
    service.enableServiceConnect({
      services: [
        {
          tls: {
            awsPcaAuthorityArn:
              "arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/123456789012",
            kmsKey,
            role,
          },
          portMappingName: "api",
        },
      ],
      namespace: "test namespace",
    });

    // THEN
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.service_connect_configuration).toMatchObject({
      namespace: "test namespace",
      service: [
        {
          port_name: "api",
          tls: {
            issuer_cert_authority: {
              aws_pca_authority_arn:
                "arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/123456789012",
            },
            kms_key: stack.resolve(kmsKey.keyArn),
            role_arn: stack.resolve(role.roleArn),
          },
        },
      ],
    });
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   ServiceConnectConfiguration: {
    //     Services: [
    //       {
    //         Tls: {
    //           IssuerCertificateAuthority: {
    //             AwsPcaAuthorityArn:
    //               'arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/123456789012',
    //           },
    //           KmsKey: stack.resolve(kmsKey.keyArn),
    //           RoleArn: stack.resolve(role.roleArn),
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("throws an error when awsPcaAuthorityArn is not an ARN", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });

    // WHEN
    const createFargateService = () =>
      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        serviceConnectConfiguration: {
          services: [
            {
              tls: {
                awsPcaAuthorityArn: "invalid-arn",
              },
              portMappingName: "api",
            },
          ],
          namespace: "test namespace",
        },
      });

    // THEN
    expect(() => createFargateService()).toThrow(
      /awsPcaAuthorityArn must start with "arn:" and have at least 6 components; received invalid-arn/,
    );
  });

  test("throws an error when tls is configured with no awsPcaAuthorityArn", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });

    // WHEN
    const createFargateService = () =>
      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        serviceConnectConfiguration: {
          services: [
            {
              tls: {},
              portMappingName: "api",
            },
          ],
          namespace: "test namespace",
        },
      });

    // THEN
    expect(() => createFargateService()).toThrow(
      /'awsPcaAuthorityArn' is required when 'tls' is configured on a Service Connect service/,
    );
  });

  test("throws an error when tls only sets role and omits awsPcaAuthorityArn", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
    });

    // WHEN
    const createFargateService = () =>
      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        serviceConnectConfiguration: {
          services: [
            {
              tls: { role },
              portMappingName: "api",
            },
          ],
          namespace: "test namespace",
        },
      });

    // THEN
    expect(() => createFargateService()).toThrow(
      /'awsPcaAuthorityArn' is required when 'tls' is configured on a Service Connect service/,
    );
  });

  test("throws an error when tls only sets kmsKey and omits awsPcaAuthorityArn", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });
    const kmsKey = new encryption.Key(stack, "KmsKey");

    // WHEN
    const createFargateService = () =>
      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        serviceConnectConfiguration: {
          services: [
            {
              tls: { kmsKey },
              portMappingName: "api",
            },
          ],
          namespace: "test namespace",
        },
      });

    // THEN
    expect(() => createFargateService()).toThrow(
      /'awsPcaAuthorityArn' is required when 'tls' is configured on a Service Connect service/,
    );
  });

  test("throws an error when tls sets awsPcaAuthorityArn to an empty string", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });

    // WHEN
    const createFargateService = () =>
      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        serviceConnectConfiguration: {
          services: [
            {
              tls: { awsPcaAuthorityArn: "" },
              portMappingName: "api",
            },
          ],
          namespace: "test namespace",
        },
      });

    // THEN
    expect(() => createFargateService()).toThrow(
      /'awsPcaAuthorityArn' is required when 'tls' is configured on a Service Connect service/,
    );
  });

  test("does not throw and resolves an unresolved token awsPcaAuthorityArn", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });
    const tokenizedArn = Lazy.stringValue({
      produce: () =>
        "arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/123456789012",
    });

    // WHEN
    const createFargateService = () =>
      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        serviceConnectConfiguration: {
          services: [
            {
              tls: {
                awsPcaAuthorityArn: tokenizedArn,
              },
              portMappingName: "api",
            },
          ],
          namespace: "test namespace",
        },
      });

    // THEN
    expect(createFargateService).not.toThrow();

    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.service_connect_configuration).toMatchObject({
      namespace: "test namespace",
      service: [
        {
          port_name: "api",
          tls: {
            issuer_cert_authority: {
              aws_pca_authority_arn: stack.resolve(tokenizedArn),
            },
          },
        },
      ],
    });
  });
});

// TERRACONSTRUCTS DEVIATION: upstream's "For alarm-based rollbacks" describe block exercises the
// `@aws-cdk/aws-ecs:removeDefaultDeploymentAlarm` feature flag (via `cxapi.ECS_REMOVE_DEFAULT_DEPLOYMENT_ALARM`),
// which is not ported (no feature-flag/cx-api surface exists in this repo, see src/aws/cx-api.ts).
// This repo's `base-service.ts` always targets the modern/recommended CDK behavior for this flag
// (`recommendedValue: true`), so the legacy "set a default (disabled, empty-alarm-list) deploymentAlarms
// block on the ECS deployment controller" branch was dropped entirely -- `alarms` is only ever set when
// `props.deploymentAlarms` is explicitly provided. The two tests below assert exactly that dropped legacy
// default behavior and are therefore omitted (not just their flag context):
//
// test.each([
//   [true, { Alarms: Match.absent() }],
//   [false, { Alarms: { AlarmNames: [], Enable: false, Rollback: false } }],
// ])('deploymentAlarms is (not set)/(set) by default for ECS deployment controller when feature flag is enabled/disabled', ...)
//
// test('deploymentAlarms is set by default when deployment controller is not specified', ...)
describe("For alarm-based rollbacks", () => {
  let stack: AwsStack;

  beforeEach(() => {
    stack = new AwsStack();
  });

  test("should omit deploymentAlarms for CodeDeploy deployment controller", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });

    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // THEN
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.alarms).toBeUndefined();
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     Alarms: Match.absent(),
    //   },
    // });
  });

  test("should omit deploymentAlarms for External deployment controller", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });

    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.EXTERNAL,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // THEN
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.alarms).toBeUndefined();
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     Alarms: Match.absent(),
    //   },
    // });
  });
});

describe("When specifying a task definition revision", () => {
  let stack: AwsStack;

  beforeEach(() => {
    stack = new AwsStack();
  });

  test("specifies the revision if set to something other than latest", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });

    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      taskDefinitionRevision: ecs.TaskDefinitionRevision.of(1),
    });

    // THEN
    const family = stack.resolve(taskDefinition.family);
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.task_definition).toEqual(`${family}:1`);
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   TaskDefinition: 'FargateTaskDef:1',
    // });
  });

  test("omits the revision if set to latest", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });

    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      taskDefinitionRevision: ecs.TaskDefinitionRevision.LATEST,
    });

    // THEN
    const family = stack.resolve(taskDefinition.family);
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.task_definition).toEqual(family);
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   TaskDefinition: 'FargateTaskDef',
    // });
  });
});

// TERRACONSTRUCTS DEVIATION: upstream's top-level test.each(...) ('circuitbreaker is %p /\\ flag
// is %p => DeploymentController in output: %p') exercises the
// `@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker` feature flag (via
// `context: { '@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker': flagValue }`).
// That flag is not ported (no feature-flag/cx-api surface exists in this repo, see
// src/aws/cx-api.ts); `base-service.ts` always targets the modern/recommended behavior
// (`recommendedValue: true`, i.e. never implicitly set `{ type: DeploymentControllerType.ECS }`
// just because `circuitBreaker` is configured), so two of the four parametrized rows
// ([true, false, true] and [true, true, false] collapse to the same "controller omitted" behavior
// and never assert `controllerInTemplate: true`) no longer hold against this port. Omitted in full:
//
// test.each([
//   [false, false, false],
//   [true, false, true],
//   [false, true, false],
//   [true, true, false],
// ])('circuitbreaker is %p /\\ flag is %p => DeploymentController in output: %p', ...)

test.each([
  [true, true],
  [false, false],
  [undefined, undefined],
])(
  "circuitBreaker.enable is %p and circuitBreaker.rollback is %p",
  (enable, rollback) => {
    // GIVEN
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });

    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      circuitBreaker: {
        enable,
        rollback,
      },
    });

    // THEN
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.deployment_circuit_breaker).toEqual({
      enable: enable ?? true,
      rollback: rollback ?? false,
    });
    // OLD CFN:
    // template.hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     DeploymentCircuitBreaker: {
    //       Enable: enable ?? true,
    //       Rollback: rollback ?? false,
    //     },
    //   },
    // });
  },
);

describe("Blue/Green Deployment", () => {
  let stack: AwsStack;
  let vpc: compute.Vpc;
  let cluster: ecs.Cluster;
  let taskDefinition: ecs.FargateTaskDefinition;

  beforeEach(() => {
    stack = new AwsStack();
    vpc = new compute.Vpc(stack, "Vpc");
    cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    taskDefinition = new ecs.FargateTaskDefinition(stack, "FargateTaskDef");
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 80 }],
    });
  });

  test("isUsingECSDeploymentController returns true when no deployment controller is specified", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // THEN
    expect(service.isUsingECSDeploymentController()).toBe(true);
  });

  test("isUsingECSDeploymentController returns true when ECS deployment controller is specified", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
    });

    // THEN
    expect(service.isUsingECSDeploymentController()).toBe(true);
  });

  test("isUsingECSDeploymentController returns false when CODE_DEPLOY deployment controller is specified", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY,
      },
    });

    // THEN
    expect(service.isUsingECSDeploymentController()).toBe(false);
  });

  test("isUsingECSDeploymentController returns false when EXTERNAL deployment controller is specified", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.EXTERNAL,
      },
    });

    // THEN
    expect(service.isUsingECSDeploymentController()).toBe(false);
  });
});

// Wrapping synth/snapshot coverage for the FargateService/BaseService constructs exercised above
// (harness idiom: test/aws/notify/queue.test.ts + test/aws/edge/cloudmap/service.test.ts).
describe("base-service synth", () => {
  test("FargateService with default properties should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    // WHEN
    new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("FargateService with service connect and TLS should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");
    const kmsKey = new encryption.Key(stack, "KmsKey");
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
    });
    taskDefinition.addContainer("Web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [
        {
          name: "api",
          containerPort: 80,
        },
      ],
    });
    const service = new ecs.FargateService(stack, "Service", {
      cluster,
      taskDefinition,
    });
    // WHEN
    service.enableServiceConnect({
      services: [
        {
          tls: {
            awsPcaAuthorityArn:
              "arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/123456789012",
            kmsKey,
            role,
          },
          portMappingName: "api",
        },
      ],
      namespace: "test namespace",
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
