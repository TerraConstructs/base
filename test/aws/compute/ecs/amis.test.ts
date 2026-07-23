// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/amis.test.ts

import { dataAwsSsmParameter } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as ecs from "../../../../src/aws/compute/ecs";
import { Template } from "../../../assertions";

describe("amis", () => {
  test.each([
    [
      ecs.BottlerocketEcsVariant.AWS_ECS_1,
      "SsmParameterValueawsservicebottlerocketawsecs1x8664",
    ],
    [
      ecs.BottlerocketEcsVariant.AWS_ECS_1_NVIDIA,
      "SsmParameterValueawsservicebottlerocketawsecs1nvidiax8664",
    ],
    [
      ecs.BottlerocketEcsVariant.AWS_ECS_2,
      "SsmParameterValueawsservicebottlerocketawsecs2x8664",
    ],
    [
      ecs.BottlerocketEcsVariant.AWS_ECS_2_NVIDIA,
      "SsmParameterValueawsservicebottlerocketawsecs2nvidiax8664",
    ],
  ])("BottleRocketImage with %s variant", (variant, _ssmKey) => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);

    // WHEN
    new ecs.BottleRocketImage({
      variant,
    }).getImage(stack);

    // THEN
    // TERRACONSTRUCTS DEVIATION: upstream synthesizes a CloudFormation template
    // Parameter (Type "AWS::SSM::Parameter::Value<...>") whose sanitized logical id
    // starts with `ssmKey` and whose Default is the SSM parameter path. TerraConstructs
    // has no CFN template-Parameter mechanism; StringParameter.valueForTypedStringParameterV2
    // instead synthesizes an `aws_ssm_parameter` data source, so assert its `name`
    // attribute directly rather than reconstructing the CFN logical id.
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: `/aws/service/bottlerocket/${variant}/x86_64/latest/image_id`,
      },
    );
    // const assembly = app.synth();
    // const parameters = assembly.getStackByName(stack.stackName).template.Parameters;
    // expect(Object.entries(parameters).some(
    //   ([k, v]) => k.startsWith(ssmKey) && (v as any).Default.includes(`/bottlerocket/${variant}/x86_64/`),
    // )).toEqual(true);
  });
});

describe("amis synth", () => {
  test("BottleRocketImage synth matches snapshot", () => {
    // GIVEN
    const app: App = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });

    // WHEN
    new ecs.BottleRocketImage({
      variant: ecs.BottlerocketEcsVariant.AWS_ECS_1,
    }).getImage(stack);

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
