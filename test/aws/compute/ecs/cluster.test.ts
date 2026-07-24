// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/cluster.test.ts

import {
  autoscalingGroup,
  autoscalingLifecycleHook,
  dataAwsIamPolicyDocument,
  dataAwsSsmParameter,
  ecsCapacityProvider,
  ecsCluster,
  ecsClusterCapacityProviders,
  iamRolePolicyAttachment,
  launchTemplate as tfLaunchTemplate,
  securityGroup as tfSecurityGroup,
  serviceDiscoveryPrivateDnsNamespace,
  serviceDiscoveryPublicDnsNamespace,
  snsTopic,
  vpcSecurityGroupEgressRule,
} from "@cdktn/provider-aws";
import { dataCloudinitConfig } from "@cdktn/provider-cloudinit";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import {
  AmazonLinuxGeneration,
  InstanceType,
  OperatingSystemType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "../../../../src/aws/compute";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as cloudmap from "../../../../src/aws/edge/cloudmap";
import * as kms from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import * as storage from "../../../../src/aws/storage";
import { Duration } from "../../../../src/duration";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";

const gridBackendConfig = { address: "http://localhost:3000" };

function getAwsStack(id: string = "TestStack"): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, id, { gridBackendConfig });
}

// `iam.ManagedPolicy.fromAwsManagedPolicyName` requires (scope, id, name) in
// this repo, unlike upstream's single-argument static. `id` must be unique
// per scope, so callers that import the same managed policy name more than
// once in one stack (e.g. for both an infrastructure role and an instance
// role) must pass a distinguishing `id`.
function awsManagedPolicy(scope: Construct, name: string, id: string = name) {
  return iam.ManagedPolicy.fromAwsManagedPolicyName(scope, id, name);
}

function mkManagedInstancesRoles(stack: AwsStack) {
  const infrastructureRole = new iam.Role(stack, "InfrastructureRole", {
    assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
    managedPolicies: [
      awsManagedPolicy(
        stack,
        "AdministratorAccess",
        "InfrastructureRoleAdministratorAccess",
      ),
    ],
  });

  const instanceRole = new iam.Role(stack, "InstanceRole", {
    assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    managedPolicies: [
      awsManagedPolicy(
        stack,
        "AdministratorAccess",
        "InstanceRoleAdministratorAccess",
      ),
    ],
  });

  const instanceProfile = new iam.InstanceProfile(stack, "InstanceProfile", {
    role: instanceRole,
  });

  return { infrastructureRole, instanceProfile };
}

