// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/cfn-init.test.ts

import { autoscalingGroup } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

// NOTE (whole-file, terraform-provider-unsupported): every test in this upstream suite exercises
// CloudFormation's `CreationPolicy`/`UpdatePolicy` attribute pair (surfaced upstream via the
// `Signals`/`UpdatePolicy` classes and the deprecated `resourceSignal*`/`updateType`/
// `replacingUpdateMinSuccessfulInstancesPercent` props) and/or the `ec2.CloudFormationInit`
// (`init`/`initOptions`) integration and its generated `cfn-init`/`cfn-signal` UserData +
// `cloudformation:SignalResource`/`DescribeStackResource` IAM policy. `aws_autoscaling_group`
// (terraform-provider-aws) has no stack-update rollback/signalling mechanism and no cfn-init
// helper-metadata concept, so none of that surface is ported on
// `compute.autoscaling.AutoScalingGroup` -- see the deviation note on `CommonAutoScalingGroupProps`
// in src/aws/compute/auto-scaling/auto-scaling-group.ts ("aws_autoscaling_group has no
// creation/update-policy or init equivalent - so none of that surface is ported here"). Every case
// below is therefore preserved commented-out verbatim, kept until (if ever) the provider grows an
// equivalent knob.

interface BaseProps {
  vpc: compute.Vpc;
  machineImage: compute.IMachineImage;
  instanceType: compute.InstanceType;
  desiredCapacity: number;
  minCapacity: number;
}

let stack: AwsStack;
let vpc: compute.Vpc;
let baseProps: BaseProps;

beforeEach(() => {
  const app = Testing.app();
  stack = new AwsStack(app);
  vpc = new compute.Vpc(stack, "Vpc");

  baseProps = {
    vpc,
    machineImage: new compute.AmazonLinuxImage(),
    instanceType: compute.InstanceType.of(
      compute.InstanceClass.M4,
      compute.InstanceSize.MICRO,
    ),
    desiredCapacity: 5,
    minCapacity: 2,
  };
});

// Not supported by Terraform Provider: `signals`/CreationPolicy.ResourceSignal has no
// aws_autoscaling_group equivalent (no stack-update signalling in Terraform).
// test('Signals.waitForAll uses desiredCapacity if available', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     signals: autoscaling.Signals.waitForAll(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 5,
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: `signals`/CreationPolicy.ResourceSignal has no
// aws_autoscaling_group equivalent (no stack-update signalling in Terraform).
// test('Signals.waitForAll uses minCapacity if desiredCapacity is not available', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     desiredCapacity: undefined,
//     signals: autoscaling.Signals.waitForAll(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 2,
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: `signals`/CreationPolicy.ResourceSignal has no
// aws_autoscaling_group equivalent (no stack-update signalling in Terraform).
// test('Signals.waitForMinCapacity uses minCapacity', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     signals: autoscaling.Signals.waitForMinCapacity(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 2,
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: `signals`/CreationPolicy.ResourceSignal has no
// aws_autoscaling_group equivalent (no stack-update signalling in Terraform).
// test('Signals.waitForCount uses given number', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     signals: autoscaling.Signals.waitForCount(10),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     CreationPolicy: {
//       ResourceSignal: {
//         Count: 10,
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: `signals` (CreationPolicy.ResourceSignal) has no
// aws_autoscaling_group equivalent, so the `cloudformation:SignalResource` IAM statement it
// generates upstream is never emitted either.
// test('When signals are given appropriate IAM policy is added', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     signals: autoscaling.Signals.waitForAll(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
//     PolicyDocument: {
//       Statement: Match.arrayWith([{
//         Action: 'cloudformation:SignalResource',
//         Effect: 'Allow',
//         Resource: { Ref: 'AWS::StackId' },
//       }]),
//     },
//   });
// });

// Not supported by Terraform Provider: `updatePolicy`/UpdatePolicy.AutoScalingScheduledAction has
// no aws_autoscaling_group equivalent (Terraform has no in-place-vs-replace stack UpdatePolicy
// concept).
// test('UpdatePolicy.rollingUpdate() still correctly inserts IgnoreUnmodifiedGroupSizeProperties', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
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

// Not supported by Terraform Provider: `updatePolicy`/`signals` (UpdatePolicy.AutoScalingRollingUpdate
// + CreationPolicy.AutoScalingCreationPolicy/ResourceSignal) has no aws_autoscaling_group equivalent.
// test('UpdatePolicy.rollingUpdate() with Signals uses those defaults', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     signals: autoscaling.Signals.waitForCount(10, {
//       minSuccessPercentage: 50,
//       timeout: Duration.minutes(30),
//     }),
//     updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     CreationPolicy: {
//       AutoScalingCreationPolicy: {
//         MinSuccessfulInstancesPercent: 50,
//       },
//       ResourceSignal: {
//         Count: 10,
//         Timeout: 'PT30M',
//       },
//     },
//     UpdatePolicy: {
//       AutoScalingRollingUpdate: {
//         MinSuccessfulInstancesPercent: 50,
//         PauseTime: 'PT30M',
//         WaitOnResourceSignals: true,
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: `updatePolicy`/UpdatePolicy.AutoScalingRollingUpdate has no
// aws_autoscaling_group equivalent.
// test('UpdatePolicy.rollingUpdate() without Signals', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     UpdatePolicy: {
//       AutoScalingRollingUpdate: {
//       },
//     },
//   });
// });

