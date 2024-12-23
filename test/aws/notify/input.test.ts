import { cloudwatchEventTarget } from "@cdktf/provider-aws";
import { Testing, ref, Lazy } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Role, ServicePrincipal } from "../../../src/aws/iam"; // TODO: Get rid of barrel file imports?
import { EventField, RuleTargetInput } from "../../../src/aws/notify/input";
import { Rule } from "../../../src/aws/notify/rule";
import { Schedule } from "../../../src/aws/notify/schedule";
import { IRuleTarget } from "../../../src/aws/notify/target";
import { Duration } from "../../../src/duration";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("input", () => {
  let stack: AwsStack;
  let rule: Rule;

  beforeEach(() => {
    stack = getAwsStack();
    rule = new Rule(stack, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });
  });
  describe("json template", () => {
    test("can just be a JSON object", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromObject({ SomeObject: "withAValue" }),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input: '{"SomeObject":"withAValue"}',
        },
      );
    });

    test("can use joined JSON containing refs in JSON object", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromObject({
            data: EventField.fromPath("$"),
            stackName: ref("ExampleRef"),
          }),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input_transformer: {
            input_paths: {
              f1: "$",
            },
            input_template: '{"data":<f1>,"stackName":"${ExampleRef}"}',
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       InputTransformer: {
      //         InputPathsMap: {
      //           f1: "$",
      //         },
      //         InputTemplate: {
      //           "Fn::Join": [
      //             "",
      //             [
      //               '{"data":<f1>,"stackName":"',
      //               { Ref: "AWS::StackName" },
      //               '"}',
      //             ],
      //           ],
      //         },
      //       },
      //     },
      //   ],
      // });
    });

    test("can use joined JSON containing refs in JSON object with tricky inputs", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromObject({
            data: `they said \"hello\"${EventField.fromPath("$")}`,
            stackName: ref("ExampleRef"),
          }),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input_transformer: {
            input_paths: {
              f1: "$",
            },
            input_template:
              '{"data":"they said \\"hello\\"<f1>","stackName":"${ExampleRef}"}',
          },
        },
      );
      // const template = JSON.parse(synthesized);
      // expect(template).toMatchObject({});
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       InputTransformer: {
      //         InputPathsMap: {
      //           f1: "$",
      //         },
      //         InputTemplate: {
      //           "Fn::Join": [
      //             "",
      //             [
      //               '{"data":"they said \\"hello\\"<f1>","stackName":"',
      //               { Ref: "AWS::StackName" },
      //               '"}',
      //             ],
      //           ],
      //         },
      //       },
      //     },
      //   ],
      // });
    });

    test("can use joined JSON containing refs in JSON object and concat", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromObject({
            data: `more text ${EventField.fromPath("$")}`,
            stackName: ref("ExampleRef"),
          }),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input_transformer: {
            input_paths: {
              f1: "$",
            },
            input_template:
              '{"data":"more text <f1>","stackName":"${ExampleRef}"}',
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       InputTransformer: {
      //         InputPathsMap: {
      //           f1: "$",
      //         },
      //         InputTemplate: {
      //           "Fn::Join": [
      //             "",
      //             [
      //               '{"data":"more text <f1>","stackName":"',
      //               { Ref: "AWS::StackName" },
      //               '"}',
      //             ],
      //           ],
      //         },
      //       },
      //     },
      //   ],
      // });
    });

    test("can use joined JSON containing refs in JSON object and quotes", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromObject({
            data: `more text "${EventField.fromPath("$")}"`,
            stackName: ref("ExampleRef"),
          }),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input_transformer: {
            input_paths: {
              f1: "$",
            },
            input_template:
              '{"data":"more text \\"<f1>\\"","stackName":"${ExampleRef}"}',
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       InputTransformer: {
      //         InputPathsMap: {
      //           f1: "$",
      //         },
      //         InputTemplate: {
      //           "Fn::Join": [
      //             "",
      //             [
      //               '{"data":"more text \\"<f1>\\"","stackName":"',
      //               { Ref: "AWS::StackName" },
      //               '"}',
      //             ],
      //           ],
      //         },
      //       },
      //     },
      //   ],
      // });
    });

    test("can use joined JSON containing refs in JSON object and multiple keys", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromObject({
            data: `${EventField.fromPath("$")}${EventField.fromPath("$.other")}`,
            stackName: ref("ExampleRef"),
          }),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input_transformer: {
            input_paths: {
              f1: "$",
              other: "$.other",
            },
            input_template:
              '{"data":"<f1><other>","stackName":"${ExampleRef}"}',
          },
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       InputTransformer: {
      //         InputPathsMap: {
      //           f1: "$",
      //         },
      //         InputTemplate: {
      //           "Fn::Join": [
      //             "",
      //             [
      //               '{"data":"<f1><other>","stackName":"',
      //               { Ref: "AWS::StackName" },
      //               '"}',
      //             ],
      //           ],
      //         },
      //       },
      //     },
      //   ],
      // });
    });

    test("can use token", () => {
      // GIVEN
      const role = new Role(stack, "Role", {
        assumedBy: new ServicePrincipal("test.service"),
      });

      // WHEN
      rule.addTarget(
        new SomeTarget(RuleTargetInput.fromObject({ roleArn: role.roleArn })),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input: '{"roleArn":"${aws_iam_role.Role_1ABCC5F0.arn}"}',
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       Input: {
      //         "Fn::Join": [
      //           "",
      //           [
      //             '{"roleArn":"',
      //             {
      //               "Fn::GetAtt": ["Role00B015A1", "Arn"],
      //             },
      //             '"}',
      //           ],
      //         ],
      //       },
      //     },
      //   ],
      // });
    });
  });

  describe("text templates", () => {
    test("strings with newlines are serialized to a newline-delimited list of JSON strings", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromMultilineText("I have\nmultiple lines"),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input: '"I have"\n"multiple lines"',
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       Input: '"I have"\n"multiple lines"',
      //     },
      //   ],
      // });
    });

    test("escaped newlines are not interpreted as newlines", () => {
      // WHEN
      rule.addTarget(
        new SomeTarget(
          RuleTargetInput.fromMultilineText("this is not\\na real newline"),
        ),
      );

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input: '"this is not\\\\na real newline"',
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       Input: '"this is not\\\\na real newline"',
      //     },
      //   ],
      // });
    });

    test("can use Tokens in text templates", () => {
      const world = Lazy.stringValue({ produce: () => "world" });

      // WHEN
      rule.addTarget(
        new SomeTarget(RuleTargetInput.fromText(`hello ${world}`)),
      );

      // THEN
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      expect(synthesized).toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          input: '"hello world"',
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      //   Targets: [
      //     {
      //       Input: '"hello world"',
      //     },
      //   ],
      // });
    });
  });
});

class SomeTarget implements IRuleTarget {
  public constructor(private readonly input: RuleTargetInput) {}

  public bind() {
    return { id: "T1", arn: "ARN1", input: this.input };
  }
}

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