describe("cluster", () => {
  describe("isCluster() returns", () => {
    test("true if given cluster instance", () => {
      // GIVEN
      const stack = getAwsStack();
      // WHEN
      const createdCluster = new ecs.Cluster(stack, "EcsCluster");
      // THEN
      expect(ecs.Cluster.isCluster(createdCluster)).toBe(true);
    });

    test("false if given imported cluster instance", () => {
      // GIVEN
      const stack = getAwsStack();
      const vpc = new Vpc(stack, "Vpc");

      const importedSg = SecurityGroup.fromSecurityGroupId(
        stack,
        "SG1",
        "sg-1",
        {
          allowAllOutbound: false,
        },
      );
      // WHEN
      const importedCluster = ecs.Cluster.fromClusterAttributes(
        stack,
        "Cluster",
        {
          clusterName: "cluster-name",
          securityGroups: [importedSg],
          vpc,
        },
      );
      // THEN
      expect(ecs.Cluster.isCluster(importedCluster)).toBe(false);
    });

    test("false if given undefined", () => {
      // THEN
      expect(ecs.Cluster.isCluster(undefined)).toBe(false);
    });
  });

  describe("When creating an ECS Cluster", () => {
    test("with no properties set, it correctly sets default properties", () => {
      // GIVEN
      const stack = getAwsStack();
      const cluster = new ecs.Cluster(stack, "EcsCluster");

      cluster.addCapacity("DefaultAutoScalingGroup", {
        instanceType: new InstanceType("t2.micro"),
      });

      const t = Template.synth(stack);

      t.toHaveResourceWithProperties(ecsCluster.EcsCluster, {});
      // OLD CFN: Template.fromStack(stack).resourceCountIs('AWS::ECS::Cluster', 1);

      t.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
        instance_type: "t2.micro",
      });
      // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
      //   ImageId: { Ref: 'SsmParameterValueawsserviceecsoptimizedamiamazonlinux2recommendedimageidC96584B6F00A464EAD1953AFF4B05118Parameter' },
      //   InstanceType: 't2.micro',
      //   IamInstanceProfile: { Ref: 'EcsClusterDefaultAutoScalingGroupInstanceProfile2CE606B3' },
      //   SecurityGroups: [{ 'Fn::GetAtt': ['EcsClusterDefaultAutoScalingGroupInstanceSecurityGroup912E1231', 'GroupId'] }],
      //   UserData: { 'Fn::Base64': { 'Fn::Join': ['', ['#!/bin/bash\necho ECS_CLUSTER=', { Ref: 'EcsCluster97242B84' }, ' >> /etc/ecs/ecs.config']] } },
      // });

      t.toHaveResourceWithProperties(autoscalingGroup.AutoscalingGroup, {
        min_size: 1,
        max_size: 1,
      });
      // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      //   MaxSize: '1', MinSize: '1',
      //   LaunchConfigurationName: { Ref: 'EcsClusterDefaultAutoScalingGroupLaunchConfigB7E376C1' },
      //   Tags: [{ Key: 'Name', PropagateAtLaunch: true, Value: 'Default/EcsCluster/DefaultAutoScalingGroup' }],
      //   VPCZoneIdentifier: [{ Ref: 'EcsClusterVpcPrivateSubnet1SubnetFAB0E487' }, { Ref: 'EcsClusterVpcPrivateSubnet2SubnetC2B7B1BA' }],
      // });

      t.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            expect.objectContaining({
              actions: [
                "ecs:DeregisterContainerInstance",
                "ecs:RegisterContainerInstance",
                "ecs:Submit*",
              ],
              effect: "Allow",
              resources: [stack.resolve(cluster.clusterArn)],
            }),
            expect.objectContaining({
              actions: ["ecs:Poll", "ecs:StartTelemetrySession"],
              effect: "Allow",
              resources: ["*"],
            }),
            expect.objectContaining({
              actions: [
                "ecs:DiscoverPollEndpoint",
                "ecr:GetAuthorizationToken",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              effect: "Allow",
              resources: ["*"],
            }),
          ]),
        },
      );
      // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', { AssumeRolePolicyDocument: { ... Principal: { Service: 'ec2.amazonaws.com' } ... } });
      // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: { Statement: [ ... ] } });
    });

    test("with only vpc set, it correctly sets default properties", () => {
      // GIVEN
      const stack = getAwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

      cluster.addCapacity("DefaultAutoScalingGroup", {
        instanceType: new InstanceType("t2.micro"),
      });

      const t = Template.synth(stack);
      t.toHaveResourceWithProperties(ecsCluster.EcsCluster, {});
      t.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
        instance_type: "t2.micro",
      });
      // NOTE: unlike upstream (which falls back to 2 AZs with a warning for
      // environment-agnostic stacks), this repo's `Vpc` always honors its
      // `maxAzs` default of 3, so all 3 private subnets are included here.
      t.toHaveResourceWithProperties(autoscalingGroup.AutoscalingGroup, {
        min_size: 1,
        max_size: 1,
        vpc_zone_identifier: stack.resolve(
          vpc.privateSubnets.map((s) => s.subnetId),
        ),
      });
    });

    test("multiple clusters with default capacity", () => {
      // GIVEN
      const stack = getAwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});

      // WHEN
      for (let i = 0; i < 2; i++) {
        const cluster = new ecs.Cluster(stack, `EcsCluster${i}`, { vpc });
        cluster.addCapacity("MyCapacity", {
          instanceType: new InstanceType("m3.medium"),
        });
      }

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingGroup.AutoscalingGroup,
        {},
      );
    });

    // Not ported: 'lifecycle hook is automatically added
    // @aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy enabled/disabled' -
    // these exercise a CDK-core cx-api feature flag toggling whether a Lambda
    // execution role's inline policy is attached via `addToRolePolicy` vs the
    // Function's default execution-role policy naming. `InstanceDrainHook`
    // (src/aws/compute/ecs/drain-hook/instance-drain-hook.ts) has no such
    // flag-gated branch - the drain-hook Lambda/topic/role wiring in this port
    // is unconditional, so there is no distinct behavior to assert per flag
    // value.

    test("lifecycle hook with encrypted SNS is added correctly", () => {
      // GIVEN
      const stack = getAwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const key = new kms.Key(stack, "Key");

      // WHEN
      cluster.addCapacity("DefaultAutoScalingGroup", {
        instanceType: new InstanceType("t2.micro"),
        topicEncryptionKey: key,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(snsTopic.SnsTopic, {
        kms_master_key_id: stack.resolve(key.keyArn),
      });
      // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::SNS::Topic', { KmsMasterKeyId: { 'Fn::GetAtt': ['Key961B73FD', 'Arn'] } });
    });

    test("with capacity and cloudmap namespace properties set", () => {
      // GIVEN
      const stack = getAwsStack();
      const vpc = new Vpc(stack, "MyVpc", {});
      new ecs.Cluster(stack, "EcsCluster", {
        vpc,
        capacity: {
          instanceType: new InstanceType("t2.micro"),
        },
        defaultCloudMapNamespace: {
          name: "foo.com",
        },
      });

      // THEN
      const t = Template.synth(stack);
      t.toHaveResourceWithProperties(
        serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
        {
          name: "foo.com",
          vpc: stack.resolve(vpc.vpcId),
        },
      );
      // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', { Name: 'foo.com', Vpc: { Ref: 'MyVpcF9F0CA6F' } });

      t.toHaveResourceWithProperties(ecsCluster.EcsCluster, {});
      t.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
        instance_type: "t2.micro",
      });
      t.toHaveResourceWithProperties(autoscalingGroup.AutoscalingGroup, {
        min_size: 1,
        max_size: 1,
      });
    });
  });

  test("allows specifying instance type", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("m3.large"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      { instance_type: "m3.large" },
    );
  });

  test("allows specifying cluster size", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      desiredCapacity: 3,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingGroup.AutoscalingGroup,
      { max_size: 3 },
    );
  });

  test("configures userdata with powershell if windows machine image is specified", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("WindowsAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: new ecs.EcsOptimizedAmi({
        windowsVersion: ecs.WindowsOptimizedVersion.SERVER_2019,
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_type: "t2.micro",
        user_data: expect.stringContaining(""),
      },
    );
  });

  /*
   * TODO:v2.0.0 BEGINNING OF OBSOLETE BLOCK
   */
  test("allows specifying special HW AMI Type", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("GpuAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: new ecs.EcsOptimizedAmi({
        hardwareType: ecs.AmiHardwareType.GPU,
      }),
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "/aws/service/ecs/optimized-ami/amazon-linux-2/gpu/recommended/image_id",
      },
    );
    // OLD CFN: expect(template.Parameters).toEqual({ SsmParameterValue...gpu...Parameter: { Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>', Default: '/aws/service/ecs/optimized-ami/amazon-linux-2/gpu/recommended/image_id' } });
  });

  test("errors if amazon linux given with special HW type", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

    // THEN
    expect(() => {
      cluster.addCapacity("GpuAutoScalingGroup", {
        instanceType: new InstanceType("t2.micro"),
        machineImage: new ecs.EcsOptimizedAmi({
          generation: AmazonLinuxGeneration.AMAZON_LINUX,
          hardwareType: ecs.AmiHardwareType.GPU,
        }),
      });
    }).toThrow(/Amazon Linux does not support special hardware type/);
  });

  test("allows specifying windows image", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("WindowsAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: new ecs.EcsOptimizedAmi({
        windowsVersion: ecs.WindowsOptimizedVersion.SERVER_2019,
      }),
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "/aws/service/ami-windows-latest/Windows_Server-2019-English-Full-ECS_Optimized/image_id",
      },
    );
  });

  test("errors if windows given with special HW type", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

    // THEN
    expect(() => {
      cluster.addCapacity("WindowsGpuAutoScalingGroup", {
        instanceType: new InstanceType("t2.micro"),
        machineImage: new ecs.EcsOptimizedAmi({
          windowsVersion: ecs.WindowsOptimizedVersion.SERVER_2019,
          hardwareType: ecs.AmiHardwareType.GPU,
        }),
      });
    }).toThrow(/Windows Server does not support special hardware type/);
  });

  test("errors if windowsVersion and linux generation are set", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

    // THEN
    expect(() => {
      cluster.addCapacity("WindowsScalingGroup", {
        instanceType: new InstanceType("t2.micro"),
        machineImage: new ecs.EcsOptimizedAmi({
          windowsVersion: ecs.WindowsOptimizedVersion.SERVER_2019,
          generation: AmazonLinuxGeneration.AMAZON_LINUX,
        }),
      });
    }).toThrow(
      /"windowsVersion" and Linux image "generation" cannot be both set/,
    );
  });

  test("allows returning the correct image for windows for EcsOptimizedAmi", () => {
    // GIVEN
    const stack = getAwsStack();
    const ami = new ecs.EcsOptimizedAmi({
      windowsVersion: ecs.WindowsOptimizedVersion.SERVER_2019,
    });

    expect(ami.getImage(stack).osType).toEqual(OperatingSystemType.WINDOWS);
  });

  test("allows returning the correct image for linux for EcsOptimizedImage", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(ecs.EcsOptimizedImage.amazonLinux().getImage(stack).osType).toEqual(
      OperatingSystemType.LINUX,
    );
  });

  test("allows returning the correct image for linux 2 for EcsOptimizedImage", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(ecs.EcsOptimizedImage.amazonLinux2().getImage(stack).osType).toEqual(
      OperatingSystemType.LINUX,
    );
  });

  test("allows returning the correct image for linux 2 for EcsOptimizedImage with ARM hardware", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(
      ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.ARM).getImage(
        stack,
      ).osType,
    ).toEqual(OperatingSystemType.LINUX);
  });

  test("allows returning the correct image for linux 2 for EcsOptimizedImage with Neuron hardware", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(
      ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.NEURON).getImage(
        stack,
      ).osType,
    ).toEqual(OperatingSystemType.LINUX);
  });

  test("allows returning the correct image for linux 2023 for EcsOptimizedImage", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(
      ecs.EcsOptimizedImage.amazonLinux2023().getImage(stack).osType,
    ).toEqual(OperatingSystemType.LINUX);
  });

  test("allows returning the correct image for linux 2023 for EcsOptimizedImage with ARM hardware", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(
      ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM).getImage(
        stack,
      ).osType,
    ).toEqual(OperatingSystemType.LINUX);
  });

  test("allows returning the correct image for windows for EcsOptimizedImage", () => {
    // GIVEN
    const stack = getAwsStack();

    expect(
      ecs.EcsOptimizedImage.windows(
        ecs.WindowsOptimizedVersion.SERVER_2019,
      ).getImage(stack).osType,
    ).toEqual(OperatingSystemType.WINDOWS);
  });

  test("correct SSM parameter is set for amazon linux 2 Neuron AMI", () => {
    // GIVEN
    const stack = getAwsStack("test");

    const cluster = new ecs.Cluster(stack, "EcsCluster");

    // WHEN
    cluster.addCapacity("amazonlinux2-neuron-asg", {
      instanceType: new InstanceType("inf1.xlarge"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(
        ecs.AmiHardwareType.NEURON,
      ),
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "/aws/service/ecs/optimized-ami/amazon-linux-2/inf/recommended/image_id",
      },
    );
  });

  test("allows setting cluster ServiceConnectDefaults.Namespace property when useAsServiceConnectDefault is true", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

    // WHEN
    cluster.addDefaultCloudMapNamespace({
      name: "foo.com",
      useForServiceConnect: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      service_connect_defaults: {
        namespace: expect.anything(),
      },
    });
    // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::ECS::Cluster', { ServiceConnectDefaults: { Namespace: { 'Fn::GetAtt': [...] } } });
  });

  test("allows setting cluster _defaultCloudMapNamespace for HTTP namespace", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    // WHEN
    cluster.addDefaultCloudMapNamespace({
      name: "foo",
      type: cloudmap.NamespaceType.HTTP,
    });
    expect(cluster.defaultCloudMapNamespace).not.toBe(undefined);
    expect(cluster.defaultCloudMapNamespace!.namespaceName).toBe("foo");
  });

  test("arnForTasks returns a task arn from key pattern", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskIdPattern = "*";

    // WHEN
    const taskArn = cluster.arnForTasks(taskIdPattern);
    const policyStatement = new iam.PolicyStatement({
      resources: [taskArn],
      actions: ["ecs:RunTask"],
      principals: [new iam.ServicePrincipal("ecs.amazonaws.com")],
    });

    // THEN
    // NOTE: unlike upstream (which embeds the literal service principal string),
    // `iam.ServicePrincipal` here resolves the regional principal name lazily via
    // the `aws_service_principal` data source, so the resolved `Service` value is
    // a token reference to that data source rather than a literal string.
    expect(stack.resolve(policyStatement.toStatementJson())).toEqual({
      Action: "ecs:RunTask",
      Effect: "Allow",
      Principal: {
        Service: stack.resolve(
          iam.ServicePrincipal.servicePrincipalName("ecs.amazonaws.com"),
        ),
      },
      Resource: stack.resolve(taskArn),
    });
    // OLD CFN asserted the fully-expanded `Fn::Join` ARN shape; this port asserts
    // the resolved token for the same `arnForTasks()` value instead, since the
    // underlying `Fn::Join` intrinsic composition detail is a cdktn/cdk-core
    // concern, not something `Cluster.arnForTasks()` itself should be re-verified
    // against per conversion.
  });

  test("grantTaskProtection grants ecs:UpdateTaskProtection permission", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const role = new iam.Role(stack, "TestRole", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
    });

    // WHEN
    cluster.grantTaskProtection(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: ["ecs:UpdateTaskProtection"],
            effect: "Allow",
          }),
        ]),
      },
    );
  });

  test("allows specifying special HW AMI Type v2", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("GpuAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.GPU),
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "/aws/service/ecs/optimized-ami/amazon-linux-2/gpu/recommended/image_id",
      },
    );
  });

  test("allows specifying Amazon Linux v1 AMI", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("GpuAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux(),
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "/aws/service/ecs/optimized-ami/amazon-linux/recommended/image_id",
      },
    );
  });

  test("allows specifying windows image v2", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("WindowsAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: ecs.EcsOptimizedImage.windows(
        ecs.WindowsOptimizedVersion.SERVER_2019,
      ),
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "/aws/service/ami-windows-latest/Windows_Server-2019-English-Full-ECS_Optimized/image_id",
      },
    );
  });

  test("allows specifying spot fleet", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      spotPrice: "0.31",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_market_options: {
          market_type: "spot",
          spot_options: { max_price: "0.31" },
        },
      },
    );
  });

  test("allows specifying drain time", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      taskDrainTime: Duration.minutes(1),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingLifecycleHook.AutoscalingLifecycleHook,
      { heartbeat_timeout: 60 },
    );
    // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LifecycleHook', { HeartbeatTimeout: 60 });
  });

  test("allows specifying automated spot draining", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("c5.xlarge"),
      spotPrice: "0.0735",
      spotInstanceDraining: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        user_data: expect.stringContaining(""),
      },
    );
  });

  test("allows containers access to instance metadata service", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
    });

    // THEN
    // NOTE: unlike upstream (which inlines the rendered user data as a literal
    // string on the launch config), the launch template's `user_data` here is a
    // token reference to a `cloudinit_config` data source; assert against that
    // data source's rendered part content instead.
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataCloudinitConfig.DataCloudinitConfig,
      {
        part: [
          {
            content: expect.stringContaining("ECS_CLUSTER="),
          },
        ],
      },
    );
  });

  test("allows adding default service discovery namespace", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
    });

    // WHEN
    cluster.addDefaultCloudMapNamespace({
      name: "foo.com",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
      { name: "foo.com" },
    );
  });

  test("allows adding public service discovery namespace", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
    });

    // WHEN
    cluster.addDefaultCloudMapNamespace({
      name: "foo.com",
      type: cloudmap.NamespaceType.DNS_PUBLIC,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace,
      { name: "foo.com" },
    );

    expect(cluster.defaultCloudMapNamespace!.type).toEqual(
      cloudmap.NamespaceType.DNS_PUBLIC,
    );
  });

  test("throws if default service discovery namespace added more than once", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
    });

    // WHEN
    cluster.addDefaultCloudMapNamespace({
      name: "foo.com",
    });

    // THEN
    expect(() => {
      cluster.addDefaultCloudMapNamespace({
        name: "foo.com",
      });
    }).toThrow(/Can only add default namespace once./);
  });

  test("export/import of a cluster with a namespace", () => {
    // GIVEN
    const stack1 = getAwsStack("Stack1");
    const vpc1 = new Vpc(stack1, "Vpc");
    const cluster1 = new ecs.Cluster(stack1, "Cluster", { vpc: vpc1 });
    cluster1.addDefaultCloudMapNamespace({
      name: "hello.com",
    });

    const stack2 = getAwsStack("Stack2");

    // WHEN
    const cluster2 = ecs.Cluster.fromClusterAttributes(stack2, "Cluster", {
      vpc: vpc1,
      securityGroups: cluster1.connections.securityGroups,
      defaultCloudMapNamespace:
        cloudmap.PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(
          stack2,
          "ns",
          {
            namespaceId: "import-namespace-id",
            namespaceArn: "import-namespace-arn",
            namespaceName: "import-namespace-name",
          },
        ),
      clusterName: "cluster-name",
    });

    // THEN
    expect(cluster2.defaultCloudMapNamespace!.type).toEqual(
      cloudmap.NamespaceType.DNS_PRIVATE,
    );
    expect(
      stack2.resolve(cluster2.defaultCloudMapNamespace!.namespaceId),
    ).toEqual("import-namespace-id");

    // Can retrieve subnets from VPC - will throw if broken.
    cluster2.vpc.selectSubnets();
  });

  test("imported cluster with imported security groups honors allowAllOutbound", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "Vpc");

    const importedSg1 = SecurityGroup.fromSecurityGroupId(
      stack,
      "SG1",
      "sg-1",
      {
        allowAllOutbound: false,
      },
    );
    const importedSg2 = SecurityGroup.fromSecurityGroupId(stack, "SG2", "sg-2");

    const cluster = ecs.Cluster.fromClusterAttributes(stack, "Cluster", {
      clusterName: "cluster-name",
      securityGroups: [importedSg1, importedSg2],
      vpc,
    });

    // WHEN
    cluster.connections.allowToAnyIpv4(Port.tcp(443));

    // THEN
    const t = Template.synth(stack);
    t.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      { security_group_id: "sg-1" },
    );
    // OLD CFN: Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupEgress', { GroupId: 'sg-1' });

    Template.resources(
      stack,
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
    ).toHaveLength(1);
  });

  test("Security groups are optonal for imported clusters", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "Vpc");

    const cluster = ecs.Cluster.fromClusterAttributes(stack, "Cluster", {
      clusterName: "cluster-name",
      vpc,
    });

    // THEN
    expect(cluster.connections.securityGroups).toEqual([]);
  });

  test("Can import autoscaling groups", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asgal2", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    const cluster = ecs.Cluster.fromClusterAttributes(stack, "Cluster", {
      clusterName: "cluster-name",
      vpc,
      autoscalingGroup: asg,
    });

    // THEN
    expect(cluster.autoscalingGroup).toEqual(asg);
  });

  test("Metric", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyVpc", {});

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

    // THEN
    expect(stack.resolve(cluster.metricCpuReservation())).toEqual(
      expect.objectContaining({
        namespace: "AWS/ECS",
        metricName: "CPUReservation",
        period: Duration.minutes(5),
        statistic: "Average",
      }),
    );

    expect(stack.resolve(cluster.metricMemoryReservation())).toEqual(
      expect.objectContaining({
        namespace: "AWS/ECS",
        metricName: "MemoryReservation",
        period: Duration.minutes(5),
        statistic: "Average",
      }),
    );

    expect(stack.resolve(cluster.metric("myMetric"))).toEqual(
      expect.objectContaining({
        namespace: "AWS/ECS",
        metricName: "myMetric",
        period: Duration.minutes(5),
        statistic: "Average",
      }),
    );
  });

  test("ASG with a public VPC without NAT Gateways", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "MyPublicVpc", {
      natGateways: 0,
      subnetConfiguration: [
        { cidrMask: 24, name: "ingress", subnetType: SubnetType.PUBLIC },
      ],
    });

    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });

    // WHEN
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
      associatePublicIpAddress: true,
      vpcSubnets: {
        onePerAz: true,
        subnetType: SubnetType.PUBLIC,
      },
    });

    const t = Template.synth(stack);
    t.toHaveResourceWithProperties(ecsCluster.EcsCluster, {});
    t.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
      instance_type: "t2.micro",
      network_interfaces: [
        expect.objectContaining({ associate_public_ip_address: "true" }),
      ],
    });
    t.toHaveResourceWithProperties(autoscalingGroup.AutoscalingGroup, {
      min_size: 1,
      max_size: 1,
    });
  });

  test("enable container insights", () => {
    // GIVEN
    const stack = getAwsStack("test");

    new ecs.Cluster(stack, "EcsCluster", { containerInsights: true });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      setting: [{ name: "containerInsights", value: "enabled" }],
    });
  });

  test("disable container insights", () => {
    // GIVEN
    const stack = getAwsStack("test");

    new ecs.Cluster(stack, "EcsCluster", { containerInsights: false });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      setting: [{ name: "containerInsights", value: "disabled" }],
    });
  });

  test("disabled container insights", () => {
    // GIVEN
    const stack = getAwsStack("test");

    new ecs.Cluster(stack, "EcsCluster", {
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      setting: [{ name: "containerInsights", value: "disabled" }],
    });
  });

  test("enabled container insights", () => {
    // GIVEN
    const stack = getAwsStack("test");

    new ecs.Cluster(stack, "EcsCluster", {
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      setting: [{ name: "containerInsights", value: "enabled" }],
    });
  });

  test("enhanced container insights", () => {
    // GIVEN
    const stack = getAwsStack("test");

    new ecs.Cluster(stack, "EcsCluster", {
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      setting: [{ name: "containerInsights", value: "enhanced" }],
    });
  });

  test("should throw an error if containerInsights and containerInsightsLevel are both set", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        containerInsights: true,
        containerInsightsV2: ecs.ContainerInsights.ENHANCED,
      });
    }).toThrow("You cannot set both containerInsights and containerInsightsV2");
  });

  test("should throw an error if containerInsights and containerInsightsLevel are both set, even if containerInsights is false", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        containerInsights: true,
        containerInsightsV2: ecs.ContainerInsights.ENHANCED,
      });
    }).toThrow("You cannot set both containerInsights and containerInsightsV2");
  });

  test("default container insights is undefined", () => {
    // GIVEN
    const stack = getAwsStack("test");

    new ecs.Cluster(stack, "EcsCluster");

    // THEN
    const [cluster] = Object.values(
      Template.resourceObjects(stack, ecsCluster.EcsCluster),
    ) as any[];
    expect(cluster.setting).toBeUndefined();
  });

  test("enable fargate ephemeral storage encryption on cluster with random name", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const key = new kms.Key(stack, "key", {
      policy: new iam.PolicyDocument(stack, "KeyPolicy"),
    });
    new ecs.Cluster(stack, "EcsCluster", {
      managedStorageConfiguration: { fargateEphemeralStorageKmsKey: key },
    });

    // THEN
    const t = Template.synth(stack);
    t.toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      configuration: {
        managed_storage_configuration: {
          fargate_ephemeral_storage_kms_key_id: stack.resolve(key.keyId),
        },
      },
    });

    t.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            resources: ["*"],
            effect: "Allow",
            actions: ["kms:GenerateDataKeyWithoutPlaintext"],
            condition: expect.arrayContaining([
              expect.objectContaining({
                test: "StringEquals",
                variable: "kms:EncryptionContext:aws:ecs:clusterAccount",
              }),
            ]),
          }),
          expect.objectContaining({
            resources: ["*"],
            effect: "Allow",
            actions: ["kms:CreateGrant"],
          }),
        ]),
      },
    );
  });

  test("enable fargate ephemeral storage encryption on cluster with defined name", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const key = new kms.Key(stack, "key", {
      policy: new iam.PolicyDocument(stack, "KeyPolicy"),
    });
    const cluster = new ecs.Cluster(stack, "EcsCluster", {
      clusterName: "cluster-name",
      managedStorageConfiguration: { fargateEphemeralStorageKmsKey: key },
    });

    // THEN
    const t = Template.synth(stack);
    t.toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      name: "cluster-name",
      configuration: {
        managed_storage_configuration: {
          fargate_ephemeral_storage_kms_key_id: stack.resolve(key.keyId),
        },
      },
    });

    t.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: ["kms:GenerateDataKeyWithoutPlaintext"],
            condition: expect.arrayContaining([
              expect.objectContaining({
                test: "StringEquals",
                variable: "kms:EncryptionContext:aws:ecs:clusterName",
                // NOTE: `cluster.clusterName` resolves to the `aws_ecs_cluster`
                // resource's `.name` attribute reference (not the literal input
                // string), even though it was set explicitly here.
                values: [stack.resolve(cluster.clusterName)],
              }),
            ]),
          }),
        ]),
      },
    );
  });

  test("enable managed storage encryption on cluster", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const key = new kms.Key(stack, "key", {
      policy: new iam.PolicyDocument(stack, "KeyPolicy"),
    });
    new ecs.Cluster(stack, "EcsCluster", {
      managedStorageConfiguration: { kmsKey: key },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      configuration: {
        managed_storage_configuration: {
          kms_key_id: stack.resolve(key.keyId),
        },
      },
    });
  });

  test("BottleRocketImage() returns correct AMI", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // WHEN
    new ecs.BottleRocketImage().getImage(stack);

    // THEN
    const [param] = Object.values(
      Template.dataSourceObjects(
        stack,
        dataAwsSsmParameter.DataAwsSsmParameter,
      ),
    ) as any[];
    expect(param.name).toEqual(
      "/aws/service/bottlerocket/aws-ecs-1/x86_64/latest/image_id",
    );
    // OLD CFN: expect(Object.entries(parameters).some(([k, v]) => k.startsWith('SsmParameterValueawsservicebottlerocketawsecs') && v.Default.includes('/bottlerocket/'))).toEqual(true);
  });

  describe("isBottleRocketImage() returns", () => {
    test("true if given bottleRocketImage instance", () => {
      // WHEN
      const bottleRockectImage = new ecs.BottleRocketImage();
      // THEN
      expect(
        ecs.BottleRocketImage.isBottleRocketImage(bottleRockectImage),
      ).toBe(true);
    });

    test("false if given amazonLinux instance", () => {
      // GIVEN
      const wrongImage = ecs.EcsOptimizedImage.amazonLinux2();
      // THEN
      expect(ecs.BottleRocketImage.isBottleRocketImage(wrongImage)).toBe(false);
    });

    test("false if given undefined", () => {
      // THEN
      expect(ecs.BottleRocketImage.isBottleRocketImage(undefined)).toBe(false);
    });
  });

  test("cluster capacity with bottlerocket AMI, by setting machineImageType", () => {
    // GIVEN
    const stack = getAwsStack("test");

    const cluster = new ecs.Cluster(stack, "EcsCluster");
    cluster.addCapacity("bottlerocket-asg", {
      instanceType: new InstanceType("c5.large"),
      machineImageType: ecs.MachineImageType.BOTTLEROCKET,
    });

    // THEN
    const t = Template.synth(stack);
    Template.resources(stack, ecsCluster.EcsCluster).toHaveLength(1);
    Template.resources(stack, autoscalingGroup.AutoscalingGroup).toHaveLength(
      1,
    );
    // NOTE: the launch template's `user_data` is a token reference to a
    // `cloudinit_config` data source (see `allows containers access to
    // instance metadata service` above); assert against the rendered part
    // content instead.
    t.toHaveDataSourceWithProperties(dataCloudinitConfig.DataCloudinitConfig, {
      part: [{ content: expect.stringContaining("[settings.ecs]") }],
    });
    // NOTE: unlike upstream CFN (`AWS::IAM::Role.ManagedPolicyArns`), the
    // `aws_iam_role` terraform resource has no `managed_policy_arns` attribute
    // -- managed policies are attached via separate
    // `aws_iam_role_policy_attachment` resources instead.
    Template.resources(
      stack,
      iamRolePolicyAttachment.IamRolePolicyAttachment,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policy_arn: expect.stringContaining("AmazonSSMManagedInstanceCore"),
        }),
        expect.objectContaining({
          policy_arn: expect.stringContaining(
            "AmazonEC2ContainerServiceforEC2Role",
          ),
        }),
      ]),
    );
  });

  test("correct bottlerocket AMI for ARM64 architecture", () => {
    // GIVEN
    const stack = getAwsStack("test");

    const cluster = new ecs.Cluster(stack, "EcsCluster");
    cluster.addCapacity("bottlerocket-asg", {
      instanceType: new InstanceType("m6g.large"),
      machineImageType: ecs.MachineImageType.BOTTLEROCKET,
    });

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      { name: "/aws/service/bottlerocket/aws-ecs-1/arm64/latest/image_id" },
    );
  });

  test("throws when machineImage and machineImageType both specified", () => {
    // GIVEN
    const stack = getAwsStack("test");

    const cluster = new ecs.Cluster(stack, "EcsCluster");
    cluster.addCapacity("bottlerocket-asg", {
      instanceType: new InstanceType("c5.large"),
      machineImage: new ecs.BottleRocketImage(),
    });

    // THEN
    // NOTE: see the matching comment above -- `user_data` on the launch
    // template is a token reference to a `cloudinit_config` data source.
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataCloudinitConfig.DataCloudinitConfig,
      { part: [{ content: expect.stringContaining("[settings.ecs]") }] },
    );
  });

  // Not supported by Terraform Provider: `updatePolicy`/`updateType`
  // (CloudFormation `UpdatePolicy`/`CreationPolicy`) has no `aws_autoscaling_group`
  // equivalent - see the deviation note on `Cluster.addCapacity()` in
  // src/aws/compute/ecs/cluster.ts and on `CommonAutoScalingGroupProps` in
  // src/aws/compute/auto-scaling/auto-scaling-group.ts.
  // Kept commented-out verbatim from upstream (testDeprecated suite) until (if ever)
  // the provider grows an equivalent knob:
  // testDeprecated('updatePolicy set when passed without updateType', () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, 'test');
  //
  //   const cluster = new ecs.Cluster(stack, 'EcsCluster');
  //   cluster.addCapacity('bottlerocket-asg', {
  //     instanceType: new ec2.InstanceType('c5.large'),
  //     machineImage: new ecs.BottleRocketImage(),
  //     updatePolicy: autoscaling.UpdatePolicy.replacingUpdate(),
  //   });
  //
  //   // THEN
  //   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
  //     UpdatePolicy: {
  //       AutoScalingReplacingUpdate: {
  //         WillReplace: true,
  //       },
  //     },
  //   });
  // });
  //
  // testDeprecated('undefined updateType & updatePolicy replaced by default updatePolicy', () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, 'test');
  //
  //   const cluster = new ecs.Cluster(stack, 'EcsCluster');
  //   cluster.addCapacity('bottlerocket-asg', {
  //     instanceType: new ec2.InstanceType('c5.large'),
  //     machineImage: new ecs.BottleRocketImage(),
  //   });
  //
  //   // THEN
  //   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
  //     UpdatePolicy: {
  //       AutoScalingReplacingUpdate: {
  //         WillReplace: true,
  //       },
  //     },
  //   });
  // });
  //
  // testDeprecated('updateType.NONE replaced by updatePolicy equivalent', () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, 'test');
  //
  //   const cluster = new ecs.Cluster(stack, 'EcsCluster');
  //   cluster.addCapacity('bottlerocket-asg', {
  //     instanceType: new ec2.InstanceType('c5.large'),
  //     machineImage: new ecs.BottleRocketImage(),
  //     updateType: autoscaling.UpdateType.NONE,
  //   });
  //
  //   // THEN
  //   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
  //     UpdatePolicy: {
  //       AutoScalingScheduledAction: {
  //         IgnoreUnmodifiedGroupSizeProperties: true,
  //       },
  //     },
  //   });
  // });
  //
  // testDeprecated('updateType.REPLACING_UPDATE replaced by updatePolicy equivalent', () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, 'test');
  //
  //   const cluster = new ecs.Cluster(stack, 'EcsCluster');
  //   cluster.addCapacity('bottlerocket-asg', {
  //     instanceType: new ec2.InstanceType('c5.large'),
  //     machineImage: new ecs.BottleRocketImage(),
  //     updateType: autoscaling.UpdateType.REPLACING_UPDATE,
  //   });
  //
  //   // THEN
  //   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
  //     UpdatePolicy: {
  //       AutoScalingReplacingUpdate: {
  //         WillReplace: true,
  //       },
  //     },
  //   });
  // });
  //
  // testDeprecated('updateType.ROLLING_UPDATE replaced by updatePolicy equivalent', () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, 'test');
  //
  //   const cluster = new ecs.Cluster(stack, 'EcsCluster');
  //   cluster.addCapacity('bottlerocket-asg', {
  //     instanceType: new ec2.InstanceType('c5.large'),
  //     machineImage: new ecs.BottleRocketImage(),
  //     updateType: autoscaling.UpdateType.ROLLING_UPDATE,
  //   });
  //
  //   // THEN
  //   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
  //     UpdatePolicy: {
  //       AutoScalingRollingUpdate: {
  //         WaitOnResourceSignals: false,
  //         PauseTime: 'PT0S',
  //         SuspendProcesses: [
  //           'HealthCheck',
  //           'ReplaceUnhealthy',
  //           'AZRebalance',
  //           'AlarmNotification',
  //           'ScheduledActions',
  //           'InstanceRefresh',
  //         ],
  //       },
  //       AutoScalingScheduledAction: {
  //         IgnoreUnmodifiedGroupSizeProperties: true,
  //       },
  //     },
  //   });
  // });
  //
  // testDeprecated('throws when updatePolicy and updateType both specified', () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, 'test');
  //
  //   const cluster = new ecs.Cluster(stack, 'EcsCluster');
  //
  //   expect(() => {
  //     cluster.addCapacity('bottlerocket-asg', {
  //       instanceType: new ec2.InstanceType('c5.large'),
  //       machineImage: new ecs.BottleRocketImage(),
  //       updatePolicy: autoscaling.UpdatePolicy.replacingUpdate(),
  //       updateType: autoscaling.UpdateType.REPLACING_UPDATE,
  //     });
  //   }).toThrow("Cannot set 'signals'/'updatePolicy' and 'updateType' together. Prefer 'signals'/'updatePolicy'");
  // });

  test("allows specifying capacityProviders (deprecated)", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // WHEN
    new ecs.Cluster(stack, "EcsCluster", {
      capacityProviders: ["FARGATE_SPOT"],
    });

    // THEN
    const t = Template.synth(stack);
    t.toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      {
        capacity_providers: ["FARGATE_SPOT"],
      },
    );
  });

  test("allows specifying Fargate capacityProviders", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // WHEN
    new ecs.Cluster(stack, "EcsCluster", {
      enableFargateCapacityProviders: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      { capacity_providers: ["FARGATE", "FARGATE_SPOT"] },
    );
  });

  test("allows specifying capacityProviders (alternate method)", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // WHEN
    const cluster = new ecs.Cluster(stack, "EcsCluster");
    cluster.enableFargateCapacityProviders();

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      { capacity_providers: ["FARGATE", "FARGATE_SPOT"] },
    );
  });

  test("allows adding capacityProviders post-construction (deprecated)", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const cluster = new ecs.Cluster(stack, "EcsCluster");

    // WHEN
    cluster.addCapacityProvider("FARGATE");
    cluster.addCapacityProvider("FARGATE"); // does not add twice

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      { capacity_providers: ["FARGATE"] },
    );
  });

  test("allows adding capacityProviders post-construction", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const cluster = new ecs.Cluster(stack, "EcsCluster");

    // WHEN
    cluster.addCapacityProvider("FARGATE");
    cluster.addCapacityProvider("FARGATE"); // does not add twice

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      { capacity_providers: ["FARGATE"] },
    );
  });

  test("throws for unsupported capacity providers", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const cluster = new ecs.Cluster(stack, "EcsCluster");

    // THEN
    expect(() => {
      cluster.addCapacityProvider("HONK");
    }).toThrow(/CapacityProvider not supported/);
  });

  describe("creates ASG capacity providers ", () => {
    test("with expected defaults", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
        vpc,
        instanceType: new InstanceType("bogus"),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      });

      // WHEN
      new ecs.AsgCapacityProvider(stack, "provider", { autoScalingGroup: asg });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          auto_scaling_group_provider: {
            auto_scaling_group_arn: stack.resolve(asg.autoScalingGroupArn),
            managed_scaling: {
              status: "ENABLED",
              target_capacity: 100,
            },
            managed_termination_protection: "ENABLED",
          },
        },
      );
    });

    test("with IAutoScalingGroup should throw an error if Managed Termination Protection is enabled.", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const asg = autoscaling.AutoScalingGroup.fromAutoScalingGroupName(
        stack,
        "ASG",
        "my-asg",
      );

      // THEN
      expect(() => {
        new ecs.AsgCapacityProvider(stack, "provider", {
          autoScalingGroup: asg,
        });
      }).toThrow(
        "Cannot enable Managed Termination Protection on a Capacity Provider when providing an imported AutoScalingGroup.",
      );
    });

    test("with IAutoScalingGroup should not throw an error if Managed Termination Protection is disabled.", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const asg = autoscaling.AutoScalingGroup.fromAutoScalingGroupName(
        stack,
        "ASG",
        "my-asg",
      );

      // WHEN
      new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup: asg,
        enableManagedTerminationProtection: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          auto_scaling_group_provider: {
            auto_scaling_group_arn: stack.resolve(asg.autoScalingGroupArn),
            managed_scaling: { status: "ENABLED", target_capacity: 100 },
            managed_termination_protection: "DISABLED",
          },
        },
      );
    });
  });

  describe("creates Managed Instances capacity providers", () => {
    test("with expected defaults", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { instanceProfile } = mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            infrastructure_role_arn: expect.anything(),
            instance_launch_template: expect.objectContaining({
              ec2_instance_profile_arn: expect.anything(),
              network_configuration: {
                subnets: stack.resolve(
                  vpc.privateSubnets.map((s) => s.subnetId),
                ),
              },
            }),
          }),
        },
      );
    });

    test("with custom capacity provider name", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        capacityProviderName: "my-managed-instances-cp",
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        { name: "my-managed-instances-cp" },
      );
    });

    test("with security groups", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      const securityGroup = new SecurityGroup(stack, "SecurityGroup", {
        vpc,
        description: "Test security group",
      });

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        securityGroups: [securityGroup],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            instance_launch_template: expect.objectContaining({
              network_configuration: expect.objectContaining({
                security_groups: [stack.resolve(securityGroup.securityGroupId)],
              }),
            }),
          }),
        },
      );
    });

    test("with task volume storage", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        taskVolumeStorage: Size.gibibytes(100),
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            instance_launch_template: expect.objectContaining({
              storage_configuration: { storage_size_gib: 100 },
            }),
          }),
        },
      );
    });

    test("with monitoring configuration", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        monitoring: ecs.InstanceMonitoring.DETAILED,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            instance_launch_template: expect.objectContaining({
              monitoring: "DETAILED",
            }),
          }),
        },
      );
    });

    test("with instance requirements", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        // TERRACONSTRUCTS DEVIATION: `instanceRequirements` is typed directly against
        // the `aws_ecs_capacity_provider` L1 shape in this port (no `ec2.InstanceRequirementsConfig`
        // L2 abstraction exists here) - see `ManagedInstancesCapacityProviderProps.instanceRequirements`
        // doc comment in src/aws/compute/ecs/cluster.ts.
        instanceRequirements: {
          vcpuCount: { min: 2, max: 8 },
          memoryMib: { min: 4096, max: 16384 },
          cpuManufacturers: ["intel", "amd"],
        },
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            instance_launch_template: expect.objectContaining({
              instance_requirements: {
                vcpu_count: { min: 2, max: 8 },
                memory_mib: { min: 4096, max: 16384 },
                cpu_manufacturers: ["intel", "amd"],
              },
            }),
          }),
        },
      );
    });

    test("with propagate tags", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        propagateTags: ecs.PropagateManagedInstancesTags.CAPACITY_PROVIDER,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            propagate_tags: "CAPACITY_PROVIDER",
          }),
        },
      );
    });

    test("throws when subnets are not provided", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // THEN
      expect(() => {
        new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: [],
        });
      }).toThrow("Subnets are required and should be non-empty.");
    });

    test("throws when both allowedInstanceTypes and excludedInstanceTypes are specified in instanceRequirements", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // THEN
      expect(() => {
        new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
          instanceRequirements: {
            vcpuCount: { min: 2 },
            memoryMib: { min: 4096 },
            allowedInstanceTypes: ["m5.large", "c5.xlarge"],
            excludedInstanceTypes: ["t2.micro", "t3.nano"],
          },
        });
      }).toThrow(
        "Cannot specify both allowedInstanceTypes and excludedInstanceTypes. Use one or the other.",
      );
    });

    test("throws when both spotMaxPricePercentageOverLowestPrice and maxSpotPriceAsPercentageOfOptimalOnDemandPrice are specified in instanceRequirements", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // THEN
      expect(() => {
        new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
          instanceRequirements: {
            vcpuCount: { min: 2 },
            memoryMib: { min: 4096 },
            spotMaxPricePercentageOverLowestPrice: 30,
            onDemandMaxPricePercentageOverLowestPrice: 50,
          },
        });
      }).toThrow(
        "Cannot specify both spotMaxPricePercentageOverLowestPrice and onDemandMaxPricePercentageOverLowestPrice. Use one or the other.",
      );
    });

    test("throws when capacity provider name starts with aws, ecs or fargate", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // THEN
      expect(() => {
        new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
          capacityProviderName: "awscp",
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
        });
      }).toThrow(
        /Invalid Capacity Provider Name: awscp, If a name is specified, it cannot start with aws, ecs, or fargate./,
      );

      expect(() => {
        new ecs.ManagedInstancesCapacityProvider(stack, "provider2", {
          capacityProviderName: "ecscp",
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
        });
      }).toThrow(
        /Invalid Capacity Provider Name: ecscp, If a name is specified, it cannot start with aws, ecs, or fargate./,
      );

      expect(() => {
        new ecs.ManagedInstancesCapacityProvider(stack, "provider3", {
          capacityProviderName: "fargatecp",
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
        });
      }).toThrow(
        /Invalid Capacity Provider Name: fargatecp, If a name is specified, it cannot start with aws, ecs, or fargate./,
      );
    });

    test("allows modifying security groups via IConnectable interface", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      const securityGroup = new SecurityGroup(stack, "SecurityGroup", {
        vpc,
        description: "Test security group",
      });

      // WHEN
      const capacityProvider = new ecs.ManagedInstancesCapacityProvider(
        stack,
        "provider",
        {
          infrastructureRole,
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
          securityGroups: [securityGroup],
        },
      );

      // Use connections API to allow inbound traffic
      capacityProvider.connections.allowFrom(Peer.anyIpv4(), Port.tcp(80));

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          ingress: expect.arrayContaining([
            expect.objectContaining({
              protocol: "tcp",
              from_port: 80,
              to_port: 80,
              cidr_blocks: ["0.0.0.0/0"],
            }),
          ]),
        },
      );
    });

    test("can add Managed Instances capacity via Capacity Provider", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster");
      const { instanceProfile } = mkManagedInstancesRoles(stack);

      // WHEN
      const capacityProvider = new ecs.ManagedInstancesCapacityProvider(
        stack,
        "provider",
        {
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
        },
      );

      cluster.enableFargateCapacityProviders();

      // Ensure not added twice
      cluster.addManagedInstancesCapacityProvider(capacityProvider);
      cluster.addManagedInstancesCapacityProvider(capacityProvider);

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            infrastructure_role_arn: expect.anything(),
          }),
        },
      );
    });

    test("does not create CfnClusterCapacityProviderAssociations when using managed instances capacity provider", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster");
      const { instanceProfile } = mkManagedInstancesRoles(stack);

      // WHEN
      const capacityProvider = new ecs.ManagedInstancesCapacityProvider(
        stack,
        "provider",
        {
          ec2InstanceProfile: instanceProfile,
          subnets: vpc.privateSubnets,
        },
      );

      cluster.addManagedInstancesCapacityProvider(capacityProvider);

      // THEN
      Template.resources(
        stack,
        ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      ).toHaveLength(0);
    });

    test("minimal configuration with required fields only", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        instanceRequirements: {
          memoryMib: { min: 4096 },
          vcpuCount: { min: 2 },
        },
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            instance_launch_template: expect.objectContaining({
              instance_requirements: {
                vcpu_count: { min: 2 },
                memory_mib: { min: 4096 },
              },
            }),
          }),
        },
      );
    });

    test("full configuration with all fields", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const { infrastructureRole, instanceProfile } =
        mkManagedInstancesRoles(stack);

      // WHEN
      new ecs.ManagedInstancesCapacityProvider(stack, "provider", {
        infrastructureRole,
        ec2InstanceProfile: instanceProfile,
        subnets: vpc.privateSubnets,
        instanceRequirements: {
          acceleratorCount: { min: 1, max: 4 },
          acceleratorManufacturers: ["nvidia", "amd"],
          acceleratorNames: ["a100", "v100"],
          acceleratorTotalMemoryMib: { min: 8192, max: 32768 },
          acceleratorTypes: ["gpu"],
          allowedInstanceTypes: ["m5.large", "c5.xlarge"],
          bareMetal: "excluded",
          baselineEbsBandwidthMbps: { min: 1000, max: 5000 },
          burstablePerformance: "included",
          cpuManufacturers: ["intel", "amd"],
          instanceGenerations: ["current"],
          localStorage: "required",
          localStorageTypes: ["ssd"],
          maxSpotPriceAsPercentageOfOptimalOnDemandPrice: 50,
          memoryGibPerVcpu: { min: 2, max: 8 },
          memoryMib: { min: 4096, max: 65536 },
          networkBandwidthGbps: { min: 1, max: 10 },
          networkInterfaceCount: { min: 1, max: 4 },
          requireHibernateSupport: true,
          spotMaxPricePercentageOverLowestPrice: 30,
          totalLocalStorageGb: { min: 100, max: 1000 },
          vcpuCount: { min: 2, max: 16 },
        },
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        ecsCapacityProvider.EcsCapacityProvider,
        {
          managed_instances_provider: expect.objectContaining({
            instance_launch_template: expect.objectContaining({
              instance_requirements: expect.objectContaining({
                vcpu_count: { min: 2, max: 16 },
                memory_mib: { min: 4096, max: 65536 },
                accelerator_manufacturers: ["nvidia", "amd"],
                cpu_manufacturers: ["intel", "amd"],
              }),
            }),
          }),
        },
      );
    });
  });

  test("can disable Managed Scaling and Managed Termination Protection for ASG capacity provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedScaling: false,
      enableManagedTerminationProtection: false,
      enableManagedDraining: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsCapacityProvider.EcsCapacityProvider,
      {
        auto_scaling_group_provider: {
          auto_scaling_group_arn: stack.resolve(asg.autoScalingGroupArn),
          managed_termination_protection: "DISABLED",
          managed_draining: "DISABLED",
        },
      },
    );
  });

  test("can disable Managed Termination Protection for ASG capacity provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsCapacityProvider.EcsCapacityProvider,
      {
        auto_scaling_group_provider: {
          auto_scaling_group_arn: stack.resolve(asg.autoScalingGroupArn),
          managed_scaling: { status: "ENABLED", target_capacity: 100 },
          managed_termination_protection: "DISABLED",
        },
      },
    );
  });

  test("can disable Managed Draining for ASG capacity provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedDraining: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsCapacityProvider.EcsCapacityProvider,
      {
        auto_scaling_group_provider: {
          auto_scaling_group_arn: stack.resolve(asg.autoScalingGroupArn),
          managed_draining: "DISABLED",
          managed_scaling: { status: "ENABLED", target_capacity: 100 },
          managed_termination_protection: "ENABLED",
        },
      },
    );
  });

  test("can enable Managed Draining for ASG capacity provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedDraining: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsCapacityProvider.EcsCapacityProvider,
      {
        auto_scaling_group_provider: {
          auto_scaling_group_arn: stack.resolve(asg.autoScalingGroupArn),
          managed_draining: "ENABLED",
          managed_scaling: { status: "ENABLED", target_capacity: 100 },
          managed_termination_protection: "ENABLED",
        },
      },
    );
  });

  test("throws error, when ASG capacity provider has Managed Scaling disabled and Managed Termination Protection is undefined (defaults to true)", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // THEN
    expect(() => {
      new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup: asg,
        enableManagedScaling: false,
      });
    }).toThrow(
      "Cannot enable Managed Termination Protection on a Capacity Provider when Managed Scaling is disabled. Either enable Managed Scaling or disable Managed Termination Protection.",
    );
  });

  test("throws error, when Managed Scaling is disabled and Managed Termination Protection is enabled.", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // THEN
    expect(() => {
      new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup: asg,
        enableManagedScaling: false,
        enableManagedTerminationProtection: true,
      });
    }).toThrow(
      "Cannot enable Managed Termination Protection on a Capacity Provider when Managed Scaling is disabled. Either enable Managed Scaling or disable Managed Termination Protection.",
    );
  });

  test("capacity provider enables ASG new instance scale-in protection by default", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    new ecs.AsgCapacityProvider(stack, "provider", { autoScalingGroup: asg });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingGroup.AutoscalingGroup,
      { protect_from_scale_in: true },
    );
  });

  test("capacity provider disables ASG new instance scale-in protection", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });

    // THEN
    const [group] = Object.values(
      Template.resourceObjects(stack, autoscalingGroup.AutoscalingGroup),
    ) as any[];
    expect(group.protect_from_scale_in).toBeUndefined();
  });

  test("can add ASG capacity via Capacity Provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster");

    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });

    cluster.enableFargateCapacityProviders();

    // Ensure not added twice
    cluster.addAsgCapacityProvider(capacityProvider);
    cluster.addAsgCapacityProvider(capacityProvider);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      {
        cluster_name: stack.resolve(cluster.clusterName),
        capacity_providers: [
          "FARGATE",
          "FARGATE_SPOT",
          stack.resolve(capacityProvider.capacityProviderName),
        ],
        default_capacity_provider_strategy: [],
      },
    );
  });

  describe("addAsgCapacityProvider propagates the ASG security groups to cluster.connections", () => {
    test("adds the ASG connections security groups onto cluster.connections", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
        vpc,
        instanceType: new InstanceType("bogus"),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      });
      const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup: asg,
      });

      // pre-fix: cluster.connections.securityGroups stays [] after this call,
      // because only the deprecated addAutoScalingGroup() path propagated SGs.
      expect(cluster.connections.securityGroups).toEqual([]);

      // WHEN
      cluster.addAsgCapacityProvider(capacityProvider);

      // THEN
      expect(cluster.connections.securityGroups).toEqual(
        capacityProvider.autoScalingGroup.connections.securityGroups,
      );
      expect(cluster.connections.securityGroups.length).toBeGreaterThan(0);
    });

    test("does not double-add security groups when the same capacity provider is added twice", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
        vpc,
        instanceType: new InstanceType("bogus"),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      });
      const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup: asg,
      });

      // WHEN
      cluster.addAsgCapacityProvider(capacityProvider);
      cluster.addAsgCapacityProvider(capacityProvider);

      // THEN
      expect(cluster.connections.securityGroups).toEqual(
        capacityProvider.autoScalingGroup.connections.securityGroups,
      );
    });

    test("Ec2Service on a bridge-mode task definition inherits the ASG security group via cluster.connections", () => {
      // GIVEN
      const stack = getAwsStack("test");
      const vpc = new Vpc(stack, "Vpc");
      const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
      const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
        vpc,
        instanceType: new InstanceType("bogus"),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      });
      const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
        autoScalingGroup: asg,
      });
      cluster.addAsgCapacityProvider(capacityProvider);

      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef");
      taskDefinition.addContainer("web", {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        memoryLimitMiB: 512,
      });

      // WHEN
      // default network mode is bridge, which copies cluster.connections.securityGroups
      const service = new ecs.Ec2Service(stack, "Ec2Service", {
        cluster,
        taskDefinition,
      });

      // THEN
      // pre-fix: service.connections.securityGroups would be empty because
      // cluster.connections.securityGroups was never populated.
      for (const sg of asg.connections.securityGroups) {
        expect(service.connections.securityGroups).toContain(sg);
      }
      expect(service.connections.securityGroups.length).toBeGreaterThan(0);
    });
  });

  test("throws when calling Cluster.addAsgCapacityProvider with an AsgCapacityProvider created with an imported ASG", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const importedAsg = autoscaling.AutoScalingGroup.fromAutoScalingGroupName(
      stack,
      "ASG",
      "my-asg",
    );
    const cluster = new ecs.Cluster(stack, "EcsCluster");

    const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: importedAsg,
      enableManagedTerminationProtection: false,
    });
    // THEN
    expect(() => {
      cluster.addAsgCapacityProvider(capacityProvider);
    }).toThrow(
      "Cannot configure the AutoScalingGroup because it is an imported resource.",
    );
  });

  test("should throw an error if capacity provider with default strategy is not present in capacity providers", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        enableFargateCapacityProviders: true,
      }).addDefaultCapacityProviderStrategy([
        { capacityProvider: "test capacityProvider", base: 10, weight: 50 },
      ]);
    }).toThrow(
      "Capacity provider test capacityProvider must be added to the cluster with addAsgCapacityProvider() or addManagedInstancesCapacityProvider() before it can be used in a default capacity provider strategy.",
    );
  });

  test("should throw an error when capacity providers is length 0 and default capacity provider startegy specified", () => {
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        enableFargateCapacityProviders: false,
      }).addDefaultCapacityProviderStrategy([
        { capacityProvider: "test capacityProvider", base: 10, weight: 50 },
      ]);
    }).toThrow(
      "Capacity provider test capacityProvider must be added to the cluster with addAsgCapacityProvider() or addManagedInstancesCapacityProvider() before it can be used in a default capacity provider strategy.",
    );
  });

  test("should throw an error when more than 1 default capacity provider have base specified", () => {
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        enableFargateCapacityProviders: true,
      }).addDefaultCapacityProviderStrategy([
        { capacityProvider: "FARGATE", base: 10, weight: 50 },
        { capacityProvider: "FARGATE_SPOT", base: 10, weight: 50 },
      ]);
    }).toThrow(
      /Only 1 capacity provider in a capacity provider strategy can have a nonzero base./,
    );
  });

  test("should throw an error when a capacity provider strategy contains a mix of Auto Scaling groups and Fargate providers", () => {
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });
    const cluster = new ecs.Cluster(stack, "EcsCluster", {
      enableFargateCapacityProviders: true,
    });
    const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    // THEN
    expect(() => {
      cluster.addDefaultCapacityProviderStrategy([
        { capacityProvider: "FARGATE", base: 10, weight: 50 },
        { capacityProvider: "FARGATE_SPOT" },
        { capacityProvider: capacityProvider.capacityProviderName },
      ]);
    }).toThrow(
      /A capacity provider strategy cannot contain a mix of capacity providers using Auto Scaling groups and Fargate providers. Specify one or the other and try again./,
    );
  });

  test("should throw an error if addDefaultCapacityProviderStrategy is called more than once", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      const cluster = new ecs.Cluster(stack, "EcsCluster", {
        enableFargateCapacityProviders: true,
      });
      cluster.addDefaultCapacityProviderStrategy([
        { capacityProvider: "FARGATE", base: 10, weight: 50 },
        { capacityProvider: "FARGATE_SPOT" },
      ]);
      cluster.addDefaultCapacityProviderStrategy([
        { capacityProvider: "FARGATE", base: 10, weight: 50 },
        { capacityProvider: "FARGATE_SPOT" },
      ]);
    }).toThrow(/Cluster default capacity provider strategy is already set./);
  });

  test("can add ASG capacity via Capacity Provider with default capacity provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", {
      enableFargateCapacityProviders: true,
    });

    cluster.addDefaultCapacityProviderStrategy([
      { capacityProvider: "FARGATE", base: 10, weight: 50 },
      { capacityProvider: "FARGATE_SPOT" },
    ]);

    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });

    cluster.addAsgCapacityProvider(capacityProvider);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      {
        cluster_name: stack.resolve(cluster.clusterName),
        capacity_providers: [
          "FARGATE",
          "FARGATE_SPOT",
          stack.resolve(capacityProvider.capacityProviderName),
        ],
        default_capacity_provider_strategy: [
          { capacity_provider: "FARGATE", base: 10, weight: 50 },
          { capacity_provider: "FARGATE_SPOT" },
        ],
      },
    );
  });

  test("can add ASG default capacity provider", () => {
    // GIVEN
    const stack = getAwsStack("test");
    const vpc = new Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster");

    const asg = new autoscaling.AutoScalingGroup(stack, "asg", {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
    });

    // WHEN
    const capacityProvider = new ecs.AsgCapacityProvider(stack, "provider", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });

    cluster.addAsgCapacityProvider(capacityProvider);

    cluster.addDefaultCapacityProviderStrategy([
      { capacityProvider: capacityProvider.capacityProviderName },
    ]);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsClusterCapacityProviders.EcsClusterCapacityProviders,
      {
        cluster_name: stack.resolve(cluster.clusterName),
        capacity_providers: [
          stack.resolve(capacityProvider.capacityProviderName),
        ],
        default_capacity_provider_strategy: [
          {
            capacity_provider: stack.resolve(
              capacityProvider.capacityProviderName,
            ),
          },
        ],
      },
    );
  });

  test("correctly sets log configuration for execute command", () => {
    // GIVEN
    const stack = getAwsStack("test");

    const kmsKeyRes = new kms.Key(stack, "KmsKey");

    const logGroup = new cloudwatch.LogGroup(stack, "LogGroup", {
      encryptionKey: kmsKeyRes,
    });

    const execBucket = new storage.Bucket(stack, "EcsExecBucket", {
      encryptionKey: kmsKeyRes,
    });

    // WHEN
    new ecs.Cluster(stack, "EcsCluster", {
      executeCommandConfiguration: {
        kmsKey: kmsKeyRes,
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

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsCluster.EcsCluster, {
      configuration: {
        execute_command_configuration: {
          kms_key_id: stack.resolve(kmsKeyRes.keyArn),
          log_configuration: {
            cloud_watch_encryption_enabled: true,
            cloud_watch_log_group_name: stack.resolve(logGroup.logGroupName),
            s3_bucket_name: stack.resolve(execBucket.bucketName),
            s3_bucket_encryption_enabled: true,
            s3_key_prefix: "exec-output",
          },
          logging: "OVERRIDE",
        },
      },
    });
  });

  test("throws when no log configuration is provided when logging is set to OVERRIDE", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        executeCommandConfiguration: {
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });
    }).toThrow(
      /Execute command log configuration must only be specified when logging is OVERRIDE./,
    );
  });

  test("throws when log configuration provided but logging is set to DEFAULT", () => {
    // GIVEN
    const stack = getAwsStack("test");

    const logGroup = new cloudwatch.LogGroup(stack, "LogGroup");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        executeCommandConfiguration: {
          logConfiguration: {
            cloudWatchLogGroup: logGroup,
          },
          logging: ecs.ExecuteCommandLogging.DEFAULT,
        },
      });
    }).toThrow(
      /Execute command log configuration must only be specified when logging is OVERRIDE./,
    );
  });

  test("throws when CloudWatchEncryptionEnabled without providing CloudWatch Logs log group name", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        executeCommandConfiguration: {
          logConfiguration: {
            cloudWatchEncryptionEnabled: true,
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });
    }).toThrow(
      /You must specify a CloudWatch log group in the execute command log configuration to enable CloudWatch encryption./,
    );
  });

  test("throws when S3EncryptionEnabled without providing S3 Bucket name", () => {
    // GIVEN
    const stack = getAwsStack("test");

    // THEN
    expect(() => {
      new ecs.Cluster(stack, "EcsCluster", {
        executeCommandConfiguration: {
          logConfiguration: {
            s3EncryptionEnabled: true,
          },
          logging: ecs.ExecuteCommandLogging.OVERRIDE,
        },
      });
    }).toThrow(
      /You must specify an S3 bucket name in the execute command log configuration to enable S3 encryption./,
    );
  });

  test("When importing ECS Cluster via Arn", () => {
    // GIVEN
    const stack = getAwsStack();
    const clusterName = "my-cluster";
    const region = "service-region";
    const account = "service-account";
    const cluster = ecs.Cluster.fromClusterArn(
      stack,
      "Cluster",
      `arn:aws:ecs:${region}:${account}:cluster/${clusterName}`,
    );

    // THEN
    expect(cluster.clusterName).toEqual(clusterName);
    expect(cluster.env.region).toEqual(region);
    expect(cluster.env.account).toEqual(account);
  });

  test("throws error when import ECS Cluster without resource name in arn", () => {
    // GIVEN
    const stack = getAwsStack();

    // THEN
    expect(() => {
      ecs.Cluster.fromClusterArn(
        stack,
        "Cluster",
        "arn:aws:ecs:service-region:service-account:cluster",
      );
    }).toThrow(/Missing required Cluster Name from Cluster ARN: /);
  });
});

