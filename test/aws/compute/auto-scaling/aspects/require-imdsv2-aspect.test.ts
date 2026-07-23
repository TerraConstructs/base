// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/aspects/require-imdsv2-aspect.test.ts

import { launchTemplate as tfLaunchTemplate } from "@cdktn/provider-aws";
import { App, Aspects, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import {
  InstanceType,
  MachineImage,
  Vpc,
} from "../../../../../src/aws/compute";
import * as autoscaling from "../../../../../src/aws/compute/auto-scaling";
import { Annotations, Template } from "../../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("AutoScalingGroupRequireImdsv2Aspect", () => {
  let app: App;
  let stack: AwsStack;
  let vpc: Vpc;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
    vpc = new Vpc(stack, "Vpc");
  });

  // Terraform deviation: this port's AutoScalingGroup (see
  // ../../../../../src/aws/compute/auto-scaling/auto-scaling-group.ts) always provisions
  // an `aws_launch_template` -- the deprecated `AWS::AutoScaling::LaunchConfiguration` /
  // `aws_launch_configuration` resource is never emitted -- so the upstream
  // CfnLaunchConfiguration-token branch of AutoScalingGroupRequireImdsv2Aspect (and its
  // isResolvableObject/token-warning check) does not exist in the port. The aspect always
  // merges `httpTokens: "required"` into the LaunchTemplate's metadata options unconditionally
  // (see src/aws/compute/auto-scaling/aspects/require-imdsv2-aspect.ts), so there is nothing
  // to warn about here.
  // test('warns when metadataOptions is a token', () => {
  //   // GIVEN
  //   const asg = new AutoScalingGroup(stack, 'AutoScalingGroup', {
  //     vpc,
  //     instanceType: new ec2.InstanceType('t2.micro'),
  //     machineImage: ec2.MachineImage.latestAmazonLinux(),
  //   });
  //   const launchConfig = asg.node.tryFindChild('LaunchConfig') as CfnLaunchConfiguration;
  //   launchConfig.metadataOptions = cdk.Token.asAny({
  //     httpEndpoint: 'https://bla.com',
  //   } as CfnLaunchConfiguration.MetadataOptionsProperty);
  //   const aspect = new AutoScalingGroupRequireImdsv2Aspect();
  //
  //   // WHEN
  //   cdk.Aspects.of(stack).add(aspect);
  //
  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', Match.not({
  //     MetadataOptions: {
  //       HttpTokens: 'required',
  //     },
  //   }));
  //
  //   Annotations.fromStack(stack).hasWarning('/Stack/AutoScalingGroup', Match.stringLikeRegexp('.*CfnLaunchConfiguration.MetadataOptions field is a CDK token.'));
  // });

  test("requires IMDSv2", () => {
    // GIVEN
    new autoscaling.AutoScalingGroup(stack, "AutoScalingGroup", {
      vpc,
      instanceType: new InstanceType("t2.micro"),
      machineImage: MachineImage.latestAmazonLinux(),
    });
    const aspect = new autoscaling.AutoScalingGroupRequireImdsv2Aspect();

    // WHEN
    Aspects.of(stack).add(aspect);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_tokens: "required",
        },
      },
    );
    // CDK Test:
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
    //   MetadataOptions: {
    //     HttpTokens: 'required',
    //   },
    // });
  });
});

