// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/instance.test.ts

import * as path from "node:path";
import {
  instance as tfInstance,
  networkInterface as tfNetworkInterface,
  launchTemplate as tfLaunchTemplate,
  dataAwsIamPolicyDocument,
  iamInstanceProfile,
  iamRole,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
// import { Duration } from "../../../src/";
import { AwsStack } from "../../../src/aws";
import {
  AmazonLinuxImage,
  BlockDeviceVolume,
  // CloudFormationInit,
  EbsDeviceVolumeType,
  // InitCommand,
  Instance,
  InstanceArchitecture,
  InstanceClass,
  InstanceSize,
  InstanceType,
  // NOTE: IMDSv2 creates L1 LT
  // LaunchTemplate,
  UserData,
  Vpc,
  SubnetType,
  SecurityGroup,
  WindowsImage,
  WindowsVersion,
  KeyPair,
  KeyPairType,
  CpuCredits,
  InstanceInitiatedShutdownBehavior,
  PlacementGroup,
} from "../../../src/aws/compute";
import { Key } from "../../../src/aws/encryption";
import { InstanceProfile, Role, ServicePrincipal } from "../../../src/aws/iam";
import { Bucket, StringParameter } from "../../../src/aws/storage";
import { Annotations, Template } from "../../assertions";
// import { Asset } from "../../aws-s3-assets";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let app: App;
let stack: AwsStack;
let vpc: Vpc;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new Vpc(stack, "VPC");
});

