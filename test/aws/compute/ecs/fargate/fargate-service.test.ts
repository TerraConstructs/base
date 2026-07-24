// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/fargate/fargate-service.test.ts

import {
  appautoscalingPolicy,
  appautoscalingScheduledAction,
  appautoscalingTarget,
  dataAwsIamPolicyDocument,
  ecsClusterCapacityProviders,
  ecsService,
  ecsTaskDefinition,
  lbTargetGroup,
  securityGroup as ec2SecurityGroup,
  serviceDiscoveryPrivateDnsNamespace,
  serviceDiscoveryService,
  vpcSecurityGroupEgressRule,
  vpcSecurityGroupIngressRule,
} from "@cdktn/provider-aws";
import { Fn, HttpBackend, Testing, TerraformVariable } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws";
import * as cloudwatch from "../../../../../src/aws/cloudwatch";
import * as compute from "../../../../../src/aws/compute";
import * as ecs from "../../../../../src/aws/compute/ecs";
import { ServiceManagedVolume } from "../../../../../src/aws/compute/ecs/base/service-managed-volume";
import * as cloudmap from "../../../../../src/aws/edge/cloudmap";
import * as encryption from "../../../../../src/aws/encryption";
import * as iam from "../../../../../src/aws/iam";
import * as storage from "../../../../../src/aws/storage";
import { Duration } from "../../../../../src/duration";
import { Size } from "../../../../../src/size";
import { Annotations, Template } from "../../../../assertions";
import { addDefaultCapacityProvider } from "../util";

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

/**
 * The stack typically synthesizes multiple `aws_iam_policy_document` data
 * sources (assume-role policies, cluster capacity provider policy, task role
 * default policy, ...). Find the task role's *default* policy document --
 * identified by carrying the ssmmessages statement `enableExecuteCommand()`
 * always adds to it -- instead of relying on (arbitrarily ordered) indexing.
 */
function taskRoleDefaultPolicyDoc(stack: AwsStack): any {
  const docs = Object.values(
    Template.dataSourceObjects(
      stack,
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    ),
  ) as any[];
  return docs.find((doc) =>
    (doc.statement ?? []).some((statement: any) =>
      (statement.actions ?? []).includes("ssmmessages:CreateControlChannel"),
    ),
  );
}

/**
 * The `kms.Key`'s own resource policy is synthesized as a
 * `data.aws_iam_policy_document` (referenced by the `aws_kms_key.policy`
 * attribute as `${data.aws_iam_policy_document....json}`, not embedded as a
 * literal JSON string) -- find it by its `kms:*` admin statement, rather than
 * trying to `JSON.parse()` the (unresolved token) `policy` attribute.
 */
function kmsKeyPolicyDoc(stack: AwsStack): any {
  const docs = Object.values(
    Template.dataSourceObjects(
      stack,
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    ),
  ) as any[];
  return docs.find((doc) =>
    (doc.statement ?? []).some((statement: any) =>
      (statement.actions ?? []).includes("kms:*"),
    ),
  );
}

/**
 * Grab all synthesized resources of a given type as plain objects, without
 * hard-coding TerraConstructs' generated (hashed) logical ids.
 */
function allResources(stack: AwsStack, type: any): any[] {
  return Object.values(Template.resourceObjects(stack, type));
}

