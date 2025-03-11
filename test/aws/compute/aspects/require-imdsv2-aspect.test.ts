// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/aspects/require-imdsv2-aspect.test.ts

import {
  launchTemplate as tfLaunchTemplate,
  instance as tfInstance,
} from "@cdktf/provider-aws";
import { App, Testing, Aspects } from "cdktf";
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
      const template = new Template(stack);

      // THEN
      const launchTemplate = instance.node.tryFindChild(
        "LaunchTemplate",
      ) as tfLaunchTemplate.LaunchTemplate;
      expect(launchTemplate).toBeDefined();
      template.expect.toHaveResourceWithProperties(
        tfLaunchTemplate.LaunchTemplate,
        {
          name: stack.resolve(launchTemplate.nameInput),
          metadata_options: {
            http_tokens: "required",
          },
        },
      );
      template.expect.toHaveResourceWithProperties(tfInstance.Instance, {
        launch_template: {
          name: stack.resolve(launchTemplate.name),
          version: stack.resolve(launchTemplate.latestVersion),
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
        constructPath: "MyStack/Instance",
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
      const instance1 = new Instance(stack, "OtherInstance", {
        vpc,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      const stack2 = new AwsStack(app, "RequireImdsv2Stack", {
        environmentName, // Should be different
        gridUUID, // Should be different
        providerConfig,
        gridBackendConfig,
      });
      const vpc2 = new Vpc(stack2, "Vpc");
      const instance2 = new Instance(stack2, "Instance", {
        vpc: vpc2,
        instanceType: new InstanceType("t2.micro"),
        machineImage: MachineImage.latestAmazonLinux(),
      });
      const aspect = new InstanceRequireImdsv2Aspect();

      // WHEN
      Aspects.of(stack).add(aspect);
      Aspects.of(stack2).add(aspect);

      // synth both stacks
      new Template(stack);
      new Template(stack2);

      // THEN
      const lt2 = instance2.node.tryFindChild(
        "LaunchTemplate",
      ) as tfLaunchTemplate.LaunchTemplate;
      const lt1 = instance1.node.tryFindChild(
        "LaunchTemplate",
      ) as tfLaunchTemplate.LaunchTemplate;
      expect(lt2).toBeDefined();
      expect(lt1).toBeDefined();
      expect(lt2.nameInput !== lt1.nameInput);
    });
  });

  describe("LaunchTemplateRequireImdsv2Aspect", () => {
    // // Terraform LaunchTemplate does not have `launchTemplateData` attribute
    // test("warns when LaunchTemplateData is a CDK token", () => {
    //   // GIVEN
    //   const launchTemplate = new LaunchTemplate(stack, "LaunchTemplate");
    //   const cfnLaunchTemplate = launchTemplate.node.tryFindChild(
    //     "Resource",
    //   ) as tfLaunchTemplate.LaunchTemplate;
    //   cfnLaunchTemplate.kernelId = "asfd";
    //   const aspect = new LaunchTemplateRequireImdsv2Aspect();

    //   // WHEN
    //   aspect.visit(launchTemplate);

    //   // THEN
    //   Annotations.fromStack(stack).hasWarnings({
    //     constructPath: "/Stack/LaunchTemplate",
    //     message: /.*LaunchTemplateData is a CDK token./,
    //   });
    // });

    // // metaDataOptions is ComplexListObject and can never be a token
    // test("warns when MetadataOptions is a CDK token", () => {
    //   // GIVEN
    //   const launchTemplate = new LaunchTemplate(stack, "LaunchTemplate");
    //   const cfnLaunchTemplate = launchTemplate.node.tryFindChild(
    //     "Resource",
    //   ) as tfLaunchTemplate.LaunchTemplate;
    //   cfnLaunchTemplate.putMetadataOptions({
    //     httpEndpoint: Token.asString("http://bla"),
    //   });
    //   const aspect = new LaunchTemplateRequireImdsv2Aspect();

    //   // WHEN
    //   aspect.visit(launchTemplate);

    //   // THEN
    //   Annotations.fromStack(stack).hasWarnings({
    //     constructPath: "/Stack/LaunchTemplate",
    //     message: /.*LaunchTemplateData.MetadataOptions is a CDK token./,
    //   });
    // });

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