describe("instance", () => {
  test("instance is created with source/dest check switched off", () => {
    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      sourceDestCheck: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      instance_type: "t3.large",
      source_dest_check: false,
    });
  });
  test("instance is grantable", () => {
    // GIVEN
    const param = new StringParameter(stack, "Param", {
      stringValue: "Foobar",
    });
    const instance = new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
    });

    // WHEN
    param.grantRead(instance);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "ssm:DescribeParameters",
              "ssm:GetParameters",
              "ssm:GetParameter",
              "ssm:GetParameterHistory",
            ],
            effect: "Allow",
            resources: [stack.resolve(param.parameterArn)],
            // {
            //   "Fn::Join": [
            //     "",
            //     [
            //       "arn:",
            //       {
            //         Ref: "AWS::Partition",
            //       },
            //       ":ssm:",
            //       {
            //         Ref: "AWS::Region",
            //       },
            //       ":",
            //       {
            //         Ref: "AWS::AccountId",
            //       },
            //       ":parameter/",
            //       {
            //         Ref: "Param165332EC",
            //       },
            //     ],
            //   ],
            // },
          },
        ],
      },
    );
  });
  test("instance architecture is correctly discerned for arm instances", () => {
    // GIVEN
    const sampleInstanceClasses = [
      // current Graviton-based instance classes
      "a1",
      "t4g",
      "c6g",
      "c7g",
      "c6gd",
      "c6gn",
      "c7g",
      "c7gd",
      "m6g",
      "m6gd",
      "m7g",
      "m7gd",
      "r6g",
      "r6gd",
      "r7g",
      "r7gd",
      "g5g",
      "im4gn",
      "is4gen",
      // theoretical future Graviton-based instance classes
      "a13",
      "t11g",
      "y10ng",
      "z11ngd",
    ];

    for (const instanceClass of sampleInstanceClasses) {
      // WHEN
      const instanceType = InstanceType.of(
        instanceClass as InstanceClass,
        InstanceSize.XLARGE18,
      );

      // THEN
      expect(instanceType.architecture).toBe(InstanceArchitecture.ARM_64);
    }
  });
  test("instance architecture is correctly discerned for x86-64 instance", () => {
    // GIVEN
    const sampleInstanceClasses = [
      "c5",
      "m5ad",
      "r5n",
      "m6",
      "t3a",
      "r6i",
      "r6a",
      "g6",
      "p4de",
      "p5",
      "m7i-flex",
    ]; // A sample of x86-64 instance classes

    for (const instanceClass of sampleInstanceClasses) {
      // WHEN
      const instanceType = InstanceType.of(
        instanceClass as InstanceClass,
        InstanceSize.XLARGE18,
      );

      // THEN
      expect(instanceType.architecture).toBe(InstanceArchitecture.X86_64);
    }
  });

  test("sameInstanceClassAs compares InstanceTypes contains dashes", () => {
    // GIVEN
    const comparitor = InstanceType.of(
      InstanceClass.M7I_FLEX,
      InstanceSize.LARGE,
    );
    //WHEN
    const largerInstanceType = InstanceType.of(
      InstanceClass.M7I_FLEX,
      InstanceSize.XLARGE,
    );
    //THEN
    expect(largerInstanceType.sameInstanceClassAs(comparitor)).toBeTruthy();
  });

  test("sameInstanceClassAs compares InstanceSize contains dashes", () => {
    // GIVEN
    const comparitor = new InstanceType("c7a.metal-48xl");
    //WHEN
    const largerInstanceType = new InstanceType("c7a.xlarge");
    //THEN
    expect(largerInstanceType.sameInstanceClassAs(comparitor)).toBeTruthy();
  });

  test("instances with local NVME drive are correctly named", () => {
    // GIVEN
    const sampleInstanceClassKeys = [
      {
        key: InstanceClass.R5D,
        value: "r5d",
      },
      {
        key: InstanceClass.MEMORY5_NVME_DRIVE,
        value: "r5d",
      },
      {
        key: InstanceClass.R5AD,
        value: "r5ad",
      },
      {
        key: InstanceClass.MEMORY5_AMD_NVME_DRIVE,
        value: "r5ad",
      },
      {
        key: InstanceClass.M5AD,
        value: "m5ad",
      },
      {
        key: InstanceClass.STANDARD5_AMD_NVME_DRIVE,
        value: "m5ad",
      },
    ]; // A sample of instances with NVME drives

    for (const instanceClass of sampleInstanceClassKeys) {
      // WHEN
      const instanceType = InstanceType.of(
        instanceClass.key,
        InstanceSize.LARGE,
      );
      // THEN
      expect(instanceType.toString().split(".")[0]).toBe(instanceClass.value);
    }
  });
  test("instance architecture throws an error when instance type is invalid", () => {
    // GIVEN
    const malformedInstanceTypes = ["t4", "t4g.nano.", "t4gnano", ""];

    for (const malformedInstanceType of malformedInstanceTypes) {
      // WHEN
      const instanceType = new InstanceType(malformedInstanceType);

      // THEN
      expect(() => instanceType.architecture).toThrow(
        "Malformed instance type identifier",
      );
    }
  });
  test("can propagate EBS volume tags", () => {
    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      propagateTagsToVolumeOnCreation: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      volume_tags: {
        Name: "MyStack/Instance",
      },
    });
  });
  // placementGroup
  describe("placementGroup", () => {
    test("can set placementGroup", () => {
      // WHEN
      // create a new placementgroup
      const pg1 = new PlacementGroup(stack, "myPlacementGroup1");
      new PlacementGroup(stack, "myPlacementGroup2");
      new Instance(stack, "Instance1", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
        placementGroup: pg1,
      });
      new Instance(stack, "Instance2", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
        placementGroup: PlacementGroup.fromPlacementGroupName(
          stack,
          "importedPlacementGroup",
          "myPlacementGroup2",
        ),
      });

      const t = Template.synth(stack);
      // THEN
      t.toHaveResourceWithProperties(tfInstance.Instance, {
        placement_group: stack.resolve(pg1.placementGroupName),
        // {
        //   "Fn::GetAtt": ["myPlacementGroup180969E8B", "GroupName"],
        // },
      });
      t.toHaveResourceWithProperties(tfInstance.Instance, {
        placement_group: "myPlacementGroup2",
      });
    });
  });
  describe("blockDeviceMappings", () => {
    test("can set blockDeviceMappings", () => {
      // WHEN
      const kmsKey = new Key(stack, "EbsKey");
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
        blockDevices: [
          {
            deviceName: "ebs",
            mappingEnabled: true,
            volume: BlockDeviceVolume.ebs(15, {
              deleteOnTermination: true,
              encrypted: true,
              volumeType: EbsDeviceVolumeType.IO1,
              iops: 5000,
            }),
          },
          {
            deviceName: "ebs-gp3",
            mappingEnabled: true,
            volume: BlockDeviceVolume.ebs(15, {
              deleteOnTermination: true,
              encrypted: true,
              volumeType: EbsDeviceVolumeType.GP3,
              iops: 5000,
            }),
          },
          {
            deviceName: "ebs-cmk",
            mappingEnabled: true,
            volume: BlockDeviceVolume.ebs(15, {
              deleteOnTermination: true,
              encrypted: true,
              kmsKey: kmsKey,
              volumeType: EbsDeviceVolumeType.IO1,
              iops: 5000,
            }),
          },
          {
            deviceName: "ebs-snapshot",
            mappingEnabled: false,
            volume: BlockDeviceVolume.ebsFromSnapshot("snapshot-id", {
              volumeSize: 500,
              deleteOnTermination: false,
              volumeType: EbsDeviceVolumeType.SC1,
            }),
          },
          {
            deviceName: "ephemeral",
            volume: BlockDeviceVolume.ephemeral(0),
          },
        ],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
        ebs_block_device: [
          {
            device_name: "ebs",
            delete_on_termination: true,
            encrypted: true,
            iops: 5000,
            volume_size: 15,
            volume_type: "io1",
          },
          {
            device_name: "ebs-gp3",
            delete_on_termination: true,
            encrypted: true,
            iops: 5000,
            volume_size: 15,
            volume_type: "gp3",
          },
          {
            device_name: "ebs-cmk",
            delete_on_termination: true,
            encrypted: true,
            kms_key_id: stack.resolve(kmsKey.keyArn),
            // {
            //   "Fn::GetAtt": ["EbsKeyD3FEE551", "Arn"],
            // },
            iops: 5000,
            volume_size: 15,
            volume_type: "io1",
          },
          {
            device_name: "ebs-snapshot",
            delete_on_termination: false,
            snapshot_id: "snapshot-id",
            volume_size: 500,
            volume_type: "sc1",
            // Terraform provider AWS only supports no_device on ephemeral...
            // no_device: {},
          },
        ],
        ephemeral_block_device: [
          {
            device_name: "ephemeral",
            no_device: false,
          },
        ],
      });
    });

    test("throws if ephemeral volumeIndex < 0", () => {
      // THEN
      expect(() => {
        new Instance(stack, "Instance", {
          vpc,
          machineImage: new AmazonLinuxImage(),
          instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
          blockDevices: [
            {
              deviceName: "ephemeral",
              volume: BlockDeviceVolume.ephemeral(-1),
            },
          ],
        });
      }).toThrow(/volumeIndex must be a number starting from 0/);
    });

    test("throws if volumeType === IO1 without iops", () => {
      // THEN
      expect(() => {
        new Instance(stack, "Instance", {
          vpc,
          machineImage: new AmazonLinuxImage(),
          instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
          blockDevices: [
            {
              deviceName: "ebs",
              volume: BlockDeviceVolume.ebs(15, {
                deleteOnTermination: true,
                encrypted: true,
                volumeType: EbsDeviceVolumeType.IO1,
              }),
            },
          ],
        });
      }).toThrow(
        /ops property is required with volumeType: EbsDeviceVolumeType.IO1/,
      );
    });

    test("throws if volumeType === IO2 without iops", () => {
      // THEN
      expect(() => {
        new Instance(stack, "Instance", {
          vpc,
          machineImage: new AmazonLinuxImage(),
          instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
          blockDevices: [
            {
              deviceName: "ebs",
              volume: BlockDeviceVolume.ebs(15, {
                deleteOnTermination: true,
                encrypted: true,
                volumeType: EbsDeviceVolumeType.IO2,
              }),
            },
          ],
        });
      }).toThrow(
        /ops property is required with volumeType: EbsDeviceVolumeType.IO1 and EbsDeviceVolumeType.IO2/,
      );
    });

    test("warning if iops without volumeType", () => {
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
        blockDevices: [
          {
            deviceName: "ebs",
            volume: BlockDeviceVolume.ebs(15, {
              deleteOnTermination: true,
              encrypted: true,
              iops: 5000,
            }),
          },
        ],
      });

      // THEN
      // TODO: Support Warning Acknowledgements - [ack: @aws-cdk/aws-ec2:iopsIgnored]
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "MyStack/Instance",
        message: "iops will be ignored without volumeType: IO1, IO2, or GP3",
      });
    });

    test("warning if iops and invalid volumeType", () => {
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
        blockDevices: [
          {
            deviceName: "ebs",
            volume: BlockDeviceVolume.ebs(15, {
              deleteOnTermination: true,
              encrypted: true,
              volumeType: EbsDeviceVolumeType.GP2,
              iops: 5000,
            }),
          },
        ],
      });

      // THEN
      // TODO: Support Warning Acknowledgements - [ack: @aws-cdk/aws-ec2:iopsIgnored]
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "MyStack/Instance",
        message: "iops will be ignored without volumeType: IO1, IO2, or GP3",
      });
    });
  });

  describe("instanceProfile", () => {
    let instanceProfile: InstanceProfile;
    let role: Role;

    beforeEach(() => {
      role = new Role(stack, "MyRole", {
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      });
      instanceProfile = new InstanceProfile(stack, "MyInstanceProfile", {
        role,
      });
    });

    test("can specify instanceProfile", () => {
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
        instanceProfile,
      });

      Template.synth(stack).toHaveResourceWithProperties(
        iamInstanceProfile.IamInstanceProfile,
        {
          role: stack.resolve(role.roleName),
        },
      );
    });

    test("throws if used with role", () => {
      expect(() => {
        new Instance(stack, "Instance", {
          vpc,
          machineImage: new AmazonLinuxImage(),
          instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
          instanceProfile,
          role,
        });
      }).toThrow(/You cannot provide both instanceProfile and role/);
    });
  });

  test("instance can be created with Private IP Address", () => {
    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      privateIpAddress: "10.0.0.2",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      instance_type: "t3.large",
      private_ip: "10.0.0.2",
    });
  });

  test("instance can be created with Private IP Address AND Associate Public IP Address", () => {
    const privateIpAddress = "10.0.0.2";
    // GIVEN
    const securityGroup = new SecurityGroup(stack, "SecurityGroup", { vpc });

    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      securityGroup,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      privateIpAddress: privateIpAddress,
      associatePublicIpAddress: true,
    });

    // THEN
    // Now private_ip and associate_public_ip_address are both set directly on the instance
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfInstance.Instance, {
      // private_ip property should be set directly on the instance
      private_ip: privateIpAddress,
      // associate_public_ip_address should be set directly on the instance
      associate_public_ip_address: true,
      // subnet_id should be set directly on the instance
      subnet_id: "${aws_subnet.VPC_PublicSubnet1_0D1B5E48.id}",
      // should depend on VPC Public routing for connectivity
      depends_on: [
        "data.aws_iam_policy_document.Instance_InstanceRole_AssumeRolePolicy_5AE9180F",
        "aws_iam_role.Instance_InstanceRole_E9785DE5",
        "aws_route_table_association.VPC_PublicSubnet1_RouteTableAssociation_0B0896DC",
        "aws_route.VPC_PublicSubnet1_DefaultRoute_91CEF279",
        "aws_route_table_association.VPC_PublicSubnet2_RouteTableAssociation_5A808732",
        "aws_route.VPC_PublicSubnet2_DefaultRoute_B7481BBA",
        "aws_route_table_association.VPC_PublicSubnet3_RouteTableAssociation_427FE0C6",
        "aws_route.VPC_PublicSubnet3_DefaultRoute_A0D29D46",
      ],
    });
    // No NetworkInterface resource should be created for basic scenarios
    expect(() =>
      template.toHaveResource(tfNetworkInterface.NetworkInterface),
    ).toThrow();

    // Validate the instances created have the private IP set correctly
    const instances = Template.resources(stack, tfInstance.Instance);
    instances.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          private_ip: privateIpAddress,
        }),
      ]),
    );
  });

  test("instance requires IMDSv2", () => {
    // WHEN
    const instance = new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: new InstanceType("t2.micro"),
      requireImdsv2: true,
    });

    // Force stack synth so the InstanceRequireImdsv2Aspect is applied
    const template = Template.synth(stack);

    // THEN
    const launchTemplate = instance.node.tryFindChild(
      "LaunchTemplate",
    ) as tfLaunchTemplate.LaunchTemplate;
    expect(launchTemplate).toBeDefined();
    template.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
      name: stack.resolve(launchTemplate.nameInput),
      metadata_options: {
        http_tokens: "required",
      },
    });
    template.toHaveResourceWithProperties(tfInstance.Instance, {
      launch_template: {
        name: stack.resolve(launchTemplate.name),
        version: stack.resolve(launchTemplate.latestVersion.toString()),
      },
    });
  });

  it("throws an error on incompatible Key Pair for operating system", () => {
    // GIVEN
    const keyPair = new KeyPair(stack, "KeyPair", {
      type: KeyPairType.ED25519,
    });

    // THEN
    expect(
      () =>
        new Instance(stack, "Instance", {
          vpc,
          machineImage: new WindowsImage(
            WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_CORE_BASE,
          ),
          instanceType: new InstanceType("t2.micro"),
          keyPair,
        }),
    ).toThrow("ed25519 keys are not compatible with the chosen AMI");
  });

  it("throws an error if keyName and keyPair both provided", () => {
    // GIVEN
    const keyPair = new KeyPair(stack, "KeyPair");

    // THEN
    expect(
      () =>
        new Instance(stack, "Instance", {
          vpc,
          instanceType: new InstanceType("t2.micro"),
          machineImage: new AmazonLinuxImage(),
          keyName: "test-key-pair",
          keyPair,
        }),
    ).toThrow(
      "Cannot specify both of 'keyName' and 'keyPair'; prefer 'keyPair'",
    );
  });

  it("correctly associates a key pair", () => {
    // GIVEN
    const keyPair = new KeyPair(stack, "KeyPair", {
      keyPairName: "test-key-pair",
    });

    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      instanceType: new InstanceType("t2.micro"),
      machineImage: new AmazonLinuxImage(),
      keyPair,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      key_name: stack.resolve(keyPair.keyPairName),
    });
  });

  describe("Detailed Monitoring", () => {
    test("instance with Detailed Monitoring enabled", () => {
      // WHEN
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: new InstanceType("t2.micro"),
        detailedMonitoring: true,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
        monitoring: true,
      });
    });

    test("instance with Detailed Monitoring disabled", () => {
      // WHEN
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: new InstanceType("t2.micro"),
        detailedMonitoring: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
        monitoring: false,
      });
    });

    test("instance with Detailed Monitoring unset falls back to disabled", () => {
      // WHEN
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: new InstanceType("t2.micro"),
      });

      // THEN
      Template.resources(stack, tfInstance.Instance).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            monitoring: expect.anything(),
          }),
        ]),
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::EC2::Instance', {
      //   Monitoring: Match.absent(),
      // });
    });
  });

  test("burstable instance with explicit credit specification", () => {
    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      creditSpecification: CpuCredits.STANDARD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      instance_type: "t3.large",
      credit_specification: {
        cpu_credits: "standard",
      },
    });
  });

  test("throw if creditSpecification is defined for a non-burstable instance type", () => {
    // THEN
    expect(() => {
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: InstanceType.of(InstanceClass.M5, InstanceSize.LARGE),
        creditSpecification: CpuCredits.STANDARD,
      });
    }).toThrow(
      "creditSpecification is supported only for T4g, T3a, T3, T2 instance type, got: m5.large",
    );
  });

  test("set instanceInitiatedShutdownBehavior", () => {
    // WHEN
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: new InstanceType("t2.micro"),
      instanceInitiatedShutdownBehavior:
        InstanceInitiatedShutdownBehavior.TERMINATE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      instance_type: "t2.micro",
      instance_initiated_shutdown_behavior: "terminate",
    });
  });
});