describe("AutoScalingGroupRequireImdsv2Aspect with AUTOSCALING_GENERATE_LAUNCH_TEMPLATE feature flag", () => {
  let app: App;
  let stack: AwsStack;
  let vpc: Vpc;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
    // Terraform deviation: the AUTOSCALING_GENERATE_LAUNCH_TEMPLATE cx-api feature flag is not
    // ported (see src/aws/cx-api.ts) -- this port's AutoScalingGroup always provisions an
    // `aws_launch_template`, so there is no separate flag to toggle; setContext would be a no-op.
    // stack.node.setContext(AUTOSCALING_GENERATE_LAUNCH_TEMPLATE, true);
    vpc = new Vpc(stack, "Vpc");
  });

  // Terraform deviation: unlike upstream's `cdk.isResolvableObject` guard against a raw
  // CloudFormation token on CfnLaunchTemplate.launchTemplateData, this port's
  // AutoScalingGroupRequireImdsv2Aspect reads/writes the provider binding's typed
  // `metadataOptionsInput` (a ComplexObject value, never a Lazy/CDK-token producer) and merges
  // in `httpTokens: "required"` unconditionally -- there is no token to detect, so no warning
  // is ever emitted (see src/aws/compute/auto-scaling/aspects/require-imdsv2-aspect.ts).
  // test('warns when launchTemplateData for LaunchTemplate is a token', () => {
  //   // GIVEN
  //   const asg = new AutoScalingGroup(stack, 'AutoScalingGroup', {
  //     vpc,
  //     instanceType: new ec2.InstanceType('t2.micro'),
  //     machineImage: ec2.MachineImage.latestAmazonLinux2(),
  //   });
  //   const launchTemplate = asg.node.tryFindChild('LaunchTemplate') as ec2.LaunchTemplate;
  //   const cfnLaunchTemplate = launchTemplate.node.tryFindChild('Resource') as ec2.CfnLaunchTemplate;
  //   cfnLaunchTemplate.launchTemplateData = cdk.Token.asAny({
  //     kernelId: 'asfd',
  //   } as ec2.CfnLaunchTemplate.LaunchTemplateDataProperty);
  //   const aspect = new AutoScalingGroupRequireImdsv2Aspect();
  //
  //   // WHEN
  //   cdk.Aspects.of(stack).add(aspect);
  //
  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties('AWS::EC2::LaunchTemplate', Match.not({
  //     LaunchTemplateData: {
  //       KernelId: 'asfd',
  //       MetadataOptions: {
  //         HttpTokens: 'required',
  //       },
  //     },
  //   }));
  //
  //   Annotations.fromStack(stack).hasWarning('/Stack/AutoScalingGroup', Match.stringLikeRegexp('.*CfnLaunchTemplate.LaunchTemplateData field is a CDK token.'));
  // });

  // Terraform deviation: same as above -- there is no CfnLaunchTemplate.launchTemplateData /
  // metadataOptions token-resolvability check in the port's aspect, so this warning path does
  // not exist.
  // test('warns when metadataOptions for LaunchTemplate is a token', () => {
  //   // GIVEN
  //   const asg = new AutoScalingGroup(stack, 'AutoScalingGroup', {
  //     vpc,
  //     instanceType: new ec2.InstanceType('t2.micro'),
  //     machineImage: ec2.MachineImage.latestAmazonLinux2(),
  //   });
  //   const launchTemplate = asg.node.tryFindChild('LaunchTemplate') as ec2.LaunchTemplate;
  //   const cfnLaunchTemplate = launchTemplate.node.tryFindChild('Resource') as ec2.CfnLaunchTemplate;
  //   cfnLaunchTemplate.launchTemplateData = {
  //     metadataOptions: cdk.Token.asAny({
  //       httpEndpoint: 'https://bla.com',
  //     } as ec2.CfnLaunchTemplate.MetadataOptionsProperty),
  //   } as ec2.CfnLaunchTemplate.LaunchTemplateDataProperty;
  //
  //   const aspect = new AutoScalingGroupRequireImdsv2Aspect();
  //
  //   // WHEN
  //   cdk.Aspects.of(stack).add(aspect);
  //
  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties('AWS::EC2::LaunchTemplate', Match.not({
  //     LaunchTemplateData: {
  //       MetadataOptions: {
  //         HttpTokens: 'required',
  //       },
  //     },
  //   }));
  //
  //   Annotations.fromStack(stack).hasWarning('/Stack/AutoScalingGroup', Match.stringLikeRegexp('.*CfnLaunchTemplate.LaunchTemplateData.MetadataOptions field is a CDK token.'));
  // });

  test("requires IMDSv2 for LaunchTemplate", () => {
    // GIVEN
    new autoscaling.AutoScalingGroup(stack, "AutoScalingGroup", {
      vpc,
      instanceType: new InstanceType("t2.micro"),
      machineImage: MachineImage.latestAmazonLinux2(),
    });
    const aspect = new autoscaling.AutoScalingGroupRequireImdsv2Aspect();

    // WHEN
    Aspects.of(stack).add(aspect);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLaunchTemplate.LaunchTemplate,
      {
        metadata_options: {
          http_tokens: "required",
        },
      },
    );
    // CDK Test:
    // Template.fromStack(stack).hasResourceProperties('AWS::EC2::LaunchTemplate', {
    //   LaunchTemplateData: {
    //     MetadataOptions: {
    //       HttpTokens: 'required',
    //     },
    //   },
    // });
  });
});

// Repo-specific: snapshot/synth coverage proving AutoScalingGroupRequireImdsv2Aspect actually
// mutates the emitted aws_launch_template resource (not just an assertion on a single
// property), and that no warning annotations are produced now that the token-resolvability
// checks from upstream are dropped (see comments above).
describe("AutoScalingGroupRequireImdsv2Aspect synth", () => {
  test("applies to AutoScalingGroup and matches snapshot", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new Vpc(stack, "Vpc");
    new autoscaling.AutoScalingGroup(stack, "AutoScalingGroup", {
      vpc,
      instanceType: new InstanceType("t2.micro"),
      machineImage: MachineImage.latestAmazonLinux(),
    });

    // WHEN
    Aspects.of(stack).add(
      new autoscaling.AutoScalingGroupRequireImdsv2Aspect(),
    );

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
    expect(Annotations.fromStack(stack).warnings).toHaveLength(0);
  });
});
