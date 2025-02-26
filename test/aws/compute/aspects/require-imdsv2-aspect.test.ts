// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/aspects/require-imdsv2-aspect.test.ts

import {
  launchTemplate as tfLaunchTemplate,
  instance as tfInstance,
} from "@cdktf/provider-aws";
import { App, Testing, Aspects, Token } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../../src/aws";
import {
  Instance,
  InstanceRequireImdsv2Aspect,
  InstanceType,
  LaunchTemplate,
  LaunchTemplateRequireImdsv2Aspect,
  MachineImage,
  Vpc,
} from "../../../../src/aws/compute";
import { Annotations, Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("RequireImdsv2Aspect", () => {
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
    vpc = new Vpc(stack, "Vpc");
  });

  test("suppresses warnings", () => {
    // GIVEN
    const aspect = new LaunchTemplateRequireImdsv2Aspect({
      suppressWarnings: true,
    });
    const errmsg = "ERROR";
    const visitMock = jest.spyOn(aspect, "visit").mockImplementation((node) => {
      // @ts-ignore
      aspect.warn(node, errmsg);
    });
    const construct = new Construct(stack, "Construct");

    // WHEN
    aspect.visit(construct);

    // THEN
    expect(visitMock).toHaveBeenCalled();
    expect(Annotations.fromStack(stack).warnings).toHaveLength(0);
    //.hasNoWarning("/Stack/Construct", errmsg);
  });

  describe("InstanceRequireImdsv2Aspect", () => {
    test("requires IMDSv2", () => {
      // GIVEN
      const instance = new Instance(stack, "Instance", {
        vpc,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      const aspect = new InstanceRequireImdsv2Aspect();

      // WHEN
      Aspects.of(stack).add(aspect);
      app.synth();

      // THEN
      const launchTemplate = instance.node.tryFindChild(
        "LaunchTemplate",
      ) as LaunchTemplate;
      expect(launchTemplate).toBeDefined();
      const template = Template.synth(stack);
      template.toHaveResourceWithProperties(tfLaunchTemplate.LaunchTemplate, {
        name: stack.resolve(launchTemplate.launchTemplateName),
        metadata_options: {
          http_tokens: "required",
        },
      });
      template.toHaveResourceWithProperties(tfInstance.Instance, {
        launch_template: {
          name: stack.resolve(launchTemplate.launchTemplateName),
          version: stack.resolve(launchTemplate.latestVersionNumber),
        },
      });
    });

    test("does not toggle when Instance has a LaunchTemplate", () => {
      // GIVEN
      const instance = new Instance(stack, "Instance", {
        vpc,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      instance.instance.putLaunchTemplate({
        name: "name",
        version: "version",
      });
      const aspect = new InstanceRequireImdsv2Aspect();

      // WHEN
      Aspects.of(stack).add(aspect);

      // THEN
      // Aspect normally creates a LaunchTemplate for the Instance to toggle IMDSv1,
      // so we can assert that one was not created
      Template.resources(stack, tfLaunchTemplate.LaunchTemplate).toHaveLength(
        0,
      );
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "/Stack/Instance",
        message:
          /.*Cannot toggle IMDSv1 because this Instance is associated with an existing Launch Template./,
      });
    });

    test("suppresses Launch Template warnings", () => {
      // GIVEN
      const instance = new Instance(stack, "Instance", {
        vpc,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      instance.instance.putLaunchTemplate({
        name: "name",
        version: "version",
      });
      const aspect = new InstanceRequireImdsv2Aspect({
        suppressLaunchTemplateWarning: true,
      });

      // WHEN
      aspect.visit(instance);

      // THEN
      expect(Annotations.fromStack(stack).warnings).toHaveLength(0);
      // CDK Test: hasNoWarning(
      //   "/Stack/Instance",
      //   "Cannot toggle IMDSv1 because this Instance is associated with an existing Launch Template.",
      // );
    });

    test("launch template name is unique with feature flag", () => {
      // GIVEN
      const app2 = Testing.app();
      const otherStack = new AwsStack(app2, "OtherStack", {
        environmentName, // Should be different
        gridUUID, // Should be different
        providerConfig,
        gridBackendConfig,
      });
      const otherVpc = new Vpc(otherStack, "OtherVpc");
      const otherInstance = new Instance(otherStack, "OtherInstance", {
        vpc: otherVpc,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      const imdsv2Stack = new AwsStack(app2, "RequireImdsv2Stack", {
        environmentName, // Should be different
        gridUUID, // Should be different
        providerConfig,
        gridBackendConfig,
      });
      const imdsv2Vpc = new Vpc(imdsv2Stack, "Vpc");
      const instance = new Instance(imdsv2Stack, "Instance", {
        vpc: imdsv2Vpc,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      const aspect = new InstanceRequireImdsv2Aspect();

      // WHEN
      Aspects.of(imdsv2Stack).add(aspect);
      Aspects.of(otherStack).add(aspect);
      app2.synth();

      // THEN
      const launchTemplate = instance.node.tryFindChild(
        "LaunchTemplate",
      ) as LaunchTemplate;
      const otherLaunchTemplate = otherInstance.node.tryFindChild(
        "LaunchTemplate",
      ) as LaunchTemplate;
      expect(launchTemplate).toBeDefined();
      expect(otherLaunchTemplate).toBeDefined();
      expect(
        launchTemplate.launchTemplateName !==
          otherLaunchTemplate.launchTemplateName,
      );
    });
  });

  describe("LaunchTemplateRequireImdsv2Aspect", () => {
    test("warns when LaunchTemplateData is a CDK token", () => {
      // GIVEN
      const launchTemplate = new LaunchTemplate(stack, "LaunchTemplate");
      const cfnLaunchTemplate = launchTemplate.node.tryFindChild(
        "Resource",
      ) as tfLaunchTemplate.LaunchTemplate;
      cfnLaunchTemplate.kernelId = "asfd";
      const aspect = new LaunchTemplateRequireImdsv2Aspect();

      // WHEN
      aspect.visit(launchTemplate);

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "/Stack/LaunchTemplate",
        message: /.*LaunchTemplateData is a CDK token./,
      });
    });

    test("warns when MetadataOptions is a CDK token", () => {
      // GIVEN
      const launchTemplate = new LaunchTemplate(stack, "LaunchTemplate");
      const cfnLaunchTemplate = launchTemplate.node.tryFindChild(
        "Resource",
      ) as tfLaunchTemplate.LaunchTemplate;
      cfnLaunchTemplate.putMetadataOptions({
        httpEndpoint: "http://bla",
      });
      const aspect = new LaunchTemplateRequireImdsv2Aspect();

      // WHEN
      aspect.visit(launchTemplate);

      // THEN
      Annotations.fromStack(stack).hasWarnings({
        constructPath: "/Stack/LaunchTemplate",
        message: /.*LaunchTemplateData.MetadataOptions is a CDK token./,
      });
    });

    test("requires IMDSv2", () => {
      // GIVEN
      new LaunchTemplate(stack, "LaunchTemplate");
      const aspect = new LaunchTemplateRequireImdsv2Aspect();

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
    });
  });
});