// TODO: Implement Grid Init
// test("add CloudFormation Init to instance", () => {
//   // GIVEN
//   new Instance(stack, "Instance", {
//     vpc,
//     machineImage: new AmazonLinuxImage(),
//     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
//     init: CloudFormationInit.fromElements(
//       InitCommand.shellCommand("echo hello"),
//     ),
//   });

//   // THEN
//   Template.fromStack(stack).hasResourceProperties("AWS::EC2::Instance", {
//     UserData: {
//       "Fn::Base64": {
//         "Fn::Join": [
//           "",
//           [
//             "#!/bin/bash\n# fingerprint: 85ac432b1de1144f\n(\n  set +e\n  /opt/aws/bin/cfn-init -v --region ",
//             { Ref: "AWS::Region" },
//             " --stack ",
//             { Ref: "AWS::StackName" },
//             " --resource InstanceC1063A87 -c default\n  /opt/aws/bin/cfn-signal -e $? --region ",
//             { Ref: "AWS::Region" },
//             " --stack ",
//             { Ref: "AWS::StackName" },
//             " --resource InstanceC1063A87\n  cat /var/log/cfn-init.log >&2\n)",
//           ],
//         ],
//       },
//     },
//   });
//   Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
//     PolicyDocument: {
//       Statement: Match.arrayWith([
//         {
//           Action: [
//             "cloudformation:DescribeStackResource",
//             "cloudformation:SignalResource",
//           ],
//           Effect: "Allow",
//           Resource: { Ref: "AWS::StackId" },
//         },
//       ]),
//       Version: "2012-10-17",
//     },
//   });
//   Template.fromStack(stack).hasResource("AWS::EC2::Instance", {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 1,
//         Timeout: "PT5M",
//       },
//     },
//   });
// });