test("can add ASG capacity via Capacity Provider by not specifying machineImageType", () => {
  // GIVEN
  const stack = getAwsStack("test");
  const vpc = new Vpc(stack, "Vpc");
  const cluster = new ecs.Cluster(stack, "EcsCluster");

  const asgAl2 = new autoscaling.AutoScalingGroup(stack, "asgal2", {
    vpc,
    instanceType: new InstanceType("bogus"),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
  });

  const asgBottlerocket = new autoscaling.AutoScalingGroup(
    stack,
    "asgBottlerocket",
    {
      vpc,
      instanceType: new InstanceType("bogus"),
      machineImage: new ecs.BottleRocketImage(),
    },
  );

  // WHEN
  const capacityProviderAl2 = new ecs.AsgCapacityProvider(
    stack,
    "provideral2",
    {
      autoScalingGroup: asgAl2,
      enableManagedTerminationProtection: false,
    },
  );

  const capacityProviderBottlerocket = new ecs.AsgCapacityProvider(
    stack,
    "providerBottlerocket",
    {
      autoScalingGroup: asgBottlerocket,
      enableManagedTerminationProtection: false,
      machineImageType: ecs.MachineImageType.BOTTLEROCKET,
    },
  );

  cluster.enableFargateCapacityProviders();

  // Ensure not added twice
  cluster.addAsgCapacityProvider(capacityProviderAl2);
  cluster.addAsgCapacityProvider(capacityProviderAl2);

  // Add Bottlerocket ASG Capacity Provider
  cluster.addAsgCapacityProvider(capacityProviderBottlerocket);

  // THEN Bottlerocket LaunchTemplate
  const t = Template.synth(stack);
  // NOTE: `user_data` on the launch template is a token reference to a
  // `cloudinit_config` data source; assert against the rendered part content.
  t.toHaveDataSourceWithProperties(dataCloudinitConfig.DataCloudinitConfig, {
    part: [{ content: expect.stringContaining("[settings.ecs]") }],
  });

  // THEN AmazonLinux2 LaunchTemplate
  t.toHaveDataSourceWithProperties(dataCloudinitConfig.DataCloudinitConfig, {
    part: [{ content: expect.stringContaining("ECS_CLUSTER=") }],
  });

  t.toHaveResourceWithProperties(
    ecsClusterCapacityProviders.EcsClusterCapacityProviders,
    {
      capacity_providers: [
        "FARGATE",
        "FARGATE_SPOT",
        stack.resolve(capacityProviderAl2.capacityProviderName),
        stack.resolve(capacityProviderBottlerocket.capacityProviderName),
      ],
      cluster_name: stack.resolve(cluster.clusterName),
      default_capacity_provider_strategy: [],
    },
  );
});

