// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-ec2/test/integ.machine-image.ts

import { ssmParameter } from "@cdktf/provider-aws";
import { CloudinitProvider } from "@cdktf/provider-cloudinit/lib/provider";
import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "machine-image";

// import { aws_autoscaling as asg } from "aws-cdk-lib";
// import { EC2_RESTRICT_DEFAULT_SECURITY_GROUP } from 'aws-cdk-lib/cx-api';

export class TestCase extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);
    // this.node.setContext(EC2_RESTRICT_DEFAULT_SECURITY_GROUP, false);
    // TODO: Add support for registerOutputs to VPC L2 Construct
    const vpc = new aws.compute.Vpc(this, "Vpc");
    new TerraformOutput(this, "VpcId", {
      value: vpc.vpcId,
      description: "The ID of the VPC",
      staticId: true,
    });

    const instanceType = aws.compute.InstanceType.of(
      aws.compute.InstanceClass.T3,
      aws.compute.InstanceSize.NANO,
    );

    const amzn2 = new aws.compute.Instance(this, "amzn2", {
      instanceType,
      machineImage: aws.compute.MachineImage.latestAmazonLinux2(),
      vpc,
    });
    new TerraformOutput(this, "amzn2Output", {
      value: amzn2.instanceId,
      description: "The ID of the amzn2 instance",
      staticId: true,
    });

    const al2023 = new aws.compute.Instance(this, "al2023", {
      instanceType,
      machineImage: aws.compute.MachineImage.latestAmazonLinux2023(),
      vpc,
    });
    new TerraformOutput(this, "al2023Output", {
      value: al2023.instanceId,
      description: "The ID of the al2023 instance",
      staticId: true,
    });

    const al2023WithMinimalAmi = new aws.compute.Instance(
      this,
      "al2023WithMinimalAMI",
      {
        instanceType,
        machineImage: new aws.compute.AmazonLinuxImage({
          generation: aws.compute.AmazonLinuxGeneration.AMAZON_LINUX_2023,
          edition: aws.compute.AmazonLinuxEdition.MINIMAL,
        }),
        vpc,
      },
    );
    new TerraformOutput(this, "al2023WithMinimalAMIOutput", {
      value: al2023WithMinimalAmi.instanceId,
      description: "The ID of the al2023WithMinimalAMI instance",
      staticId: true,
    });

    const parameter = new ssmParameter.SsmParameter(this, "AmiParameter", {
      name: "IntegTestAmi",
      type: "String",
      dataType: "aws:ec2:image",
      value: "ami-06ca3ca175f37dd66",
    });
    new TerraformOutput(this, "AmiParameterOutput", {
      value: parameter.name,
      description: "The ARN of the SSM parameter for the AMI",
      staticId: true,
    });

    // TODO: Causes permanent diff on ami-id!
    const machineImage = aws.compute.MachineImage.resolveSsmParameterAtLaunch(
      parameter.name,
    );
    const ssmInstanceTest = new aws.compute.Instance(
      this,
      "ssm-resolve-instance",
      {
        instanceType,
        machineImage,
        vpc,
      },
    );
    ssmInstanceTest.node.addDependency(parameter);
    new TerraformOutput(this, "ssmInstanceTestOutput", {
      value: ssmInstanceTest.instanceId,
      description: "The ID of the SSM resolved instance",
    });

    // TODO: Add suppoart for Auto Scaling Groups with Launch Templates
    // const launchTemplate = new aws.compute.LaunchTemplate(this, "LT", {
    //   instanceType,
    //   machineImage,
    // });
    // new asg.AutoScalingGroup(this, "ASG", {
    //   vpc,
    //   launchTemplate,
    //   desiredCapacity: 1,
    // });
  }
}

const app = new App({
  outdir,
});
const stack = new TestCase(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new CloudinitProvider(stack, "CloudInit");
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();

// import { IntegTest } from "@aws-cdk/integ-tests-alpha";
// new IntegTest(app, "integ-test", {
//   testCases: [new TestCase(app, "integ-ec2-machine-image-test")],
//   enableLookups: true,
// });