test("cause replacement from s3 asset in userdata", () => {
  // GIVEN
  // app = new App({
  //   context: {
  //     [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false,
  //   },
  // });
  // stack = new AwsStack(app);
  // vpc = new Vpc(stack, "Vpc)");
  const userData1 = UserData.forLinux();

  const asset1 = new Bucket(stack, "HelloWorld", {
    sources: path.join(__dirname, "asset-fixture"),
  });
  userData1.addS3DownloadCommand({
    bucket: asset1,
    bucketKey: "data.txt",
  });

  // const userData2 = UserData.forLinux();
  // const asset2 = new Asset(stack, "UserDataAssets2", {
  //   path: path.join(__dirname, "asset-fixture", "data.txt"),
  // });
  // userData2.addS3DownloadCommand({
  //   bucket: asset2.bucket,
  //   bucketKey: asset2.s3ObjectKey,
  // });

  // WHEN
  new Instance(stack, "InstanceOne", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
    userData: userData1,
    userDataCausesReplacement: true,
  });
  // new Instance(stack, "InstanceTwo", {
  //   vpc,
  //   machineImage: new AmazonLinuxImage(),
  //   instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
  //   userData: userData2,
  //   userDataCausesReplacement: true,
  // });

  // THEN -- both instances have the same userData hash, telling us the hash is based
  // on the actual asset hash and not accidentally on the token stringification of them.
  // (which would base the hash on '${Token[1234.bla]}'
  const hash = "f88eace39faf39d7";
  Template.fromStack(stack).toMatchObject({
    resource: {
      aws_instance: {
        InstanceOne_5B821005: expect.anything(),
        // [`InstanceTwoDC29A7A7${hash}`]: expect.anything(),
      },
    },
  });
});