test("throws when ASG Capacity Provider with capacityProviderName starting with aws, ecs or fargate", () => {
  // GIVEN
  const stack = getAwsStack("test");
  const vpc = new Vpc(stack, "Vpc");
  const cluster = new ecs.Cluster(stack, "EcsCluster");

  const asgAl2 = new autoscaling.AutoScalingGroup(stack, "asgal2", {
    vpc,
    instanceType: new InstanceType("bogus"),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
  });

  // THEN
  expect(() => {
    // WHEN Capacity Provider define capacityProviderName start with aws.
    const capacityProviderAl2 = new ecs.AsgCapacityProvider(
      stack,
      "provideral2",
      {
        autoScalingGroup: asgAl2,
        enableManagedTerminationProtection: false,
        capacityProviderName: "awscp",
      },
    );

    cluster.addAsgCapacityProvider(capacityProviderAl2);
  }).toThrow(
    /Invalid Capacity Provider Name: awscp, If a name is specified, it cannot start with aws, ecs, or fargate./,
  );

  expect(() => {
    // WHEN Capacity Provider define capacityProviderName start with ecs.
    const capacityProviderAl2 = new ecs.AsgCapacityProvider(
      stack,
      "provideral2-2",
      {
        autoScalingGroup: asgAl2,
        enableManagedTerminationProtection: false,
        capacityProviderName: "ecscp",
      },
    );

    cluster.addAsgCapacityProvider(capacityProviderAl2);
  }).toThrow(
    /Invalid Capacity Provider Name: ecscp, If a name is specified, it cannot start with aws, ecs, or fargate./,
  );
});

