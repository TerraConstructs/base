// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/bastion-host.test.ts

import {
  instance as tfInstance,
  launchTemplate as tfLaunchTemplate,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
// import { BASTION_HOST_USE_AMAZON_LINUX_2023_BY_DEFAULT } from "../../cx-api";
import {
  BastionHostLinux,
  BlockDeviceVolume,
  // CloudFormationInit,
  // InitCommand,
  InstanceClass,
  InstanceSize,
  InstanceType,
  SubnetType,
  Vpc,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("bastion host", () => {
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

  test("default instance is created in basic", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      instance_type: "t3.nano",
      subnet_id: "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id}",
    });
  });
  test("default instance is created in isolated vpc", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC", {
      subnetConfiguration: [
        {
          subnetType: SubnetType.PRIVATE_ISOLATED,
          name: "Isolated",
        },
      ],
    });

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      instance_type: "t3.nano",
      subnet_id: "${aws_subnet.VPC_IsolatedSubnet1_878DBDC3.id}",
    });
  });
  test("ebs volume is encrypted", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC", {
      subnetConfiguration: [
        {
          subnetType: SubnetType.PRIVATE_ISOLATED,
          name: "Isolated",
        },
      ],
    });

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
      blockDevices: [
        {
          deviceName: "EBSBastionHost",
          volume: BlockDeviceVolume.ebs(10, {
            encrypted: true,
          }),
        },
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      ebs_block_device: [
        {
          device_name: "EBSBastionHost",
          encrypted: true,
          volume_size: 10,
        },
      ],
    });
  });
  test("x86-64 instances use x86-64 image by default", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      ami: expect.stringContaining(
        "aws--service--ami-amazon-linux-latest--al2023-ami-kernel-61-x86_64",
      ),
    });
  });
  test("arm instances use arm image by default", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      ami: expect.stringContaining(
        "aws--service--ami-amazon-linux-latest--al2023-ami-kernel-61-arm64",
      ),
    });
  });

  // // TODO: Add support for Grid Init (cfn-init)
  // test("add CloudFormation Init to instance", () => {
  //   // GIVEN
  //   const vpc = new Vpc(stack, "VPC");

  //   // WHEN
  //   new BastionHostLinux(stack, "Bastion", {
  //     vpc,
  //     initOptions: {
  //       timeout: Duration.minutes(30),
  //     },
  //     init: CloudFormationInit.fromElements(
  //       InitCommand.shellCommand("echo hello"),
  //     ),
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResource(tfInstance.Instance, {
  //     CreationPolicy: {
  //       ResourceSignal: {
  //         Timeout: "PT30M",
  //       },
  //     },
  //     Metadata: {
  //       "AWS::CloudFormation::Init": {
  //         config: {
  //           commands: {
  //             "000": {
  //               command: "echo hello",
  //             },
  //           },
  //         },
  //       },
  //     },
  //   });
  // });

  test("imdsv2 is required", () => {
    //GIVEN
    const vpc = new Vpc(stack, "VPC");

    //WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
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

  test("appends new hash digest to instance logical Id if userDataCausesReplacement is true", () => {
    //GIVEN
    const stackNew = new AwsStack(app, "StackNew", {
      environmentName, // should be different
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const vpcOld = new Vpc(stack, "VPC");
    const vpcNew = new Vpc(stackNew, "VPC");
    const oldSshKeys = ["foo", "bar"];
    const newSshKeys = ["foo_new", "bar_new"];
    // const oldHash = "450c0dd0c96b2841";
    // const newHash = "a5b7d63257ea4ca9";

    // WHEN
    const bastionHostOld = new BastionHostLinux(
      stack,
      "BastionHostUserDataCausesReplacement",
      {
        vpc: vpcOld,
        userDataCausesReplacement: true,
      },
    );
    bastionHostOld.instance.addUserData(
      ...oldSshKeys.map(
        (key) => `echo ${key} >> ~ec2-user/.ssh/authorized_keys`,
      ),
    );

    const bastionHostNew = new BastionHostLinux(
      stackNew,
      "BastionHostUserDataCausesReplacement",
      {
        vpc: vpcNew,
        userDataCausesReplacement: true,
      },
    );
    bastionHostNew.instance.addUserData(
      ...oldSshKeys.map(
        (key) => `echo ${key} >> ~ec2-user/.ssh/authorized_keys`,
      ),
    );
    bastionHostNew.instance.addUserData(
      ...newSshKeys.map(
        (key) => `echo ${key} >> ~ec2-user/.ssh/authorized_keys`,
      ),
    );

    // THEN
    // AWS CDK checks for logical Id change, TF provider just needs to have the attribute set
    const t = new Template(stack);
    t.toMatchObject({
      resource: {
        aws_instance: {
          // [`BastionHostUserDataCausesReplacement985DBC41${oldHash}`]:
          BastionHostUserDataCausesReplacement_985DBC41: {
            user_data_replace_on_change: true,
          },
        },
      },
    });
    const tNew = new Template(stackNew);
    tNew.toMatchObject({
      resource: {
        aws_instance: {
          // NOTE: TerraConstructs doesn't change the logical ID
          // [`BastionHostUserDataCausesReplacement985DBC41${newHash}`]:
          BastionHostUserDataCausesReplacement_985DBC41: {
            user_data_replace_on_change: true,
          },
        },
      },
    });
  });

  test("does not append new hash digest to instance logical Id if userDataCausesReplacement is false", () => {
    //GIVEN
    const vpc = new Vpc(stack, "VPC");
    const sshKeys = ["foo", "bar"];
    const hashdigest = "450c0dd0c96b2841";

    // WHEN
    const bastionHostOld = new BastionHostLinux(
      stack,
      "BastionHostUserDataCausesReplacement",
      {
        vpc,
        userDataCausesReplacement: false,
      },
    );
    bastionHostOld.instance.addUserData(
      ...sshKeys.map((key) => `echo ${key} >> ~ec2-user/.ssh/authorized_keys`),
    );

    // THEN
    // ["BastionHostUserDataCausesReplacement985DBC41"]
    Template.synth(stack).toHaveResource(tfInstance.Instance);
  });

  /**
   * TerraConstructs feature flag:
   * BASTION_HOST_USE_AMAZON_LINUX_2023_BY_DEFAULT is always true
   *
   * Currently, if the machineImage property of the BastionHost construct defaults to using
   * the latest Amazon Linux 2 AMI. Amazon Linux 2 hits end-of-life in June 2025,
   * so using Amazon Linux 2023 by default is a more future-proof and secure option.
   */
  test.skip("uses Amazon Linux 2 by default if feature flag is disabled", () => {
    // GIVEN
    // const featureFlags = {
    //   [BASTION_HOST_USE_AMAZON_LINUX_2023_BY_DEFAULT]: false,
    // };
    // const app = new App({
    //   context: featureFlags,
    // });
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      ami: expect.stringContaining(
        "aws--service--ami-amazon-linux-latest--amzn2-ami-kernel-510-hvm-x86_64",
      ),
    });
  });

  test("uses Amazon Linux 2023 by default if feature flag is enabled", () => {
    // GIVEN
    // const featureFlags = {
    //   [BASTION_HOST_USE_AMAZON_LINUX_2023_BY_DEFAULT]: true,
    // };
    // const app = new App({
    //   context: featureFlags,
    // });
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new BastionHostLinux(stack, "Bastion", {
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfInstance.Instance, {
      ami: expect.stringContaining(
        "aws--service--ami-amazon-linux-latest--al2023-ami-kernel-61-x86_64",
      ),
    });
  });
});