test("ssm permissions adds right managed policy", () => {
  // WHEN
  new Instance(stack, "InstanceOne", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
    ssmSessionPermissions: true,
  });

  Template.synth(stack).toHaveResourceWithProperties(iamRole.IamRole, {
    managed_policy_arns: [
      "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore",
    ],
  });
});

test("sameInstanceClassAs compares identical InstanceTypes correctly", () => {
  // GIVEN
  const comparitor = InstanceType.of(InstanceClass.T3, InstanceSize.LARGE);
  //WHEN
  const sameInstanceType = InstanceType.of(
    InstanceClass.T3,
    InstanceSize.LARGE,
  );
  //THEN
  expect(sameInstanceType.sameInstanceClassAs(comparitor)).toBeTruthy();
});

test("sameInstanceClassAs compares InstanceTypes correctly regardless of size", () => {
  // GIVEN
  const comparitor = InstanceType.of(InstanceClass.T3, InstanceSize.LARGE);
  //WHEN
  const largerInstanceType = InstanceType.of(
    InstanceClass.T3,
    InstanceSize.XLARGE,
  );
  //THEN
  expect(largerInstanceType.sameInstanceClassAs(comparitor)).toBeTruthy();
});

test("sameInstanceClassAs compares different InstanceTypes correctly", () => {
  // GIVEN
  const comparitor = InstanceType.of(InstanceClass.C4, InstanceSize.LARGE);
  //WHEN
  const instanceType = new InstanceType("t3.large");
  //THEN
  expect(instanceType.sameInstanceClassAs(comparitor)).toBeFalsy();
});