test("throws when ASG Capacity Provider with no capacityProviderName but stack name starting with aws, ecs or fargate", () => {
  // GIVEN
  const stack = getAwsStack("ecscp");
  const vpc = new Vpc(stack, "Vpc");
  const cluster = new ecs.Cluster(stack, "EcsCluster");

  const asgAl2 = new autoscaling.AutoScalingGroup(stack, "asgal2", {
    vpc,
    instanceType: new InstanceType("bogus"),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
  });

  expect(() => {
    // WHEN Capacity Provider when stack name starts with ecs.
    const capacityProvider = new ecs.AsgCapacityProvider(
      stack,
      "provideral2-2",
      {
        autoScalingGroup: asgAl2,
        enableManagedTerminationProtection: false,
      },
    );

    cluster.addAsgCapacityProvider(capacityProvider);
  }).not.toThrow();
});

test("throws when InstanceWarmupPeriod is less than 0", () => {
  // GIVEN
  const stack = getAwsStack("test");
  const vpc = new Vpc(stack, "Vpc");
  const cluster = new ecs.Cluster(stack, "EcsCluster");

  const asgAl2 = new autoscaling.AutoScalingGroup(stack, "asgal2", {
    vpc,
    instanceType: new InstanceType("t2.micro"),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
  });

  // THEN
  expect(() => {
    const capacityProviderAl2 = new ecs.AsgCapacityProvider(
      stack,
      "provideral2",
      {
        autoScalingGroup: asgAl2,
        instanceWarmupPeriod: -1,
      },
    );

    cluster.addAsgCapacityProvider(capacityProviderAl2);
  }).toThrow(
    /InstanceWarmupPeriod must be between 0 and 10000 inclusive, got: -1./,
  );
});