describe("fargate service", () => {
  describe("When creating a Fargate Service", () => {
    test("with only required properties set, it correctly sets default properties", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      const service = new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.taskDefinitionArn),
      );
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.deployment_maximum_percent).toEqual(200);
      expect(resource.deployment_minimum_healthy_percent).toEqual(50);
      expect(resource.launch_type).toEqual("FARGATE");
      expect(resource.enable_ecs_managed_tags).toEqual(false);
      expect(resource.availability_zone_rebalancing).toBeUndefined();
      expect(resource.network_configuration).toMatchObject({
        assign_public_ip: false,
        subnets: stack.resolve(vpc.privateSubnets.map((s) => s.subnetId)),
      });

      const sg = soleResource(stack, ec2SecurityGroup.SecurityGroup);
      expect(sg.description).toEqual("Default/FargateService/SecurityGroup");
      expect(resource.network_configuration.security_groups).toHaveLength(1);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: { Ref: 'FargateTaskDefC6FB60B4' },
      //   Cluster: { Ref: 'EcsCluster97242B84' },
      //   DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 },
      //   LaunchType: LaunchType.FARGATE,
      //   EnableECSManagedTags: false,
      //   NetworkConfiguration: {
      //     AwsvpcConfiguration: {
      //       AssignPublicIp: 'DISABLED',
      //       SecurityGroups: [{ 'Fn::GetAtt': ['FargateServiceSecurityGroup0A0E79CB', 'GroupId'] }],
      //       Subnets: [{ Ref: 'MyVpcPrivateSubnet1Subnet5057CF7E' }, { Ref: 'MyVpcPrivateSubnet2Subnet0040C983' }],
      //     },
      //   },
      //   AvailabilityZoneRebalancing: Match.absent(),
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      //   GroupDescription: 'Default/FargateService/SecurityGroup',
      //   SecurityGroupEgress: [
      //     { CidrIp: '0.0.0.0/0', Description: 'Allow all outbound traffic by default', IpProtocol: '-1' },
      //   ],
      //   VpcId: { Ref: 'MyVpcF9F0CA6F' },
      // });

      expect(service.node.defaultChild).toBeDefined();
    });

    test("can create service with default settings if VPC only has public subnets", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc", {
        subnetConfiguration: [
          {
            cidrMask: 28,
            name: "public-only",
            subnetType: compute.SubnetType.PUBLIC,
          },
        ],
      });
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

      // THEN -- did not throw
      expect(() => stack.prepareStack()).not.toThrow();
    });

    // TERRACONSTRUCTS DEVIATION: upstream's `testDeprecated` helper (from `@aws-cdk/cdk-build-tools`)
    // is not ported (see `test/aws/compute/task-base.test.ts`); the deprecated
    // `capacityProviders` cluster prop below is exercised with a plain `test()`.
    test("does not set launchType when capacity provider strategies specified (deprecated)", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        capacityProviders: ["FARGATE", "FARGATE_SPOT"],
      });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE_SPOT",
            weight: 2,
          },
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
      });

      // THEN
      const associations = soleResource(stack, ecsService.EcsService);
      expect(associations.launch_type).toBeUndefined();
      expect(associations.capacity_provider_strategy).toEqual([
        { capacity_provider: "FARGATE_SPOT", weight: 2 },
        { capacity_provider: "FARGATE", weight: 1 },
      ]);

      const clusterAssociations = soleResource(
        stack,
        ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      );
      expect(clusterAssociations.capacity_providers).toEqual([
        "FARGATE",
        "FARGATE_SPOT",
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Cluster', { CapacityProviders: Match.absent() });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
      //   CapacityProviders: ['FARGATE', 'FARGATE_SPOT'],
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: { Ref: 'FargateTaskDefC6FB60B4' },
      //   Cluster: { Ref: 'EcsCluster97242B84' },
      //   DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 },
      //   // no launch type
      //   CapacityProviderStrategy: [
      //     { CapacityProvider: 'FARGATE_SPOT', Weight: 2 },
      //     { CapacityProvider: 'FARGATE', Weight: 1 },
      //   ],
      //   EnableECSManagedTags: false,
      //   NetworkConfiguration: { ... },
      // });
    });

    // TERRACONSTRUCTS DEVIATION: upstream gates the broad "no CloudWatch log group configured"
    // execute-command permission branch behind the `@aws-cdk/aws-ecs:reduceEc2FargateCloudWatchPermissions`
    // feature flag (recommendedValue: true, see `base-service.ts` `executeCommandLogConfiguration()`).
    // This repo always targets the modern/recommended behavior, so the legacy (flag-disabled)
    // broad-wildcard-permission branch is dropped entirely. Omitted in full:
    //
    // [false, undefined].forEach((value) => {
    //   test('set cloudwatch permissions based on falsy feature flag when no cloudwatch log configured', ...)
    // });

    test("set cloudwatch permissions based on true feature flag when no cloudwatch log configured", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.FargateTaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual([
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
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       { Action: [...ssmmessages], Effect: 'Allow', Resource: '*' },
      //       { Action: 'logs:DescribeLogGroups', Effect: 'Allow', Resource: '*' },
      //       { Action: [...logs write], Effect: 'Allow', Resource: '*' },
      //     ],
      //     Version: '2012-10-17',
      //   },
      // });
    });

    test("set cloudwatch permissions based on true feature flag when cloudwatch log is configured", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          logConfiguration: {
            cloudWatchLogGroup: logGroup,
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });
      const taskDefinition = new ecs.FargateTaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: ["logs:DescribeLogGroups"],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: [
              "logs:CreateLogStream",
              "logs:DescribeLogStreams",
              "logs:PutLogEvents",
            ],
            effect: "Allow",
          }),
        ]),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       { Action: [...ssmmessages], Effect: 'Allow', Resource: '*' },
      //       { Action: 'logs:DescribeLogGroups', Effect: 'Allow', Resource: '*' },
      //       { Action: [...logs write], Effect: 'Allow', Resource: { 'Fn::Join': [...log-group arn...] } },
      //     ],
      //     Version: '2012-10-17',
      //   },
      // });
    });

    test("does not set launchType when capacity provider strategies specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      cluster.enableFargateCapacityProviders();

      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        capacityProviderStrategies: [
          {
            capacityProvider: "FARGATE_SPOT",
            weight: 2,
          },
          {
            capacityProvider: "FARGATE",
            weight: 1,
          },
        ],
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.launch_type).toBeUndefined();
      expect(resource.capacity_provider_strategy).toEqual([
        { capacity_provider: "FARGATE_SPOT", weight: 2 },
        { capacity_provider: "FARGATE", weight: 1 },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Cluster', { CapacityProviders: Match.absent() });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
      //   CapacityProviders: ['FARGATE', 'FARGATE_SPOT'],
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   // no launch type
      //   LaunchType: Match.absent(),
      //   CapacityProviderStrategy: [
      //     { CapacityProvider: 'FARGATE_SPOT', Weight: 2 },
      //     { CapacityProvider: 'FARGATE', Weight: 1 },
      //   ],
      // });
    });

    test("with custom cloudmap namespace", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      const cloudMapNamespace = new cloudmap.PrivateDnsNamespace(
        stack,
        "TestCloudMapNamespace",
        {
          name: "scorekeep.com",
          vpc,
        },
      );

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
          failureThreshold: 20,
          cloudMapNamespace,
        },
      });

      // THEN
      const sdService = soleResource(
        stack,
        serviceDiscoveryService.ServiceDiscoveryService,
      );
      expect(sdService.name).toEqual("myApp");
      expect(sdService.namespace_id).toEqual(
        stack.resolve(cloudMapNamespace.namespaceId),
      );
      expect(sdService.dns_config).toMatchObject({
        dns_records: [{ ttl: 60, type: "A" }],
        routing_policy: "MULTIVALUE",
      });
      expect(sdService.health_check_custom_config).toEqual({
        failure_threshold: 20,
      });

      const namespace = soleResource(
        stack,
        serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
      );
      expect(namespace.name).toEqual("scorekeep.com");
      expect(namespace.vpc).toEqual(stack.resolve(vpc.vpcId));
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::Service', {
      //   DnsConfig: { DnsRecords: [{ TTL: 60, Type: 'A' }], NamespaceId: {...}, RoutingPolicy: 'MULTIVALUE' },
      //   HealthCheckCustomConfig: { FailureThreshold: 20 },
      //   Name: 'myApp',
      //   NamespaceId: { 'Fn::GetAtt': ['TestCloudMapNamespace1FB9B446', 'Id'] },
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', {
      //   Name: 'scorekeep.com',
      //   Vpc: { Ref: 'MyVpcF9F0CA6F' },
      // });
    });

    test("with user-provided cloudmap service", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      const cloudMapNamespace = new cloudmap.PrivateDnsNamespace(
        stack,
        "TestCloudMapNamespace",
        {
          name: "scorekeep.com",
          vpc,
        },
      );

      const cloudMapService = new cloudmap.Service(stack, "Service", {
        name: "service-name",
        namespace: cloudMapNamespace,
        dnsRecordType: cloudmap.DnsRecordType.SRV,
      });

      const ecsService_ = new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      // WHEN
      ecsService_.associateCloudMapService({
        service: cloudMapService,
        container: container,
        containerPort: 8000,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.service_registries).toEqual({
        container_name: "web",
        container_port: 8000,
        registry_arn: stack.resolve(cloudMapService.serviceArn),
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [
      //     { ContainerName: 'web', ContainerPort: 8000, RegistryArn: { 'Fn::GetAtt': ['ServiceDBC79909', 'Arn'] } },
      //   ],
      // });
    });

    test("errors when more than one service registry used", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      const cloudMapNamespace = new cloudmap.PrivateDnsNamespace(
        stack,
        "TestCloudMapNamespace",
        {
          name: "scorekeep.com",
          vpc,
        },
      );

      const ecsService_ = new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      ecsService_.enableCloudMap({
        cloudMapNamespace,
      });

      const cloudMapService = new cloudmap.Service(stack, "Service", {
        name: "service-name",
        namespace: cloudMapNamespace,
        dnsRecordType: cloudmap.DnsRecordType.SRV,
      });

      // WHEN / THEN
      expect(() => {
        ecsService_.associateCloudMapService({
          service: cloudMapService,
          container: container,
          containerPort: 8000,
        });
      }).toThrow(/at most one service registry/i);
    });

    test("with all properties set", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: cloudmap.NamespaceType.DNS_PRIVATE,
      });

      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      const securityGroup1 = new compute.SecurityGroup(
        stack,
        "SecurityGroup1",
        {
          allowAllOutbound: true,
          description: "Example",
          securityGroupName: "Bob",
          vpc,
        },
      );

      const svc = new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        desiredCount: 2,
        assignPublicIp: true,
        cloudMapOptions: {
          name: "myapp",
          dnsRecordType: cloudmap.DnsRecordType.A,
          dnsTtl: Duration.seconds(50),
          failureThreshold: 20,
        },
        healthCheckGracePeriod: Duration.seconds(60),
        maxHealthyPercent: 150,
        minHealthyPercent: 55,
        deploymentController: {
          type: ecs.DeploymentControllerType.ECS,
        },
        circuitBreaker: { rollback: true },
        securityGroups: [securityGroup1],
        serviceName: "bonjour",
        vpcSubnets: { subnetType: compute.SubnetType.PUBLIC },
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      // THEN
      expect(svc.cloudMapService).toBeDefined();

      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.taskDefinitionArn),
      );
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.deployment_maximum_percent).toEqual(150);
      expect(resource.deployment_minimum_healthy_percent).toEqual(55);
      expect(resource.deployment_circuit_breaker).toEqual({
        enable: true,
        rollback: true,
      });
      expect(resource.deployment_controller).toEqual({ type: "ECS" });
      expect(resource.desired_count).toEqual(2);
      expect(resource.health_check_grace_period_seconds).toEqual(60);
      expect(resource.launch_type).toEqual("FARGATE");
      expect(resource.network_configuration.assign_public_ip).toEqual(true);
      expect(resource.network_configuration.security_groups).toEqual(
        stack.resolve([securityGroup1.securityGroupId]),
      );
      expect(resource.name).toEqual("bonjour");
      expect(resource.service_registries).toMatchObject({
        registry_arn: stack.resolve(svc.cloudMapService!.serviceArn),
      });
      expect(resource.availability_zone_rebalancing).toEqual("ENABLED");
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: {...}, Cluster: {...},
      //   DeploymentConfiguration: {
      //     MaximumPercent: 150, MinimumHealthyPercent: 55,
      //     DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      //   },
      //   DeploymentController: { Type: ecs.DeploymentControllerType.ECS },
      //   DesiredCount: 2,
      //   HealthCheckGracePeriodSeconds: 60,
      //   LaunchType: LaunchType.FARGATE,
      //   NetworkConfiguration: {
      //     AwsvpcConfiguration: {
      //       AssignPublicIp: 'ENABLED',
      //       SecurityGroups: [{ 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] }],
      //       Subnets: [{ Ref: 'MyVpcPublicSubnet1SubnetF6608456' }, { Ref: 'MyVpcPublicSubnet2Subnet492B6BFB' }],
      //     },
      //   },
      //   ServiceName: 'bonjour',
      //   ServiceRegistries: [{ RegistryArn: { 'Fn::GetAtt': ['FargateServiceCloudmapService9544B753', 'Arn'] } }],
      //   AvailabilityZoneRebalancing: 'ENABLED',
      // });
    });

    test("throws when task definition is not Fargate compatible", () => {
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.TaskDefinition(stack, "Ec2TaskDef", {
        compatibility: ecs.Compatibility.EC2,
      });
      taskDefinition.addContainer("BaseContainer", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryReservationMiB: 10,
      });

      // THEN
      expect(() => {
        new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
        });
      }).toThrow(
        /Supplied TaskDefinition is not configured for compatibility with Fargate/,
      );
    });

    test("throws whith secret json field on unsupported platform version", () => {
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaksDef");
      const secret = new encryption.Secret(stack, "Secret");
      taskDefinition.addContainer("BaseContainer", {
        image: ecs.ContainerImage.fromRegistry("test"),
        secrets: {
          SECRET_KEY: ecs.Secret.fromSecretsManager(secret, "specificKey"),
        },
      });

      // Errors on validation, not on construction.
      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        platformVersion: ecs.FargatePlatformVersion.VERSION1_3,
      });

      // THEN
      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).toThrow(
        new RegExp(
          `uses at least one container that references a secret JSON field.+platform version ${ecs.FargatePlatformVersion.VERSION1_4} or later`,
        ),
      );
    });

    test("ignore task definition and launch type if deployment controller is set to be EXTERNAL", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.EXTERNAL,
        },
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/FargateService",
        message: expect.stringMatching(
          /taskDefinition and launchType are blanked out when using external deployment controller./,
        ),
      });
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.deployment_maximum_percent).toEqual(200);
      expect(resource.deployment_minimum_healthy_percent).toEqual(50);
      expect(resource.deployment_controller).toEqual({ type: "EXTERNAL" });
      expect(resource.enable_ecs_managed_tags).toEqual(false);
      expect(resource.task_definition).toBeUndefined();
      expect(resource.launch_type).toBeUndefined();
      // OLD CFN:
      // Annotations.fromStack(stack).hasWarning('/Default/FargateService', 'taskDefinition and launchType are blanked out when using external deployment controller. [ack: @aws-cdk/aws-ecs:externalDeploymentController]');
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   Cluster: {...}, DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 },
      //   DeploymentController: { Type: 'EXTERNAL' }, EnableECSManagedTags: false,
      // });
    });

    test("add warning to annotations if circuitBreaker is specified with a non-ECS DeploymentControllerType", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.EXTERNAL,
        },
        circuitBreaker: { rollback: true },
      });

      // THEN
      // TERRACONSTRUCTS DEVIATION: `base-service.ts` raises the "requires the ECS deployment
      // controller" message via `Annotations.of(this).addError(...)` (an ERROR annotation), whereas
      // upstream surfaces it as `node.metadata` without a level distinction from the WARN above.
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/FargateService",
        message: expect.stringMatching(
          /taskDefinition and launchType are blanked out when using external deployment controller./,
        ),
      });
      Annotations.fromStack(stack).hasErrors({
        constructPath: "Default/FargateService",
        message: expect.stringMatching(
          /Deployment circuit breaker requires the ECS deployment controller./,
        ),
      });
      // OLD CFN:
      // app.synth();
      // expect(service.node.metadata[1].data).toEqual('Deployment circuit breaker requires the ECS deployment controller.');
      // expect(service.node.metadata[0].data).toEqual('taskDefinition and launchType are blanked out when using external deployment controller. [ack: @aws-cdk/aws-ecs:externalDeploymentController]');
    });

    test("errors when no container specified on task definition", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      // Errors on validation, not on construction.
      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      // THEN
      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).toThrow(/one essential container/);
    });

    test("errors when platform version does not support containers which references secret JSON field", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
        {
          runtimePlatform: {
            operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            cpuArchitecture: ecs.CpuArchitecture.ARM64,
          },
          memoryLimitMiB: 512,
          cpu: 256,
        },
      );

      // Errors on validation, not on construction.
      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        platformVersion: ecs.FargatePlatformVersion.VERSION1_2,
      });

      taskDefinition.addContainer("main", {
        image: ecs.ContainerImage.fromRegistry("somecontainer"),
        secrets: {
          envName: ecs.Secret.fromSecretsManager(
            new encryption.Secret(stack, "testSecret"),
            "secretField",
          ),
        },
      });

      // THEN
      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).toThrow(/This feature requires platform version/);
    });

    test("errors when platform version does not support ephemeralStorageGiB", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
        {
          runtimePlatform: {
            operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            cpuArchitecture: ecs.CpuArchitecture.ARM64,
          },
          memoryLimitMiB: 512,
          cpu: 256,
          ephemeralStorageGiB: 100,
        },
      );

      // WHEN
      // THEN
      expect(() => {
        new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
          platformVersion: ecs.FargatePlatformVersion.VERSION1_2,
        });
      }).toThrow(/The ephemeralStorageGiB feature requires platform version/);
    });

    test("errors when platform version does not support pidMode", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
        {
          runtimePlatform: {
            operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            cpuArchitecture: ecs.CpuArchitecture.ARM64,
          },
          memoryLimitMiB: 512,
          cpu: 256,
          pidMode: ecs.PidMode.TASK,
        },
      );

      // WHEN
      // THEN
      expect(() => {
        new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
          platformVersion: ecs.FargatePlatformVersion.VERSION1_2,
        });
      }).toThrow(/The pidMode feature requires platform version/);
    });

    test("allows adding the default container after creating the service", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      // Add the container *after* creating the service
      taskDefinition.addContainer("main", {
        image: ecs.ContainerImage.fromRegistry("somecontainer"),
      });

      // THEN
      const td = soleResource(stack, ecsTaskDefinition.EcsTaskDefinition);
      const containers = JSON.parse(td.container_definitions);
      expect(containers).toEqual([expect.objectContaining({ name: "main" })]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [Match.objectLike({ Name: 'main' })],
      // });
    });

    test("allows specifying assignPublicIP as enabled", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        assignPublicIp: true,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.network_configuration.assign_public_ip).toEqual(true);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED' } },
      // });
    });

    test("allows specifying 0 for minimumHealthyPercent", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        assignPublicIp: true,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.network_configuration.assign_public_ip).toEqual(true);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED' } },
      // });
    });

    test("throws when availability zone rebalancing is enabled and maxHealthyPercent is 100", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      // THEN
      expect(() => {
        new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
          availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
          maxHealthyPercent: 100,
        });
      }).toThrow(/requires maxHealthyPercent > 100/);
    });

    test("sets task definition to family when CODE_DEPLOY deployment controller is specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.CODE_DEPLOY,
        },
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.family),
      );
      expect(resource.deployment_controller).toEqual({ type: "CODE_DEPLOY" });
      // OLD CFN:
      // Template.fromStack(stack).hasResource('AWS::ECS::Service', {
      //   Properties: { TaskDefinition: 'FargateTaskDef', DeploymentController: { Type: 'CODE_DEPLOY' } },
      //   DependsOn: ['FargateTaskDefC6FB60B4', 'FargateTaskDefTaskRole0B257552'],
      // });
    });

    // TERRACONSTRUCTS DEVIATION: `testDeprecated` not ported (see note above).
    test("throws when securityGroup and securityGroups are supplied", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const securityGroup1 = new compute.SecurityGroup(
        stack,
        "SecurityGroup1",
        {
          allowAllOutbound: true,
          description: "Example",
          securityGroupName: "Bingo",
          vpc,
        },
      );
      const securityGroup2 = new compute.SecurityGroup(
        stack,
        "SecurityGroup2",
        {
          allowAllOutbound: false,
          description: "Example",
          securityGroupName: "Rolly",
          vpc,
        },
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      // THEN
      expect(() => {
        new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
          securityGroup: securityGroup1,
          securityGroups: [securityGroup2],
        });
      }).toThrow(
        /Only one of SecurityGroup or SecurityGroups can be populated./,
      );
    });

    test("with multiple securty groups, it correctly updates cloudformation template", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const securityGroup1 = new compute.SecurityGroup(
        stack,
        "SecurityGroup1",
        {
          allowAllOutbound: true,
          description: "Example",
          securityGroupName: "Bingo",
          vpc,
        },
      );
      const securityGroup2 = new compute.SecurityGroup(
        stack,
        "SecurityGroup2",
        {
          allowAllOutbound: false,
          description: "Example",
          securityGroupName: "Rolly",
          vpc,
        },
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        securityGroups: [securityGroup1, securityGroup2],
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.network_configuration.security_groups).toEqual(
        stack.resolve([
          securityGroup1.securityGroupId,
          securityGroup2.securityGroupId,
        ]),
      );

      const groups = allResources(stack, ec2SecurityGroup.SecurityGroup);
      expect(groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: "Example",
            name: "Bingo",
          }),
          expect.objectContaining({
            description: "Example",
            name: "Rolly",
          }),
        ]),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   NetworkConfiguration: {
      //     AwsvpcConfiguration: {
      //       SecurityGroups: [
      //         { 'Fn::GetAtt': ['SecurityGroup1F554B36F', 'GroupId'] },
      //         { 'Fn::GetAtt': ['SecurityGroup23BE86BB7', 'GroupId'] },
      //       ],
      //     },
      //   },
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      //   GroupDescription: 'Example', GroupName: 'Bingo',
      //   SecurityGroupEgress: [{ CidrIp: '0.0.0.0/0', Description: 'Allow all outbound traffic by default', IpProtocol: '-1' }],
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      //   GroupDescription: 'Example', GroupName: 'Rolly',
      //   SecurityGroupEgress: [{ CidrIp: '255.255.255.255/32', Description: 'Disallow all traffic', FromPort: 252, IpProtocol: 'icmp', ToPort: 86 }],
      // });
    });

    test("with deployment alarms", () => {
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const myAlarm = cloudwatch.Alarm.fromAlarmArn(
        stack,
        "myAlarm",
        "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
      );

      new ecs.FargateService(stack, "ExternalService", {
        cluster,
        taskDefinition,
        deploymentAlarms: {
          alarmNames: [myAlarm.alarmName],
        },
      });

      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.alarms).toEqual({
        enable: true,
        rollback: true,
        alarm_names: [myAlarm.alarmName],
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   DeploymentConfiguration: { Alarms: { Enable: true, Rollback: true, AlarmNames: [myAlarm.alarmName] } },
      // });
    });

    test("no network configuration with external deployment controller", () => {
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "ExternalService", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.EXTERNAL,
        },
      });

      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.network_configuration).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', { NetworkConfiguration: Match.absent() });
    });

    test("network configuration exists when explicitly specifying a deployment controller type other than EXTERNAL", () => {
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "ExternalService", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.ECS,
        },
      });

      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.network_configuration).toMatchObject({
        assign_public_ip: false,
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'DISABLED', SecurityGroups: [...], Subnets: [...] } },
      // });
    });

    test("warning if minHealthyPercent not set", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/FargateService",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 50% is used./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasWarning('/Default/FargateService', 'minHealthyPercent has not been configured so the default value of 50% is used. The number of running tasks will decrease below the desired count during deployments etc. See https://github.com/aws/aws-cdk/issues/31705 [ack: @aws-cdk/aws-ecs:minHealthyPercent]');
    });

    test("no warning if minHealthyPercent set", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        minHealthyPercent: 50,
      });

      // THEN
      Annotations.fromStack(stack).hasNoWarnings({
        constructPath: "Default/FargateService",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 50% is used./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasNoWarning('/Default/FargateService', 'minHealthyPercent has not been configured so the default value of 50% is used. ...');
    });
  });

  describe("when enabling service connect", () => {
    describe("when validating service connect configurations", () => {
      let stack: AwsStack;
      let service: ecs.FargateService;

      beforeEach(() => {
        // GIVEN
        stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        });

        service = new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
        });
      });

      test("throws an exception if serviceconnectservice.port is a string and it does not exists on the task definition", () => {
        // GIVEN
        const config: ecs.ServiceConnectProps = {
          services: [
            {
              portMappingName: "100",
              dnsName: "backend.prod",
            },
          ],
          namespace: "test namespace",
        };
        expect(() => {
          service.enableServiceConnect(config);
        }).toThrow(/Port Mapping '100' does not exist on the task definition./);
      });

      test("throws an exception when adding multiple services without different discovery names", () => {
        // GIVEN
        service.taskDefinition.addContainer("mobile", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          portMappings: [
            {
              containerPort: 100,
              name: "abc",
            },
          ],
        });
        const config: ecs.ServiceConnectProps = {
          services: [
            {
              portMappingName: "abc",
              dnsName: "backend.prod",
              port: 5005,
            },
            {
              portMappingName: "abc",
              dnsName: "backend.prod.local",
            },
          ],
          namespace: "test namespace",
        };
        expect(() => {
          service.enableServiceConnect(config);
        }).toThrow(
          /Cannot create multiple services with the discoveryName 'abc'./,
        );
      });

      test("throws an exception if ingressPortOverride is not valid.", () => {
        // GIVEN
        service.taskDefinition.addContainer("mobile", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          portMappings: [
            {
              containerPort: 100,
              name: "100",
            },
          ],
        });
        const config: ecs.ServiceConnectProps = {
          services: [
            {
              portMappingName: "100",
              dnsName: "backend.prod",
              port: 5005,
              ingressPortOverride: 100000,
            },
          ],
          namespace: "test namespace",
        };
        expect(() => {
          service.enableServiceConnect(config);
        }).toThrow(/ingressPortOverride 100000 is not valid./);
      });

      test("throws an exception if Client Alias port is not valid", () => {
        // GIVEN
        service.taskDefinition.addContainer("mobile", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          portMappings: [
            {
              containerPort: 100,
              name: "100",
            },
          ],
        });
        const config: ecs.ServiceConnectProps = {
          services: [
            {
              portMappingName: "100",
              dnsName: "backend.prod",
              port: 100000,
              ingressPortOverride: 3000,
            },
          ],
          namespace: "test namespace",
        };
        expect(() => {
          service.enableServiceConnect(config);
        }).toThrow(/Client Alias port 100000 is not valid./);
      });
    });

    describe("when creating a FargateService with service connect", () => {
      let stack: AwsStack;
      let service: ecs.FargateService;
      let cluster: ecs.Cluster;

      beforeEach(() => {
        // GIVEN
        stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          portMappings: [
            {
              containerPort: 80,
              name: "api",
            },
          ],
        });

        service = new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
        });
      });

      test("service connect cannot be enabled twice", () => {
        // WHEN
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect();

        // THEN

        expect(() => {
          service.enableServiceConnect({});
        }).toThrow(
          "Service connect configuration cannot be specified more than once.",
        );
      });

      test("client alias port is defaulted to containerport", () => {
        service.enableServiceConnect({
          namespace: "cool",
          services: [
            {
              portMappingName: "api",
            },
          ],
        });

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
          service: [
            {
              port_name: "api",
              client_alias: { port: 80 },
            },
          ],
        });
        // OLD CFN:
        // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
        //   ServiceConnectConfiguration: {
        //     Enabled: true, Namespace: 'cool',
        //     Services: [{ PortName: 'api', ClientAliases: [{ Port: 80 }] }],
        //   },
        // });
      });

      test("with explicit enable", () => {
        // WHEN
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect({});

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
        });
      });

      test("with explicit enable and no props", () => {
        // WHEN
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect();

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
        });
      });

      test("explicit enable and non default namespace", () => {
        // WHEN
        const ns = new cloudmap.HttpNamespace(stack, "httpnamespace_ns", {
          name: "cool",
        });
        service.enableServiceConnect({
          namespace: ns.namespaceName,
        });

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
        });
      });

      test("namespace inferred from cluster", () => {
        // WHEN
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect({});

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
        });
      });

      test("namespace inferred from cluster; empty props", () => {
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect();

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
        });
      });

      test("no namespace errors out", () => {
        // THEN
        expect(() => {
          service.enableServiceConnect({});
        }).toThrow();
      });

      test("error when enabling service connect with no container", () => {
        // GIVEN
        const taskDefinition = new ecs.FargateTaskDefinition(stack, "td2");
        const svc = new ecs.FargateService(stack, "svc2", {
          cluster,
          taskDefinition,
        });
        expect(() => {
          svc.enableServiceConnect({
            logDriver: ecs.LogDrivers.awsLogs({
              streamPrefix: "sc",
            }),
          });
        }).toThrow(
          "Task definition must have at least one container to enable service connect.",
        );
      });

      test("with all options exercised", () => {
        // WHEN
        new cloudmap.HttpNamespace(stack, "httpnamespace", {
          name: "cool",
        });
        service.enableServiceConnect({
          services: [
            {
              portMappingName: "api",
              discoveryName: "svc",
              ingressPortOverride: 1000,
              port: 80,
              dnsName: "api",
              idleTimeout: Duration.seconds(10),
              perRequestTimeout: Duration.seconds(10),
            },
          ],
          namespace: "cool",
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "sc",
          }),
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration).toMatchObject({
          enabled: true,
          namespace: "cool",
          service: [
            {
              port_name: "api",
              ingress_port_override: 1000,
              discovery_name: "svc",
              client_alias: { port: 80, dns_name: "api" },
              timeout: {
                idle_timeout_seconds: 10,
                per_request_timeout_seconds: 10,
              },
            },
          ],
          log_configuration: {
            log_driver: "awslogs",
            options: expect.objectContaining({
              "awslogs-stream-prefix": "sc",
            }),
          },
        });
      });

      test("can set idleTimeout without perRequestTimeout", () => {
        // WHEN
        new cloudmap.HttpNamespace(stack, "httpnamespace", {
          name: "cool",
        });
        service.enableServiceConnect({
          services: [
            {
              portMappingName: "api",
              idleTimeout: Duration.seconds(10),
            },
          ],
          namespace: "cool",
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(
          resource.service_connect_configuration.service[0].timeout,
        ).toEqual({ idle_timeout_seconds: 10 });
        // OLD CFN:
        // Timeout: { IdleTimeoutSeconds: 10, PerRequestTimeoutSeconds: Match.absent() }
      });

      test("can set perRequestTimeout without idleTimeout", () => {
        // WHEN
        new cloudmap.HttpNamespace(stack, "httpnamespace", {
          name: "cool",
        });
        service.enableServiceConnect({
          services: [
            {
              portMappingName: "api",
              perRequestTimeout: Duration.seconds(10),
            },
          ],
          namespace: "cool",
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(
          resource.service_connect_configuration.service[0].timeout,
        ).toEqual({ per_request_timeout_seconds: 10 });
      });

      test("can set idleTimeout and perRequestTimeout to 0", () => {
        // WHEN
        new cloudmap.HttpNamespace(stack, "httpnamespace", {
          name: "cool",
        });
        service.enableServiceConnect({
          services: [
            {
              portMappingName: "api",
              idleTimeout: Duration.seconds(0),
              perRequestTimeout: Duration.seconds(0),
            },
          ],
          namespace: "cool",
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(
          resource.service_connect_configuration.service[0].timeout,
        ).toEqual({ idle_timeout_seconds: 0, per_request_timeout_seconds: 0 });
      });

      test("throws if idleTimeout is less than 1 second and not 0", () => {
        // WHEN
        new cloudmap.HttpNamespace(stack, "httpnamespace", {
          name: "cool",
        });
        expect(() => {
          service.enableServiceConnect({
            services: [
              {
                portMappingName: "api",
                idleTimeout: Duration.millis(10),
              },
            ],
            namespace: "cool",
          });
        }).toThrow(
          /idleTimeout must be at least 1 second or 0 to disable it, got 10ms./,
        );
      });

      test("throws if perRequestTimeout is less than 1 second and not 0", () => {
        // WHEN
        new cloudmap.HttpNamespace(stack, "httpnamespace", {
          name: "cool",
        });
        expect(() => {
          service.enableServiceConnect({
            services: [
              {
                portMappingName: "api",
                perRequestTimeout: Duration.millis(10),
              },
            ],
            namespace: "cool",
          });
        }).toThrow(
          /perRequestTimeout must be at least 1 second or 0 to disable it, got 10ms./,
        );
      });

      test("with no alias name", () => {
        // WHEN
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect({
          services: [
            {
              portMappingName: "api",
              port: 80,
            },
          ],
        });

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration.service[0]).toMatchObject(
          {
            port_name: "api",
            client_alias: { port: 80 },
          },
        );
      });

      test("with no alias specified", () => {
        // WHEN
        cluster.addDefaultCloudMapNamespace({
          name: "cool",
        });
        service.enableServiceConnect({
          services: [
            {
              portMappingName: "api",
            },
          ],
        });

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.service_connect_configuration.service[0]).toMatchObject(
          {
            port_name: "api",
            client_alias: { port: 80 },
          },
        );
      });
    });
  });

  describe("When setting up a service volume configurations", () => {
    let stack: AwsStack;
    let cluster: ecs.Cluster;
    let service: ecs.FargateService;
    let taskDefinition: ecs.FargateTaskDefinition;
    let container: ecs.ContainerDefinition;
    let role: iam.IRole;

    beforeEach(() => {
      // GIVEN
      stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      taskDefinition = new ecs.FargateTaskDefinition(stack, "FargateTaskDef");
      role = new iam.Role(stack, "Role", {
        assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
      });
      container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });
      service = new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
      });
    });

    test("success when adding a service volume", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      service.addVolume(
        new ServiceManagedVolume(stack, "EBS Volume", {
          name: "nginx-vol",
          managedEBSVolume: {
            role: role,
            size: Size.gibibytes(20),
            fileSystemType: ecs.FileSystemType.XFS,
            tagSpecifications: [
              {
                tags: {
                  purpose: "production",
                },
                propagateTags: ecs.EbsPropagatedTagSource.SERVICE,
              },
            ],
          },
        }),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.volume_configuration).toEqual({
        name: "nginx-vol",
        managed_ebs_volume: {
          role_arn: stack.resolve(role.roleArn),
          size_in_gb: 20,
          file_system_type: "xfs",
          tag_specifications: [
            {
              resource_type: "volume",
              propagate_tags: "SERVICE",
              tags: { purpose: "production" },
            },
          ],
        },
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   VolumeConfigurations: [{
      //     ManagedEBSVolume: {
      //       RoleArn: { 'Fn::GetAtt': ['Role1ABCC5F0', 'Arn'] }, SizeInGiB: 20, FilesystemType: 'xfs',
      //       TagSpecifications: [{ PropagateTags: 'SERVICE', ResourceType: 'volume', Tags: [{ Key: 'purpose', Value: 'production' }] }],
      //     },
      //     Name: 'nginx-vol',
      //   }],
      // });
    });

    // Repo-specific destroy-ordering regression (caught live by the
    // ecs.ebs-taskattach integ test): the service must depends_on the
    // volume's auto-created EBS infrastructure role AND its policy
    // attachment, or Terraform destroys the attachment in parallel with the
    // service and ECS loses the permissions needed to detach the managed
    // volume mid-deprovisioning (task wedges DEPROVISIONING, service hangs
    // DRAINING past the provider's 20-minute delete timeout).
    test("service depends on the auto-created EBS role and its policy attachment", () => {
      // WHEN - no explicit role: ServiceManagedVolume creates role + attachment
      const volume = new ServiceManagedVolume(stack, "EBSVol", {
        name: "ebs1",
        managedEBSVolume: {
          size: Size.gibibytes(15),
        },
      });
      taskDefinition.addVolume(volume);
      service.addVolume(volume);

      // THEN
      const resource = soleResource(stack, ecsService.EcsService) as {
        depends_on?: string[];
      };
      expect(resource.depends_on).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^aws_iam_role\.EBSVol_EBSRole_/),
          expect.stringMatching(
            /^aws_iam_role_policy_attachment\.EBSVol_AmazonECSInfrastructureRolePolicyForVolumes_/,
          ),
        ]),
      );
    });

    // Repo-specific sentinel-default regression (caught live by the
    // ecs.sd-awsvpc-nw integ deploy): CloudFormation omits DesiredCount and
    // ECS creates a REPLICA service with 1 task; aws_ecs_service with an
    // omitted desired_count (and explicit scheduling_strategy) creates the
    // service with 0 tasks — so nothing ever starts or registers into
    // CloudMap. The port must emit desired_count 1 by default, with
    // ignore_changes so Terraform never resets manual/auto scaling, and must
    // NOT ignore changes when the user pins an explicit count.
    test("desiredCount defaults to 1 with ignore_changes; explicit count is enforced", () => {
      // WHEN - default (no desiredCount)
      const resource = soleResource(stack, ecsService.EcsService) as {
        desired_count?: number;
        lifecycle?: { ignore_changes?: string[] };
      };

      // THEN
      expect(resource.desired_count).toEqual(1);
      expect(resource.lifecycle?.ignore_changes).toEqual(["desired_count"]);

      // WHEN - explicit desiredCount
      const stack2 = new AwsStack();
      const vpc2 = new compute.Vpc(stack2, "MyVpc", {});
      const cluster2 = new ecs.Cluster(stack2, "EcsCluster", { vpc: vpc2 });
      const taskDefinition2 = new ecs.FargateTaskDefinition(stack2, "TaskDef");
      taskDefinition2.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });
      new ecs.FargateService(stack2, "FargateService", {
        cluster: cluster2,
        taskDefinition: taskDefinition2,
        desiredCount: 3,
      });

      // THEN - enforced, no ignore_changes
      const resource2 = soleResource(stack2, ecsService.EcsService) as {
        desired_count?: number;
        lifecycle?: { ignore_changes?: string[] };
      };
      expect(resource2.desired_count).toEqual(3);
      expect(resource2.lifecycle?.ignore_changes).toBeUndefined();
    });

    test("success when mounting via ServiceManagedVolume", () => {
      // WHEN
      const volume = new ServiceManagedVolume(stack, "EBS Volume", {
        name: "nginx-vol",
        managedEBSVolume: {
          role: role,
          size: Size.gibibytes(20),
          tagSpecifications: [
            {
              tags: {
                purpose: "production",
              },
              propagateTags: ecs.EbsPropagatedTagSource.SERVICE,
            },
          ],
        },
      });
      taskDefinition.addVolume(volume);
      service.addVolume(volume);
      volume.mountIn(container, {
        containerPath: "/var/lib",
        readOnly: false,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.volume_configuration).toMatchObject({
        name: "nginx-vol",
        managed_ebs_volume: {
          role_arn: stack.resolve(role.roleArn),
          size_in_gb: 20,
          tag_specifications: [
            {
              resource_type: "volume",
              propagate_tags: "SERVICE",
              tags: { purpose: "production" },
            },
          ],
        },
      });
      const td = soleResource(stack, ecsTaskDefinition.EcsTaskDefinition);
      const containers = JSON.parse(td.container_definitions);
      expect(containers).toEqual([
        expect.objectContaining({
          mountPoints: [
            {
              containerPath: "/var/lib",
              readOnly: false,
              sourceVolume: "nginx-vol",
            },
          ],
        }),
      ]);
      expect(td.volume).toEqual([
        expect.objectContaining({
          name: "nginx-vol",
          configure_at_launch: true,
        }),
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [{ MountPoints: [{ ContainerPath: '/var/lib', ReadOnly: false, SourceVolume: 'nginx-vol' }] }],
      //   Volumes: [{ Name: 'nginx-vol', ConfiguredAtLaunch: true }],
      // });
    });

    test("throw an error when multiple volume configurations are added to ECS service", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });
      const vol1 = new ServiceManagedVolume(stack, "EBSVolume", {
        name: "nginx-vol",
        managedEBSVolume: {
          fileSystemType: ecs.FileSystemType.XFS,
          size: Size.gibibytes(15),
        },
      });
      const vol2 = new ServiceManagedVolume(stack, "ebs1", {
        name: "ebs1",
        managedEBSVolume: {
          fileSystemType: ecs.FileSystemType.XFS,
          size: Size.gibibytes(15),
        },
      });
      service.addVolume(vol1);
      service.addVolume(vol2);
      expect(() => {
        stack.prepareStack();
      }).toThrow(
        /Only one EBS volume can be specified for 'volumeConfigurations', got: 2/,
      );
    });

    test("create a default ebsrole when not provided", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      const volume = new ServiceManagedVolume(stack, "EBS Volume", {
        name: "nginx-vol",
        managedEBSVolume: {
          size: Size.gibibytes(20),
          fileSystemType: ecs.FileSystemType.XFS,
          tagSpecifications: [
            {
              tags: {
                purpose: "production",
              },
              propagateTags: ecs.EbsPropagatedTagSource.SERVICE,
            },
          ],
        },
      });
      service.addVolume(volume);

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.volume_configuration.managed_ebs_volume.role_arn).toEqual(
        stack.resolve(volume.role.roleArn),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   VolumeConfigurations: [{ ManagedEBSVolume: { RoleArn: { 'Fn::GetAtt': ['EBSVolumeEBSRoleD38B9F31', 'Arn'] }, ... } }],
      // });
    });

    test("throw an error when both size and snapshotId are not provided", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
            },
          }),
        );
      }).toThrow("'size' or 'snapShotId' must be specified");
    });

    test("throw an error when managedEBSVolume is omitted entirely", () => {
      // WHEN / THEN
      expect(
        () => new ServiceManagedVolume(stack, "EBS Volume", { name: "db" }),
      ).toThrow("'size' or 'snapShotId' must be specified");
    });

    test("throw an error snapshot does not match pattern", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBS Volume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              snapShotId: "snap-0d48decab5c493eee_",
            },
          }),
        );
      }).toThrow(
        "'snapshotId' does match expected pattern. Expected 'snap-<hexadecmial value>' (ex: 'snap-05abe246af') or Token, got: snap-0d48decab5c493eee_",
      );
    });

    test("success when snapshotId matches the pattern", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });
      const vol = new ServiceManagedVolume(stack, "EBS Volume", {
        name: "nginx-vol",
        managedEBSVolume: {
          fileSystemType: ecs.FileSystemType.XFS,
          snapShotId: "snap-0d48decab5c493eee",
        },
      });
      service.addVolume(vol);

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.volume_configuration.managed_ebs_volume).toMatchObject({
        role_arn: stack.resolve(vol.role.roleArn),
        snapshot_id: "snap-0d48decab5c493eee",
        file_system_type: "xfs",
      });
    });

    test("throw an error when size is greater than 16384 for gp2", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBS Volume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              size: Size.gibibytes(16390),
            },
          }),
        );
      }).toThrow(
        /'gp2' volumes must have a size between 1 and 16384 GiB, got 16390 GiB/,
      );
    });

    test("throw an error when size is less than 4 for volume type io1", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBS Volume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.IO1,
              size: Size.gibibytes(0),
            },
          }),
        );
      }).toThrow(
        /'io1' volumes must have a size between 4 and 16384 GiB, got 0 GiB/,
      );
    });

    test("throw an error when size is greater than 1024 for volume type standard", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBS Volume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.STANDARD,
              size: Size.gibibytes(1500),
            },
          }),
        );
      }).toThrow(
        /'standard' volumes must have a size between 1 and 1024 GiB, got 1500 GiB/,
      );
    });

    test("throw an error if throughput is configured for volumetype gp2", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBS Volume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              size: Size.gibibytes(10),
              throughput: 0,
            },
          }),
        );
      }).toThrow(
        /'throughput' can only be configured with gp3 volume type, got gp2/,
      );
    });

    test("throw an error if iops is not supported for volume type sc1", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.SC1,
              size: Size.gibibytes(125),
              iops: 0,
            },
          }),
        );
      }).toThrow(
        /'iops' cannot be specified with sc1, st1, gp2 and standard volume types, got sc1/,
      );
    });

    test("throw an error if iops is not supported for volume type sc1", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              size: Size.gibibytes(125),
              iops: 0,
            },
          }),
        );
      }).toThrow(
        /'iops' cannot be specified with sc1, st1, gp2 and standard volume types, got gp2/,
      );
    });

    test("throw an error if if iops is required but not provided for volume type io2", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.IO2,
              size: Size.gibibytes(125),
            },
          }),
        );
      }).toThrow(
        /'iops' must be specified with io1 or io2 volume types, got io2/,
      );
    });

    test("throw an error if if iops is less than 100 for volume type io2", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.IO2,
              size: Size.gibibytes(125),
              iops: 0,
            },
          }),
        );
      }).toThrow("io2' volumes must have 'iops' between 100 and 256000, got 0");
    });

    test("throw an error if if iops is greater than 256000 for volume type io2", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.IO2,
              size: Size.gibibytes(125),
              iops: 256001,
            },
          }),
        );
      }).toThrow(
        "io2' volumes must have 'iops' between 100 and 256000, got 256001",
      );
    });

    test("configure volume initialization role", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      const vol = new ServiceManagedVolume(stack, "EBS Volume", {
        name: "nginx-vol",
        managedEBSVolume: {
          fileSystemType: ecs.FileSystemType.XFS,
          snapShotId: "snap-0d48decab5c493eee",
          volumeInitializationRate: Size.mebibytes(100),
        },
      });
      service.addVolume(vol);

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.volume_configuration.managed_ebs_volume).toMatchObject({
        role_arn: stack.resolve(vol.role.roleArn),
        snapshot_id: "snap-0d48decab5c493eee",
        file_system_type: "xfs",
        volume_initialization_rate: 100,
      });
    });

    test.each([Size.mebibytes(99), Size.mebibytes(301)])(
      "throw an error if if volume initialization rate is out of range for 100-300 MiB/s",
      (volumeInitializationRate) => {
        // WHEN
        container.addMountPoints({
          containerPath: "/var/lib",
          readOnly: false,
          sourceVolume: "nginx-vol",
        });

        expect(() => {
          service.addVolume(
            new ServiceManagedVolume(stack, "EBSVolume", {
              name: "nginx-vol",
              managedEBSVolume: {
                snapShotId: "snap-0d48decab5c493eee",
                volumeInitializationRate,
              },
            }),
          );
        }).toThrow(
          `'volumeInitializationRate' must be between 100 and 300 MiB/s, got ${volumeInitializationRate.toMebibytes()} MiB/s.`,
        );
      },
    );

    test("throw an error if if volume initialization rate is specified without specifying snapshot ID", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBSVolume", {
            name: "nginx-vol",
            managedEBSVolume: {
              volumeInitializationRate: Size.mebibytes(101),
            },
          }),
        );
      }).toThrow(
        "'volumeInitializationRate' can only be specified when 'snapShotId' is provided.",
      );
    });

    test("success adding gp3 volume with throughput 0", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      const vol = new ServiceManagedVolume(stack, "EBSVolume", {
        name: "nginx-vol",
        managedEBSVolume: {
          fileSystemType: ecs.FileSystemType.XFS,
          volumeType: compute.EbsDeviceVolumeType.GP3,
          size: Size.gibibytes(15),
          throughput: 0,
        },
      });
      service.addVolume(vol);
      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.volume_configuration.managed_ebs_volume).toMatchObject({
        role_arn: stack.resolve(vol.role.roleArn),
        size_in_gb: 15,
        file_system_type: "xfs",
        volume_type: "gp3",
        throughput: 0,
      });
    });

    test("throw an error if throughput is greater than 2000 for volume type gp3", () => {
      // WHEN
      container.addMountPoints({
        containerPath: "/var/lib",
        readOnly: false,
        sourceVolume: "nginx-vol",
      });

      expect(() => {
        service.addVolume(
          new ServiceManagedVolume(stack, "EBS Volume", {
            name: "nginx-vol",
            managedEBSVolume: {
              fileSystemType: ecs.FileSystemType.XFS,
              volumeType: compute.EbsDeviceVolumeType.GP3,
              size: Size.gibibytes(10),
              throughput: 2001,
            },
          }),
        );
      }).toThrow(
        "'throughput' must be less than or equal to 2000 MiB/s, got 2001 MiB/s",
      );
    });
  });

  describe("When setting up a health check", () => {
    test("grace period is respected", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });

      // WHEN
      new ecs.FargateService(stack, "Svc", {
        cluster,
        taskDefinition,
        healthCheckGracePeriod: Duration.seconds(10),
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.health_check_grace_period_seconds).toEqual(10);
    });
  });

  describe("When adding an app load balancer", () => {
    test("allows auto scaling by ALB request per target", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });
      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
        targets: [service],
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnRequestCount("ScaleOnRequests", {
        requestsPerTarget: 1000,
        targetGroup,
      });

      // THEN
      const target = soleResource(
        stack,
        appautoscalingTarget.AppautoscalingTarget,
      );
      expect(target.max_capacity).toEqual(10);
      expect(target.min_capacity).toEqual(1);
      expect(target.resource_id).toEqual(
        stack.resolve(`service/${cluster.clusterName}/${service.serviceName}`),
      );

      const policy = soleResource(
        stack,
        appautoscalingPolicy.AppautoscalingPolicy,
      );
      expect(
        policy.target_tracking_scaling_policy_configuration
          .predefined_metric_specification.predefined_metric_type,
      ).toEqual("ALBRequestCountPerTarget");
      expect(
        policy.target_tracking_scaling_policy_configuration.target_value,
      ).toEqual(1000);

      // if any load balancer is configured and healthCheckGracePeriodSeconds is not
      // set, then it should default to 60 seconds.
      const svcResource = soleResource(stack, ecsService.EcsService);
      expect(svcResource.health_check_grace_period_seconds).toEqual(60);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      //   MaxCapacity: 10, MinCapacity: 1, ResourceId: { 'Fn::Join': ['', ['service/', {Ref: 'EcsCluster97242B84'}, '/', {'Fn::GetAtt': ['ServiceD69D759B', 'Name']}]] },
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
      //   TargetTrackingScalingPolicyConfiguration: { PredefinedMetricSpecification: { PredefinedMetricType: 'ALBRequestCountPerTarget', ResourceLabel: {...} }, TargetValue: 1000 },
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', { HealthCheckGracePeriodSeconds: 60 });
    });

    test("allows auto scaling by ALB with new service arn format", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
        targets: [service],
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnRequestCount("ScaleOnRequests", {
        requestsPerTarget: 1000,
        targetGroup,
      });

      // THEN
      const target = soleResource(
        stack,
        appautoscalingTarget.AppautoscalingTarget,
      );
      expect(target.max_capacity).toEqual(10);
      expect(target.min_capacity).toEqual(1);
      expect(target.resource_id).toEqual(
        stack.resolve(`service/${cluster.clusterName}/${service.serviceName}`),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      //   MaxCapacity: 10, MinCapacity: 1, ResourceId: { 'Fn::Join': [...] },
      // });
    });

    describe("allows specify any existing container name and port in a service", () => {
      test("with default setting", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({ containerPort: 8001 });

        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });
        const targetGroup = listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
            }),
          ],
        });

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.load_balancer).toEqual([
          {
            container_name: "MainContainer",
            container_port: 8000,
            target_group_arn: stack.resolve(targetGroup.targetGroupArn),
          },
        ]);

        const ingressRules = allResources(
          stack,
          vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        );
        expect(ingressRules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              description: "Load balancer to target",
              from_port: 8000,
              to_port: 8000,
            }),
          ]),
        );
        const egressRules = allResources(
          stack,
          vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        );
        expect(egressRules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              description: "Load balancer to target",
              from_port: 8000,
              to_port: 8000,
            }),
          ]),
        );
        // OLD CFN:
        // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
        //   LoadBalancers: [{ ContainerName: 'MainContainer', ContainerPort: 8000, TargetGroupArn: {...} }],
        // });
        // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        //   Description: 'Load balancer to target', FromPort: 8000, ToPort: 8000,
        // });
        // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
        //   Description: 'Load balancer to target', FromPort: 8000, ToPort: 8000,
        // });
      });

      test("with TCP protocol and container hostPort unset", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({
          containerPort: 8001,
          protocol: ecs.Protocol.TCP,
        });

        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
              containerPort: 8001,
              protocol: ecs.Protocol.TCP,
            }),
          ],
        });

        // THEN
        const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
        expect(tg.port).toEqual(80);
        expect(tg.protocol).toEqual("HTTP");
      });

      test("with TCP protocol and container hostPort set", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
          portMappings: [
            {
              containerPort: 8000,
              hostPort: 8000,
            },
          ],
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
              containerPort: 8000,
              protocol: ecs.Protocol.TCP,
            }),
          ],
        });

        // THEN
        const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
        expect(tg.port).toEqual(80);
        expect(tg.protocol).toEqual("HTTP");
      });

      test("with UDP protocol and container hostPort unset", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({
          containerPort: 8001,
          protocol: ecs.Protocol.UDP,
        });

        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
              containerPort: 8001,
              protocol: ecs.Protocol.UDP,
            }),
          ],
        });

        // THEN
        const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
        expect(tg.port).toEqual(80);
        expect(tg.protocol).toEqual("HTTP");
      });

      test("with UDP protocol and container hostPort set", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
          portMappings: [
            {
              containerPort: 8000,
              hostPort: 8000,
              protocol: ecs.Protocol.UDP,
            },
          ],
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
              containerPort: 8000,
              protocol: ecs.Protocol.UDP,
            }),
          ],
        });

        // THEN
        const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
        expect(tg.port).toEqual(80);
        expect(tg.protocol).toEqual("HTTP");
      });

      test("throws when protocol does not match", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({
          containerPort: 8001,
          protocol: ecs.Protocol.UDP,
        });

        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        // THEN
        expect(() => {
          listener.addTargets("target", {
            port: 80,
            targets: [
              service.loadBalancerTarget({
                containerName: "MainContainer",
                containerPort: 8001,
                protocol: ecs.Protocol.TCP,
              }),
            ],
          });
        }).toThrow(
          /Container 'Default\/FargateTaskDef\/MainContainer' has no mapping for port 8001 and protocol tcp. Did you call "container.addPortMappings\(\)"\?/,
        );
      });

      test("throws when port does not match", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({ containerPort: 8001 });

        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        // THEN
        expect(() => {
          listener.addTargets("target", {
            port: 80,
            targets: [
              service.loadBalancerTarget({
                containerName: "MainContainer",
                containerPort: 8002,
              }),
            ],
          });
        }).toThrow(
          /Container 'Default\/FargateTaskDef\/MainContainer' has no mapping for port 8002 and protocol tcp. Did you call "container.addPortMappings\(\)"\?/,
        );
      });

      test("throws when container does not exist", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new compute.Vpc(stack, "MyVpc");
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        const taskDefinition = new ecs.FargateTaskDefinition(
          stack,
          "FargateTaskDef",
        );
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({ containerPort: 8001 });

        const service = new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });

        // THEN
        expect(() => {
          listener.addTargets("target", {
            port: 80,
            targets: [
              service.loadBalancerTarget({
                containerName: "SideContainer",
                containerPort: 8001,
              }),
            ],
          });
        }).toThrow(
          /No container named 'SideContainer'. Did you call "addContainer\(\)"?/,
        );
      });
    });

    describe("allows load balancing to any container and port of service", () => {
      describe("with application load balancers", () => {
        test("with default target group port and protocol", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const container = taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
          });
          container.addPortMappings({ containerPort: 8000 });

          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          // WHEN
          const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          service.registerLoadBalancerTargets({
            containerName: "MainContainer",
            containerPort: 8000,
            listener: ecs.ListenerConfig.applicationListener(listener),
            newTargetGroupId: "target1",
          });

          // THEN
          const resource = soleResource(stack, ecsService.EcsService);
          expect(resource.load_balancer[0]).toMatchObject({
            container_name: "MainContainer",
            container_port: 8000,
          });

          const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
          expect(tg.port).toEqual(80);
          expect(tg.protocol).toEqual("HTTP");
        });

        test("with default target group port and HTTP protocol", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const container = taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
          });
          container.addPortMappings({ containerPort: 8000 });

          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          // WHEN
          const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          service.registerLoadBalancerTargets({
            containerName: "MainContainer",
            containerPort: 8000,
            listener: ecs.ListenerConfig.applicationListener(listener, {
              protocol: compute.ApplicationProtocol.HTTP,
            }),
            newTargetGroupId: "target1",
          });

          // THEN
          const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
          expect(tg.port).toEqual(80);
          expect(tg.protocol).toEqual("HTTP");
        });

        test("with default target group port and HTTPS protocol", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const container = taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
          });
          container.addPortMappings({ containerPort: 8000 });

          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          // WHEN
          const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          service.registerLoadBalancerTargets({
            containerName: "MainContainer",
            containerPort: 8000,
            listener: ecs.ListenerConfig.applicationListener(listener, {
              protocol: compute.ApplicationProtocol.HTTPS,
            }),
            newTargetGroupId: "target1",
          });

          // THEN
          const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
          expect(tg.port).toEqual(443);
          expect(tg.protocol).toEqual("HTTPS");
        });

        test("with any target group port and protocol", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const container = taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
          });
          container.addPortMappings({ containerPort: 8000 });

          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          // WHEN
          const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          service.registerLoadBalancerTargets({
            containerName: "MainContainer",
            containerPort: 8000,
            listener: ecs.ListenerConfig.applicationListener(listener, {
              port: 83,
              protocol: compute.ApplicationProtocol.HTTP,
            }),
            newTargetGroupId: "target1",
          });

          // THEN
          const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
          expect(tg.port).toEqual(83);
          expect(tg.protocol).toEqual("HTTP");
        });

        test("throws when containerPortRange is used instead of containerPort", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
            portMappings: [
              {
                containerPort: ecs.ContainerDefinition.CONTAINER_PORT_USE_RANGE,
                containerPortRange: "8000-8001",
              },
            ],
          });

          // WHEN
          const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          // THEN
          expect(() =>
            service.registerLoadBalancerTargets({
              containerName: "MainContainer",
              containerPort: 8000,
              listener: ecs.ListenerConfig.applicationListener(listener),
              newTargetGroupId: "target1",
            }),
          ).toThrow(
            /Container 'Default\/FargateTaskDef\/MainContainer' has no mapping for port 8000 and protocol tcp. Did you call "container.addPortMappings\(\)"\?/,
          );
        });
      });

      describe("with network load balancers", () => {
        test("with default target group port", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const container = taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
          });
          container.addPortMappings({ containerPort: 8000 });

          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          // WHEN
          const lb = new compute.NetworkLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          service.registerLoadBalancerTargets({
            containerName: "MainContainer",
            containerPort: 8000,
            listener: ecs.ListenerConfig.networkListener(listener),
            newTargetGroupId: "target1",
          });

          // THEN
          const resource = soleResource(stack, ecsService.EcsService);
          expect(resource.load_balancer[0]).toMatchObject({
            container_name: "MainContainer",
            container_port: 8000,
          });

          const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
          expect(tg.port).toEqual(80);
          expect(tg.protocol).toEqual("TCP");
        });

        test("with any target group port", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const container = taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
          });
          container.addPortMappings({ containerPort: 8000 });

          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          // WHEN
          const lb = new compute.NetworkLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          service.registerLoadBalancerTargets({
            containerName: "MainContainer",
            containerPort: 8000,
            listener: ecs.ListenerConfig.networkListener(listener, {
              port: 81,
            }),
            newTargetGroupId: "target1",
          });

          // THEN
          const tg = soleResource(stack, lbTargetGroup.LbTargetGroup);
          expect(tg.port).toEqual(81);
          expect(tg.protocol).toEqual("TCP");
        });

        test("throws when containerPortRange is used instead of containerPort", () => {
          // GIVEN
          const stack = new AwsStack();
          const vpc = new compute.Vpc(stack, "MyVpc");
          const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
          const taskDefinition = new ecs.FargateTaskDefinition(
            stack,
            "FargateTaskDef",
          );
          const service = new ecs.FargateService(stack, "Service", {
            cluster,
            taskDefinition,
          });

          taskDefinition.addContainer("MainContainer", {
            image: ecs.ContainerImage.fromRegistry("hello"),
            portMappings: [
              {
                containerPort: ecs.ContainerDefinition.CONTAINER_PORT_USE_RANGE,
                containerPortRange: "8000-8001",
              },
            ],
          });

          // WHEN
          const lb = new compute.NetworkLoadBalancer(stack, "lb", { vpc });
          const listener = lb.addListener("listener", { port: 80 });

          // THEN
          expect(() =>
            service.registerLoadBalancerTargets({
              containerName: "MainContainer",
              containerPort: 8000,
              listener: ecs.ListenerConfig.networkListener(listener),
              newTargetGroupId: "target1",
            }),
          ).toThrow(
            /Container 'Default\/FargateTaskDef\/MainContainer' has no mapping for port 8000 and protocol tcp. Did you call "container.addPortMappings\(\)"\?/,
          );
        });
      });
    });
  });

  describe("When adding a classic load balancer", () => {
    test("throws when AvailabilityZoneRebalancing.ENABLED", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      const lb = new compute.LoadBalancer(stack, "LB", { vpc });

      // THEN
      expect(() => {
        lb.addTarget(service);
      }).toThrow(
        "AvailabilityZoneRebalancing.ENABLED disallows using the service as a target of a Classic Load Balancer",
      );
    });
  });

  describe("autoscaling tests", () => {
    test("allows scaling on a specified scheduled time", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnSchedule("ScaleOnSchedule", {
        schedule: compute.Schedule.cron({ hour: "8", minute: "0" }),
        minCapacity: 10,
      });

      // THEN
      const scheduledAction = soleResource(
        stack,
        appautoscalingScheduledAction.AppautoscalingScheduledAction,
      );
      expect(scheduledAction.name).toEqual("ScaleOnSchedule");
      expect(scheduledAction.schedule).toEqual("cron(0 8 * * ? *)");
      expect(scheduledAction.scalable_target_action).toEqual({
        min_capacity: "10",
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      //   ScheduledActions: [{ ScalableTargetAction: { MinCapacity: 10 }, Schedule: 'cron(0 8 * * ? *)', ScheduledActionName: 'ScaleOnSchedule' }],
      // });
    });

    test("allows scaling on a specified metric value", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnMetric("ScaleOnMetric", {
        metric: new cloudwatch.Metric({
          namespace: "Test",
          metricName: "Metric",
        }),
        scalingSteps: [
          { upper: 0, change: -1 },
          { lower: 100, change: +1 },
          { lower: 500, change: +5 },
        ],
      });

      // THEN
      const policy = soleResource(
        stack,
        appautoscalingPolicy.AppautoscalingPolicy,
      );
      expect(policy.policy_type).toEqual("StepScaling");
      expect(policy.step_scaling_policy_configuration).toMatchObject({
        adjustment_type: "ChangeInCapacity",
        metric_aggregation_type: "Average",
        // NOTE: `metric_interval_upper_bound` is typed `string` (not `number`) in
        // the `aws_appautoscaling_policy` terraform schema (it must also be able
        // to represent "Infinity" for an open-ended upper bound).
        step_adjustment: [
          { metric_interval_upper_bound: "0", scaling_adjustment: -1 },
        ],
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
      //   PolicyType: 'StepScaling', ScalingTargetId: {...},
      //   StepScalingPolicyConfiguration: { AdjustmentType: 'ChangeInCapacity', MetricAggregationType: 'Average', StepAdjustments: [{ MetricIntervalUpperBound: 0, ScalingAdjustment: -1 }] },
      // });
    });

    test("allows scaling on a target CPU utilization", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnCpuUtilization("ScaleOnCpu", {
        targetUtilizationPercent: 30,
      });

      // THEN
      const policy = soleResource(
        stack,
        appautoscalingPolicy.AppautoscalingPolicy,
      );
      expect(policy.policy_type).toEqual("TargetTrackingScaling");
      expect(
        policy.target_tracking_scaling_policy_configuration
          .predefined_metric_specification.predefined_metric_type,
      ).toEqual("ECSServiceAverageCPUUtilization");
      expect(
        policy.target_tracking_scaling_policy_configuration.target_value,
      ).toEqual(30);
    });

    test("allows scaling on memory utilization", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnMemoryUtilization("ScaleOnMemory", {
        targetUtilizationPercent: 30,
      });

      // THEN
      const policy = soleResource(
        stack,
        appautoscalingPolicy.AppautoscalingPolicy,
      );
      expect(policy.policy_type).toEqual("TargetTrackingScaling");
      expect(
        policy.target_tracking_scaling_policy_configuration
          .predefined_metric_specification.predefined_metric_type,
      ).toEqual("ECSServiceAverageMemoryUtilization");
      expect(
        policy.target_tracking_scaling_policy_configuration.target_value,
      ).toEqual(30);
    });

    test("allows scaling on custom CloudWatch metric", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleToTrackCustomMetric("ScaleOnCustomMetric", {
        metric: new cloudwatch.Metric({
          namespace: "Test",
          metricName: "Metric",
        }),
        targetValue: 5,
      });

      // THEN
      const policy = soleResource(
        stack,
        appautoscalingPolicy.AppautoscalingPolicy,
      );
      expect(policy.policy_type).toEqual("TargetTrackingScaling");
      expect(
        policy.target_tracking_scaling_policy_configuration
          .customized_metric_specification,
      ).toMatchObject({
        metric_name: "Metric",
        namespace: "Test",
        statistic: "Average",
      });
      expect(
        policy.target_tracking_scaling_policy_configuration.target_value,
      ).toEqual(5);
    });

    test("scheduled scaling shows warning when minute is not defined in cron", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnSchedule("ScaleOnSchedule", {
        schedule: compute.Schedule.cron({ hour: "8" }),
        minCapacity: 10,
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/Service/TaskCount/Target",
        message: expect.stringMatching(
          /cron: If you don't pass 'minute', by default the event runs every minute./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasWarning('/Default/Service/TaskCount/Target', "cron: If you don't pass 'minute', by default the event runs every minute. Pass 'minute: '*'' if that's what you intend, or 'minute: 0' to run once per hour instead. [ack: @aws-cdk/aws-applicationautoscaling:defaultRunEveryMinute]");
    });

    test("scheduled scaling shows no warning when minute is * in cron", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        minHealthyPercent: 50, // must be set to avoid warning causing test failure
      });

      // WHEN
      const capacity = service.autoScaleTaskCount({
        maxCapacity: 10,
        minCapacity: 1,
      });
      capacity.scaleOnSchedule("ScaleOnSchedule", {
        schedule: compute.Schedule.cron({ hour: "8", minute: "*" }),
        minCapacity: 10,
      });

      // THEN
      Annotations.fromStack(stack).hasNoWarnings({
        constructPath: "Default/Service/TaskCount/Target",
        message: expect.stringMatching(
          /cron: If you don't pass 'minute', by default the event runs every minute./,
        ),
      });
    });
  });

  describe("When enabling service discovery", () => {
    test("throws if namespace has not been added to cluster", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // THEN
      expect(() => {
        new ecs.FargateService(stack, "Service", {
          cluster,
          taskDefinition,
          cloudMapOptions: {
            name: "myApp",
          },
        });
      }).toThrow(
        /Cannot enable service discovery if a Cloudmap Namespace has not been created in the cluster./,
      );
    });

    test("creates cloud map service for Private DNS namespace", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      const namespace = cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
        },
      });

      // THEN
      const sdService = soleResource(
        stack,
        serviceDiscoveryService.ServiceDiscoveryService,
      );
      expect(sdService.name).toEqual("myApp");
      expect(sdService.namespace_id).toEqual(
        stack.resolve(namespace.namespaceId),
      );
      expect(sdService.dns_config).toMatchObject({
        dns_records: [{ ttl: 60, type: "A" }],
        routing_policy: "MULTIVALUE",
      });
      expect(sdService.health_check_custom_config).toEqual({
        failure_threshold: 1,
      });
    });

    test("creates AWS Cloud Map service for Private DNS namespace with SRV records with proper defaults", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
          dnsRecordType: cloudmap.DnsRecordType.SRV,
        },
      });

      // THEN
      const sdService = soleResource(
        stack,
        serviceDiscoveryService.ServiceDiscoveryService,
      );
      expect(sdService.dns_config).toMatchObject({
        dns_records: [{ ttl: 60, type: "SRV" }],
        routing_policy: "MULTIVALUE",
      });
      expect(sdService.health_check_custom_config).toEqual({
        failure_threshold: 1,
      });
      expect(sdService.name).toEqual("myApp");
    });

    test("creates AWS Cloud Map service for Private DNS namespace with SRV records with overriden defaults", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
          dnsRecordType: cloudmap.DnsRecordType.SRV,
          dnsTtl: Duration.seconds(10),
        },
      });

      // THEN
      const sdService = soleResource(
        stack,
        serviceDiscoveryService.ServiceDiscoveryService,
      );
      expect(sdService.dns_config).toMatchObject({
        dns_records: [{ ttl: 10, type: "SRV" }],
        routing_policy: "MULTIVALUE",
      });
      expect(sdService.health_check_custom_config).toEqual({
        failure_threshold: 1,
      });
      expect(sdService.name).toEqual("myApp");
    });

    test("user can select any container and port", () => {
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: cloudmap.NamespaceType.DNS_PRIVATE,
      });

      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );
      const mainContainer = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      mainContainer.addPortMappings({ containerPort: 8000 });

      const otherContainer = taskDefinition.addContainer("OtherContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      otherContainer.addPortMappings({ containerPort: 8001 });

      new ecs.FargateService(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          dnsRecordType: cloudmap.DnsRecordType.SRV,
          container: otherContainer,
          containerPort: 8001,
        },
      });

      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.service_registries).toMatchObject({
        container_name: "OtherContainer",
        container_port: 8001,
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [{ RegistryArn: {...}, ContainerName: 'OtherContainer', ContainerPort: 8001 }],
      // });
    });
  });

  test("Metric", () => {
    // GIVEN
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("hello"),
    });

    // WHEN
    const service = new ecs.FargateService(stack, "Service", {
      cluster,
      taskDefinition,
    });

    // THEN
    expect(stack.resolve(service.metricCpuUtilization())).toEqual({
      dimensions: {
        ClusterName: stack.resolve(cluster.clusterName),
        ServiceName: stack.resolve(service.serviceName),
      },
      namespace: "AWS/ECS",
      metricName: "CPUUtilization",
      period: Duration.minutes(5),
      statistic: "Average",
    });
  });

  describe("When import a Fargate Service", () => {
    test("fromFargateServiceArn old format", () => {
      // GIVEN
      const stack = new AwsStack();

      // WHEN
      const service = ecs.FargateService.fromFargateServiceArn(
        stack,
        "EcsService",
        "arn:aws:ecs:us-west-2:123456789012:service/my-http-service",
      );

      // THEN
      expect(service.serviceArn).toEqual(
        "arn:aws:ecs:us-west-2:123456789012:service/my-http-service",
      );
      expect(service.serviceName).toEqual("my-http-service");
    });

    test("fromFargateServiceArn new format", () => {
      // GIVEN
      const stack = new AwsStack();

      // WHEN
      const service = ecs.FargateService.fromFargateServiceArn(
        stack,
        "EcsService",
        "arn:aws:ecs:us-west-2:123456789012:service/my-cluster-name/my-http-service",
      );

      // THEN
      expect(service.serviceArn).toEqual(
        "arn:aws:ecs:us-west-2:123456789012:service/my-cluster-name/my-http-service",
      );
      expect(service.serviceName).toEqual("my-http-service");
    });

    // TERRACONSTRUCTS DEVIATION: upstream gates the ARN format used to extract a service name from a
    // *tokenized* ARN behind the `@aws-cdk/aws-ecs:arnFormatIncludesClusterName` feature flag
    // (recommendedValue: true, see `base/from-service-attributes.ts` `extractServiceNameFromArn()`).
    // This repo has no legacy stacks to preserve compatibility with, so the "new" (cluster-name
    // including) ARN format is always assumed for tokenized ARNs -- the flag-disabled branch below
    // is unreachable and dropped. Omitted in full:
    //
    // test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is disabled, use old ARN format", ...)
    describe("fromFargateServiceArn tokenized ARN", () => {
      test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is enabled, use new ARN format", () => {
        // GIVEN
        const stack = new AwsStack();

        // WHEN
        const arnVar = new TerraformVariable(stack, "ARN", { type: "string" });
        const service = ecs.FargateService.fromFargateServiceArn(
          stack,
          "EcsService",
          arnVar.stringValue,
        );

        // THEN
        expect(stack.resolve(service.serviceArn)).toEqual(
          stack.resolve(arnVar.stringValue),
        );
        expect(stack.resolve(service.serviceName)).toEqual(
          stack.resolve(
            Fn.element(
              Fn.split(
                "/",
                Fn.element(Fn.split(":", arnVar.stringValue), 5) as string,
              ),
              2,
            ),
          ),
        );
      });
    });

    test("with serviceArn old format", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      // WHEN
      const service = ecs.FargateService.fromFargateServiceAttributes(
        stack,
        "EcsService",
        {
          serviceArn:
            "arn:aws:ecs:us-west-2:123456789012:service/my-http-service",
          cluster,
        },
      );

      // THEN
      expect(service.serviceArn).toEqual(
        "arn:aws:ecs:us-west-2:123456789012:service/my-http-service",
      );
      expect(service.serviceName).toEqual("my-http-service");

      expect(service.env.account).toEqual("123456789012");
      expect(service.env.region).toEqual("us-west-2");
    });

    test("with serviceArn new format", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      // WHEN
      const service = ecs.FargateService.fromFargateServiceAttributes(
        stack,
        "EcsService",
        {
          serviceArn:
            "arn:aws:ecs:us-west-2:123456789012:service/my-cluster-name/my-http-service",
          cluster,
        },
      );

      // THEN
      expect(service.serviceArn).toEqual(
        "arn:aws:ecs:us-west-2:123456789012:service/my-cluster-name/my-http-service",
      );
      expect(service.serviceName).toEqual("my-http-service");

      expect(service.env.account).toEqual("123456789012");
      expect(service.env.region).toEqual("us-west-2");
    });

    // TERRACONSTRUCTS DEVIATION: see note above `fromFargateServiceArn tokenized ARN` -- the
    // flag-disabled ("old ARN format") branch is unreachable in this repo and dropped. Omitted:
    //
    // test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is disabled, use old ARN format", ...)
    describe("with serviceArn tokenized ARN", () => {
      test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is enabled, use new ARN format", () => {
        // GIVEN
        const stack = new AwsStack();
        const cluster = new ecs.Cluster(stack, "EcsCluster");

        // WHEN
        const arnVar = new TerraformVariable(stack, "ARN", { type: "string" });
        const service = ecs.FargateService.fromFargateServiceAttributes(
          stack,
          "EcsService",
          {
            serviceArn: arnVar.stringValue,
            cluster,
          },
        );

        // THEN
        expect(stack.resolve(service.serviceArn)).toEqual(
          stack.resolve(arnVar.stringValue),
        );
      });
    });

    describe("with serviceName", () => {
      // TERRACONSTRUCTS DEVIATION: see note above `fromFargateServiceArn tokenized ARN` -- the
      // flag-disabled ("old ARN format") branch is unreachable in this repo and dropped. Omitted:
      //
      // test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is disabled, use old ARN format", ...)
      test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is enabled, use new ARN format", () => {
        // GIVEN
        const stack = new AwsStack();
        const cluster = new ecs.Cluster(stack, "EcsCluster");

        // WHEN
        const service = ecs.FargateService.fromFargateServiceAttributes(
          stack,
          "EcsService",
          {
            serviceName: "my-http-service",
            cluster,
          },
        );

        // THEN
        expect(stack.resolve(service.serviceArn)).toEqual(
          stack.resolve(
            `arn:${stack.partition}:ecs:${stack.region}:${stack.account}:service/${cluster.clusterName}/my-http-service`,
          ),
        );
        expect(service.serviceName).toEqual("my-http-service");
      });
    });

    // TERRACONSTRUCTS DEVIATION: `base-service.ts` no longer implicitly sets
    // `{ type: DeploymentControllerType.ECS }` just because `circuitBreaker` is configured (see the
    // `deploymentController` DEVIATION comment in `base-service.ts` and `base-service.test.ts`'s
    // dropped `circuitbreaker is %p /\ flag is %p` test.each). The `DeploymentController` assertion
    // below is therefore adjusted to reflect that the controller is left unset.
    test("with circuit breaker", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("Container", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });

      // WHEN
      new ecs.FargateService(stack, "EcsService", {
        cluster,
        taskDefinition,
        circuitBreaker: { rollback: true },
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.deployment_maximum_percent).toEqual(200);
      expect(resource.deployment_minimum_healthy_percent).toEqual(50);
      expect(resource.deployment_circuit_breaker).toEqual({
        enable: true,
        rollback: true,
      });
      expect(resource.deployment_controller).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50, DeploymentCircuitBreaker: { Enable: true, Rollback: true } },
      //   DeploymentController: { Type: ecs.DeploymentControllerType.ECS },
      // });
    });

    test("with circuit breaker and deployment controller feature flag enabled", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("Container", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });

      // WHEN
      new ecs.FargateService(stack, "EcsService", {
        cluster,
        taskDefinition,
        circuitBreaker: { rollback: true },
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.deployment_maximum_percent).toEqual(200);
      expect(resource.deployment_minimum_healthy_percent).toEqual(50);
      expect(resource.deployment_circuit_breaker).toEqual({
        enable: true,
        rollback: true,
      });
    });

    test("throws an exception if both serviceArn and serviceName were provided for fromEc2ServiceAttributes", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      expect(() => {
        ecs.FargateService.fromFargateServiceAttributes(stack, "EcsService", {
          serviceArn:
            "arn:aws:ecs:us-west-2:123456789012:service/my-http-service",
          serviceName: "my-http-service",
          cluster,
        });
      }).toThrow(/only specify either serviceArn or serviceName/);
    });

    test("throws an exception if neither serviceArn nor serviceName were provided for fromEc2ServiceAttributes", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      expect(() => {
        ecs.FargateService.fromFargateServiceAttributes(stack, "EcsService", {
          cluster,
        } as any);
      }).toThrow(/only specify either serviceArn or serviceName/);
    });

    test("allows setting enable execute command", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.taskDefinitionArn),
      );
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.launch_type).toEqual("FARGATE");
      expect(resource.enable_ecs_managed_tags).toEqual(false);
      expect(resource.enable_execute_command).toEqual(true);

      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual([
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
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {...EnableExecuteCommand: true...});
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: { Statement: [{ Action: [...ssmmessages], Effect: 'Allow', Resource: '*' }], Version: '2012-10-17' },
      //   PolicyName: 'FargateTaskDefTaskRoleDefaultPolicy8EB25BBD', Roles: [{ Ref: 'FargateTaskDefTaskRole0B257552' }],
      // });
    });

    test("no logging enabled when logging field is set to NONE", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          logging: ecs.ExecuteCommandLogging.NONE,
        },
      });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        logging: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: "log-group",
        }),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual([
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
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: { Statement: [{ Action: [...ssmmessages], Effect: 'Allow', Resource: '*' }], Version: '2012-10-17' },
      // });
    });

    test("enables execute command logging with logging field set to OVERRIDE", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");

      const execBucket = new storage.Bucket(stack, "ExecBucket");

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          logConfiguration: {
            cloudWatchLogGroup: logGroup,
            s3Bucket: execBucket,
            s3KeyPrefix: "exec-output",
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: ["logs:DescribeLogGroups"],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: [
              "logs:CreateLogStream",
              "logs:DescribeLogStreams",
              "logs:PutLogEvents",
            ],
            effect: "Allow",
          }),
          expect.objectContaining({
            actions: ["s3:GetBucketLocation"],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: ["s3:PutObject"],
            effect: "Allow",
          }),
        ]),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: { Statement: [...ssmmessages, logs:DescribeLogGroups, logs write (log group arn), s3:GetBucketLocation, s3:PutObject (bucket arn)...] },
      // });
    });

    test("enables only execute command session encryption", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");

      const kmsKeyConstruct = new encryption.Key(stack, "KmsKey");

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");

      const execBucket = new storage.Bucket(stack, "EcsExecBucket");

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          kmsKey: kmsKeyConstruct,
          logConfiguration: {
            cloudWatchLogGroup: logGroup,
            s3Bucket: execBucket,
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });

      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: ["kms:Decrypt", "kms:GenerateDataKey"],
            effect: "Allow",
            resources: [stack.resolve(kmsKeyConstruct.keyArn)],
          }),
        ]),
      );

      const keyPolicyDoc = kmsKeyPolicyDoc(stack);
      expect(keyPolicyDoc.statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: ["kms:*"],
            effect: "Allow",
          }),
        ]),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {...kms:Decrypt/kms:GenerateDataKey...});
      // Template.fromStack(stack).hasResourceProperties('AWS::KMS::Key', { KeyPolicy: { Statement: [{ Action: 'kms:*', Effect: 'Allow', ... }] } });
    });

    test("enables encryption for execute command logging", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");

      const kmsKeyConstruct = new encryption.Key(stack, "KmsKey");

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup", {
        encryptionKey: kmsKeyConstruct,
      });

      const execBucket = new storage.Bucket(stack, "EcsExecBucket", {
        encryptionKey: kmsKeyConstruct,
      });

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          kmsKey: kmsKeyConstruct,
          logConfiguration: {
            cloudWatchLogGroup: logGroup,
            cloudWatchEncryptionEnabled: true,
            s3Bucket: execBucket,
            s3EncryptionEnabled: true,
            s3KeyPrefix: "exec-output",
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });

      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const doc = taskRoleDefaultPolicyDoc(stack);
      expect(doc.statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: ["kms:Decrypt", "kms:GenerateDataKey"],
            effect: "Allow",
          }),
          expect.objectContaining({
            actions: ["s3:GetEncryptionConfiguration"],
            effect: "Allow",
          }),
        ]),
      );

      const keyPolicyDoc = kmsKeyPolicyDoc(stack);
      expect(keyPolicyDoc.statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actions: ["kms:*"], effect: "Allow" }),
          expect.objectContaining({
            actions: [
              "kms:Encrypt*",
              "kms:Decrypt*",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
              "kms:Describe*",
            ],
            effect: "Allow",
          }),
        ]),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {...kms + s3 GetEncryptionConfiguration...});
      // Template.fromStack(stack).hasResourceProperties('AWS::KMS::Key', {
      //   KeyPolicy: { Statement: [{ Action: 'kms:*', ... }, { Action: [...kms encrypt/decrypt...], Condition: {...logs arn like...}, ... }] },
      // });
    });

    // TERRACONSTRUCTS DEVIATION: `testDeprecated` not ported (see note above).
    test("with both propagateTags and propagateTaskTagsFrom defined", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new compute.Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "FargateTaskDef",
      );

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // THEN
      expect(() => {
        new ecs.FargateService(stack, "FargateService", {
          cluster,
          taskDefinition,
          propagateTags: ecs.PropagatedTagSource.SERVICE,
          propagateTaskTagsFrom: ecs.PropagatedTagSource.SERVICE,
        });
      }).toThrow(
        /You can only specify either propagateTags or propagateTaskTagsFrom. Alternatively, you can leave both blank/,
      );
    });
  });
});