test("associate public IP address with instance", () => {
  // GIVEN
  const securityGroup = new SecurityGroup(stack, "SecurityGroup", { vpc });

  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    vpcSubnets: { subnetType: SubnetType.PUBLIC },
    securityGroup,
    machineImage: new AmazonLinuxImage(),
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
    sourceDestCheck: false,
    associatePublicIpAddress: true,
  });

  // THEN
  const template = Template.synth(stack);
  // No NetworkInterface resource should be created for basic public IP assignment
  expect(() =>
    template.toHaveResource(tfNetworkInterface.NetworkInterface),
  ).toThrow();

  template.toHaveResourceWithProperties(tfInstance.Instance, {
    associate_public_ip_address: true,
    subnet_id: "${aws_subnet.VPC_PublicSubnet1_0D1B5E48.id}",
    depends_on: [
      // "InstanceInstanceRoleE9785DE5",
      "data.aws_iam_policy_document.Instance_InstanceRole_AssumeRolePolicy_5AE9180F",
      "aws_iam_role.Instance_InstanceRole_E9785DE5",
      // "VPCPublicSubnet1RouteTableAssociation0B0896DC",
      "aws_route_table_association.VPC_PublicSubnet1_RouteTableAssociation_0B0896DC",
      // "VPCPublicSubnet1DefaultRoute91CEF279",
      "aws_route.VPC_PublicSubnet1_DefaultRoute_91CEF279",
      // "VPCPublicSubnet2RouteTableAssociation5A808732",
      "aws_route_table_association.VPC_PublicSubnet2_RouteTableAssociation_5A808732",
      // "VPCPublicSubnet2DefaultRouteB7481BBA",
      "aws_route.VPC_PublicSubnet2_DefaultRoute_B7481BBA",
      "aws_route_table_association.VPC_PublicSubnet3_RouteTableAssociation_427FE0C6",
      "aws_route.VPC_PublicSubnet3_DefaultRoute_A0D29D46",
    ],
  });
});