// Not supported by Terraform Provider: `updatePolicy`/UpdatePolicy.AutoScalingReplacingUpdate has no
// aws_autoscaling_group equivalent.
// test('UpdatePolicy.replacingUpdate() renders correct UpdatePolicy', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
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

// Not supported by Terraform Provider: `init` (ec2.CloudFormationInit) driving an implicit
// UpdatePolicy.AutoScalingRollingUpdate default has no aws_autoscaling_group equivalent.
// test('Using init config in ASG leads to default updatepolicy', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     init: ec2.CloudFormationInit.fromElements(
//       ec2.InitCommand.shellCommand('echo hihi'),
//     ),
//     signals: autoscaling.Signals.waitForAll(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResource('AWS::AutoScaling::AutoScalingGroup', {
//     UpdatePolicy: {
//       AutoScalingRollingUpdate: Match.anyValue(),
//     },
//   });
// });

// Not supported by Terraform Provider: `init` (ec2.CloudFormationInit) generates cfn-init/cfn-signal
// UserData plus a `cloudformation:DescribeStackResource`/`SignalResource` IAM policy -- both are
// CloudFormation helper-script concepts with no Terraform / aws_launch_template UserData or IAM
// equivalent to synthesize against.
// test('Using init config in ASG leads to correct UserData and permissions', () => {
//   // WHEN
//   new autoscaling.AutoScalingGroup(stack, 'Asg', {
//     ...baseProps,
//     init: ec2.CloudFormationInit.fromElements(
//       ec2.InitCommand.shellCommand('echo hihi'),
//     ),
//     signals: autoscaling.Signals.waitForAll(),
//   });
//
//   // THEN
//   Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
//     UserData: {
//       'Fn::Base64': {
//         'Fn::Join': ['', [
//           '#!/bin/bash\n# fingerprint: 593c357d7f305b75\n(\n  set +e\n  /opt/aws/bin/cfn-init -v --region ',
//           { Ref: 'AWS::Region' },
//           ' --stack ',
//           { Ref: 'AWS::StackName' },
//           ' --resource AsgASGD1D7B4E2 -c default\n  /opt/aws/bin/cfn-signal -e $? --region ',
//           { Ref: 'AWS::Region' },
//           ' --stack ',
//           { Ref: 'AWS::StackName' },
//           ' --resource AsgASGD1D7B4E2\n  cat /var/log/cfn-init.log >&2\n)',
//         ]],
//       },
//     },
//   });
//
//   Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
//     PolicyDocument: {
//       Statement: Match.arrayWith([{
//         Action: ['cloudformation:DescribeStackResource', 'cloudformation:SignalResource'],
//         Effect: 'Allow',
//         Resource: { Ref: 'AWS::StackId' },
//       }]),
//     },
//   });
// });

// Repo-added regression coverage (see test-suite-conventions): the upstream suite above is fully
// unported (CreationPolicy/UpdatePolicy/cfn-init have no Terraform surface), so this wrapping
// describe exercises the mundane `baseProps`-shaped AutoScalingGroup this file was built around,
// synthesized through the mapped `aws_autoscaling_group` resource, and snapshot-guards that no
// cfn-init/signal-flavored attributes leak onto it.
describe("AutoScalingGroup (cfn-init.test.ts base fixture)", () => {
  let app: App;
  let regressionStack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    regressionStack = new AwsStack(app);
    new HttpBackend(regressionStack, gridBackendConfig);
  });

  test("Should synth and match SnapShot", () => {
    // GIVEN
    const regressionVpc = new compute.Vpc(regressionStack, "Vpc");

    // WHEN
    new compute.autoscaling.AutoScalingGroup(regressionStack, "Asg", {
      vpc: regressionVpc,
      machineImage: new compute.AmazonLinuxImage(),
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.M4,
        compute.InstanceSize.MICRO,
      ),
      desiredCapacity: 5,
      minCapacity: 2,
    });

    // THEN
    regressionStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(regressionStack)).toMatchSnapshot();
  });

  test("min_size/desired_capacity synth from baseProps, no CreationPolicy/UpdatePolicy/cfn-init surface exists to assert", () => {
    // GIVEN
    const regressionVpc = new compute.Vpc(regressionStack, "Vpc");

    // WHEN
    new compute.autoscaling.AutoScalingGroup(regressionStack, "Asg", {
      vpc: regressionVpc,
      machineImage: new compute.AmazonLinuxImage(),
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.M4,
        compute.InstanceSize.MICRO,
      ),
      desiredCapacity: 5,
      minCapacity: 2,
    });

    // THEN
    Template.synth(regressionStack).toHaveResourceWithProperties(
      autoscalingGroup.AutoscalingGroup,
      {
        min_size: 2,
        desired_capacity: 5,
      },
    );
  });
});
