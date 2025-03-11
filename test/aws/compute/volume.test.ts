// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/volume.test.ts

import {
  instance as tfInstance,
  ebsVolume as tfEbsVolume,
  kmsKey as tfKey,
  dataAwsIamPolicyDocument as tfIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack, Tags } from "../../../src/aws";
// import * as cxapi from "../../cx-api";
import {
  AmazonLinuxGeneration,
  EbsDeviceVolumeType,
  Instance,
  InstanceType,
  MachineImage,
  Volume,
  Vpc,
} from "../../../src/aws/compute";
import * as kms from "../../../src/aws/encryption";
import { AccountRootPrincipal, Role } from "../../../src/aws/iam";
import { Size } from "../../../src/size";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

// the Prefix for ARN using partition and account id data sources
const arnPrefix =
  "arn:${data.aws_partition.Partitition.partition}:ec2:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}";
const arnAccountRoot =
  "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root";

describe("volume", () => {
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
  test("basic volume", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
      volumeName: "MyVolume",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      availability_zone: "us-east-1a",
      multi_attach_enabled: false,
      size: 8,
      tags: expect.objectContaining({
        Name: "MyVolume",
      }),
      type: "gp3", // default due to feature flag always on
    });

    // Template.fromStack(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
    //   DeletionPolicy: "Retain",
    // });
  });

  test("fromVolumeAttributes", () => {
    // GIVEN
    const encryptionKey = new kms.Key(stack, "Key");
    const volumeId = "vol-000000";
    const availabilityZone = "us-east-1a";

    // WHEN
    const volume = Volume.fromVolumeAttributes(stack, "Volume", {
      volumeId,
      availabilityZone,
      encryptionKey,
    });

    // THEN
    expect(volume.volumeId).toEqual(volumeId);
    expect(volume.availabilityZone).toEqual(availabilityZone);
    expect(volume.encryptionKey).toEqual(encryptionKey);
  });

  test("tagged volume", () => {
    // GIVEN
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    Tags.of(volume).add("TagKey", "TagValue");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      availability_zone: "us-east-1a",
      multi_attach_enabled: false,
      size: 8,
      tags: expect.objectContaining({
        TagKey: "TagValue",
      }),
      type: "gp3", // default due to feature flag always on
    });
  });

  // TODO: missing in terraform-provider-aws
  // https://github.com/hashicorp/terraform-provider-aws/issues/34110
  test.skip("autoenableIO", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      // autoEnableIo: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      auto_enable_io: true,
    });
  });

  test("encryption", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      encrypted: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      encrypted: true,
    });
  });

  test("encryption with kms", () => {
    // GIVEN
    const encryptionKey = new kms.Key(stack, "Key");

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      encrypted: true,
      encryptionKey,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      encrypted: true,
      kms_key_id: stack.resolve(encryptionKey.keyArn),
    });
    t.expect.toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: ["kms:DescribeKey", "kms:GenerateDataKeyWithoutPlainText"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: [arnAccountRoot],
              },
            ],
            resources: ["*"],
            condition: [
              {
                test: "StringEquals",
                variable: "kms:ViaService",
                values: ["ec2.us-east-1.amazonaws.com"],
              },
              {
                test: "StringEquals",
                variable: "kms:CallerAccount",
                values: [
                  "${data.aws_caller_identity.CallerIdentity.account_id}",
                ],
              },
            ],
          },
        ]),
      },
    );
    t.expect.toHaveResourceWithProperties(tfKey.KmsKey, {
      policy: "${data.aws_iam_policy_document.Key_Policy_48E51E45.json}",
    });
  });

  test("iops", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      iops: 500,
      volumeType: EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      iops: 500,
      type: "io1",
    });
  });

  test("multi-attach", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      iops: 500,
      volumeType: EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
      enableMultiAttach: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      multi_attach_enabled: true,
    });
  });

  test("snapshotId", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      snapshotId: "snap-00000000",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      snapshot_id: "snap-00000000",
    });
  });

  test("throughput", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(1),
      volumeType: EbsDeviceVolumeType.GP3,
      throughput: 200,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      throughput: 200,
    });
  });

  test("volume: standard", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.MAGNETIC,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "standard",
    });
  });

  test("volume: io1", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
      iops: 300,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "io1",
    });
  });

  test("volume: io2", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
      iops: 300,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "io2",
    });
  });

  test("volume: gp2", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "gp2",
    });
  });

  test("volume: gp3", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "gp3",
    });
  });

  test("volume: st1", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.THROUGHPUT_OPTIMIZED_HDD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "st1",
    });
  });

  test("volume: sc1", () => {
    // GIVEN

    // WHEN
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
      volumeType: EbsDeviceVolumeType.COLD_HDD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "sc1",
    });
  });

  test("grantAttachVolume to any instance", () => {
    // GIVEN
    const role = new Role(stack, "Role", {
      assumedBy: new AccountRootPrincipal(),
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantAttachVolume(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:AttachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/*`,
            ],
          },
        ],
      },
    );
  });

  // When this feature flag is enabled, the default volume type of the
  // EBS volume will be \`EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3\`.
  // TerraConstructs default is always GENERAL_PURPOSE_SSD_GP3 for now
  test("EBS_DEFAULT_GP3 feature flag", () => {
    // GIVEN

    // WHEN
    // stack.node.setContext(cxapi.EBS_DEFAULT_GP3, true);
    new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(500),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      type: "gp3",
    });
  });

  describe("grantAttachVolume to any instance with encryption", () => {
    test("with default key policies", () => {
      // GIVEN
      const role = new Role(stack, "Role", {
        assumedBy: new AccountRootPrincipal(),
      });
      const encryptionKey = new kms.Key(stack, "Key");
      const volume = new Volume(stack, "Volume", {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(8),
        encrypted: true,
        encryptionKey,
      });

      // WHEN
      volume.grantAttachVolume(role);

      // THEN
      Template.synth(stack).toHaveDataSourceWithProperties(
        tfIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            {
              actions: ["kms:CreateGrant"],
              effect: "Allow",
              resources: [stack.resolve(encryptionKey.keyArn)],
              condition: [
                {
                  test: "Bool",
                  variable: "kms:GrantIsForAWSResource",
                  values: ["true"],
                },
                {
                  test: "StringEquals",
                  variable: "kms:ViaService",
                  values: ["ec2.us-east-1.amazonaws.com"],
                },
                {
                  test: "StringEquals",
                  variable: "kms:GrantConstraintType",
                  values: ["EncryptionContextSubset"],
                },
              ],
            },
          ]),
        },
      );
    });
  });

  test("grantAttachVolume to any instance with KMS.fromKeyArn() encryption", () => {
    // GIVEN
    const role = new Role(stack, "Role", {
      assumedBy: new AccountRootPrincipal(),
    });
    const kmsKey = new kms.Key(stack, "Key");
    // kmsKey policy is not strictly necessary for the test.
    // Demonstrating how to properly construct the Key.
    const principal = new kms.ViaServicePrincipal(
      `ec2.${stack.region}.amazonaws.com`,
      new AccountRootPrincipal(),
    ).withConditions({
      test: "StringEquals",
      variable: "kms:CallerAccount",
      values: [stack.account],
    });
    kmsKey.grant(
      principal,
      // Describe & Generate are required to be able to create the CMK-encrypted Volume.
      "kms:DescribeKey",
      "kms:GenerateDataKeyWithoutPlainText",
      // ReEncrypt is required for when the CMK is rotated.
      "kms:ReEncrypt*",
    );

    const encryptionKey = kms.Key.fromKeyArn(stack, "KeyArn", kmsKey.keyArn);
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
      encrypted: true,
      encryptionKey,
    });

    // WHEN
    volume.grantAttachVolume(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: ["kms:CreateGrant"],
            effect: "Allow",
            resources: [stack.resolve(kmsKey.keyArn)],
            condition: [
              {
                test: "Bool",
                variable: "kms:GrantIsForAWSResource",
                values: ["true"],
              },
              {
                test: "StringEquals",
                variable: "kms:ViaService",
                values: ["ec2.us-east-1.amazonaws.com"],
              },
              {
                test: "StringEquals",
                variable: "kms:GrantConstraintType",
                values: ["EncryptionContextSubset"],
              },
            ],
          },
        ]),
      },
    );
  });

  test("grantAttachVolume to specific instances", () => {
    // GIVEN
    const role = new Role(stack, "Role", {
      assumedBy: new AccountRootPrincipal(),
    });
    const vpc = new Vpc(stack, "Vpc");
    const instance1 = new Instance(stack, "Instance1", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const instance2 = new Instance(stack, "Instance2", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantAttachVolume(role, [instance1, instance2]);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:AttachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/${stack.resolve(instance1.instanceId)}`,
              `${arnPrefix}:instance/${stack.resolve(instance2.instanceId)}`,
            ],
          },
        ],
      },
    );
  });

  test("grantAttachVolume to instance self", () => {
    // GIVEN
    const vpc = new Vpc(stack, "Vpc");
    const instance = new Instance(stack, "Instance", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantAttachVolumeByResourceTag(instance.grantPrincipal, [instance]);

    // THEN
    // md5hash(constructs.map((c) => AwsStack.uniqueId(c)).join(""))
    const resourceTagValue = "4e046610d980c5250ff5d02b76d47df3";
    const resourceTagKeySuffix = resourceTagValue.slice(0, 10).toUpperCase();
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:AttachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/*`,
            ],
            condition: [
              {
                test: "ForAnyValue:StringEquals",
                variable: `ec2:ResourceTag/VolumeGrantAttach-${resourceTagKeySuffix}`,
                values: [resourceTagValue],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      tags: expect.objectContaining({
        [`VolumeGrantAttach-${resourceTagKeySuffix}`]: resourceTagValue,
      }),
    });
    t.expect.toHaveResourceWithProperties(tfInstance.Instance, {
      tags: expect.objectContaining({
        [`VolumeGrantAttach-${resourceTagKeySuffix}`]: resourceTagValue,
      }),
    });
  });

  test("grantAttachVolume to instance self with suffix", () => {
    // GIVEN
    const vpc = new Vpc(stack, "Vpc");
    const instance = new Instance(stack, "Instance", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantAttachVolumeByResourceTag(
      instance.grantPrincipal,
      [instance],
      "TestSuffix",
    );

    // THEN
    // md5hash(constructs.map((c) => AwsStack.uniqueId(c)).join(""))
    const resourceTagValue = "4e046610d980c5250ff5d02b76d47df3";
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:AttachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/*`,
            ],
            condition: [
              {
                test: "ForAnyValue:StringEquals",
                variable: "ec2:ResourceTag/VolumeGrantAttach-TestSuffix",
                values: [resourceTagValue],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      tags: expect.objectContaining({
        "VolumeGrantAttach-TestSuffix": resourceTagValue,
      }),
    });
    t.expect.toHaveResourceWithProperties(tfInstance.Instance, {
      tags: expect.objectContaining({
        "VolumeGrantAttach-TestSuffix": resourceTagValue,
      }),
    });
  });

  test("grantDetachVolume to any instance", () => {
    // GIVEN
    const role = new Role(stack, "Role", {
      assumedBy: new AccountRootPrincipal(),
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantDetachVolume(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:DetachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/*`,
            ],
          },
        ],
      },
    );
  });

  test("grantDetachVolume from specific instance", () => {
    // GIVEN
    const role = new Role(stack, "Role", {
      assumedBy: new AccountRootPrincipal(),
    });
    const vpc = new Vpc(stack, "Vpc");
    const instance1 = new Instance(stack, "Instance1", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const instance2 = new Instance(stack, "Instance2", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantDetachVolume(role, [instance1, instance2]);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:DetachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/${stack.resolve(instance1.instanceId)}`,
              `${arnPrefix}:instance/${stack.resolve(instance2.instanceId)}`,
            ],
          },
        ],
      },
    );
  });

  test("grantDetachVolume from instance self", () => {
    // GIVEN
    const vpc = new Vpc(stack, "Vpc");
    const instance = new Instance(stack, "Instance", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantDetachVolumeByResourceTag(instance.grantPrincipal, [instance]);

    // THEN
    // // md5hash(constructs.map((c) => AwsStack.uniqueId(c)).join(""))
    const resourceTagValue = "4e046610d980c5250ff5d02b76d47df3";
    const resourceTagKeySuffix = resourceTagValue.slice(0, 10).toUpperCase();
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:DetachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/*`,
            ],
            condition: [
              {
                test: "ForAnyValue:StringEquals",
                variable: `ec2:ResourceTag/VolumeGrantDetach-${resourceTagKeySuffix}`,
                values: [resourceTagValue],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      tags: expect.objectContaining({
        [`VolumeGrantDetach-${resourceTagKeySuffix}`]: resourceTagValue,
      }),
    });
    t.expect.toHaveResourceWithProperties(tfInstance.Instance, {
      tags: expect.objectContaining({
        [`VolumeGrantDetach-${resourceTagKeySuffix}`]: resourceTagValue,
      }),
    });
  });

  test("grantDetachVolume from instance self with suffix", () => {
    // GIVEN
    const vpc = new Vpc(stack, "Vpc");
    const instance = new Instance(stack, "Instance", {
      vpc,
      instanceType: new InstanceType("t3.small"),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      availabilityZone: "us-east-1a",
    });
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // WHEN
    volume.grantDetachVolumeByResourceTag(
      instance.grantPrincipal,
      [instance],
      "TestSuffix",
    );

    // THEN
    // md5hash(constructs.map((c) => AwsStack.uniqueId(c)).join(""))
    const resourceTagValue = "4e046610d980c5250ff5d02b76d47df3";
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      tfIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ec2:DetachVolume"],
            effect: "Allow",
            resources: [
              `${arnPrefix}:volume/${stack.resolve(volume.volumeId)}`,
              `${arnPrefix}:instance/*`,
            ],
            condition: [
              {
                test: "ForAnyValue:StringEquals",
                variable: "ec2:ResourceTag/VolumeGrantDetach-TestSuffix",
                values: [resourceTagValue],
              },
            ],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(tfEbsVolume.EbsVolume, {
      tags: expect.objectContaining({
        "VolumeGrantDetach-TestSuffix": resourceTagValue,
      }),
    });
    t.expect.toHaveResourceWithProperties(tfInstance.Instance, {
      tags: expect.objectContaining({
        "VolumeGrantDetach-TestSuffix": resourceTagValue,
      }),
    });
  });

  test("validation fromVolumeAttributes", () => {
    // GIVEN
    let idx: number = 0;
    const volume = new Volume(stack, "Volume", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });

    // THEN
    expect(() => {
      Volume.fromVolumeAttributes(stack, `Volume${idx++}`, {
        volumeId: volume.volumeId,
        availabilityZone: volume.availabilityZone,
      });
    }).not.toThrow();
    expect(() => {
      Volume.fromVolumeAttributes(stack, `Volume${idx++}`, {
        volumeId: "vol-0123456789abcdefABCDEF",
        availabilityZone: "us-east-1a",
      });
    }).not.toThrow();
    expect(() => {
      Volume.fromVolumeAttributes(stack, `Volume${idx++}`, {
        volumeId: " vol-0123456789abcdefABCDEF", // leading invalid character(s)
        availabilityZone: "us-east-1a",
      });
    }).toThrow(
      "`volumeId` does not match expected pattern. Expected `vol-<hexadecmial value>` (ex: `vol-05abe246af`) or a Token",
    );
    expect(() => {
      Volume.fromVolumeAttributes(stack, `Volume${idx++}`, {
        volumeId: "vol-0123456789abcdefABCDEF ", // trailing invalid character(s)
        availabilityZone: "us-east-1a",
      });
    }).toThrow(
      "`volumeId` does not match expected pattern. Expected `vol-<hexadecmial value>` (ex: `vol-05abe246af`) or a Token",
    );
  });

  test("validation required props", () => {
    // GIVEN
    const key = new kms.Key(stack, "Key");
    let idx: number = 0;

    // THEN
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
      });
    }).toThrow("Must provide at least one of `size` or `snapshotId`");
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(8),
      });
    }).not.toThrow();
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        snapshotId: "snap-000000000",
      });
    }).not.toThrow();
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(8),
        snapshotId: "snap-000000000",
      });
    }).not.toThrow();

    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(8),
        encryptionKey: key,
      });
    }).toThrow("`encrypted` must be true when providing an `encryptionKey`.");
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(8),
        encrypted: false,
        encryptionKey: key,
      });
    }).toThrow("`encrypted` must be true when providing an `encryptionKey`.");
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(8),
        encrypted: true,
        encryptionKey: key,
      });
    }).not.toThrow();
  });

  test("validation snapshotId", () => {
    // GIVEN
    const volume = new Volume(stack, "ForToken", {
      availabilityZone: "us-east-1a",
      size: Size.gibibytes(8),
    });
    let idx: number = 0;

    // THEN
    expect(() => {
      // Should not throw if we provide a Token for the snapshotId
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        snapshotId: volume.volumeId,
      });
    }).not.toThrow();
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        snapshotId: "snap-0123456789abcdefABCDEF",
      });
    }).not.toThrow();
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        snapshotId: " snap-1234", // leading extra character(s)
      });
    }).toThrow(
      "`snapshotId` does match expected pattern. Expected `snap-<hexadecmial value>` (ex: `snap-05abe246af`) or Token",
    );
    expect(() => {
      new Volume(stack, `Volume${idx++}`, {
        availabilityZone: "us-east-1a",
        snapshotId: "snap-1234 ", // trailing extra character(s)
      });
    }).toThrow(
      "`snapshotId` does match expected pattern. Expected `snap-<hexadecmial value>` (ex: `snap-05abe246af`) or Token",
    );
  });

  test("validation iops", () => {
    // GIVEN
    let idx: number = 0;

    // THEN
    // Test: Type of volume
    for (const volumeType of [
      EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
      EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
      EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
    ]) {
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(500),
          iops: 3000,
          volumeType,
        });
      }).not.toThrow();
    }

    for (const volumeType of [
      EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
      EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
    ]) {
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(500),
          volumeType,
        });
      }).toThrow(/`iops` must be specified if the `volumeType` is/);
    }

    for (const volumeType of [
      EbsDeviceVolumeType.GENERAL_PURPOSE_SSD,
      EbsDeviceVolumeType.THROUGHPUT_OPTIMIZED_HDD,
      EbsDeviceVolumeType.COLD_HDD,
      EbsDeviceVolumeType.MAGNETIC,
    ]) {
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(500),
          iops: 100,
          volumeType,
        });
      }).toThrow(/`iops` may only be specified if the `volumeType` is/);
    }

    // Test: iops in range
    for (const testData of [
      [EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3, 3000, 16000],
      [EbsDeviceVolumeType.PROVISIONED_IOPS_SSD, 100, 64000],
      [EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2, 100, 256000],
    ]) {
      const volumeType = testData[0] as EbsDeviceVolumeType;
      const min = testData[1] as number;
      const max = testData[2] as number;
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.tebibytes(10),
          volumeType,
          iops: min - 1,
        });
      }).toThrow(/iops must be between/);
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.tebibytes(10),
          volumeType,
          iops: min,
        });
      }).not.toThrow();
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.tebibytes(10),
          volumeType,
          iops: max,
        });
      }).not.toThrow();
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.tebibytes(10),
          volumeType,
          iops: max + 1,
        });
      }).toThrow(/iops must be between/);
    }

    // Test: iops ratio
    for (const testData of [
      [EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3, 500],
      [EbsDeviceVolumeType.PROVISIONED_IOPS_SSD, 50],
      [EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2, 500],
    ]) {
      const volumeType = testData[0] as EbsDeviceVolumeType;
      const max = testData[1] as number;
      const size = 10;
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(size),
          volumeType,
          iops: max * size,
        });
      }).not.toThrow();
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(size),
          volumeType,
          iops: max * size + 1,
        });
      }).toThrow(/iops has a maximum ratio of/);
    }
  });

  test("validation multi-attach", () => {
    // GIVEN
    let idx: number = 0;

    // THEN
    for (const volumeType of [
      EbsDeviceVolumeType.GENERAL_PURPOSE_SSD,
      EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
      EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
      EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
      EbsDeviceVolumeType.THROUGHPUT_OPTIMIZED_HDD,
      EbsDeviceVolumeType.COLD_HDD,
      EbsDeviceVolumeType.MAGNETIC,
    ]) {
      if (
        [
          EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
          EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
        ].includes(volumeType)
      ) {
        expect(() => {
          new Volume(stack, `Volume${idx++}`, {
            availabilityZone: "us-east-1a",
            size: Size.gibibytes(500),
            enableMultiAttach: true,
            volumeType,
            iops: 100,
          });
        }).not.toThrow();
      } else {
        expect(() => {
          new Volume(stack, `Volume${idx++}`, {
            availabilityZone: "us-east-1a",
            size: Size.gibibytes(500),
            enableMultiAttach: true,
            volumeType,
          });
        }).toThrow(/multi-attach is supported exclusively/);
      }
    }
  });

  test("validation size in range", () => {
    // GIVEN
    let idx: number = 0;

    // THEN
    for (const testData of [
      [EbsDeviceVolumeType.GENERAL_PURPOSE_SSD, 1, 16384],
      [EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3, 1, 16384],
      [EbsDeviceVolumeType.PROVISIONED_IOPS_SSD, 4, 16384],
      [EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2, 4, 16384],
      [EbsDeviceVolumeType.THROUGHPUT_OPTIMIZED_HDD, 125, 16384],
      [EbsDeviceVolumeType.COLD_HDD, 125, 16384],
      [EbsDeviceVolumeType.MAGNETIC, 1, 1024],
    ]) {
      const volumeType = testData[0] as EbsDeviceVolumeType;
      const min = testData[1] as number;
      const max = testData[2] as number;
      const iops = [
        EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
        EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
      ].includes(volumeType)
        ? 100
        : null;

      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(min - 1),
          volumeType,
          ...(iops ? { iops } : {}),
        });
      }).toThrow(/volumes must be between/);
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(min),
          volumeType,
          ...(iops ? { iops } : {}),
        });
      }).not.toThrow();
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(max),
          volumeType,
          ...(iops ? { iops } : {}),
        });
      }).not.toThrow();
      expect(() => {
        new Volume(stack, `Volume${idx++}`, {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(max + 1),
          volumeType,
          ...(iops ? { iops } : {}),
        });
      }).toThrow(/volumes must be between/);
    }
  });

  test.each([124, 1001])(
    "throws if throughput is set less than 125 or more than 1000",
    (throughput) => {
      expect(() => {
        new Volume(stack, "Volume", {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(1),
          volumeType: EbsDeviceVolumeType.GP3,
          throughput,
        });
      }).toThrow(
        /throughput property takes a minimum of 125 and a maximum of 1000/,
      );
    },
  );

  test.each([...Object.values(EbsDeviceVolumeType).filter((v) => v !== "gp3")])(
    "throws if throughput is set on any volume type other than GP3",
    (volumeType) => {
      const iops = [
        EbsDeviceVolumeType.PROVISIONED_IOPS_SSD,
        EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2,
      ].includes(volumeType)
        ? 100
        : null;
      expect(() => {
        new Volume(stack, "Volume", {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(125),
          volumeType,
          ...(iops ? { iops } : {}),
          throughput: 125,
        });
      }).toThrow(
        /throughput property requires volumeType: EbsDeviceVolumeType.GP3/,
      );
    },
  );

  test("Invalid iops to throughput ratio", () => {
    expect(() => {
      new Volume(stack, "Volume", {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(125),
        volumeType: EbsDeviceVolumeType.GP3,
        iops: 3000,
        throughput: 751,
      });
    }).toThrow(
      "Throughput (MiBps) to iops ratio of 0.25033333333333335 is too high; maximum is 0.25 MiBps per iops",
    );
  });
});