test("do not associate public IP address with instance", () => {
  // GIVEN
  const securityGroup = new SecurityGroup(stack, "SecurityGroup", { vpc });

  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    vpcSubnets: { subnetType: SubnetType.PUBLIC },
    securityGroup,
    machineImage: new AmazonLinuxImage(),
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
    sourceDestCheck: false,
    associatePublicIpAddress: false,
  });

  // THEN
  const template = Template.synth(stack);
  // No NetworkInterface resource should be created for basic public IP assignment
  expect(() =>
    template.toHaveResource(tfNetworkInterface.NetworkInterface),
  ).toThrow();

  template.toHaveResourceWithProperties(tfInstance.Instance, {
    associate_public_ip_address: false,
    subnet_id: "${aws_subnet.VPC_PublicSubnet1_0D1B5E48.id}",
  });
});

test("associate public IP address with instance and no public subnet", () => {
  // WHEN/THEN
  expect(() => {
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      sourceDestCheck: false,
      associatePublicIpAddress: true,
    });
  }).toThrow(
    "To set 'associatePublicIpAddress: true' you must select Public subnets (vpcSubnets: { subnetType: SubnetType.PUBLIC })",
  );
});

test("specify ebs optimized instance", () => {
  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: new InstanceType("t3.large"),
    ebsOptimized: true,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
    instance_type: "t3.large",
    ebs_optimized: true,
  });
});

test("specify disable api termination", () => {
  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: new InstanceType("t3.large"),
    disableApiTermination: true,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
    instance_type: "t3.large",
    disable_api_termination: true,
  });
});

test.each([
  [true, true],
  [false, false],
])("given enclaveEnabled %p", (given: boolean, expected: boolean) => {
  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: InstanceType.of(InstanceClass.M5, InstanceSize.XLARGE),
    enclaveEnabled: given,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
    enclave_options: {
      enabled: expected,
    },
  });
});

test.each([
  [true, true],
  [false, false],
])("given hibernationEnabled %p", (given: boolean, expected: boolean) => {
  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: InstanceType.of(InstanceClass.M5, InstanceSize.XLARGE),
    hibernationEnabled: given,
    blockDevices: [
      {
        deviceName: "/dev/xvda",
        volume: BlockDeviceVolume.ebs(30, {
          volumeType: EbsDeviceVolumeType.GP3,
          encrypted: true,
          deleteOnTermination: true,
        }),
      },
    ],
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
    hibernation: expected,
  });
});

