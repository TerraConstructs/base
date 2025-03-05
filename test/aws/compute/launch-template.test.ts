// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/launch-template.test.ts

import {
  iamInstanceProfile,
  iamRole,
  launchTemplate as tfLaunchTemplate,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Duration, Expiration } from "../../../src";
import { AwsStack, Tags } from "../../../src/aws";
import {
  AmazonLinuxImage,
  BlockDevice,
  BlockDeviceVolume,
  CpuCredits,
  EbsDeviceVolumeType,
  InstanceInitiatedShutdownBehavior,
  InstanceType,
  KeyPair,
  KeyPairType,
  LaunchTemplate,
  LaunchTemplateHttpTokens,
  OperatingSystemType,
  SecurityGroup,
  SpotInstanceInterruption,
  SpotRequestType,
  UserData,
  Vpc,
  WindowsImage,
  WindowsVersion,
} from "../../../src/aws/compute";
import { Key } from "../../../src/aws/encryption";
import { Role, ServicePrincipal, InstanceProfile } from "../../../src/aws/iam";
import { Annotations, Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("LaunchTemplate", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("Empty props", () => {
    // WHEN
    const template = new LaunchTemplate(stack, "Template");

    // THEN
    // Note: The following is intentionally a toEqual instead of toMatchObject
    // to ensure that only the bare minimum of properties have values when no properties
    // are given to a LaunchTemplate.
    Template.resources(stack, tfLaunchTemplate.LaunchTemplate).toEqual([
      {
        tag_specifications: [
          {
            resource_type: "instance",
            tags: {
              Name: "MyStack/Template",
            },
          },
          {
            resource_type: "volume",
            tags: {
              Name: "MyStack/Template",
            },
          },
          {
            resource_type: "launch-template",
            tags: {
              Name: "MyStack/Template",
            },
          },
        ],
        // These are GRID backend specific tags
        tags: {
          Name: "Test-Template",
          "grid:EnvironmentName": environmentName,
          "grid:UUID": gridUUID,
        },
      },
    ]);
    Template.resources(
      stack,
      iamInstanceProfile.IamInstanceProfile,
    ).toHaveLength(0);
    expect(() => {
      template.grantPrincipal;
    }).toThrow();
    expect(() => {
      template.connections;
    }).toThrow();
    expect(template.osType).toBeUndefined();
    expect(template.role).toBeUndefined();
    expect(template.userData).toBeUndefined();
  });

  test("Import from attributes with name", () => {
    // WHEN
    const template = LaunchTemplate.fromLaunchTemplateAttributes(
      stack,
      "Template",
      {
        launchTemplateName: "TestName",
        versionNumber: "TestVersion",
      },
    );

    // THEN
    expect(template.launchTemplateId).toBeUndefined();
    expect(template.launchTemplateName).toBe("TestName");
    expect(template.versionNumber).toBe("TestVersion");
  });

  test("Import from attributes with id", () => {
    // WHEN
    const template = LaunchTemplate.fromLaunchTemplateAttributes(
      stack,
      "Template",
      {
        launchTemplateId: "TestId",
        versionNumber: "TestVersion",
      },
    );

    // THEN
    expect(template.launchTemplateId).toBe("TestId");
    expect(template.launchTemplateName).toBeUndefined();
    expect(template.versionNumber).toBe("TestVersion");
  });

  test("Import from attributes fails with name and id", () => {
    expect(() => {
      LaunchTemplate.fromLaunchTemplateAttributes(stack, "Template", {
        launchTemplateName: "TestName",
        launchTemplateId: "TestId",
        versionNumber: "TestVersion",
      });
    }).toThrow();
  });

  test("Given name", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      launchTemplateName: "LTName",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        name: "LTName",
      },
    );
  });

  test("Given versionDescription", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      versionDescription: "test template",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        description: "test template",
      },
    );
  });

  test("throw error when versionDescription is too long", () => {
    const tooLongDescription = "a".repeat(256);
    // WHEN / THEN
    expect(() => {
      new LaunchTemplate(stack, "TemplateWithTooLongDescription", {
        versionDescription: tooLongDescription,
      });
    }).toThrow(
      "versionDescription must be less than or equal to 255 characters, got 256",
    );
  });

  test("Given instanceType", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      instanceType: new InstanceType("tt.test"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_type: "tt.test",
      },
    );
  });

  test("Given machineImage (Linux)", () => {
    // WHEN
    const template = new LaunchTemplate(stack, "Template", {
      machineImage: new AmazonLinuxImage(),
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_launch_template: {
          Template_576A9730: {
            image_id: expect.stringMatching(
              /SsmParameterValue--aws--service--ami-amazon-linux-latest--amzn-ami-hvm-x86_64-gp2.*Parameter/,
            ),
          },
        },
      },
    });
    expect(template.osType).toBe(OperatingSystemType.LINUX);
    // expect(template.userData).toBeUndefined();

    // We default to feature flag @aws-cdk/aws-ec2:launchTemplateDefaultUserData
    // feature flag summary:
    // The ec2.LaunchTemplate construct did not define user data when a machine image is
    // provided despite the document. If this is set, a user data is automatically defined
    // according to the OS of the machine image.
    expect(template.userData).toBeDefined();
  });

  test("Given machineImage (Windows)", () => {
    // WHEN
    const template = new LaunchTemplate(stack, "Template", {
      machineImage: new WindowsImage(
        WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE,
      ),
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_launch_template: {
          Template_576A9730: {
            image_id: expect.stringMatching(
              /SsmParameterValue--aws--service--ami-windows-latest--Windows_Server-2019-English-Full-Base.*Parameter/,
            ),
          },
        },
      },
    });
    expect(template.osType).toBe(OperatingSystemType.WINDOWS);
    // expect(template.userData).toBeUndefined();

    // We default to feature flag @aws-cdk/aws-ec2:launchTemplateDefaultUserData
    // feature flag summary:
    // The ec2.LaunchTemplate construct did not define user data when a machine image is
    // provided despite the document. If this is set, a user data is automatically defined
    // according to the OS of the machine image.
    expect(template.userData).toBeDefined();
  });

  test("Given userData", () => {
    // GIVEN
    const userData = UserData.forLinux();
    userData.addCommands("echo Test");

    // WHEN
    const template = new LaunchTemplate(stack, "Template", {
      userData,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        user_data: '${base64encode("#!/bin/bash\\necho Test")}',
      },
    );
    expect(template.userData).toBeDefined();
  });

  test("Given role", () => {
    // GIVEN
    const role = new Role(stack, "TestRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });

    // WHEN
    const template = new LaunchTemplate(stack, "Template", {
      role,
    });

    // THEN
    Template.resources(stack, iamRole.IamRole).toHaveLength(1);
    const generatedlt = template.node.findChild(
      "Profile",
    ) as iamInstanceProfile.IamInstanceProfile;
    expect(generatedlt).toBeDefined();
    const result = Template.synth(stack);
    result.toHaveResourceWithProperties(iamInstanceProfile.IamInstanceProfile, {
      role: stack.resolve(role.roleName),
    });
    result.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
      iam_instance_profile: {
        arn: stack.resolve(generatedlt.arn),
      },
      tag_specifications: [
        {
          resource_type: "instance",
          tags: {
            Name: "MyStack/Template",
          },
        },
        {
          resource_type: "volume",
          tags: {
            Name: "MyStack/Template",
          },
        },
        {
          resource_type: "launch-template",
          tags: {
            Name: "MyStack/Template",
          },
        },
      ],
    });
    expect(template.role).toBeDefined();
    expect(template.grantPrincipal).toBeDefined();
  });

  test("Given blockDeviceMapping", () => {
    // GIVEN
    const kmsKey = new Key(stack, "EbsKey");
    const blockDevices: BlockDevice[] = [
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
      {
        deviceName: "gp3-with-throughput",
        volume: BlockDeviceVolume.ebs(15, {
          volumeType: EbsDeviceVolumeType.GP3,
          throughput: 350,
        }),
      },
    ];

    // WHEN
    new LaunchTemplate(stack, "Template", {
      blockDevices,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        block_device_mappings: [
          {
            device_name: "ebs",
            ebs: {
              delete_on_termination: "true",
              encrypted: "true",
              iops: 5000,
              volume_size: 15,
              volume_type: "io1",
            },
          },
          {
            device_name: "ebs-cmk",
            ebs: {
              delete_on_termination: "true",
              encrypted: "true",
              kms_key_id: stack.resolve(kmsKey.keyArn),
              iops: 5000,
              volume_size: 15,
              volume_type: "io1",
            },
          },
          {
            device_name: "ebs-snapshot",
            ebs: {
              delete_on_termination: "false",
              snapshot_id: "snapshot-id",
              volume_size: 500,
              volume_type: "sc1",
            },
            no_device: "",
          },
          {
            device_name: "ephemeral",
            virtual_name: "ephemeral0",
          },
          {
            device_name: "gp3-with-throughput",
            ebs: {
              volume_size: 15,
              volume_type: "gp3",
              throughput: 350,
            },
          },
        ],
      },
    );
  });
  test.each([124, 1001])(
    "throws if throughput is set less than 125 or more than 1000",
    (throughput) => {
      expect(() => {
        new LaunchTemplate(stack, "LaunchTemplate", {
          blockDevices: [
            {
              deviceName: "ebs",
              volume: BlockDeviceVolume.ebs(15, {
                volumeType: EbsDeviceVolumeType.GP3,
                throughput,
              }),
            },
          ],
        });
      }).toThrow(/'throughput' must be between 125 and 1000, got/);
    },
  );
  test("throws if throughput is not an integer", () => {
    expect(() => {
      new LaunchTemplate(stack, "LaunchTemplate", {
        blockDevices: [
          {
            deviceName: "ebs",
            volume: BlockDeviceVolume.ebs(15, {
              volumeType: EbsDeviceVolumeType.GP3,
              throughput: 234.56,
            }),
          },
        ],
      });
    }).toThrow("'throughput' must be an integer, got: 234.56.");
  });
  test.each([...Object.values(EbsDeviceVolumeType).filter((v) => v !== "gp3")])(
    "throws if throughput is set on any volume type other than GP3",
    (volumeType) => {
      expect(() => {
        new LaunchTemplate(stack, "LaunchTemplate", {
          blockDevices: [
            {
              deviceName: "ebs",
              volume: BlockDeviceVolume.ebs(15, {
                volumeType: volumeType,
                throughput: 150,
              }),
            },
          ],
        });
      }).toThrow(/'throughput' requires 'volumeType': gp3, got/);
    },
  );
  test("throws if throughput / iops ratio is greater than 0.25", () => {
    expect(() => {
      new LaunchTemplate(stack, "LaunchTemplate", {
        blockDevices: [
          {
            deviceName: "ebs",
            volume: BlockDeviceVolume.ebs(15, {
              volumeType: EbsDeviceVolumeType.GP3,
              throughput: 751,
              iops: 3000,
            }),
          },
        ],
      });
    }).toThrow(
      "Throughput (MiBps) to iops ratio of 0.25033333333333335 is too high; maximum is 0.25 MiBps per iops",
    );
  });

  test("Given instance profile", () => {
    // GIVEN
    const role = new Role(stack, "TestRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    const instanceProfile = new InstanceProfile(stack, "InstanceProfile", {
      role,
    });

    // WHEN
    const template = new LaunchTemplate(stack, "Template", {
      instanceProfile,
    });

    // THEN
    Template.resources(stack, iamRole.IamRole).toHaveLength(1);
    const result = Template.synth(stack);
    result.toHaveResourceWithProperties(iamInstanceProfile.IamInstanceProfile, {
      role: stack.resolve(role.roleName),
    });
    result.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
      iam_instance_profile: {
        arn: stack.resolve(instanceProfile.instanceProfileArn),
      },
    });
    expect(template.role).toBeDefined();
    expect(template.grantPrincipal).toBeDefined();
  });

  describe("feature flag @aws-cdk/aws-ec2:launchTemplateDefaultUserData", () => {
    test("Given machineImage (Linux)", () => {
      // WHEN
      // always true in TerraConstructs
      // stack.node.setContext(cxapi.EC2_LAUNCH_TEMPLATE_DEFAULT_USER_DATA, true);
      const template = new LaunchTemplate(stack, "Template", {
        machineImage: new AmazonLinuxImage(),
      });
      // THEN
      Template.fromStack(stack).toMatchObject({
        resource: {
          aws_launch_template: {
            Template_576A9730: {
              image_id: expect.stringMatching(
                /SsmParameterValue--aws--service--ami-amazon-linux-latest--amzn-ami-hvm-x86_64-gp2.*Parameter/,
              ),
            },
          },
        },
      });
      expect(template.osType).toBe(OperatingSystemType.LINUX);
      expect(template.userData).toBeDefined();
    });

    test("Given machineImage (Windows)", () => {
      // WHEN
      // always true in TerraConstructs
      // stack.node.setContext(cxapi.EC2_LAUNCH_TEMPLATE_DEFAULT_USER_DATA, true);
      const template = new LaunchTemplate(stack, "Template", {
        machineImage: new WindowsImage(
          WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE,
        ),
      });
      // THEN
      Template.fromStack(stack).toMatchObject({
        resource: {
          aws_launch_template: {
            Template_576A9730: {
              image_id: expect.stringMatching(
                /SsmParameterValue--aws--service--ami-windows-latest--Windows_Server-2019-English-Full-Base.*Parameter/,
              ),
            },
          },
        },
      });
      expect(template.osType).toBe(OperatingSystemType.WINDOWS);
      expect(template.userData).toBeDefined();
    });
  });

  describe("feature flag @aws-cdk/aws-autoscaling:generateLaunchTemplateInsteadOfLaunchConfig", () => {
    test("Given machineImage (Linux)", () => {
      // WHEN
      // always true in TerraConstructs
      // stack.node.setContext(cxapi.AUTOSCALING_GENERATE_LAUNCH_TEMPLATE, true);
      const template = new LaunchTemplate(stack, "Template", {
        machineImage: new AmazonLinuxImage(),
      });

      // THEN
      Template.fromStack(stack).toMatchObject({
        resource: {
          aws_launch_template: {
            Template_576A9730: {
              image_id: expect.stringMatching(
                /.*SsmParameterValue--aws--service--ami-amazon-linux-latest--amzn-ami-hvm-x86_64-gp2.*Parameter/,
              ),
            },
          },
        },
      });
      expect(template.osType).toBe(OperatingSystemType.LINUX);
      expect(template.userData).toBeDefined();
    });

    test("Given machineImage (Windows)", () => {
      // WHEN
      // always true in TerraConstructs
      // stack.node.setContext(cxapi.AUTOSCALING_GENERATE_LAUNCH_TEMPLATE, true);
      const template = new LaunchTemplate(stack, "Template", {
        machineImage: new WindowsImage(
          WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE,
        ),
      });

      // THEN
      Template.fromStack(stack).toMatchObject({
        resource: {
          aws_launch_template: {
            Template_576A9730: {
              image_id: expect.stringMatching(
                /.*SsmParameterValue--aws--service--ami-windows-latest--Windows_Server-2019-English-Full-Base.*Parameter/,
              ),
            },
          },
        },
      });
      expect(template.osType).toBe(OperatingSystemType.WINDOWS);
      expect(template.userData).toBeDefined();
    });
  });

  test.each([
    [CpuCredits.STANDARD, "standard"],
    [CpuCredits.UNLIMITED, "unlimited"],
  ])("Given cpuCredits %p", (given: CpuCredits, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      cpuCredits: given,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        credit_specification: {
          cpu_credits: expected,
        },
      },
    );
  });

  test.each([
    [true, true],
    [false, false],
  ])("Given disableApiTermination %p", (given: boolean, expected: boolean) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      disableApiTermination: given,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        disable_api_termination: expected,
      },
    );
  });

  // Somehow this is a string
  // https://github.com/cdktf/cdktf-provider-aws/blob/v19.55.0/src/launch-template/index.ts#L34
  test.each([
    [true, "true"],
    [false, "false"],
  ])("Given ebsOptimized %p", (given: boolean, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      ebsOptimized: given,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        ebs_optimized: expected,
      },
    );
  });

  test.each([
    [true, true],
    [false, false],
  ])("Given nitroEnclaveEnabled %p", (given: boolean, expected: boolean) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      nitroEnclaveEnabled: given,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        enclave_options: {
          enabled: expected,
        },
      },
    );
  });

  test.each([
    [InstanceInitiatedShutdownBehavior.STOP, "stop"],
    [InstanceInitiatedShutdownBehavior.TERMINATE, "terminate"],
  ])(
    "Given instanceInitiatedShutdownBehavior %p",
    (given: InstanceInitiatedShutdownBehavior, expected: string) => {
      // WHEN
      new LaunchTemplate(stack, "Template", {
        instanceInitiatedShutdownBehavior: given,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfLaunchTemplate.LaunchTemplate,
        {
          instance_initiated_shutdown_behavior: expected,
        },
      );
    },
  );

  test("Given keyName", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      keyName: "TestKeyname",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        key_name: "TestKeyname",
      },
    );
  });

  it("throws an error on incompatible Key Pair for operating system", () => {
    // GIVEN
    const keyPair = new KeyPair(stack, "KeyPair", {
      type: KeyPairType.ED25519,
    });

    // THEN
    expect(
      () =>
        new LaunchTemplate(stack, "Instance", {
          machineImage: new WindowsImage(
            WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_CORE_BASE,
          ),
          keyPair,
        }),
    ).toThrow("ed25519 keys are not compatible with the chosen AMI");
  });

  it("throws when keyName and keyPair are provided", () => {
    // GIVEN
    const keyPair = new KeyPair(stack, "KeyPair");

    // THEN
    expect(
      () =>
        new LaunchTemplate(stack, "Instance", {
          keyName: "test-key-pair",
          keyPair,
        }),
    ).toThrow(
      "Cannot specify both of 'keyName' and 'keyPair'; prefer 'keyPair'",
    );
  });

  test.each([
    [true, true],
    [false, false],
  ])("Given detailedMonitoring %p", (given: boolean, expected: boolean) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      detailedMonitoring: given,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        monitoring: {
          enabled: expected,
        },
      },
    );
  });

  test("Given securityGroup", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");
    const sg = new SecurityGroup(stack, "SG", { vpc });

    // WHEN
    const template = new LaunchTemplate(stack, "Template", {
      securityGroup: sg,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        vpc_security_group_ids: [stack.resolve(sg.securityGroupId)],
      },
    );
    expect(template.connections).toBeDefined();
    expect(template.connections.securityGroups).toHaveLength(1);
    expect(template.connections.securityGroups[0]).toBe(sg);
  });

  test("Adding tags", () => {
    // GIVEN
    const template = new LaunchTemplate(stack, "Template");

    // WHEN
    Tags.of(template).add("TestKey", "TestValue");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        tag_specifications: [
          {
            resource_type: "instance",
            tags: {
              Name: "MyStack/Template",
              TestKey: "TestValue",
            },
          },
          {
            resource_type: "volume",
            tags: {
              Name: "MyStack/Template",
              TestKey: "TestValue",
            },
          },
          {
            resource_type: "launch-template",
            tags: {
              Name: "MyStack/Template",
              TestKey: "TestValue",
            },
          },
        ],
      },
    );
  });

  test("Requires IMDSv2", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      requireImdsv2: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_tokens: "required",
        },
      },
    );
  });

  test("Associate public IP address", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");
    const sg = new SecurityGroup(stack, "SG", { vpc });

    // WHEN
    new LaunchTemplate(stack, "Template", {
      associatePublicIpAddress: true,
      securityGroup: sg,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        network_interfaces: [
          {
            device_index: 0,
            // Somehow this is a string
            // https://github.com/cdktf/cdktf-provider-aws/blob/v19.55.0/src/launch-template/index.ts#L4786
            associate_public_ip_address: "true",
            security_groups: [stack.resolve(sg.securityGroupId)],
          },
        ],
      },
    );
  });

  test("Dissociate public IP address", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");
    const sg = new SecurityGroup(stack, "SG", { vpc });

    // WHEN
    new LaunchTemplate(stack, "Template", {
      associatePublicIpAddress: false,
      securityGroup: sg,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        network_interfaces: [
          {
            // Somehow this is a string
            // https://github.com/cdktf/cdktf-provider-aws/blob/v19.55.0/src/launch-template/index.ts#L4786
            associate_public_ip_address: "false",
            device_index: 0,
            security_groups: ["${aws_security_group.SG_ADB53937.id}"],
          },
        ],
      },
    );
  });
});

