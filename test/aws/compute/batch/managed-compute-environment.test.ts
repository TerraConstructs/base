// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/managed-compute-environment.test.ts

import {
  batchComputeEnvironment,
  dataAwsIamPolicyDocument,
  iamInstanceProfile,
  iamRolePolicyAttachment,
} from "@cdktn/provider-aws";
import { HttpBackend, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack, Tags } from "../../../../src/aws";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  LaunchTemplate,
  MachineImage,
  PlacementGroup,
  SecurityGroup,
  Subnet,
  Vpc,
} from "../../../../src/aws/compute";
import * as batch from "../../../../src/aws/compute/batch";
import * as iam from "../../../../src/aws/iam";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

// TERRACONSTRUCTS DEVIATION: upstream's `defaultExpectedEcsProps`/`defaultExpectedEksProps` are
// CfnComputeEnvironmentProps (CloudFormation L1 property bags) run through `capitalizePropertyNames`
// (test/utils.ts) to produce PascalCase CFN assertion shapes. There is no CFN L1 here -- the
// `aws_batch_compute_environment` Terraform resource's config is already snake_case -- so the
// expected props below are asserted directly in Terraform attribute shape via
// `toHaveResourceWithProperties`, which is a subset ("contains") match just like upstream's
// `hasResourceProperties`.
const defaultExpectedProps: Record<string, any> = {
  type: "MANAGED",
  state: "ENABLED",
};

const defaultComputeResources: Record<string, any> = {
  allocation_strategy: batch.AllocationStrategy.BEST_FIT_PROGRESSIVE,
  max_vcpus: 256,
  min_vcpus: 0,
  type: "EC2",
  instance_type: ["optimal"],
};

/**
 * Builds the `dataAwsIamPolicyDocument` statement shape rendered by `iam.Role` for a role
 * `assumedBy` a single `ServicePrincipal`, so tests can assert against it without hardcoding
 * the `aws_service_principal` data-source lookup token (see AwsStack.servicePrincipalName()).
 */
function assumeRoleStatement(
  awsStack: AwsStack,
  service: string,
  region?: string,
) {
  return {
    actions: ["sts:AssumeRole"],
    effect: "Allow",
    principals: [
      {
        type: "Service",
        identifiers: [
          awsStack.resolve(awsStack.servicePrincipalName(service, region)),
        ],
      },
    ],
  };
}

let stack: AwsStack;
let vpc: Vpc;

let defaultEcsProps: batch.ManagedEc2EcsComputeEnvironmentProps;

let expectedProps: any;
let defaultProps: any;