test("throw if both enclaveEnabled and hibernationEnabled are set to true", () => {
  // WHEN/THEN
  expect(() => {
    new Instance(stack, "Instance", {
      vpc,
      machineImage: new AmazonLinuxImage(),
      instanceType: InstanceType.of(InstanceClass.M5, InstanceSize.LARGE),
      enclaveEnabled: true,
      hibernationEnabled: true,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: BlockDeviceVolume.ebs(30, {
            volumeType: EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });
  }).toThrow(
    "You can't set both `enclaveEnabled` and `hibernationEnabled` to true on the same instance",
  );
});

test("instance with ipv6 address count", () => {
  // WHEN
  new Instance(stack, "Instance", {
    vpc,
    machineImage: new AmazonLinuxImage(),
    instanceType: new InstanceType("t2.micro"),
    ipv6AddressCount: 2,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
    instance_type: "t2.micro",
    ipv6_address_count: 2,
  });
});

test.each([-1, 0.1, 1.1])(
  "throws if ipv6AddressCount is not a positive integer",
  (ipv6AddressCount: number) => {
    // THEN
    expect(() => {
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: new InstanceType("t2.micro"),
        ipv6AddressCount: ipv6AddressCount,
      });
    }).toThrow(
      `\'ipv6AddressCount\' must be a non-negative integer, got: ${ipv6AddressCount}`,
    );
  },
);

test.each([true, false])(
  "throw error for specifying ipv6AddressCount with associatePublicIpAddress",
  (associatePublicIpAddress) => {
    // THEN
    expect(() => {
      new Instance(stack, "Instance", {
        vpc,
        machineImage: new AmazonLinuxImage(),
        instanceType: new InstanceType("t2.micro"),
        ipv6AddressCount: 2,
        associatePublicIpAddress,
      });
    }).toThrow(
      "You can't set both 'ipv6AddressCount' and 'associatePublicIpAddress'",
    );
  },
);

// TODO: Implement Grid Init
// test("initOptions.timeout and resourceSignalTimeout are both not set. Timeout is set to default of 5 min", () => {
//   // GIVEN
//   new Instance(stack, "Instance", {
//     vpc,
//     machineImage: new AmazonLinuxImage(),
//     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
//     init: CloudFormationInit.fromElements(
//       InitCommand.shellCommand("echo hello"),
//     ),
//   });

//   // THEN
//   Template.fromStack(stack).hasResource("AWS::EC2::Instance", {
//     CreationPolicy: {
//       ResourceSignal: {
//         Timeout: "PT5M",
//       },
//     },
//   });
// });

// test("initOptions.timeout is set and not resourceSignalTimeout. Timeout is set to initOptions.timeout value", () => {
//   // GIVEN
//   new Instance(stack, "Instance", {
//     vpc,
//     machineImage: new AmazonLinuxImage(),
//     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
//     init: CloudFormationInit.fromElements(
//       InitCommand.shellCommand("echo hello"),
//     ),
//     initOptions: {
//       timeout: Duration.minutes(10),
//     },
//   });

//   // THEN
//   Template.fromStack(stack).hasResource("AWS::EC2::Instance", {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 1,
//         Timeout: "PT10M",
//       },
//     },
//   });
// });

// test("resourceSignalTimeout is set and not initOptions.timeout. Timeout is set to resourceSignalTimeout value", () => {
//   // GIVEN
//   new Instance(stack, "Instance", {
//     vpc,
//     machineImage: new AmazonLinuxImage(),
//     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
//     init: CloudFormationInit.fromElements(
//       InitCommand.shellCommand("echo hello"),
//     ),
//     resourceSignalTimeout: Duration.minutes(10),
//   });

//   // THEN
//   Template.fromStack(stack).hasResource("AWS::EC2::Instance", {
//     CreationPolicy: {
//       ResourceSignal: {
//         Timeout: "PT15M",
//       },
//     },
//   });
// });

// test("resourceSignalTimeout and initOptions.timeout are both set, sum timeout and log warning", () => {
//   // GIVEN
//   new Instance(stack, "Instance", {
//     vpc,
//     machineImage: new AmazonLinuxImage(),
//     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
//     init: CloudFormationInit.fromElements(
//       InitCommand.shellCommand("echo hello"),
//     ),
//     initOptions: {
//       timeout: Duration.minutes(10),
//     },
//     resourceSignalTimeout: Duration.minutes(10),
//   });

//   // THEN
//   Template.fromStack(stack).hasResource("AWS::EC2::Instance", {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 1,
//         Timeout: "PT20M",
//       },
//     },
//   });
// });
