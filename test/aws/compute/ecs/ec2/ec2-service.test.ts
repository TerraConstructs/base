// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/ec2/ec2-service.test.ts

import {
  ecsService,
  ecsTaskDefinition,
  securityGroup as tfSecurityGroup,
  vpcSecurityGroupEgressRule,
  vpcSecurityGroupIngressRule,
  serviceDiscoveryPrivateDnsNamespace,
  serviceDiscoveryService,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { Fn, HttpBackend, Testing, TerraformVariable } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws";
import * as cloudwatch from "../../../../../src/aws/cloudwatch";
import {
  ApplicationLoadBalancer,
  InstanceType,
  LoadBalancer,
  NetworkLoadBalancer,
  SecurityGroup,
  Subnet,
  SubnetType,
  Vpc,
} from "../../../../../src/aws/compute";
import * as autoscaling from "../../../../../src/aws/compute/auto-scaling";
import * as ecs from "../../../../../src/aws/compute/ecs";
import * as edge from "../../../../../src/aws/edge";
import * as encryption from "../../../../../src/aws/encryption";
import * as storage from "../../../../../src/aws/storage";
import { Duration } from "../../../../../src/duration";
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
 * (harness idiom: test/aws/compute/ecs/base-service.test.ts)
 */
function soleResource(stack: AwsStack, type: any): any {
  return Object.values(Template.resourceObjects(stack, type))[0];
}

describe("ec2 service", () => {
  describe("When creating an EC2 Service", () => {
    test("with only required properties set, it correctly sets default properties", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
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
      expect(resource.launch_type).toEqual(ecs.LaunchType.EC2);
      expect(resource.scheduling_strategy).toEqual("REPLICA");
      expect(resource.enable_ecs_managed_tags).toEqual(false);
      expect(resource.availability_zone_rebalancing).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: { Ref: 'Ec2TaskDef0226F28C' },
      //   Cluster: { Ref: 'EcsCluster97242B84' },
      //   DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 },
      //   LaunchType: LaunchType.EC2,
      //   SchedulingStrategy: 'REPLICA',
      //   EnableECSManagedTags: false,
      //   AvailabilityZoneRebalancing: Match.absent(),
      // });

      expect(service.node.defaultChild).toBeDefined();
    });

    // TERRACONSTRUCTS DEVIATION: upstream's `@aws-cdk/aws-ecs:reduceEc2FargateCloudWatchPermissions`
    // feature flag (recommendedValue: true) is not ported (no feature-flag/cx-api surface for it in
    // this repo, see base/base-service.ts `executeCommandLogConfiguration()`). This repo always
    // targets the modern/recommended behavior: the broad wildcard-resource CloudWatch Logs policy
    // that upstream grants when `reduceEc2FargateCloudWatchPermissions` is falsy AND no CloudWatch
    // log group is configured on the cluster's executeCommandConfiguration is never granted. This
    // legacy-flag test (which exercises exactly that dropped branch) is therefore omitted in full:
    //
    // [false, undefined].forEach((value) => {
    //   test('set cloudwatch permissions based on falsy feature flag when no cloudwatch log configured', () => { ... });
    // });

    test("set cloudwatch permissions based on true feature flag when no cloudwatch log configured", () => {
      // GIVEN
      // TERRACONSTRUCTS DEVIATION: the feature-flag context setup is dropped -- this repo always
      // targets the "true"/recommended behavior described by the upstream test title.
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
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
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       { Action: [...ssmmessages], Effect: 'Allow', Resource: '*' },
      //       { Action: 'logs:DescribeLogGroups', Effect: 'Allow', Resource: '*' },
      //       { Action: [...CreateLogStream], Effect: 'Allow', Resource: '*' },
      //     ],
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });
    });

    test("set cloudwatch permissions based on true feature flag when cloudwatch log is configured", () => {
      // GIVEN
      // TERRACONSTRUCTS DEVIATION: the feature-flag context setup is dropped -- see note above.
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
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
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      // built the same way base/base-service.ts#executeCommandLogConfiguration() builds it
      const logGroupArn = `arn:${stack.partition}:logs:${service.env.region}:${service.env.account}:log-group:${logGroup.logGroupName}:*`;
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
            {
              actions: ["logs:DescribeLogGroups"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: [
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
              ],
              effect: "Allow",
              resources: [stack.resolve(logGroupArn)],
            },
          ],
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       { Action: [...ssmmessages], Effect: 'Allow', Resource: '*' },
      //       { Action: 'logs:DescribeLogGroups', Effect: 'Allow', Resource: '*' },
      //       {
      //         Action: [...CreateLogStream],
      //         Effect: 'Allow',
      //         Resource: { 'Fn::Join': ['', ['arn:', {Ref:'AWS::Partition'}, ':logs:', {Ref:'AWS::Region'}, ':', {Ref:'AWS::AccountId'}, ':log-group:', {Ref:'LogGroupF5B46931'}, ':*']] },
      //       },
      //     ],
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });
    });

    test("allows setting enable execute command", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
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
      expect(resource.deployment_maximum_percent).toEqual(200);
      expect(resource.deployment_minimum_healthy_percent).toEqual(50);
      expect(resource.launch_type).toEqual(ecs.LaunchType.EC2);
      expect(resource.scheduling_strategy).toEqual("REPLICA");
      expect(resource.enable_ecs_managed_tags).toEqual(false);
      expect(resource.enable_execute_command).toEqual(true);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: { Ref: 'Ec2TaskDef0226F28C' },
      //   Cluster: { Ref: 'EcsCluster97242B84' },
      //   DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 },
      //   LaunchType: LaunchType.EC2,
      //   SchedulingStrategy: 'REPLICA',
      //   EnableECSManagedTags: false,
      //   EnableExecuteCommand: true,
      // });

      // TERRACONSTRUCTS DEVIATION: unlike upstream (which, absent the
      // `@aws-cdk/aws-ecs:reduceEc2FargateCloudWatchPermissions` feature flag, grants a
      // wildcard-resource `logs:DescribeLogGroups`/`logs:CreateLogStream` policy even when no
      // CloudWatch log group is configured), this repo always targets the modern/recommended
      // behavior: see `executeCommandLogConfiguration()` in `base-service.ts`. Since no
      // `executeCommandConfiguration.logConfiguration.cloudWatchLogGroup` is configured on the
      // cluster here, only the ssmmessages statement is granted.
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
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       { Action: [...ssmmessages], Effect: 'Allow', Resource: '*' },
      //       { Action: 'logs:DescribeLogGroups', Effect: 'Allow', Resource: '*' },
      //       { Action: [...CreateLogStream], Effect: 'Allow', Resource: '*' },
      //     ],
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });
    });

    test("no logging enabled when logging field is set to NONE", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          logging: ecs.ExecuteCommandLogging.NONE,
        },
      });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        logging: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: "log-group",
        }),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
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
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [{ Action: [...ssmmessages], Effect: 'Allow', Resource: '*' }],
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });
    });

    test("enables execute command logging when logging field is set to OVERRIDE", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});

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
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const logGroupArn = `arn:${stack.partition}:logs:${service.env.region}:${service.env.account}:log-group:${logGroup.logGroupName}:*`;
      const bucketObjectArn = `arn:${stack.partition}:s3:::${execBucket.bucketName}/*`;
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
            {
              actions: ["logs:DescribeLogGroups"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: [
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
              ],
              effect: "Allow",
              resources: [stack.resolve(logGroupArn)],
            },
            {
              actions: ["s3:GetBucketLocation"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: ["s3:PutObject"],
              effect: "Allow",
              resources: [stack.resolve(bucketObjectArn)],
            },
          ],
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: {
      //     Statement: [
      //       { Action: [...ssmmessages], Effect: 'Allow', Resource: '*' },
      //       { Action: 'logs:DescribeLogGroups', Effect: 'Allow', Resource: '*' },
      //       { Action: [...CreateLogStream], Effect: 'Allow', Resource: {'Fn::Join': [...LogGroupF5B46931...]} },
      //       { Action: 's3:GetBucketLocation', Effect: 'Allow', Resource: '*' },
      //       { Action: 's3:PutObject', Effect: 'Allow', Resource: {'Fn::Join': [...ExecBucket29559356.../*']} },
      //     ],
      //     Version: '2012-10-17',
      //   },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });
    });

    test("enables only execute command session encryption", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});

      const kmsKey = new encryption.Key(stack, "KmsKey");

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");

      const execBucket = new storage.Bucket(stack, "EcsExecBucket");

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          kmsKey,
          logConfiguration: {
            cloudWatchLogGroup: logGroup,
            s3Bucket: execBucket,
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });

      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const logGroupArn = `arn:${stack.partition}:logs:${service.env.region}:${service.env.account}:log-group:${logGroup.logGroupName}:*`;
      const bucketObjectArn = `arn:${stack.partition}:s3:::${execBucket.bucketName}/*`;
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
            {
              actions: ["kms:Decrypt", "kms:GenerateDataKey"],
              effect: "Allow",
              resources: [stack.resolve(kmsKey.keyArn)],
            },
            {
              actions: ["logs:DescribeLogGroups"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: [
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
              ],
              effect: "Allow",
              resources: [stack.resolve(logGroupArn)],
            },
            {
              actions: ["s3:GetBucketLocation"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: ["s3:PutObject"],
              effect: "Allow",
              resources: [stack.resolve(bucketObjectArn)],
            },
          ],
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: { Statement: [ ...ssmmessages, kms:Decrypt/GenerateDataKey, logs:DescribeLogGroups,
      //     logs:CreateLogStream/..., s3:GetBucketLocation, s3:PutObject ], Version: '2012-10-17' },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });

      // root-principal key policy only -- no CloudWatch Logs service-principal statement, since
      // cloudWatchEncryptionEnabled was not set and logging !== DEFAULT (it's OVERRIDE)
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["kms:*"],
              effect: "Allow",
              resources: ["*"],
              principals: [
                {
                  type: "AWS",
                  identifiers: [
                    `arn:${stack.resolve(stack.partition)}:iam::${stack.resolve(service.env.account)}:root`,
                  ],
                },
              ],
            },
          ],
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::KMS::Key', {
      //   KeyPolicy: { Statement: [{ Action: 'kms:*', Effect: 'Allow',
      //     Principal: { AWS: {'Fn::Join': ['', ['arn:', {Ref:'AWS::Partition'}, ':iam::', {Ref:'AWS::AccountId'}, ':root']]} },
      //     Resource: '*' }], Version: '2012-10-17' },
      // });
    });

    test("enables encryption for execute command logging", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});

      const kmsKey = new encryption.Key(stack, "KmsKey");

      const logGroup = new cloudwatch.LogGroup(stack, "LogGroup", {
        encryptionKey: kmsKey,
      });

      const execBucket = new storage.Bucket(stack, "EcsExecBucket", {
        encryptionKey: kmsKey,
      });

      // WHEN
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        executeCommandConfiguration: {
          kmsKey,
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
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        enableExecuteCommand: true,
      });

      // THEN
      const logGroupArn = `arn:${stack.partition}:logs:${service.env.region}:${service.env.account}:log-group:${logGroup.logGroupName}:*`;
      const bucketObjectArn = `arn:${stack.partition}:s3:::${execBucket.bucketName}/*`;
      const bucketArn = `arn:${stack.partition}:s3:::${execBucket.bucketName}`;
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
            {
              actions: ["kms:Decrypt", "kms:GenerateDataKey"],
              effect: "Allow",
              resources: [stack.resolve(kmsKey.keyArn)],
            },
            {
              actions: ["logs:DescribeLogGroups"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: [
                "logs:CreateLogStream",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
              ],
              effect: "Allow",
              resources: [stack.resolve(logGroupArn)],
            },
            {
              actions: ["s3:GetBucketLocation"],
              effect: "Allow",
              resources: ["*"],
            },
            {
              actions: ["s3:PutObject"],
              effect: "Allow",
              resources: [stack.resolve(bucketObjectArn)],
            },
            {
              actions: ["s3:GetEncryptionConfiguration"],
              effect: "Allow",
              resources: [stack.resolve(bucketArn)],
            },
          ],
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      //   PolicyDocument: { Statement: [ ...ssmmessages, kms:Decrypt/GenerateDataKey, logs:DescribeLogGroups,
      //     logs:CreateLogStream/..., s3:GetBucketLocation, s3:PutObject, s3:GetEncryptionConfiguration ],
      //     Version: '2012-10-17' },
      //   PolicyName: 'Ec2TaskDefTaskRoleDefaultPolicyA24FB970',
      //   Roles: [{ Ref: 'Ec2TaskDefTaskRole400FA349' }],
      // });

      // key policy now carries BOTH the root-principal statement AND the CloudWatch Logs
      // service-principal statement (cloudWatchEncryptionEnabled: true)
      const logsCondArn = `arn:${stack.partition}:logs:${service.env.region}:${service.env.account}:*`;
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["kms:*"],
              effect: "Allow",
              resources: ["*"],
              principals: [
                {
                  type: "AWS",
                  identifiers: [
                    `arn:${stack.resolve(stack.partition)}:iam::${stack.resolve(service.env.account)}:root`,
                  ],
                },
              ],
            },
            {
              actions: [
                "kms:Encrypt*",
                "kms:Decrypt*",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
                "kms:Describe*",
              ],
              effect: "Allow",
              resources: ["*"],
              principals: [
                {
                  type: "Service",
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_logs.name}",
                  ],
                },
              ],
              condition: [
                {
                  test: "ArnLike",
                  variable: "kms:EncryptionContext:aws:logs:arn",
                  values: [stack.resolve(logsCondArn)],
                },
              ],
            },
          ],
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::KMS::Key', {
      //   KeyPolicy: { Statement: [
      //     { Action: 'kms:*', Effect: 'Allow', Principal: { AWS: {'Fn::Join': [...root]} }, Resource: '*' },
      //     { Action: [...Encrypt*/Decrypt*/ReEncrypt*/GenerateDataKey*/Describe*],
      //       Condition: { ArnLike: { 'kms:EncryptionContext:aws:logs:arn': {'Fn::Join': [...] } } },
      //       Effect: 'Allow', Principal: { Service: {'Fn::Join': ['', ['logs.', {Ref:'AWS::Region'}, '.amazonaws.com']]} },
      //       Resource: '*' },
      //   ], Version: '2012-10-17' },
      // });
    });

    test("with custom cloudmap namespace", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      const cloudMapNamespace = new edge.cloudmap.PrivateDnsNamespace(
        stack,
        "TestCloudMapNamespace",
        {
          name: "scorekeep.com",
          vpc,
        },
      );

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
          failureThreshold: 20,
          cloudMapNamespace,
        },
      });

      // THEN
      const service = soleResource(
        stack,
        serviceDiscoveryService.ServiceDiscoveryService,
      );
      const namespace = soleResource(
        stack,
        serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
      );
      expect(service.dns_config).toMatchObject({
        dns_records: [{ ttl: 60, type: "SRV" }],
        routing_policy: "MULTIVALUE",
      });
      expect(service.health_check_custom_config).toEqual({
        failure_threshold: 20,
      });
      expect(service.name).toEqual("myApp");
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::Service', {
      //   DnsConfig: { DnsRecords: [{ TTL: 60, Type: 'SRV' }], NamespaceId: {'Fn::GetAtt':[...Id]}, RoutingPolicy: 'MULTIVALUE' },
      //   HealthCheckCustomConfig: { FailureThreshold: 20 },
      //   Name: 'myApp',
      //   NamespaceId: {'Fn::GetAtt': ['TestCloudMapNamespace1FB9B446', 'Id']},
      // });

      expect(namespace.name).toEqual("scorekeep.com");
      expect(namespace.vpc).toEqual(stack.resolve(vpc.vpcId));
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', {
      //   Name: 'scorekeep.com',
      //   Vpc: { Ref: 'MyVpcF9F0CA6F' },
      // });
    });

    test("with all properties set", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });

      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // WHEN
      const securityGroup1 = new SecurityGroup(stack, "SecurityGroup1", {
        allowAllOutbound: true,
        description: "Example",
        securityGroupName: "Bob",
        vpc,
      });
      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        desiredCount: 2,
        assignPublicIp: true,
        cloudMapOptions: {
          name: "myapp",
          dnsRecordType: edge.cloudmap.DnsRecordType.A,
          dnsTtl: Duration.seconds(50),
          failureThreshold: 20,
        },
        daemon: false,
        healthCheckGracePeriod: Duration.seconds(60),
        maxHealthyPercent: 150,
        minHealthyPercent: 55,
        deploymentController: {
          type: ecs.DeploymentControllerType.ECS,
        },
        securityGroups: [securityGroup1],
        serviceName: "bonjour",
        vpcSubnets: { subnetType: SubnetType.PUBLIC },
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      service.addPlacementConstraints(
        ecs.PlacementConstraint.memberOf("attribute:ecs.instance-type =~ t2.*"),
      );
      service.addPlacementStrategies(
        ecs.PlacementStrategy.spreadAcross(
          ecs.BuiltInAttributes.AVAILABILITY_ZONE,
        ),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.taskDefinitionArn),
      );
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.deployment_maximum_percent).toEqual(150);
      expect(resource.deployment_minimum_healthy_percent).toEqual(55);
      expect(resource.deployment_controller).toEqual({
        type: ecs.DeploymentControllerType.ECS,
      });
      expect(resource.desired_count).toEqual(2);
      expect(resource.launch_type).toEqual(ecs.LaunchType.EC2);
      expect(resource.network_configuration).toMatchObject({
        assign_public_ip: true,
        security_groups: [stack.resolve(securityGroup1.securityGroupId)],
      });
      expect(resource.placement_constraints).toEqual([
        { expression: "attribute:ecs.instance-type =~ t2.*", type: "memberOf" },
      ]);
      expect(resource.ordered_placement_strategy).toEqual([
        { field: "attribute:ecs.availability-zone", type: "spread" },
      ]);
      expect(resource.scheduling_strategy).toEqual("REPLICA");
      expect(resource.name).toEqual("bonjour");
      expect(resource.service_registries).toMatchObject({
        registry_arn: stack.resolve(
          service.cloudMapService?.serviceOutputs.serviceArn,
        ),
      });
      expect(resource.availability_zone_rebalancing).toEqual("ENABLED");
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: {Ref:'Ec2TaskDef0226F28C'}, Cluster: {Ref:'EcsCluster97242B84'},
      //   DeploymentConfiguration: { MaximumPercent: 150, MinimumHealthyPercent: 55 },
      //   DeploymentController: { Type: ecs.DeploymentControllerType.ECS }, DesiredCount: 2,
      //   LaunchType: LaunchType.EC2,
      //   NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED',
      //     SecurityGroups: [{'Fn::GetAtt':['SecurityGroup1F554B36F','GroupId']}],
      //     Subnets: [{Ref:'MyVpcPublicSubnet1SubnetF6608456'},{Ref:'MyVpcPublicSubnet2Subnet492B6BFB'}] } },
      //   PlacementConstraints: [{ Expression: 'attribute:ecs.instance-type =~ t2.*', Type: 'memberOf' }],
      //   PlacementStrategies: [{ Field: 'attribute:ecs.availability-zone', Type: 'spread' }],
      //   SchedulingStrategy: 'REPLICA', ServiceName: 'bonjour',
      //   ServiceRegistries: [{ RegistryArn: {'Fn::GetAtt':['Ec2ServiceCloudmapService45B52C0F','Arn']} }],
      //   AvailabilityZoneRebalancing: 'ENABLED',
      // });
    });

    test("with autoscaling group capacity provider", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "Vpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      const autoScalingGroup = new autoscaling.AutoScalingGroup(stack, "asg", {
        vpc,
        instanceType: new InstanceType("bogus"),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      });

      // WHEN
      const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup,
        enableManagedTerminationProtection: false,
      });
      cluster.addAsgCapacityProvider(capacityProvider);

      const taskDefinition = new ecs.TaskDefinition(stack, "ServerTask", {
        compatibility: ecs.Compatibility.EC2,
      });
      taskDefinition.addContainer("app", {
        image: new ecs.RepositoryImage("bogus"),
        cpu: 1024,
        memoryReservationMiB: 900,
        portMappings: [{ containerPort: 80 }],
      });
      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        desiredCount: 0,
        capacityProviderStrategies: [
          { capacityProvider: capacityProvider.capacityProviderName },
        ],
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.capacity_provider_strategy).toEqual([
        {
          capacity_provider: stack.resolve(
            capacityProvider.capacityProviderName,
          ),
        },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   CapacityProviderStrategy: [{ CapacityProvider: {Ref:'providerD3FF4D3A'} }],
      // });
    });

    test("with multiple security groups, it correctly updates the cfn template", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      const securityGroup1 = new SecurityGroup(stack, "SecurityGroup1", {
        allowAllOutbound: true,
        description: "Example",
        securityGroupName: "Bingo",
        vpc,
      });
      const securityGroup2 = new SecurityGroup(stack, "SecurityGroup2", {
        allowAllOutbound: false,
        description: "Example",
        securityGroupName: "Rolly",
        vpc,
      });

      // WHEN
      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        desiredCount: 2,
        assignPublicIp: true,
        daemon: false,
        securityGroups: [securityGroup1, securityGroup2],
        serviceName: "bonjour",
        vpcSubnets: { subnetType: SubnetType.PUBLIC },
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.taskDefinitionArn),
      );
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.desired_count).toEqual(2);
      expect(resource.launch_type).toEqual(ecs.LaunchType.EC2);
      expect(resource.network_configuration).toMatchObject({
        assign_public_ip: true,
        security_groups: [
          stack.resolve(securityGroup1.securityGroupId),
          stack.resolve(securityGroup2.securityGroupId),
        ],
      });
      expect(resource.scheduling_strategy).toEqual("REPLICA");
      expect(resource.name).toEqual("bonjour");
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   TaskDefinition: {Ref:'Ec2TaskDef0226F28C'}, Cluster: {Ref:'EcsCluster97242B84'},
      //   DesiredCount: 2, LaunchType: LaunchType.EC2,
      //   NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED',
      //     SecurityGroups: [{'Fn::GetAtt':['SecurityGroup1F554B36F','GroupId']},{'Fn::GetAtt':['SecurityGroup23BE86BB7','GroupId']}],
      //     Subnets: [{Ref:'MyVpcPublicSubnet1SubnetF6608456'},{Ref:'MyVpcPublicSubnet2Subnet492B6BFB'}] } },
      //   SchedulingStrategy: 'REPLICA', ServiceName: 'bonjour',
      // });

      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "Example",
          name: "Bingo",
        },
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      //   GroupDescription: 'Example', GroupName: 'Bingo',
      //   SecurityGroupEgress: [{ CidrIp: '0.0.0.0/0', Description: 'Allow all outbound traffic by default', IpProtocol: '-1' }],
      //   VpcId: {Ref:'MyVpcF9F0CA6F'},
      // });

      // TERRACONSTRUCTS DEVIATION: (established by compute/security-group.ts, see
      // test/aws/compute/security-group.test.ts "new SecurityGroup rule will create an egress rule
      // that denies all traffic") -- upstream's CloudFormation-only "deny all traffic" default-egress
      // synthetic rule (SecurityGroupEgress icmp 252-86 to 255.255.255.255/32) has no Terraform
      // representation and is never emitted; `allowAllOutbound: false` simply omits any egress rule.
      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "Example",
          name: "Rolly",
        },
      );
      Template.resources(
        stack,
        vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      ).toHaveLength(0);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroup', {
      //   GroupDescription: 'Example', GroupName: 'Rolly',
      //   SecurityGroupEgress: [{ CidrIp: '255.255.255.255/32', Description: 'Disallow all traffic',
      //     FromPort: 252, IpProtocol: 'icmp', ToPort: 86 }],
      //   VpcId: {Ref:'MyVpcF9F0CA6F'},
      // });
    });

    test("throws when availability zone rebalancing is enabled and maxHealthyPercent is 100", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
          maxHealthyPercent: 100,
        });
      }).toThrow(/requires maxHealthyPercent > 100/);
    });

    test("throws when availability zone rebalancing is enabled and daemon is true", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
          daemon: true,
        });
      }).toThrow(/cannot be used with daemon mode/);
    });

    test("sets task definition to family when CODE_DEPLOY deployment controller is specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.CODE_DEPLOY,
        },
      });

      // THEN
      // base/base-service.ts strips the revision id and sets `resource.taskDefinition = family`
      // directly for CODE_DEPLOY, rather than the ARN -- there is no Terraform DependsOn-list
      // equivalent to assert (dependsOn propagates automatically via the stack aspect).
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.task_definition).toEqual(
        stack.resolve(taskDefinition.family),
      );
      expect(resource.deployment_controller).toEqual({
        type: "CODE_DEPLOY",
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResource('AWS::ECS::Service', {
      //   Properties: { TaskDefinition: 'Ec2TaskDef', DeploymentController: { Type: 'CODE_DEPLOY' } },
      //   DependsOn: ['Ec2TaskDef0226F28C', 'Ec2TaskDefTaskRole400FA349'],
      // });
    });

    // upstream: testDeprecated (deprecated `securityGroup` prop) -- this repo has no
    // deprecation-warning test harness (@aws-cdk/cdk-build-tools' testDeprecated), use plain test.
    test("throws when both securityGroup and securityGroups are supplied", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });
      const securityGroup1 = new SecurityGroup(stack, "SecurityGroup1", {
        allowAllOutbound: true,
        description: "Example",
        securityGroupName: "Bingo",
        vpc,
      });
      const securityGroup2 = new SecurityGroup(stack, "SecurityGroup2", {
        allowAllOutbound: false,
        description: "Example",
        securityGroupName: "Rolly",
        vpc,
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          desiredCount: 2,
          assignPublicIp: true,
          maxHealthyPercent: 150,
          minHealthyPercent: 55,
          securityGroup: securityGroup1,
          securityGroups: [securityGroup2],
          serviceName: "bonjour",
          vpcSubnets: { subnetType: SubnetType.PUBLIC },
        });
      }).toThrow(
        /Only one of SecurityGroup or SecurityGroups can be populated./,
      );
    });

    test("throws when task definition is not EC2 compatible", () => {
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.TaskDefinition(stack, "FargateTaskDef", {
        compatibility: ecs.Compatibility.FARGATE,
        cpu: "256",
        memoryMiB: "512",
      });
      taskDefinition.addContainer("BaseContainer", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryReservationMiB: 10,
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
        });
      }).toThrow(
        /Supplied TaskDefinition is not configured for compatibility with EC2/,
      );
    });

    test("ignore task definition and launch type if deployment controller is set to be EXTERNAL", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.EXTERNAL,
        },
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/Ec2Service",
        message:
          "taskDefinition and launchType are blanked out when using external deployment controller.",
      });
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.cluster).toEqual(stack.resolve(cluster.clusterName));
      expect(resource.deployment_maximum_percent).toEqual(200);
      expect(resource.deployment_minimum_healthy_percent).toEqual(50);
      expect(resource.scheduling_strategy).toEqual("REPLICA");
      expect(resource.enable_ecs_managed_tags).toEqual(false);
      // OLD CFN:
      // Annotations.fromStack(stack).hasWarning('/Default/Ec2Service', 'taskDefinition and launchType are blanked out when using external deployment controller. [ack: @aws-cdk/aws-ecs:externalDeploymentController]');
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   Cluster: {Ref:'EcsCluster97242B84'},
      //   DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 },
      //   SchedulingStrategy: 'REPLICA', EnableECSManagedTags: false,
      // });
    });

    test("add warning to annotations if circuitBreaker is specified with a non-ECS DeploymentControllerType", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.EXTERNAL,
        },
        circuitBreaker: { rollback: true },
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/Ec2Service",
        message:
          "taskDefinition and launchType are blanked out when using external deployment controller.",
      });
      Annotations.fromStack(stack).hasErrors({
        constructPath: "Default/Ec2Service",
        message:
          "Deployment circuit breaker requires the ECS deployment controller.",
      });
      // OLD CFN:
      // expect(service.node.metadata[0].data).toEqual('taskDefinition and launchType are blanked out when using external deployment controller. [ack: @aws-cdk/aws-ecs:externalDeploymentController]');
      // expect(service.node.metadata[1].data).toEqual('Deployment circuit breaker requires the ECS deployment controller.');
    });

    test("errors if daemon and desiredCount both specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      taskDefinition.addContainer("BaseContainer", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryReservationMiB: 10,
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          daemon: true,
          desiredCount: 2,
        });
      }).toThrow(/Don't supply desiredCount/);
    });

    test("errors if daemon and maximumPercent not 100", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      taskDefinition.addContainer("BaseContainer", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryReservationMiB: 10,
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          daemon: true,
          maxHealthyPercent: 300,
        });
      }).toThrow(/Maximum percent must be 100 for daemon mode./);
    });

    test("errors if minimum not less than maximum", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      taskDefinition.addContainer("BaseContainer", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryReservationMiB: 10,
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          daemon: true,
          minHealthyPercent: 100,
          maxHealthyPercent: 100,
        });
      }).toThrow(
        /Minimum healthy percent must be less than maximum healthy percent./,
      );
    });

    test("errors if no container definitions", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      // Errors on validation, not on construction.
      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).toThrow(/one essential container/);
    });

    test("allows adding the default container after creating the service", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      new ecs.Ec2Service(stack, "FargateService", {
        cluster,
        taskDefinition,
      });

      // Add the container *after* creating the service
      taskDefinition.addContainer("main", {
        image: ecs.ContainerImage.fromRegistry("somecontainer"),
        memoryReservationMiB: 10,
      });

      // THEN
      const resource = soleResource(stack, ecsTaskDefinition.EcsTaskDefinition);
      const containers = JSON.parse(resource.container_definitions);
      expect(containers).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "main" })]),
      );
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
      //   ContainerDefinitions: [Match.objectLike({ Name: 'main' })],
      // });
    });

    test("sets daemon scheduling strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.scheduling_strategy).toEqual("DAEMON");
      expect(resource.deployment_maximum_percent).toEqual(100);
      expect(resource.deployment_minimum_healthy_percent).toEqual(0);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   SchedulingStrategy: 'DAEMON',
      //   DeploymentConfiguration: { MaximumPercent: 100, MinimumHealthyPercent: 0 },
      // });
    });

    test("warning if minHealthyPercent not set", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/Ec2Service",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 50% is used./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasWarning('/Default/Ec2Service', 'minHealthyPercent has not been configured so the default value of 50% is used. The number of running tasks will decrease below the desired count during deployments etc. See https://github.com/aws/aws-cdk/issues/31705 [ack: @aws-cdk/aws-ecs:minHealthyPercent]');
    });

    test("no warning if minHealthyPercent set", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        minHealthyPercent: 50,
      });

      // THEN
      Annotations.fromStack(stack).hasNoWarnings({
        constructPath: "Default/Ec2Service",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 50% is used./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasNoWarning('/Default/Ec2Service', 'minHealthyPercent has not been configured so the default value of 50% is used. ...');
    });

    test("warning if minHealthyPercent not set for a daemon service", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "Default/Ec2Service",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 0% for a daemon service is used./,
        ),
      });
      Annotations.fromStack(stack).hasNoWarnings({
        constructPath: "Default/Ec2Service",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 50% is used./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasWarning('/Default/Ec2Service', 'minHealthyPercent has not been configured so the default value of 0% for a daemon service is used. See https://github.com/aws/aws-cdk/issues/31705 [ack: @aws-cdk/aws-ecs:minHealthyPercentDaemon]');
      // Annotations.fromStack(stack).hasNoWarning('/Default/Ec2Service', 'minHealthyPercent has not been configured so the default value of 50% is used. ...');
    });

    test("no warning if minHealthyPercent set for a daemon service", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        minHealthyPercent: 50,
        daemon: true,
      });

      // THEN
      Annotations.fromStack(stack).hasNoWarnings({
        constructPath: "Default/Ec2Service",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 0% for a daemon service is used./,
        ),
      });
      Annotations.fromStack(stack).hasNoWarnings({
        constructPath: "Default/Ec2Service",
        message: expect.stringMatching(
          /minHealthyPercent has not been configured so the default value of 50% is used./,
        ),
      });
      // OLD CFN:
      // Annotations.fromStack(stack).hasNoWarning('/Default/Ec2Service', 'minHealthyPercent has not been configured so the default value of 0% for a daemon service is used. ...');
      // Annotations.fromStack(stack).hasNoWarning('/Default/Ec2Service', 'minHealthyPercent has not been configured so the default value of 50% is used. ...');
    });

    describe("with a TaskDefinition with Bridge network mode", () => {
      test("it errors if vpcSubnets is specified", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.BRIDGE,
        });

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        // THEN
        // upstream's `expect(() => {...})` has no `.toThrow()` chained -- preserved verbatim
        // (this is a no-op assertion in the original CDK test too).
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            vpcSubnets: {
              subnetType: SubnetType.PUBLIC,
            },
          });
        });

        // THEN
      });

      test("it errors if assignPublicIp is true", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.BRIDGE,
        });

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        // THEN
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            assignPublicIp: true,
          });
        }).toThrow(
          /vpcSubnets, securityGroup\(s\) and assignPublicIp can only be used in AwsVpc networking mode/,
        );

        // THEN
      });

      test("it errors if vpc subnets is provided", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const subnet = new Subnet(stack, "MySubnet", {
          vpcId: vpc.vpcId,
          availabilityZone: "eu-central-1a",
          cidrBlock: "10.10.0.0/20",
        });
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.BRIDGE,
        });
        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        // THEN
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            vpcSubnets: {
              subnets: [subnet],
            },
          });
        }).toThrow(
          /vpcSubnets, securityGroup\(s\) and assignPublicIp can only be used in AwsVpc networking mode/,
        );

        // THEN
      });

      test("it errors if security group is provided", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const securityGroup = new SecurityGroup(stack, "MySG", { vpc });
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.BRIDGE,
        });
        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        // THEN
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            securityGroups: [securityGroup],
          });
        }).toThrow(
          /vpcSubnets, securityGroup\(s\) and assignPublicIp can only be used in AwsVpc networking mode/,
        );

        // THEN
      });

      test("it errors if multiple security groups is provided", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const securityGroups = [
          new SecurityGroup(stack, "MyFirstSG", { vpc }),
          new SecurityGroup(stack, "MySecondSG", { vpc }),
        ];
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.BRIDGE,
        });
        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        // THEN
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            securityGroups,
          });
        }).toThrow(
          /vpcSubnets, securityGroup\(s\) and assignPublicIp can only be used in AwsVpc networking mode/,
        );

        // THEN
      });
    });

    describe("with a TaskDefinition with AwsVpc network mode", () => {
      test("it creates a security group for the service", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.AWS_VPC,
        });

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
        });

        // THEN
        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.network_configuration).toMatchObject({
          assign_public_ip: false,
          subnets: stack.resolve(vpc.privateSubnets.map((s) => s.subnetId)),
        });
        expect(resource.network_configuration.security_groups).toHaveLength(1);
        // NOTE: `addDefaultCapacityProvider()` (see `test/aws/compute/ecs/util.ts`) creates
        // its own `AutoScalingGroup`, which -- since no `securityGroup` was passed -- creates
        // its own default instance security group in addition to the service's own awsvpc
        // security group asserted above. Two distinct security groups is therefore correct.
        Template.resources(stack, tfSecurityGroup.SecurityGroup).toHaveLength(
          2,
        );
        // OLD CFN:
        // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
        //   NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'DISABLED',
        //     SecurityGroups: [{'Fn::GetAtt':['Ec2ServiceSecurityGroupAEC30825','GroupId']}],
        //     Subnets: [{Ref:'MyVpcPrivateSubnet1Subnet5057CF7E'},{Ref:'MyVpcPrivateSubnet2Subnet0040C983'}] } },
        // });
      });

      test("it allows vpcSubnets", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.AWS_VPC,
        });

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });

        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          vpcSubnets: {
            subnetType: SubnetType.PUBLIC,
          },
        });

        // THEN
      });
    });

    test("with distinctInstance placement constraint", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        placementConstraints: [ecs.PlacementConstraint.distinctInstances()],
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.placement_constraints).toEqual([
        { type: "distinctInstance" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementConstraints: [{ Type: 'distinctInstance' }],
      // });
    });

    test("with memberOf placement constraints", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      service.addPlacementConstraints(
        ecs.PlacementConstraint.memberOf("attribute:ecs.instance-type =~ t2.*"),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.placement_constraints).toEqual([
        { expression: "attribute:ecs.instance-type =~ t2.*", type: "memberOf" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementConstraints: [{ Expression: 'attribute:ecs.instance-type =~ t2.*', Type: 'memberOf' }],
      // });
    });

    test("throws with AvailabilityZoneBalancing.ENABLED and placement constraint uses memberOf attribute:ecs.availability-zone", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      // THEN
      expect(() => {
        service.addPlacementConstraints(
          ecs.PlacementConstraint.memberOf(
            `${ecs.BuiltInAttributes.AVAILABILITY_ZONE} =~ us-east-1a`,
          ),
        );
      }).toThrow(
        /AvailabilityZoneBalancing.ENABLED disallows usage of "attribute:ecs.availability-zone"/,
      );
    });

    test("does not throw with AvailabilityZoneBalancing.ENABLED and placement constraints that don't use memberOf attribute:ecs.availability-zone", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      // WHEN
      service.addPlacementConstraints(
        ecs.PlacementConstraint.memberOf("attribute:ecs.instance-type =~ t2.*"),
      );

      // THEN
      // did not throw
    });

    test("with spreadAcross container instances strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      service.addPlacementStrategies(
        ecs.PlacementStrategy.spreadAcrossInstances(),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toEqual([
        { field: "instanceId", type: "spread" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: [{ Field: 'instanceId', Type: 'spread' }],
      // });
    });

    test("with spreadAcross placement strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      service.addPlacementStrategies(
        ecs.PlacementStrategy.spreadAcross(
          ecs.BuiltInAttributes.AVAILABILITY_ZONE,
        ),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toEqual([
        { field: "attribute:ecs.availability-zone", type: "spread" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: [{ Field: 'attribute:ecs.availability-zone', Type: 'spread' }],
      // });
    });

    test("throws with AvailabilityZoneBalancing.ENABLED and first placement strategy is not spread-across-AZ", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      // THEN
      expect(() => {
        service.addPlacementStrategies(
          ecs.PlacementStrategy.spreadAcrossInstances(),
        );
      }).toThrow(
        /requires that the first placement strategy, if any, be 'spread across "attribute:ecs.availability-zone"'/,
      );
    });

    test("does not throw with AvailabilityZoneBalancing.ENABLED and first placement strategy is spread-across-AZ", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      // WHEN
      service.addPlacementStrategies(
        ecs.PlacementStrategy.spreadAcross(
          ecs.BuiltInAttributes.AVAILABILITY_ZONE,
        ),
      );
      service.addPlacementStrategies(
        ecs.PlacementStrategy.spreadAcrossInstances(),
      );

      // THEN
      // did not throw
    });

    test("can turn PlacementStrategy into json format", () => {
      // THEN
      expect(
        ecs.PlacementStrategy.spreadAcross(
          ecs.BuiltInAttributes.AVAILABILITY_ZONE,
        ).toJson(),
      ).toEqual([{ type: "spread", field: "attribute:ecs.availability-zone" }]);
    });

    test("can turn PlacementConstraints into json format", () => {
      // THEN
      expect(ecs.PlacementConstraint.distinctInstances().toJson()).toEqual([
        { type: "distinctInstance" },
      ]);
    });

    test("errors when spreadAcross with no input", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      expect(() => {
        service.addPlacementStrategies(ecs.PlacementStrategy.spreadAcross());
      }).toThrow("spreadAcross: give at least one field to spread by");
    });

    test("errors with spreadAcross placement strategy if daemon specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      // THEN
      expect(() => {
        service.addPlacementStrategies(
          ecs.PlacementStrategy.spreadAcross(
            ecs.BuiltInAttributes.AVAILABILITY_ZONE,
          ),
        );
      });
    });

    test("with no placement constraints", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.placement_constraints).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementConstraints: Match.absent(),
      // });
    });

    // TERRACONSTRUCTS DEVIATION: upstream's `ec2-service.ts` calls `Lazy.any({produce:...})` (no
    // `omitEmptyArray` option) for `placementConstraints`/`placementStrategies`, so an explicit `[]`
    // renders as an actual empty array in the CFN template. This repo's `ec2/ec2-service.ts` passes
    // `Lazy.anyValue({produce:...}, {omitEmptyArray: true})`, which -- per cdktn's `LazyAny.resolve()`
    // -- omits the property entirely whenever the produced array is empty, regardless of whether it
    // started `undefined` or was explicitly set to `[]`. An explicit empty array is therefore
    // indistinguishable from "not set" in the synthesized `aws_ecs_service` resource.
    test("with empty [] placement constraints", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        placementConstraints: [],
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.placement_constraints).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementConstraints: Match.arrayEquals([]),
      // });
    });

    // TERRACONSTRUCTS DEVIATION: see note above `with empty [] placement constraints`.
    test("with empty [] placement strategies", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        placementStrategies: [],
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: Match.arrayEquals([]),
      // });
    });

    // upstream: testDeprecated (deprecated `propagateTaskTagsFrom` prop) -- no deprecation-warning
    // test harness in this repo, use plain test.
    test("with both propagateTags and propagateTaskTagsFrom defined", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      expect(() => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          propagateTags: ecs.PropagatedTagSource.SERVICE,
          propagateTaskTagsFrom: ecs.PropagatedTagSource.SERVICE,
        });
      }).toThrow(
        /You can only specify either propagateTags or propagateTaskTagsFrom. Alternatively, you can leave both blank/,
      );
    });

    test("with no placement strategy if daemon specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toBeUndefined();
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: Match.absent(),
      // });
    });

    test("with random placement strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      service.addPlacementStrategies(ecs.PlacementStrategy.randomly());

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toEqual([{ type: "random" }]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: [{ Type: 'random' }],
      // });
    });

    test("errors with random placement strategy if daemon specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      // THEN
      expect(() => {
        service.addPlacementStrategies(ecs.PlacementStrategy.randomly());
      }).toThrow();
    });

    test("with packedbyCpu placement strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      service.addPlacementStrategies(ecs.PlacementStrategy.packedByCpu());

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toEqual([
        { field: "CPU", type: "binpack" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: [{ Field: 'CPU', Type: 'binpack' }],
      // });
    });

    test("with packedbyMemory placement strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      service.addPlacementStrategies(ecs.PlacementStrategy.packedByMemory());

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toEqual([
        { field: "MEMORY", type: "binpack" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: [{ Field: 'MEMORY', Type: 'binpack' }],
      // });
    });

    test("with packedBy placement strategy", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      service.addPlacementStrategies(
        ecs.PlacementStrategy.packedBy(ecs.BinPackResource.MEMORY),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.ordered_placement_strategy).toEqual([
        { field: "MEMORY", type: "binpack" },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   PlacementStrategies: [{ Field: 'MEMORY', Type: 'binpack' }],
      // });
    });

    test("errors with packedBy placement strategy if daemon specified", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      // THEN
      expect(() => {
        service.addPlacementStrategies(
          ecs.PlacementStrategy.packedBy(ecs.BinPackResource.MEMORY),
        );
      }).toThrow();
    });

    test("throws an exception if non-DAEMON service is added but no EC2 capacity is associated with the cluster", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).toThrow(/Cluster for this service needs Ec2 capacity/);
    });

    test("does not throw an exception if DAEMON service is added but no EC2 capacity is associated with the cluster", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
        daemon: true,
      });

      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).not.toThrow();
    });

    describe("with deployment alarms", () => {
      let stack: AwsStack;
      let cluster: ecs.Cluster;
      let taskDefinition: ecs.TaskDefinition;

      beforeEach(() => {
        stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

        taskDefinition.addContainer("web", {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
          memoryLimitMiB: 512,
        });
      });

      test("minimum configuration", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );

        new ecs.Ec2Service(stack, "Ec2Service", {
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

      test("and explicitly set behavior to ROLLBACK_ON_ALARM", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );

        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          deploymentAlarms: {
            alarmNames: [myAlarm.alarmName],
            behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
          },
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.alarms).toEqual({
          enable: true,
          rollback: true,
          alarm_names: [myAlarm.alarmName],
        });
      });

      test("and explicitly set behavior to FAIL_ON_ALARM", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          deploymentAlarms: {
            alarmNames: [myAlarm.alarmName],
            behavior: ecs.AlarmBehavior.FAIL_ON_ALARM,
          },
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.alarms).toEqual({
          enable: true,
          rollback: false,
          alarm_names: [myAlarm.alarmName],
        });
      });

      test("use enableDeploymentAlarms()", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );

        const service = new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
        });
        service.enableDeploymentAlarms([myAlarm.alarmName]);

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.alarms).toEqual({
          enable: true,
          rollback: true,
          alarm_names: [myAlarm.alarmName],
        });
      });

      test("use enableDeploymentAlarms() and explicitly set behavior to ROLLBACK_ON_ALARM", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );

        const service = new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
        });
        service.enableDeploymentAlarms([myAlarm.alarmName], {
          behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.alarms).toEqual({
          enable: true,
          rollback: true,
          alarm_names: [myAlarm.alarmName],
        });
      });

      test("use enableDeploymentAlarms() and explicitly set behavior to FAIL_ON_ALARM", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );
        const service = new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
        });
        service.enableDeploymentAlarms([myAlarm.alarmName], {
          behavior: ecs.AlarmBehavior.FAIL_ON_ALARM,
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.alarms).toEqual({
          enable: true,
          rollback: false,
          alarm_names: [myAlarm.alarmName],
        });
      });

      test("throw error if deploymentAlarms is specified with a non-ECS DeploymentControllerType", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            deploymentController: {
              type: ecs.DeploymentControllerType.EXTERNAL,
            },
            deploymentAlarms: {
              alarmNames: [myAlarm.alarmName],
            },
          });
        }).toThrow("Deployment alarms requires the ECS deployment controller.");
      });

      test("mixing alarm behaviors throws errors", () => {
        const myAlarm = cloudwatch.Alarm.fromAlarmArn(
          stack,
          "myAlarm",
          "arn:aws:cloudwatch:us-east-1:1234567890:alarm:alarm1",
        );
        const service = new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
          deploymentAlarms: {
            alarmNames: [myAlarm.alarmName],
            behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
          },
        });
        expect(() => {
          service.enableDeploymentAlarms([myAlarm.alarmName], {
            behavior: ecs.AlarmBehavior.FAIL_ON_ALARM,
          });
        }).toThrow(
          "all deployment alarms on an ECS service must have the same AlarmBehavior. Attempted to enable deployment alarms with FAIL_ON_ALARM, but alarms were previously enabled with ROLLBACK_ON_ALARM",
        );
        const anotherService = new ecs.Ec2Service(stack, "Ec2Service2", {
          cluster,
          taskDefinition,
          deploymentAlarms: {
            alarmNames: [myAlarm.alarmName],
            behavior: ecs.AlarmBehavior.FAIL_ON_ALARM,
          },
        });
        expect(() => {
          anotherService.enableDeploymentAlarms([myAlarm.alarmName], {
            behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
          });
        }).toThrow(
          "all deployment alarms on an ECS service must have the same AlarmBehavior. Attempted to enable deployment alarms with ROLLBACK_ON_ALARM, but alarms were previously enabled with FAIL_ON_ALARM",
        );
      });

      test("empty array of alarm names is not allowed", () => {
        expect(() => {
          new ecs.Ec2Service(stack, "Ec2Service", {
            cluster,
            taskDefinition,
            deploymentAlarms: {
              alarmNames: [],
            },
          });
        }).toThrow(
          "at least one alarm name is required when specifying deploymentAlarms, received empty array",
        );

        const service = new ecs.Ec2Service(stack, "AnotherEc2Service", {
          cluster,
          taskDefinition,
        });
        expect(() => service.enableDeploymentAlarms([])).toThrow(
          "at least one alarm name is required when calling enableDeploymentAlarms(), received empty array",
        );
      });

      test("no deployment alarms configured", () => {
        new ecs.Ec2Service(stack, "Ec2Service", {
          cluster,
          taskDefinition,
        });

        const resource = soleResource(stack, ecsService.EcsService);
        expect(resource.alarms).toBeUndefined();
        // OLD CFN:
        // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
        //   DeploymentConfiguration: { Alarms: { Enable: false, Rollback: false, AlarmNames: [] } },
        // });
      });

      // TERRACONSTRUCTS DEVIATION: (established by test/aws/compute/ecs/base-service.test.ts's "For
      // alarm-based rollbacks" describe) upstream's `@aws-cdk/aws-ecs:removeDefaultDeploymentAlarm`
      // feature flag is not ported -- `alarms` is only ever set when `props.deploymentAlarms` is
      // explicitly provided, in every partition. The two upstream tests below assert the dropped
      // legacy "default (disabled, empty-alarm-list) deploymentAlarms in commercial partitions only"
      // behavior, which no longer differs by partition (see "no deployment alarms configured" above,
      // which now covers every partition identically). Omitted in full:
      //
      // test('no deployment alarms configured in gov cloud', ...)
      // test('no deployment alarms in isolated partitions', ...)

      /**
       * This section of tests test all combinations of the following possible
       * alarm names and metrics. Most combinations work just fine, some
       * combinations could cause a circular dependency and will have an info
       * annotation for the user.
       * NAME:
       *   - name is undefined, so it is a token referencing its own logical id
       *   - contains a token referencing the service
       *   - contains a token referencing another resource
       *   - hardcoded
       * METRIC:
       *   - contains a token referencing the service
       *   - contains a token referencing another resource
       *   - hardcoded
       *
       * The tests might seem repetitive because the implementation is not fully
       * able to detect the alarm <-> service circular dependency. Keeping these
       * tests in place to make it easier to validate a future implementation that
       * does have proper errors for the alarm <-> service cycle.
       */
      describe("circular dependency tests", () => {
        let service: ecs.Ec2Service;
        function infoMessage(alarmName: string, serviceId: string): string {
          return `Deployment alarm (${alarmName}) enabled on ${serviceId} may cause a circular dependency error when this stack deploys. The alarm name references the alarm's logical id, or another resource. See the 'Deployment alarms' section in the module README for more details.`;
        }
        beforeEach(() => {
          service = new ecs.Ec2Service(stack, "EC2Service", {
            cluster,
            taskDefinition,
          });
        });
        test("alarm name is undefined and alarm metric references service", () => {
          // This configuration will fail deployment
          const metric = service.metricCpuUtilization();
          const alarm = new cloudwatch.Alarm(stack, "MyAlarm", {
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarm.alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarm.alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name is undefined and alarm metric references other resource", () => {
          // This will succeed deployment, but we still have an info message because we can't tell it apart from scenarios that will fail deployment
          const metric = cluster.metricMemoryUtilization();
          const alarm = new cloudwatch.Alarm(stack, "MyAlarm", {
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarm.alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarm.alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name is undefined and alarm metric is hardcoded", () => {
          // This will succeed deployment, but we still have an info message because we can't tell it apart from scenarios that will fail deployment
          const metric = new cloudwatch.Metric({
            namespace: "AWS/ECS",
            metricName: "CustomMetric",
          });
          const alarm = new cloudwatch.Alarm(stack, "MyAlarm", {
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarm.alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarm.alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name references the service", () => {
          // This configuration will fail deployment
          const alarmName = `${service.serviceName}Alarm`;
          const metric = new cloudwatch.Metric({
            namespace: "CustomNamespace",
            metricName: "CustomMetric",
          });
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name references other resource and alarm metric references service", () => {
          // This will succeed deployment, but we still have an info message because we can't tell it apart from scenarios that will fail deployment
          const alarmName = `${cluster.clusterName}ServiceCpuAlarm`;
          const metric = service.metricCpuUtilization();
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name and metric reference other resource", () => {
          // This will succeed deployment, but we still have an info message because we can't tell it apart from scenarios that will fail deployment
          const alarmName = `${cluster.clusterName}Alarm`;
          const metric = cluster.metricMemoryUtilization();
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name references other resource and alarm metric is hardcoded", () => {
          // This will succeed deployment, but we still have an info message because we can't tell it apart from scenarios that will fail deployment
          const alarmName = `${cluster.clusterName}Alarm`;
          const metric = new cloudwatch.Metric({
            namespace: "CustomNamespace",
            metricName: "CustomMetric",
          });
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasInfo({
            constructPath: "Default/EC2Service",
            message: infoMessage(
              JSON.stringify(stack.resolve(alarmName)),
              service.node.id,
            ),
          });
        });
        test("alarm name is hardcoded and alarm metric references service", () => {
          // This will succeed deployment, and we know this during synthesis, so there is no info Annotation about circular dependency errors
          const alarmName = "MyAlarm";
          const metric = service.metricCpuUtilization();
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasNoInfo({
            constructPath: "Default/EC2Service",
            message: /circular dependency error/,
          });
        });
        test("alarm name is hardcoded and alarm metric references other resource", () => {
          // This will succeed deployment, and we know this during synthesis, so there is no info Annotation about circular dependency errors
          const alarmName = "MyAlarm";
          const metric = cluster.metricMemoryUtilization();
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasNoInfo({
            constructPath: "Default/EC2Service",
            message: /circular dependency error/,
          });
        });
        test("alarm name and metric are hardcoded", () => {
          // This will succeed deployment, and we know this during synthesis, so there is no info Annotation about circular dependency errors
          const alarmName = "MyAlarm";
          const metric = new cloudwatch.Metric({
            namespace: "CustomNamespace",
            metricName: "CustomMetric",
          });
          new cloudwatch.Alarm(stack, "MyAlarm", {
            alarmName,
            metric,
            evaluationPeriods: 5,
            threshold: 2,
          });
          service.enableDeploymentAlarms([alarmName]);
          Annotations.fromStack(stack).hasNoInfo({
            constructPath: "Default/EC2Service",
            message: /circular dependency error/,
          });
        });
      });
    });
  });

  describe("attachToClassicLB", () => {
    test("allows network mode of task definition to be host", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "VPC");
      const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TD", {
        networkMode: ecs.NetworkMode.HOST,
      });
      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryLimitMiB: 1024,
      });
      container.addPortMappings({ containerPort: 808 });
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      const lb = new LoadBalancer(stack, "LB", { vpc });
      service.attachToClassicLB(lb);
    });

    test("allows network mode of task definition to be bridge", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "VPC");
      const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TD", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });
      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryLimitMiB: 1024,
      });
      container.addPortMappings({ containerPort: 808 });
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      const lb = new LoadBalancer(stack, "LB", { vpc });
      service.attachToClassicLB(lb);
    });

    test("throws when network mode of task definition is AwsVpc", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "VPC");
      const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TD", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryLimitMiB: 1024,
      });
      container.addPortMappings({ containerPort: 808 });
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      const lb = new LoadBalancer(stack, "LB", { vpc });
      expect(() => {
        service.attachToClassicLB(lb);
      }).toThrow(
        /Cannot use a Classic Load Balancer if NetworkMode is AwsVpc. Use Host or Bridge instead./,
      );
    });

    test("throws when network mode of task definition is none", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "VPC");
      const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TD", {
        networkMode: ecs.NetworkMode.NONE,
      });
      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryLimitMiB: 1024,
      });
      container.addPortMappings({ containerPort: 808 });
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      const lb = new LoadBalancer(stack, "LB", { vpc });
      expect(() => {
        service.attachToClassicLB(lb);
      }).toThrow(
        /Cannot use a Classic Load Balancer if NetworkMode is None. Use Host or Bridge instead./,
      );
    });

    test("throws when AvailabilityZoneRebalancing.ENABLED", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
      });

      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      });

      const lb = new LoadBalancer(stack, "LB", { vpc });

      // THEN
      expect(() => {
        lb.addTarget(service);
      }).toThrow(
        "AvailabilityZoneRebalancing.ENABLED disallows using the service as a target of a Classic Load Balancer",
      );
    });
  });

  describe("attachToApplicationTargetGroup", () => {
    test("allows network mode of task definition to be other than none", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
      });

      // THEN
      service.attachToApplicationTargetGroup(targetGroup);
    });

    test("throws when network mode of task definition is none", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.NONE,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
      });

      // THEN
      expect(() => {
        service.attachToApplicationTargetGroup(targetGroup);
      }).toThrow(
        /Cannot use a load balancer if NetworkMode is None. Use Bridge, Host or AwsVpc instead./,
      );
    });

    test("throws when the first port mapping added to the container does not expose a single port", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({
        containerPort: ecs.ContainerDefinition.CONTAINER_PORT_USE_RANGE,
        containerPortRange: "8000-8001",
      });

      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
      });

      // THEN
      expect(() => {
        service.attachToApplicationTargetGroup(targetGroup);
      }).toThrow(
        /The first port mapping of the container MainContainer must expose a single port./,
      );
    });

    describe("correctly setting ingress and egress port", () => {
      test("with bridge/NAT network mode and 0 host port", () => {
        [ecs.NetworkMode.BRIDGE, ecs.NetworkMode.NAT].forEach(
          (networkMode: ecs.NetworkMode) => {
            // GIVEN
            const stack = new AwsStack();
            const vpc = new Vpc(stack, "MyVpc", {});
            const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
            addDefaultCapacityProvider(cluster, stack, vpc);
            cluster.connections.addSecurityGroup();
            const taskDefinition = new ecs.Ec2TaskDefinition(
              stack,
              "Ec2TaskDef",
              {
                networkMode,
              },
            );
            const container = taskDefinition.addContainer("MainContainer", {
              image: ecs.ContainerImage.fromRegistry("hello"),
              memoryLimitMiB: 512,
            });
            container.addPortMappings({ containerPort: 8000 });
            container.addPortMappings({ containerPort: 8001 });

            const service = new ecs.Ec2Service(stack, "Service", {
              cluster,
              taskDefinition,
            });

            // WHEN
            const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
            const listener = lb.addListener("listener", { port: 80 });
            listener.addTargets("target", {
              port: 80,
              targets: [
                service.loadBalancerTarget({
                  containerName: "MainContainer",
                  containerPort: 8001,
                }),
              ],
            });

            // THEN
            Template.synth(stack).toHaveResourceWithProperties(
              vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
              {
                description: "Load balancer to target",
                from_port: 32768,
                to_port: 65535,
              },
            );
            Template.synth(stack).toHaveResourceWithProperties(
              vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
              {
                description: "Load balancer to target",
                from_port: 32768,
                to_port: 65535,
              },
            );
            // OLD CFN:
            // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
            //   Description: 'Load balancer to target', FromPort: 32768, ToPort: 65535 });
            // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
            //   Description: 'Load balancer to target', FromPort: 32768, ToPort: 65535 });
          },
        );
      });

      test("with bridge/NAT network mode and host port other than 0", () => {
        [ecs.NetworkMode.BRIDGE, ecs.NetworkMode.NAT].forEach(
          (networkMode: ecs.NetworkMode) => {
            // GIVEN
            const stack = new AwsStack();
            const vpc = new Vpc(stack, "MyVpc", {});
            const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
            addDefaultCapacityProvider(cluster, stack, vpc);
            const taskDefinition = new ecs.Ec2TaskDefinition(
              stack,
              "Ec2TaskDef",
              {
                networkMode,
              },
            );
            const container = taskDefinition.addContainer("MainContainer", {
              image: ecs.ContainerImage.fromRegistry("hello"),
              memoryLimitMiB: 512,
            });
            container.addPortMappings({ containerPort: 8000 });
            container.addPortMappings({ containerPort: 8001, hostPort: 80 });

            const service = new ecs.Ec2Service(stack, "Service", {
              cluster,
              taskDefinition,
            });

            // WHEN
            const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
            const listener = lb.addListener("listener", { port: 80 });
            listener.addTargets("target", {
              port: 80,
              targets: [
                service.loadBalancerTarget({
                  containerName: "MainContainer",
                  containerPort: 8001,
                }),
              ],
            });

            // THEN
            Template.synth(stack).toHaveResourceWithProperties(
              vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
              {
                description: "Load balancer to target",
                from_port: 80,
                to_port: 80,
              },
            );
            Template.synth(stack).toHaveResourceWithProperties(
              vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
              {
                description: "Load balancer to target",
                from_port: 80,
                to_port: 80,
              },
            );
            // OLD CFN:
            // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
            //   Description: 'Load balancer to target', FromPort: 80, ToPort: 80 });
            // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
            //   Description: 'Load balancer to target', FromPort: 80, ToPort: 80 });
          },
        );
      });

      test("with host network mode", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.HOST,
        });
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
          memoryLimitMiB: 512,
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({ containerPort: 8001 });

        const service = new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });
        listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
              containerPort: 8001,
            }),
          ],
        });

        // THEN
        Template.synth(stack).toHaveResourceWithProperties(
          vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
          {
            description: "Load balancer to target",
            from_port: 8001,
            to_port: 8001,
          },
        );
        Template.synth(stack).toHaveResourceWithProperties(
          vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
          {
            description: "Load balancer to target",
            from_port: 8001,
            to_port: 8001,
          },
        );
        // OLD CFN:
        // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        //   Description: 'Load balancer to target', FromPort: 8001, ToPort: 8001 });
        // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
        //   Description: 'Load balancer to target', FromPort: 8001, ToPort: 8001 });
      });

      test("with aws_vpc network mode", () => {
        // GIVEN
        const stack = new AwsStack();
        const vpc = new Vpc(stack, "MyVpc", {});
        const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
        addDefaultCapacityProvider(cluster, stack, vpc);
        const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
          networkMode: ecs.NetworkMode.AWS_VPC,
        });
        const container = taskDefinition.addContainer("MainContainer", {
          image: ecs.ContainerImage.fromRegistry("hello"),
          memoryLimitMiB: 512,
        });
        container.addPortMappings({ containerPort: 8000 });
        container.addPortMappings({ containerPort: 8001 });

        const service = new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
        });

        // WHEN
        const lb = new ApplicationLoadBalancer(stack, "lb", { vpc });
        const listener = lb.addListener("listener", { port: 80 });
        listener.addTargets("target", {
          port: 80,
          targets: [
            service.loadBalancerTarget({
              containerName: "MainContainer",
              containerPort: 8001,
            }),
          ],
        });

        // THEN
        Template.synth(stack).toHaveResourceWithProperties(
          vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
          {
            description: "Load balancer to target",
            from_port: 8001,
            to_port: 8001,
          },
        );
        Template.synth(stack).toHaveResourceWithProperties(
          vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
          {
            description: "Load balancer to target",
            from_port: 8001,
            to_port: 8001,
          },
        );
        // OLD CFN:
        // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
        //   Description: 'Load balancer to target', FromPort: 8001, ToPort: 8001 });
        // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
        //   Description: 'Load balancer to target', FromPort: 8001, ToPort: 8001 });
      });
    });
  });

  describe("attachToNetworkTargetGroup", () => {
    test("allows network mode of task definition to be other than none", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new NetworkLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
      });

      // THEN
      service.attachToNetworkTargetGroup(targetGroup);
    });

    test("throws when network mode of task definition is none", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.NONE,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({ containerPort: 8000 });

      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new NetworkLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
      });

      // THEN
      expect(() => {
        service.attachToNetworkTargetGroup(targetGroup);
      }).toThrow(
        /Cannot use a load balancer if NetworkMode is None. Use Bridge, Host or AwsVpc instead./,
      );
    });

    test("throws when the first port mapping added to the container does not expose a single port", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
      });
      container.addPortMappings({
        containerPort: ecs.ContainerDefinition.CONTAINER_PORT_USE_RANGE,
        containerPortRange: "8000-8001",
      });

      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      const lb = new NetworkLoadBalancer(stack, "lb", { vpc });
      const listener = lb.addListener("listener", { port: 80 });
      const targetGroup = listener.addTargets("target", {
        port: 80,
      });

      // THEN
      expect(() => {
        service.attachToNetworkTargetGroup(targetGroup);
      }).toThrow(
        /The first port mapping of the container MainContainer must expose a single port./,
      );
    });
  });

  describe("classic ELB", () => {
    test("can attach to classic ELB", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "VPC");
      const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TD", {
        networkMode: ecs.NetworkMode.HOST,
      });
      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryLimitMiB: 1024,
      });
      container.addPortMappings({ containerPort: 808 });
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const lb = new LoadBalancer(stack, "LB", { vpc });
      lb.addTarget(service);

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.load_balancer).toEqual([
        {
          container_name: "web",
          container_port: 808,
          elb_name: stack.resolve(lb.loadBalancerName),
        },
      ]);
      // if any load balancer is configured and healthCheckGracePeriodSeconds is not
      // set, then it should default to 60 seconds.
      expect(resource.health_check_grace_period_seconds).toEqual(60);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   LoadBalancers: [{ ContainerName: 'web', ContainerPort: 808, LoadBalancerName: {Ref:'LB8A12904C'} }],
      // });
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   HealthCheckGracePeriodSeconds: 60,
      // });
    });

    test("can attach any container and port as a target", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "VPC");
      const cluster = new ecs.Cluster(stack, "Cluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TD", {
        networkMode: ecs.NetworkMode.HOST,
      });
      const container = taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("test"),
        memoryLimitMiB: 1024,
      });
      container.addPortMappings({ containerPort: 808 });
      container.addPortMappings({ containerPort: 8080 });
      const service = new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
      });

      // WHEN
      const lb = new LoadBalancer(stack, "LB", { vpc });
      lb.addTarget(
        service.loadBalancerTarget({
          containerName: "web",
          containerPort: 8080,
        }),
      );

      // THEN
      const resource = soleResource(stack, ecsService.EcsService);
      expect(resource.load_balancer).toEqual([
        {
          container_name: "web",
          container_port: 8080,
          elb_name: stack.resolve(lb.loadBalancerName),
        },
      ]);
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   LoadBalancers: [{ ContainerName: 'web', ContainerPort: 8080, LoadBalancerName: {Ref:'LB8A12904C'} }],
      // });
    });
  });

  describe("When enabling service discovery", () => {
    test("throws if namespace has not been added to cluster", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      // default network mode is bridge
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Service", {
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

    test("fails to enable Service Discovery with HTTP defaultCloudmapNamespace", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.NONE,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.HTTP,
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
          cloudMapOptions: {
            name: "myApp",
          },
        });
      }).toThrow(
        /Cannot enable DNS service discovery for HTTP Cloudmap Namespace./,
      );
    });

    test("throws if network mode is none", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.NONE,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      cluster.addDefaultCloudMapNamespace({ name: "foo.com" });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
          cloudMapOptions: {
            name: "myApp",
          },
        });
      }).toThrow(
        /Cannot use a service discovery if NetworkMode is None. Use Bridge, Host or AwsVpc instead./,
      );
    });

    test("creates AWS Cloud Map service for Private DNS namespace with bridge network mode", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      // default network mode is bridge
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
        },
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "MainContainer",
        container_port: 8000,
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [{ ContainerName: 'MainContainer', ContainerPort: 8000,
      //     RegistryArn: {'Fn::GetAtt':['ServiceCloudmapService046058A4','Arn']} }],
      // });

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
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::Service', {
      //   DnsConfig: { DnsRecords: [{TTL:60,Type:'SRV'}], NamespaceId: {'Fn::GetAtt':[...]}, RoutingPolicy: 'MULTIVALUE' },
      //   HealthCheckCustomConfig: { FailureThreshold: 1 },
      //   Name: 'myApp', NamespaceId: {'Fn::GetAtt':['EcsClusterDefaultServiceDiscoveryNamespaceB0971B2F','Id']},
      // });
    });

    test("creates AWS Cloud Map service for Private DNS namespace with host network mode", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.HOST,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
        },
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "MainContainer",
        container_port: 8000,
      });

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

    test("throws if wrong DNS record type specified with bridge network mode", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      // default network mode is bridge
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
      });

      // THEN
      expect(() => {
        new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
          cloudMapOptions: {
            name: "myApp",
            dnsRecordType: edge.cloudmap.DnsRecordType.A,
          },
        });
      }).toThrow(
        /SRV records must be used when network mode is Bridge or Host./,
      );
    });

    test("creates AWS Cloud Map service for Private DNS namespace with AwsVpc network mode", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.Ec2Service(stack, "Service", {
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
      expect(sdService.dns_config).toMatchObject({
        dns_records: [{ ttl: 60, type: "A" }],
        routing_policy: "MULTIVALUE",
      });
      expect(sdService.health_check_custom_config).toEqual({
        failure_threshold: 1,
      });
      expect(sdService.name).toEqual("myApp");
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [{ RegistryArn: {'Fn::GetAtt':['ServiceCloudmapService046058A4','Arn']} }],
      // });
    });

    test("creates AWS Cloud Map service for Private DNS namespace with AwsVpc network mode with SRV records", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });
      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });
      container.addPortMappings({ containerPort: 8000 });

      // WHEN
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });

      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          name: "myApp",
          dnsRecordType: edge.cloudmap.DnsRecordType.SRV,
        },
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "MainContainer",
        container_port: 8000,
      });

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

    test("user can select any container and port", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(
        stack,
        "FargateTaskDef",
        {
          networkMode: ecs.NetworkMode.BRIDGE,
        },
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

      // WHEN
      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          dnsRecordType: edge.cloudmap.DnsRecordType.SRV,
          container: otherContainer,
          containerPort: 8001,
        },
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "OtherContainer",
        container_port: 8001,
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [{ RegistryArn: {'Fn::GetAtt':[...]}, ContainerName: 'OtherContainer', ContainerPort: 8001 }],
      // });
    });

    test("By default, the container name is the default", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Task", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });

      taskDefinition
        .addContainer("main", {
          image: ecs.ContainerImage.fromRegistry("some"),
          memoryLimitMiB: 512,
        })
        .addPortMappings({ containerPort: 1234 });

      taskDefinition
        .addContainer("second", {
          image: ecs.ContainerImage.fromRegistry("some"),
          memoryLimitMiB: 512,
        })
        .addPortMappings({ containerPort: 4321 });

      // WHEN
      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {},
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "main",
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [Match.objectLike({ ContainerName: 'main', ContainerPort: Match.anyValue() })],
      // });
    });

    test("For SRV, by default, container name is default container and port is the default container port", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Task", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });

      taskDefinition
        .addContainer("main", {
          image: ecs.ContainerImage.fromRegistry("some"),
          memoryLimitMiB: 512,
        })
        .addPortMappings({ containerPort: 1234 });

      taskDefinition
        .addContainer("second", {
          image: ecs.ContainerImage.fromRegistry("some"),
          memoryLimitMiB: 512,
        })
        .addPortMappings({ containerPort: 4321 });

      // WHEN
      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          dnsRecordType: edge.cloudmap.DnsRecordType.SRV,
        },
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "main",
        container_port: 1234,
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [Match.objectLike({ ContainerName: 'main', ContainerPort: 1234 })],
      // });
    });

    test("allows SRV service discovery to select the container and port", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Task", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });

      taskDefinition
        .addContainer("main", {
          image: ecs.ContainerImage.fromRegistry("some"),
          memoryLimitMiB: 512,
        })
        .addPortMappings({ containerPort: 1234 });

      const secondContainer = taskDefinition.addContainer("second", {
        image: ecs.ContainerImage.fromRegistry("some"),
        memoryLimitMiB: 512,
      });
      secondContainer.addPortMappings({ containerPort: 4321 });

      // WHEN
      new ecs.Ec2Service(stack, "Service", {
        cluster,
        taskDefinition,
        cloudMapOptions: {
          dnsRecordType: edge.cloudmap.DnsRecordType.SRV,
          container: secondContainer,
          containerPort: 4321,
        },
      });

      // THEN
      const ecsResource = soleResource(stack, ecsService.EcsService);
      expect(ecsResource.service_registries).toMatchObject({
        container_name: "second",
        container_port: 4321,
      });
      // OLD CFN:
      // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
      //   ServiceRegistries: [Match.objectLike({ ContainerName: 'second', ContainerPort: 4321 })],
      // });
    });

    test("throws if SRV and container is not part of task definition", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Task", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });

      // The right container
      taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });

      const wrongTaskDefinition = new ecs.Ec2TaskDefinition(
        stack,
        "WrongTaskDef",
      );
      // The wrong container
      const wrongContainer = wrongTaskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });

      // WHEN
      expect(() => {
        new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
          cloudMapOptions: {
            dnsRecordType: edge.cloudmap.DnsRecordType.SRV,
            container: wrongContainer,
            containerPort: 4321,
          },
        });
      }).toThrow(/another task definition/i);
    });

    test("throws if SRV and the container port is not mapped", () => {
      const stack = new AwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      addDefaultCapacityProvider(cluster, stack, vpc);
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
        type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
      });
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Task", {
        networkMode: ecs.NetworkMode.BRIDGE,
      });

      const container = taskDefinition.addContainer("MainContainer", {
        image: ecs.ContainerImage.fromRegistry("hello"),
        memoryLimitMiB: 512,
      });

      container.addPortMappings({ containerPort: 8000 });

      expect(() => {
        new ecs.Ec2Service(stack, "Service", {
          cluster,
          taskDefinition,
          cloudMapOptions: {
            dnsRecordType: edge.cloudmap.DnsRecordType.SRV,
            container: container,
            containerPort: 4321,
          },
        });
      }).toThrow(/container port.*not.*mapped/i);
    });
  });

  test("Metric", () => {
    // GIVEN
    const stack = new AwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    addDefaultCapacityProvider(cluster, stack, vpc);
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "FargateTaskDef");
    taskDefinition.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("hello"),
    });

    // WHEN
    const service = new ecs.Ec2Service(stack, "Service", {
      cluster,
      taskDefinition,
    });

    // THEN
    const memMetric = service.metricMemoryUtilization();
    expect(memMetric.namespace).toEqual("AWS/ECS");
    expect(memMetric.metricName).toEqual("MemoryUtilization");
    expect(memMetric.statistic).toEqual("Average");
    expect(memMetric.period.toMinutes()).toEqual(5);
    expect(stack.resolve(memMetric.dimensions)).toEqual({
      ClusterName: stack.resolve(cluster.clusterName),
      ServiceName: stack.resolve(service.serviceName),
    });

    const cpuMetric = service.metricCpuUtilization();
    expect(cpuMetric.namespace).toEqual("AWS/ECS");
    expect(cpuMetric.metricName).toEqual("CPUUtilization");
    expect(cpuMetric.statistic).toEqual("Average");
    expect(cpuMetric.period.toMinutes()).toEqual(5);
    expect(stack.resolve(cpuMetric.dimensions)).toEqual({
      ClusterName: stack.resolve(cluster.clusterName),
      ServiceName: stack.resolve(service.serviceName),
    });
    // OLD CFN:
    // expect(stack.resolve(service.metricMemoryUtilization())).toEqual({
    //   dimensions: { ClusterName: {Ref:'EcsCluster97242B84'}, ServiceName: {'Fn::GetAtt':['ServiceD69D759B','Name']} },
    //   namespace: 'AWS/ECS', metricName: 'MemoryUtilization', period: cdk.Duration.minutes(5), statistic: 'Average',
    // });
    // expect(stack.resolve(service.metricCpuUtilization())).toEqual({
    //   dimensions: { ClusterName: {Ref:'EcsCluster97242B84'}, ServiceName: {'Fn::GetAtt':['ServiceD69D759B','Name']} },
    //   namespace: 'AWS/ECS', metricName: 'CPUUtilization', period: cdk.Duration.minutes(5), statistic: 'Average',
    // });
  });

  describe("When import an EC2 Service", () => {
    test("fromEc2ServiceArn old format", () => {
      // GIVEN
      const stack = new AwsStack();

      // WHEN
      const service = ecs.Ec2Service.fromEc2ServiceArn(
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

    test("fromEc2ServiceArn new format", () => {
      // GIVEN
      const stack = new AwsStack();

      // WHEN
      const service = ecs.Ec2Service.fromEc2ServiceArn(
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
    describe("fromEc2ServiceArn tokenized ARN", () => {
      test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is enabled, use new ARN format", () => {
        // GIVEN
        const stack = new AwsStack();

        // WHEN
        const arnVar = new TerraformVariable(stack, "ARN", { type: "string" });
        const service = ecs.Ec2Service.fromEc2ServiceArn(
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
      const service = ecs.Ec2Service.fromEc2ServiceAttributes(
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
      const service = ecs.Ec2Service.fromEc2ServiceAttributes(
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

    // TERRACONSTRUCTS DEVIATION: see note above `fromEc2ServiceArn tokenized ARN` -- the
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
        const service = ecs.Ec2Service.fromEc2ServiceAttributes(
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

        expect(stack.resolve(service.env.account)).toEqual(
          stack.resolve(Fn.element(Fn.split(":", arnVar.stringValue), 4)),
        );
        expect(stack.resolve(service.env.region)).toEqual(
          stack.resolve(Fn.element(Fn.split(":", arnVar.stringValue), 3)),
        );
      });
    });

    describe("with serviceName", () => {
      // TERRACONSTRUCTS DEVIATION: see note above `fromEc2ServiceArn tokenized ARN` -- the
      // flag-disabled ("old ARN format") branch is unreachable in this repo and dropped. Omitted:
      //
      // test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is disabled, use old ARN format", ...)
      test("when @aws-cdk/aws-ecs:arnFormatIncludesClusterName is enabled, use new ARN format", () => {
        // GIVEN
        const stack = new AwsStack();
        const cluster = new ecs.Cluster(stack, "EcsCluster");

        // WHEN
        const service = ecs.Ec2Service.fromEc2ServiceAttributes(
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

    test("throws an exception if both serviceArn and serviceName were provided for fromEc2ServiceAttributes", () => {
      // GIVEN
      const stack = new AwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      expect(() => {
        ecs.Ec2Service.fromEc2ServiceAttributes(stack, "EcsService", {
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
        ecs.Ec2Service.fromEc2ServiceAttributes(stack, "EcsService", {
          cluster,
        });
      }).toThrow(/only specify either serviceArn or serviceName/);
    });
  });
});

// Wrapping synth/snapshot coverage for the Ec2Service/BaseService constructs exercised above
// (harness idiom: test/aws/notify/queue.test.ts + test/aws/compute/ecs/base-service.test.ts).
describe("ec2 service synth", () => {
  test("Ec2Service with only required properties set should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new Vpc(stack, "MyVpc", {});
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    addDefaultCapacityProvider(cluster, stack, vpc);
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");

    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
    });

    // WHEN
    new ecs.Ec2Service(stack, "Ec2Service", {
      cluster,
      taskDefinition,
    });

    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Ec2Service with all properties set should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new Vpc(stack, "MyVpc", {});
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    addDefaultCapacityProvider(cluster, stack, vpc);
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    cluster.addDefaultCloudMapNamespace({
      name: "foo.com",
      type: edge.cloudmap.NamespaceType.DNS_PRIVATE,
    });

    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
    });

    // WHEN
    const service = new ecs.Ec2Service(stack, "Ec2Service", {
      cluster,
      taskDefinition,
      desiredCount: 2,
      assignPublicIp: true,
      cloudMapOptions: {
        name: "myapp",
        dnsRecordType: edge.cloudmap.DnsRecordType.A,
        dnsTtl: Duration.seconds(50),
        failureThreshold: 20,
      },
      daemon: false,
      healthCheckGracePeriod: Duration.seconds(60),
      maxHealthyPercent: 150,
      minHealthyPercent: 55,
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
      securityGroups: [
        new SecurityGroup(stack, "SecurityGroup1", {
          allowAllOutbound: true,
          description: "Example",
          securityGroupName: "Bob",
          vpc,
        }),
      ],
      serviceName: "bonjour",
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      availabilityZoneRebalancing: ecs.AvailabilityZoneRebalancing.ENABLED,
    });
    service.addPlacementConstraints(
      ecs.PlacementConstraint.memberOf("attribute:ecs.instance-type =~ t2.*"),
    );
    service.addPlacementStrategies(
      ecs.PlacementStrategy.spreadAcross(
        ecs.BuiltInAttributes.AVAILABILITY_ZONE,
      ),
    );

    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