// TERRACONSTRUCTS DEVIATION: upstream's describe.each also covers `ManagedEc2EksComputeEnvironment`.
// EKS support is intentionally omitted in this port (blocked on aws-eks port -- see the
// ManagedEc2EksComputeEnvironment omission TODOs in
// src/aws/compute/batch/managed-compute-environment.ts), so only the ManagedEc2Ecs variant is
// exercised here.
describe.each([batch.ManagedEc2EcsComputeEnvironment])(
  "%p type ComputeEnvironment",
  (ComputeEnvironment) => {
    beforeEach(() => {
      stack = getAwsStack();
      vpc = new Vpc(stack, "vpc");

      defaultEcsProps = {
        vpc,
      };
      expectedProps = defaultExpectedProps;
      defaultProps = defaultEcsProps;
    });

    test("default props", () => {
      // WHEN
      const ce = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            security_group_ids: [
              stack.resolve(ce.connections.securityGroups[0].securityGroupId),
            ],
            subnets: stack.resolve(vpc.selectSubnets().subnetIds),
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      // });
      Template.synth(stack).toHaveResourceWithProperties(
        iamInstanceProfile.IamInstanceProfile,
        {
          role: stack.resolve(ce.instanceRole!.roleName),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::InstanceProfile', {
      //   Roles: [{ Ref: 'MyCEInstanceProfileRole895D248D' }],
      // });
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [assumeRoleStatement(stack, "ec2.amazonaws.com")],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
      //   AssumeRolePolicyDocument: {
      //     Statement: [{
      //       Action: 'sts:AssumeRole',
      //       Effect: 'Allow',
      //       Principal: { Service: 'ec2.amazonaws.com' },
      //     }],
      //     Version: '2012-10-17',
      //   },
      // });
    });

    test("can specify maxvCpus", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        maxvCpus: 512,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            max_vcpus: 512,
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     MaxvCpus: 512,
      //   },
      // });
    });

    test("can specify parameterized maxvCpus", () => {
      // WHEN
      const maxVCpuParameter = new TerraformVariable(
        stack,
        "MaxVCpuParameter",
        {
          type: "number",
          default: 512,
        },
      );

      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        maxvCpus: maxVCpuParameter.numberValue,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            max_vcpus: "${var.MaxVCpuParameter}",
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     MaxvCpus: {
      //       Ref: 'MaxVCpuParameter',
      //     },
      //   },
      // });
    });

    test("can specify minvCpus", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        minvCpus: 8,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            min_vcpus: 8,
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     MinvCpus: 8,
      //   },
      // });
    });

    test("can specify parameterized minvCpus", () => {
      // WHEN
      const minVCpuParameter = new TerraformVariable(
        stack,
        "MinVCpuParameter",
        {
          type: "number",
          default: 512,
        },
      );

      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        minvCpus: minVCpuParameter.numberValue,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            min_vcpus: "${var.MinVCpuParameter}",
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     MinvCpus: {
      //       Ref: 'MinVCpuParameter',
      //     },
      //   },
      // });
    });

    test("can specify spotBidPercentage as a parameter", () => {
      // WHEN
      const spotBidPercentageParameter = new TerraformVariable(
        stack,
        "SpotBidPercentageParameter",
        {
          type: "number",
          default: 100,
        },
      );

      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        spot: true,
        spotBidPercentage: spotBidPercentageParameter.numberValue,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            type: "SPOT",
            allocation_strategy:
              batch.AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED,
            bid_percentage: "${var.SpotBidPercentageParameter}",
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     Type: 'SPOT',
      //     AllocationStrategy: AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED,
      //     BidPercentage: {
      //       Ref: 'SpotBidPercentageParameter',
      //     },
      //   },
      // });
    });

    test("can be disabled", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        enabled: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          state: "DISABLED",
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   State: 'DISABLED',
      // });
    });

    test("spot => AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        spot: true,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            type: "SPOT",
            allocation_strategy: "SPOT_PRICE_CAPACITY_OPTIMIZED",
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     Type: 'SPOT',
      //     AllocationStrategy: 'SPOT_PRICE_CAPACITY_OPTIMIZED',
      //   },
      // });
    });

    test("images are correctly rendered as EC2ConfigurationObjects", () => {
      // TERRACONSTRUCTS DEVIATION: upstream branches on `ComputeEnvironment` to pick
      // `EksMachineImageType.EKS_AL2` for the EKS variant; that variant is omitted in this port
      // (see the describe.each note above), so the expected image type is always `ECS_AL2`.
      const expectedImageType = batch.EcsMachineImageType.ECS_AL2;

      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        images: [
          {
            image: MachineImage.latestAmazonLinux2(),
          },
        ],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            ec2_configuration: [
              {
                // image_id_override is an SSM-parameter-lookup token rendered from the internal
                // scope `this` inside the construct; not independently reproducible from the test.
                image_id_override: expect.any(String),
                image_type: expectedImageType,
              },
            ],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     Ec2Configuration: [
      //       {
      //         ImageIdOverride: { Ref: 'SsmParameterValueawsserviceamiamazonlinuxlatestamzn2amikernel510hvmx8664gp2C96584B6F00A464EAD1953AFF4B05118Parameter' },
      //         ImageType: expectedImageType,
      //       },
      //     ],
      //   },
      // });
    });

    test("instance classes are correctly rendered", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        instanceClasses: [InstanceClass.R4],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            instance_type: ["r4", "optimal"],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     InstanceTypes: [
      //       'r4',
      //       'optimal',
      //     ],
      //   },
      // });
    });

    test("instance types are correctly rendered", () => {
      // WHEN
      const ce = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        instanceTypes: [InstanceType.of(InstanceClass.R4, InstanceSize.LARGE)],
      });

      ce.addInstanceClass(InstanceClass.M4);
      ce.addInstanceType(InstanceType.of(InstanceClass.C4, InstanceSize.LARGE));

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            instance_type: ["r4.large", "c4.large", "m4", "optimal"],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     InstanceTypes: [
      //       'r4.large',
      //       'c4.large',
      //       'm4',
      //       'optimal',
      //     ],
      //   },
      // });
    });

    test("respects useOptimalInstanceClasses: false", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        useOptimalInstanceClasses: false,
        instanceClasses: [InstanceClass.R4],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            instance_type: ["r4"],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     InstanceTypes: [
      //       'r4',
      //     ],
      //   },
      // });
    });

    test("does not throw with useOptimalInstanceClasses: false and a call to addInstanceClass()", () => {
      // WHEN
      const myCE = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        useOptimalInstanceClasses: false,
      });

      myCE.addInstanceClass(InstanceClass.C4);

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            instance_type: ["c4"],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     InstanceTypes: [
      //       'c4',
      //     ],
      //   },
      // });
    });

    test("does not throw with useOptimalInstanceClasses: false and a call to addInstanceType()", () => {
      // WHEN
      const myCE = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        useOptimalInstanceClasses: false,
      });

      myCE.addInstanceType(
        InstanceType.of(InstanceClass.C4, InstanceSize.XLARGE112),
      );

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            instance_type: ["c4.112xlarge"],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     InstanceTypes: [
      //       'c4.112xlarge',
      //     ],
      //   },
      // });
    });

    test("creates and uses instanceProfile, even when instanceRole is specified", () => {
      // WHEN
      const myRole = new iam.Role(stack, "myRole", {
        assumedBy: new iam.ServicePrincipal("foo.amazonaws.com", {
          region: "bermuda-triangle-1337",
        }),
      });
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        instanceRole: myRole,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            // instanceRole is unchanged from default
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     // instanceRole is unchanged from default
      //   },
      // });
      Template.synth(stack).toHaveResourceWithProperties(
        iamInstanceProfile.IamInstanceProfile,
        {
          role: stack.resolve(myRole.roleName),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::InstanceProfile', {
      //   Roles: [{ Ref: 'myRoleE60D68E8' }],
      // });
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            assumeRoleStatement(
              stack,
              "foo.amazonaws.com",
              "bermuda-triangle-1337",
            ),
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
      //   AssumeRolePolicyDocument: {
      //     Statement: [{
      //       Action: 'sts:AssumeRole',
      //       Effect: 'Allow',
      //       Principal: { Service: 'foo.amazonaws.com' },
      //     }],
      //     Version: '2012-10-17',
      //   },
      // });
    });

    test("respects launch template", () => {
      // WHEN
      const launchTemplate = new LaunchTemplate(stack, "launchTemplate");
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        launchTemplate,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            launch_template: {
              launch_template_id: stack.resolve(
                launchTemplate.launchTemplateId,
              ),
            },
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     LaunchTemplate: {
      //       LaunchTemplateId: { Ref: 'launchTemplateDEE5742D' },
      //     },
      //   },
      // });
    });

    test("respects name", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        computeEnvironmentName: "NamedCE",
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          name: "NamedCE",
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeEnvironmentName: 'NamedCE',
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //   },
      // });
    });

    test("respects placement group", () => {
      // WHEN
      const myPlacementGroup = new PlacementGroup(stack, "myPlacementGroup");
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        placementGroup: myPlacementGroup,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            placement_group: stack.resolve(myPlacementGroup.placementGroupName),
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     PlacementGroup: {
      //       'Fn::GetAtt': ['myPlacementGroup2E94D14E', 'GroupName'],
      //     },
      //   },
      // });
    });

    test("respects replaceComputeEnvironment", () => {
      // WHEN
      const ce = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
        replaceComputeEnvironment: true,
      });

      // THEN
      // TERRACONSTRUCTS DEVIATION (provider-unsupported): `replaceComputeEnvironment` is a
      // CloudFormation-only stack-update replacement-behavior toggle with no
      // `aws_batch_compute_environment` Terraform counterpart (verified against @cdktn/provider-aws
      // 6.52.0 -- see mappings/aws-batch.json, CfnComputeEnvironment "UNMAPPABLE Cfn props"). The prop
      // is still accepted and stored on the construct for upstream API parity, so only the
      // construct-level value is asserted here.
      expect(ce.replaceComputeEnvironment).toEqual(true);
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //   },
      //   ReplaceComputeEnvironment: true,
      // });
    });

    test("respects security groups", () => {
      // WHEN
      const testSG = new SecurityGroup(stack, "TestSG", {
        vpc,
        allowAllOutbound: false,
      });
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        securityGroups: [testSG],
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            security_group_ids: [stack.resolve(testSG.securityGroupId)],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     SecurityGroupIds: [{
      //       'Fn::GetAtt': ['TestSG581D3391', 'GroupId'],
      //     }],
      //   },
      // });
    });

    test("respects service role", () => {
      // WHEN
      const testSLR = new iam.Role(stack, "TestSLR", {
        assumedBy: new iam.ServicePrincipal("cdk.amazonaws.com"),
      });
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        serviceRole: testSLR,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          service_role: stack.resolve(testSLR.roleArn),
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ServiceRole: {
      //     'Fn::GetAtt': ['TestSLR05974C22', 'Arn'],
      //   },
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //   },
      // });
    });

    test("respects vpcSubnets", () => {
      // WHEN
      const subnetVpc = new Vpc(stack, "subnetVpc");
      const testSubnet = new Subnet(stack, "testSubnet", {
        availabilityZone: "az-3",
        cidrBlock: "10.0.0.0/32",
        vpcId: subnetVpc.vpcId,
      });
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpcSubnets: {
          subnets: [testSubnet],
        },
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
            subnets: [stack.resolve(testSubnet.subnetId)],
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     Subnets: [
      //       { Ref: 'testSubnet42F0FA0C' },
      //     ],
      //   },
      // });
    });

    test("respects updateTimeout", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        updateTimeout: Duration.minutes(1),
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
          }),
          update_policy: {
            job_execution_timeout_minutes: 1,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //   },
      //   UpdatePolicy: {
      //     JobExecutionTimeoutMinutes: 1,
      //   },
      // });
    });

    test("respects terminateOnUpdate", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        terminateOnUpdate: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
          }),
          update_policy: {
            terminate_jobs_on_update: false,
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //   },
      //   UpdatePolicy: {
      //     TerminateJobsOnUpdate: false,
      //   },
      // });
    });

    test("respects updateToLatestImageVersion", () => {
      // WHEN
      const ce = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        updateToLatestImageVersion: false,
      });

      // THEN
      // TERRACONSTRUCTS DEVIATION (provider-unsupported): `computeResources.updateToLatestImageVersion`
      // has no `BatchComputeEnvironmentComputeResources` counterpart (verified against
      // @cdktn/provider-aws 6.52.0 -- see mappings/aws-batch.json, CfnComputeEnvironment "UNMAPPABLE
      // Cfn props"). The prop is still accepted and stored on the construct for upstream API parity,
      // so only the construct-level value is asserted here.
      expect(ce.updateToLatestImageVersion).toEqual(false);
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          compute_resources: expect.objectContaining({
            ...defaultComputeResources,
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     UpdateToLatestImageVersion: false,
      //   },
      // });
    });

    test("respects tags", () => {
      // WHEN
      const ce = new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
      });

      Tags.of(ce).add("superfood", "acai");
      Tags.of(ce).add("super", "salamander");

      // THEN
      // TERRACONSTRUCTS DEVIATION: upstream tags land on the CFN `ComputeResources.Tags` (tags
      // applied to the spawned EC2 instances). This port has no TagManager wiring into the nested
      // `compute_resources.tags` block (see the TODO comment in managed-compute-environment.ts); the
      // generic Tags aspect instead populates the `aws_batch_compute_environment` resource's own
      // top-level `tags` attribute.
      Template.synth(stack).toHaveResourceWithProperties(
        batchComputeEnvironment.BatchComputeEnvironment,
        {
          ...expectedProps,
          tags: expect.objectContaining({
            superfood: "acai",
            super: "salamander",
          }),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
      //   ...expectedProps,
      //   ComputeResources: {
      //     ...defaultComputeResources,
      //     Tags: {
      //       superfood: 'acai',
      //       super: 'salamander',
      //     },
      //   },
      // });
    });

    test("can be imported from arn", () => {
      // WHEN
      const ce =
        batch.ManagedEc2EcsComputeEnvironment.fromManagedEc2EcsComputeEnvironmentArn(
          stack,
          "import",
          "arn:aws:batch:us-east-1:123456789012:compute-environment/ce-name",
        );

      // THEN
      expect(ce.computeEnvironmentArn).toEqual(
        "arn:aws:batch:us-east-1:123456789012:compute-environment/ce-name",
      );
    });

    test("attach necessary managed policy to instance role", () => {
      // WHEN
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        vpc,
      });

      // THEN
      const expectedManagedPolicyArn =
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          stack,
          "ExpectedManagedPolicy",
          "service-role/AmazonEC2ContainerServiceforEC2Role",
        ).managedPolicyArn;
      Template.synth(stack).toHaveResourceWithProperties(
        iamRolePolicyAttachment.IamRolePolicyAttachment,
        {
          policy_arn: stack.resolve(expectedManagedPolicyArn),
        },
      );
      // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
      //   ManagedPolicyArns: [
      //     {
      //       'Fn::Join': [
      //         '',
      //         [
      //           'arn:',
      //           {
      //             Ref: 'AWS::Partition',
      //           },
      //           ':iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role',
      //         ],
      //       ],
      //     },
      //   ],
      // });
    });

    test("throws when no instance types are provided", () => {
      new ComputeEnvironment(stack, "MyCE", {
        ...defaultProps,
        useOptimalInstanceClasses: false,
        vpc,
      });

      expect(() => {
        Template.fromStack(stack, { runValidations: true });
      }).toThrow(
        /'defaultInstanceClasses' undefined without specifying any instance types or classes/,
      );
    });

    test("throws error when AllocationStrategy.SPOT_CAPACITY_OPTIMIZED is used without specfiying spot", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          allocationStrategy: batch.AllocationStrategy.SPOT_CAPACITY_OPTIMIZED,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'AllocationStrategy.SPOT_CAPACITY_OPTIMIZED' without using spot instances/,
      );
    });

    test("throws error when AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED is used without specfiying spot", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          allocationStrategy:
            batch.AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED' without using spot instances/,
      );
    });

    test("throws error when spotBidPercentage is specified without spot", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          spotBidPercentage: 80,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'spotBidPercentage' without specifying 'spot'/,
      );
    });

    test("throws error when spotBidPercentage is specified and spot is false", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          spotBidPercentage: 80,
          spot: false,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'spotBidPercentage' without specifying 'spot'/,
      );
    });

    test("throws error when spotBidPercentage is a parameter and spot is not enabled", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          spotBidPercentage: new TerraformVariable(
            stack,
            "SpotBidPercentageParameter",
            {
              type: "number",
            },
          ).numberValue,
          spot: false,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'spotBidPercentage' without specifying 'spot'/,
      );
    });

    test("throws error when spotBidPercentage > 100", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          spotBidPercentage: 120,
          spot: true,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'spotBidPercentage' > 100/,
      );
    });

    test("throws error when spotBidPercentage < 0", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          spotBidPercentage: -120,
          spot: true,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' specifies 'spotBidPercentage' < 0/,
      );
    });

    test("throws error when minvCpus > maxvCpus", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          maxvCpus: 512,
          minvCpus: 1024,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' has 'minvCpus' = 1024 > 'maxvCpus' = 512; 'minvCpus' cannot be greater than 'maxvCpus'/,
      );
    });

    test("skips validation for minvCpus < maxvCpus check when either properties are tokens", () => {
      // WHEN
      const minVCpuParameter = new TerraformVariable(
        stack,
        "MinVCpuParameter",
        {
          type: "number",
          default: 512,
        },
      );

      const maxVCpuParameter = new TerraformVariable(
        stack,
        "MaxVCpuParameter",
        {
          type: "number",
          default: 512,
        },
      );

      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          maxvCpus: maxVCpuParameter.numberValue,
          minvCpus: 1024,
        });

        new ComputeEnvironment(stack, "MyOtherCE", {
          ...defaultProps,
          vpc,
          maxvCpus: 1024,
          minvCpus: minVCpuParameter.numberValue,
        });
      }).not.toThrow(
        /Managed ComputeEnvironment 'MyCE' has 'minvCpus' = 1024 > 'maxvCpus' = 512; 'minvCpus' cannot be greater than 'maxvCpus'/,
      );
    });

    test("throws error when minvCpus < 0", () => {
      // THEN
      expect(() => {
        new ComputeEnvironment(stack, "MyCE", {
          ...defaultProps,
          vpc,
          minvCpus: -256,
        });
      }).toThrow(
        /Managed ComputeEnvironment 'MyCE' has 'minvCpus' = -256 < 0; 'minvCpus' cannot be less than zero/,
      );
    });
  },
);