// Wrapping synth/snapshot coverage for the FargateService construct exercised above
// (harness idiom: test/aws/notify/queue.test.ts + test/aws/compute/ecs/base-service.test.ts).
describe("fargate service synth", () => {
  test("FargateService with only required properties set should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "MyVpc");
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

  test("FargateService with all properties set should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "MyVpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addDefaultCloudMapNamespace({
      name: "foo.com",
      type: cloudmap.NamespaceType.DNS_PRIVATE,
    });
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
      desiredCount: 2,
      assignPublicIp: true,
      cloudMapOptions: {
        name: "myapp",
        dnsRecordType: cloudmap.DnsRecordType.A,
        dnsTtl: Duration.seconds(50),
        failureThreshold: 20,
      },
      healthCheckGracePeriod: Duration.seconds(60),
      maxHealthyPercent: 150,
      minHealthyPercent: 55,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
      circuitBreaker: { rollback: true },
      serviceName: "bonjour",
      vpcSubnets: { subnetType: compute.SubnetType.PUBLIC },
      availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("FargateService with service connect should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "MyVpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 80, name: "api" }],
    });
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });
    // WHEN
    cluster.addDefaultCloudMapNamespace({ name: "cool" });
    service.enableServiceConnect({
      services: [
        {
          portMappingName: "api",
          idleTimeout: Duration.seconds(10),
          perRequestTimeout: Duration.seconds(10),
        },
      ],
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("FargateService with a managed EBS volume should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "MyVpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    const container = taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    container.addMountPoints({
      containerPath: "/var/lib",
      readOnly: false,
      sourceVolume: "nginx-vol",
    });
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });
    // WHEN
    service.addVolume(
      new ServiceManagedVolume(stack, "EBSVolume", {
        name: "nginx-vol",
        managedEBSVolume: {
          size: Size.gibibytes(20),
          fileSystemType: ecs.FileSystemType.XFS,
        },
      }),
    );
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("FargateService with an application load balancer target should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "MyVpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    const container = taskDefinition.addContainer("MainContainer", {
      image: ecs.ContainerImage.fromRegistry("hello"),
    });
    container.addPortMappings({ containerPort: 8000 });
    const service = new ecs.FargateService(stack, "Service", {
      cluster,
      taskDefinition,
    });
    // WHEN
    const lb = new compute.ApplicationLoadBalancer(stack, "lb", { vpc });
    const listener = lb.addListener("listener", { port: 80 });
    listener.addTargets("target", {
      port: 80,
      targets: [service],
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
