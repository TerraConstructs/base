import { Fact } from "@aws-cdk/region-info";
import { App, TerraformOutput } from "cdktf";
import { Node } from "constructs";
import { AwsStack } from "../../src/aws";
import * as cxapi from "../../src/aws/cx-api";
import { StackBase } from "../../src/stack-base";

describe("stack", () => {
  test("cross-stack use of region and account returns nonscoped intrinsic because the two stacks must be in the same region anyway", () => {
    // GIVEN
    const app = new App();
    const stack1 = new AwsStack(app, "Stack1");
    const stack2 = new AwsStack(app, "Stack2");
    // WHEN - used in another stack
    new TerraformOutput(stack2, "DemOutput", { value: stack1.region });
    new TerraformOutput(stack2, "DemAccount", { value: stack1.account });
    // THEN
    expect(stack2.toTerraform().output).toEqual({
      DemOutput: {
        value: "${data.aws_region.Region.name}",
      },
      DemAccount: {
        value: "${data.aws_caller_identity.CallerIdentity.account_id}",
      },
    });
  });
  test("url suffix does not imply a stack dependency", () => {
    // GIVEN
    const app = new App();
    const first = new AwsStack(app, "First");
    const second = new AwsStack(app, "Second");
    // WHEN
    new TerraformOutput(second, "Output", {
      value: first.urlSuffix,
    });
    // THEN
    expect(second.dependencies.length).toEqual(0);
  });
  test("stack with region supplied via props returns literal value", () => {
    // GIVEN
    const app = new App();
    const stack = new AwsStack(app, "Stack1", {
      providerConfig: {
        allowedAccountIds: ["123456789012"],
        region: "es-norst-1",
      },
    });
    // THEN
    expect(stack.resolve(stack.region)).toEqual("es-norst-1");
  });
  describe("stack partition literal feature flag", () => {
    // GIVEN
    const envForRegion = (region: string) => {
      return {
        providerConfig: { allowedAccountIds: ["123456789012"], region },
      };
    };
    // THEN
    test("stacks with no region defined", () => {
      const noRegionStack = new AwsStack(new App(), "MissingRegion");
      expect(noRegionStack.resolve(noRegionStack.partition)).toEqual(
        "${data.aws_partition.Partitition.partition}",
      );
    });
    test("stacks with an unknown region", () => {
      const imaginaryRegionStack = new AwsStack(
        new App(),
        "ImaginaryRegion",
        envForRegion("us-area51"),
      );
      expect(
        imaginaryRegionStack.resolve(imaginaryRegionStack.partition),
      ).toEqual("${data.aws_partition.Partitition.partition}");
    });
  });
  test("stack.availabilityZones returns list with references", () => {
    // GIVEN
    const app = new App();
    const stack = new AwsStack(app, "MyStack", {
      providerConfig: {
        region: "eu-east-1",
      },
    });
    // WHEN
    const azs = stack.availabilityZones();
    // THEN
    expect(stack.resolve(azs)).toEqual([
      "${element(data.aws_availability_zones.AvailabilityZones.names, 0)}",
      "${element(data.aws_availability_zones.AvailabilityZones.names, 1)}",
    ]);
  });
});

describe("regionalFact", () => {
  Fact.register({
    name: "MyFact",
    region: "us-east-1",
    value: "x.amazonaws.com",
  });
  Fact.register({
    name: "MyFact",
    region: "eu-west-1",
    value: "x.amazonaws.com",
  });
  Fact.register({
    name: "MyFact",
    region: "cn-north-1",
    value: "x.amazonaws.com.cn",
  });

  Fact.register({ name: "WeirdFact", region: "us-east-1", value: "oneformat" });
  Fact.register({
    name: "WeirdFact",
    region: "eu-west-1",
    value: "otherformat",
  });

  test("regional facts return a literal value if possible", () => {
    const stack = new AwsStack(undefined, "Stack", {
      providerConfig: { region: "us-east-1" },
    });
    expect(stack.regionalFact("MyFact")).toEqual("x.amazonaws.com");
  });

  test("regional facts are simplified to use URL_SUFFIX token if possible", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    expect(stack.regionalFact("MyFact")).toEqual(`x.${stack.urlSuffix}`);
  });

  test("regional facts are simplified to use concrete values if URL_SUFFIX token is not necessary", () => {
    const stack = new AwsStack();
    Node.of(stack).setContext(cxapi.TARGET_PARTITIONS, ["aws"]);
    expect(stack.regionalFact("MyFact")).toEqual("x.amazonaws.com");
  });

  test('regional facts use the global lookup map if partition is the literal string of "undefined"', () => {
    const stack = new AwsStack();
    Node.of(stack).setContext(cxapi.TARGET_PARTITIONS, "undefined");
    new TerraformOutput(stack, "TheFact", {
      value: stack.regionalFact("WeirdFact"),
    });

    expect(stack.toTerraform()).toMatchObject({
      locals: {
        WeirdFactMap: {
          "eu-west-1": { value: "otherformat" },
          "us-east-1": { value: "oneformat" },
        },
      },
      output: {
        TheFact: {
          value: "${local.WeirdFactMap[data.aws_region.Region.name].value}",
        },
      },
    });
  });

  test("regional facts generate a mapping if necessary", () => {
    const stack = new AwsStack(undefined, "Stack", {});
    new TerraformOutput(stack, "TheFact", {
      value: stack.regionalFact("WeirdFact"),
    });

    expect(stack.toTerraform()).toMatchObject({
      locals: {
        WeirdFactMap: {
          "eu-west-1": { value: "otherformat" },
          "us-east-1": { value: "oneformat" },
        },
      },
      output: {
        TheFact: {
          value: "${local.WeirdFactMap[data.aws_region.Region.name].value}",
        },
      },
    });
  });
});