describe("ManagedEc2EcsComputeEnvironment", () => {
  beforeEach(() => {
    stack = getAwsStack();
    vpc = new Vpc(stack, "vpc");

    defaultEcsProps = {
      vpc,
    };
  });

  test("respects spotFleetRole", () => {
    // WHEN
    const spotFleetRole = new iam.Role(stack, "SpotFleetRole", {
      assumedBy: new iam.ArnPrincipal(
        "arn:aws:iam:123456789012:magicuser/foobar",
      ),
    });
    new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
      ...defaultEcsProps,
      spot: true,
      spotFleetRole,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      batchComputeEnvironment.BatchComputeEnvironment,
      {
        ...defaultExpectedProps,
        compute_resources: expect.objectContaining({
          ...defaultComputeResources,
          allocation_strategy:
            batch.AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED,
          type: "SPOT",
          spot_iam_fleet_role: stack.resolve(spotFleetRole.roleArn),
        }),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
    //   ...pascalCaseExpectedEcsProps,
    //   ComputeResources: {
    //     ...defaultComputeResources,
    //     AllocationStrategy: AllocationStrategy.SPOT_PRICE_CAPACITY_OPTIMIZED,
    //     Type: 'SPOT',
    //     SpotIamFleetRole: {
    //       'Fn::GetAtt': ['SpotFleetRole6D4F7558', 'Arn'],
    //     },
    //   },
    // });
  });

  test("image types are correctly rendered as EC2ConfigurationObjects", () => {
    // WHEN
    new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
      ...defaultEcsProps,
      vpc,
      images: [
        {
          imageType: batch.EcsMachineImageType.ECS_AL2_NVIDIA,
        },
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      batchComputeEnvironment.BatchComputeEnvironment,
      {
        ...defaultExpectedProps,
        compute_resources: expect.objectContaining({
          ...defaultComputeResources,
          ec2_configuration: [
            {
              image_type: "ECS_AL2_NVIDIA",
            },
          ],
        }),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
    //   ...pascalCaseExpectedEcsProps,
    //   ComputeResources: {
    //     ...defaultComputeResources,
    //     Ec2Configuration: [
    //       {
    //         ImageType: 'ECS_AL2_NVIDIA',
    //       },
    //     ],
    //   },
    // });
  });

  test("Amazon Linux 2023 does not support A1 instances.", () => {
    expect(
      () =>
        new batch.ManagedEc2EcsComputeEnvironment(
          stack,
          "Al2023A1InstanceClass",
          {
            ...defaultEcsProps,
            instanceClasses: [InstanceClass.A1],
            vpc,
            images: [
              {
                imageType: batch.EcsMachineImageType.ECS_AL2023,
              },
            ],
          },
        ),
    ).toThrow("Amazon Linux 2023 does not support A1 instances.");

    expect(
      () =>
        new batch.ManagedEc2EcsComputeEnvironment(
          stack,
          "Al2023A1XlargeInstance",
          {
            ...defaultEcsProps,
            instanceTypes: [
              InstanceType.of(InstanceClass.A1, InstanceSize.XLARGE2),
            ],
            vpc,
            images: [
              {
                imageType: batch.EcsMachineImageType.ECS_AL2023,
              },
            ],
          },
        ),
    ).toThrow("Amazon Linux 2023 does not support A1 instances.");

    new batch.ManagedEc2EcsComputeEnvironment(stack, "Al2A1InstanceClass", {
      ...defaultEcsProps,
      instanceClasses: [InstanceClass.A1],
      vpc,
      images: [
        {
          imageType: batch.EcsMachineImageType.ECS_AL2,
        },
      ],
    });

    new batch.ManagedEc2EcsComputeEnvironment(stack, "Al2A1XlargeInstance", {
      ...defaultEcsProps,
      instanceTypes: [InstanceType.of(InstanceClass.A1, InstanceSize.XLARGE2)],
      vpc,
      images: [
        {
          imageType: batch.EcsMachineImageType.ECS_AL2,
        },
      ],
    });
  });

  test("can use non-default allocation strategy", () => {
    // WHEN
    new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
      ...defaultEcsProps,
      vpc,
      allocationStrategy: batch.AllocationStrategy.BEST_FIT,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      batchComputeEnvironment.BatchComputeEnvironment,
      {
        ...defaultExpectedProps,
        compute_resources: expect.objectContaining({
          ...defaultComputeResources,
          allocation_strategy: "BEST_FIT",
        }),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
    //   ...pascalCaseExpectedEcsProps,
    //   ComputeResources: {
    //     ...defaultComputeResources,
    //     AllocationStrategy: 'BEST_FIT',
    //   },
    // });
  });

  test("spot and AllocationStrategy.BEST_FIT => a default spot fleet role is created", () => {
    // WHEN
    const ce = new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
      ...defaultEcsProps,
      vpc,
      spot: true,
      allocationStrategy: batch.AllocationStrategy.BEST_FIT,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      batchComputeEnvironment.BatchComputeEnvironment,
      {
        ...defaultExpectedProps,
        compute_resources: expect.objectContaining({
          ...defaultComputeResources,
          type: "SPOT",
          allocation_strategy: "BEST_FIT",
          spot_iam_fleet_role: stack.resolve(ce.spotFleetRole!.roleArn),
        }),
      },
    );
    // TERRACONSTRUCTS addition (PR #136 review): the generated role must carry the
    // AmazonEC2SpotFleetTaggingRole managed policy - AWS requires it for Batch to
    // launch/tag/terminate the fleet's instances; a bare role (upstream behavior)
    // synthesizes fine but is unusable at runtime.
    // https://docs.aws.amazon.com/batch/latest/userguide/spot_fleet_IAM_role.html
    Template.synth(stack).toHaveResourceWithProperties(
      iamRolePolicyAttachment.IamRolePolicyAttachment,
      {
        role: stack.resolve(ce.spotFleetRole!.roleName),
        policy_arn: expect.stringMatching(
          /service-role\/AmazonEC2SpotFleetTaggingRole/,
        ),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
    //   ...pascalCaseExpectedEcsProps,
    //   ComputeResources: {
    //     ...defaultComputeResources,
    //     Type: 'SPOT',
    //     AllocationStrategy: 'BEST_FIT',
    //     SpotIamFleetRole: { 'Fn::GetAtt': ['MyCESpotFleetRole70BE30A0', 'Arn'] },
    //   },
    // });
  });

  test("can use default instance classes", () => {
    // WHEN
    new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
      ...defaultEcsProps,
      vpc,
      defaultInstanceClasses: [batch.DefaultInstanceClass.ARM64],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      batchComputeEnvironment.BatchComputeEnvironment,
      {
        ...defaultExpectedProps,
        compute_resources: expect.objectContaining({
          ...defaultComputeResources,
          instance_type: ["default_arm64"],
        }),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
    //   ...pascalCaseExpectedEcsProps,
    //   ComputeResources: {
    //     ...defaultComputeResources,
    //     InstanceTypes: ['default_arm64'],
    //   },
    // });
  });

  test("throws when using defaultInstanceClasses and useOptimalInstanceClasses", () => {
    // WHEN
    expect(() => {
      new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
        ...defaultEcsProps,
        defaultInstanceClasses: [batch.DefaultInstanceClass.ARM64],
        useOptimalInstanceClasses: true,
      });
    }).toThrow(
      /cannot use `defaultInstanceClasses` with `useOptimalInstanceClasses`/,
    );
  });

  test("throws when spotFleetRole is specified without spot", () => {
    // WHEN
    expect(() => {
      new batch.ManagedEc2EcsComputeEnvironment(stack, "MyCE", {
        ...defaultEcsProps,
        spotFleetRole: new iam.Role(stack, "SpotFleetRole", {
          assumedBy: new iam.ArnPrincipal(
            "arn:aws:iam:123456789012:magicuser/foobar",
          ),
        }),
      });
    }).toThrow(
      /Managed ComputeEnvironment 'MyCE' specifies 'spotFleetRole' without specifying 'spot'/,
    );
  });
});

// TODO: EKS support omitted (blocked on aws-eks port) - https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/managed-compute-environment.test.ts#L1054-L1127 (describe('ManagedEc2EksComputeEnvironment', ...))

describe("FargateComputeEnvironment", () => {
  beforeEach(() => {
    stack = getAwsStack();
    vpc = new Vpc(stack, "vpc");
  });

  test("respects name", () => {
    // WHEN
    new batch.FargateComputeEnvironment(stack, "maximalPropsFargate", {
      vpc,
      maxvCpus: 512,
      computeEnvironmentName: "maxPropsFargateCE",
      replaceComputeEnvironment: true,
      spot: true,
      terminateOnUpdate: true,
      updateTimeout: Duration.minutes(30),
      updateToLatestImageVersion: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      batchComputeEnvironment.BatchComputeEnvironment,
      {
        name: "maxPropsFargateCE",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
    //   ComputeEnvironmentName: 'maxPropsFargateCE',
    // });
  });

  test("can be imported from arn", () => {
    // WHEN
    const ce = batch.FargateComputeEnvironment.fromFargateComputeEnvironmentArn(
      stack,
      "import",
      "arn:aws:batch:us-east-1:123456789012:compute-environment/ce-name",
    );

    // THEN
    expect(ce.computeEnvironmentArn).toEqual(
      "arn:aws:batch:us-east-1:123456789012:compute-environment/ce-name",
    );
  });
});

// Harness idiom (see test/aws/notify/queue.test.ts): wrap synth-only assertions in a describe with
// toMatchSnapshot(), attaching an HttpBackend (via gridBackendConfig) to every snapshotted stack so
// the default local backend's machine-dependent tfstate path never leaks into the snapshot.
describe("ManagedComputeEnvironment synth", () => {
  test("ManagedEc2EcsComputeEnvironment synthesizes and matches snapshot", () => {
    // GIVEN
    const synthStack = getAwsStack();
    const synthVpc = new Vpc(synthStack, "vpc");

    // WHEN
    new batch.ManagedEc2EcsComputeEnvironment(synthStack, "MyCE", {
      vpc: synthVpc,
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });

  test("FargateComputeEnvironment synthesizes and matches snapshot", () => {
    // GIVEN
    const synthStack = getAwsStack();
    const synthVpc = new Vpc(synthStack, "vpc");

    // WHEN
    new batch.FargateComputeEnvironment(synthStack, "MyFargateCE", {
      vpc: synthVpc,
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  const awsStack = new AwsStack(app, "TestStack");
  new HttpBackend(awsStack, gridBackendConfig);
  return awsStack;
}