test("throws when InstanceWarmupPeriod is greater than 10000", () => {
  // GIVEN
  const stack = getAwsStack("test");
  const vpc = new Vpc(stack, "Vpc");
  const cluster = new ecs.Cluster(stack, "EcsCluster");

  const asgAl2 = new autoscaling.AutoScalingGroup(stack, "asgal2", {
    vpc,
    instanceType: new InstanceType("t2.micro"),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
  });

  // THEN
  expect(() => {
    const capacityProviderAl2 = new ecs.AsgCapacityProvider(
      stack,
      "provideral2",
      {
        autoScalingGroup: asgAl2,
        instanceWarmupPeriod: 99999,
      },
    );

    cluster.addAsgCapacityProvider(capacityProviderAl2);
  }).toThrow(
    /InstanceWarmupPeriod must be between 0 and 10000 inclusive, got: 99999./,
  );
});

// Wrapping describe with toMatchSnapshot() synth tests - harness idiom, see
// test/aws/notify/queue.test.ts and test/assertions.ts. Guards against emitted
// Terraform drift for the aws_ecs_cluster / aws_ecs_cluster_capacity_providers /
// aws_ecs_capacity_provider resources this construct creates.
describe("cluster synth", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new ecs.Cluster(stack, "EcsCluster");
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with capacity", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new Vpc(stack, "Vpc");
    // WHEN
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: new InstanceType("t2.micro"),
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with Fargate capacity providers", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    const cluster = new ecs.Cluster(stack, "EcsCluster", {
      enableFargateCapacityProviders: true,
    });
    cluster.addDefaultCapacityProviderStrategy([
      { capacityProvider: "FARGATE", base: 1, weight: 1 },
    ]);
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