describe("LaunchTemplate marketOptions", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("given spotOptions", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      spotOptions: {},
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_market_options: {
          market_type: "spot",
        },
      },
    );
  });

  test.each([
    [0, true],
    [1, false],
    [6, false],
    [7, true],
  ])(
    "for range duration errors: %p",
    (duration: number, expectErrors: boolean) => {
      // WHEN
      new LaunchTemplate(stack, "Template", {
        spotOptions: {
          blockDuration: Duration.hours(duration),
        },
      });

      // THEN
      if (expectErrors) {
        Annotations.fromStack(stack).hasErrors({
          constructPath: "MyStack/Template",
        });
      } else {
        // Check for no errors expected?
        expect(() => {
          Annotations.fromStack(stack).hasErrors({
            constructPath: "MyStack/Template",
          });
        }).toThrow();
      }
    },
  );

  test("for bad duration", () => {
    expect(() => {
      new LaunchTemplate(stack, "Template", {
        spotOptions: {
          // Duration must be an integral number of hours.
          blockDuration: Duration.minutes(61),
        },
      });
    }).toThrow();
  });

  test("given blockDuration", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      spotOptions: {
        blockDuration: Duration.hours(1),
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_market_options: {
          market_type: "spot",
          spot_options: {
            block_duration_minutes: 60,
          },
        },
      },
    );
  });

  test.each([
    [SpotInstanceInterruption.STOP, "stop"],
    [SpotInstanceInterruption.TERMINATE, "terminate"],
    [SpotInstanceInterruption.HIBERNATE, "hibernate"],
  ])(
    "given interruptionBehavior %p",
    (given: SpotInstanceInterruption, expected: string) => {
      // WHEN
      new LaunchTemplate(stack, "Template", {
        spotOptions: {
          interruptionBehavior: given,
        },
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfLaunchTemplate.LaunchTemplate,
        {
          instance_market_options: {
            market_type: "spot",
            spot_options: {
              instance_interruption_behavior: expected,
            },
          },
        },
      );
    },
  );

  test.each([
    [0.001, "0.001"],
    [1, "1"],
    [2.5, "2.5"],
  ])("given maxPrice %p", (given: number, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      spotOptions: {
        maxPrice: given,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_market_options: {
          market_type: "spot",
          spot_options: {
            max_price: expected,
          },
        },
      },
    );
  });

  test.each([
    [SpotRequestType.ONE_TIME, "one-time"],
    [SpotRequestType.PERSISTENT, "persistent"],
  ])("given requestType %p", (given: SpotRequestType, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      spotOptions: {
        requestType: given,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_market_options: {
          market_type: "spot",
          spot_options: {
            spot_instance_type: expected,
          },
        },
      },
    );
  });

  test("given validUntil", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      spotOptions: {
        validUntil: Expiration.atTimestamp(0),
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        instance_market_options: {
          market_type: "spot",
          spot_options: {
            valid_until: "Thu, 01 Jan 1970 00:00:00 GMT",
          },
        },
      },
    );
  });
});

describe("LaunchTemplate metadataOptions", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test.each([
    [true, "enabled"],
    [false, "disabled"],
  ])("given httpEndpoint %p", (given: boolean, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      httpEndpoint: given,
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_endpoint: expected,
        },
      },
    );
  });

  test.each([
    [true, "enabled"],
    [false, "disabled"],
  ])("given httpProtocolIpv6 %p", (given: boolean, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      httpProtocolIpv6: given,
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_protocol_ipv6: expected,
        },
      },
    );
  });

  test.each([
    [1, 1],
    [2, 2],
  ])("given httpPutResponseHopLimit %p", (given: number, expected: number) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      httpPutResponseHopLimit: given,
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_put_response_hop_limit: expected,
        },
      },
    );
  });

  test.each([
    [LaunchTemplateHttpTokens.OPTIONAL, "optional"],
    [LaunchTemplateHttpTokens.REQUIRED, "required"],
  ])(
    "given httpTokens %p",
    (given: LaunchTemplateHttpTokens, expected: string) => {
      // WHEN
      new LaunchTemplate(stack, "Template", {
        httpTokens: given,
      });
      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfLaunchTemplate.LaunchTemplate,
        {
          metadata_options: {
            http_tokens: expected,
          },
        },
      );
    },
  );

  test.each([
    [true, "enabled"],
    [false, "disabled"],
  ])("given instanceMetadataTags %p", (given: boolean, expected: string) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      instanceMetadataTags: given,
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          instance_metadata_tags: expected,
        },
      },
    );
  });

  test.each([
    [0, true],
    [-1, true],
    [1, false],
    [64, false],
    [65, true],
  ])("given instanceMetadataTags %p", (given: number, expectError: boolean) => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      httpPutResponseHopLimit: given,
    });
    // THEN
    if (expectError) {
      Annotations.fromStack(stack).hasErrors({
        constructPath: "MyStack/Template",
      });
    }
    // TODO: check for no errors expected
    // else {
    //   expect(() => {
    //     Annotations.fromStack(stack).hasErrors({
    //       constructPath: "/Default/Template",
    //     });
    //   }).toThrow();
    // }
  });

  test("throw when requireImdsv2 is true and httpTokens is OPTIONAL", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      requireImdsv2: true,
      httpTokens: LaunchTemplateHttpTokens.OPTIONAL,
    });
    // THEN
    Annotations.fromStack(stack).hasErrors({
      message: /httpTokens must be required when requireImdsv2 is true/,
    });
  });
  test("httpTokens REQUIRED is allowed when requireImdsv2 is true", () => {
    // WHEN
    new LaunchTemplate(stack, "Template", {
      requireImdsv2: true,
      httpTokens: LaunchTemplateHttpTokens.REQUIRED,
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_tokens: "required",
        },
      },
    );
  });
});
