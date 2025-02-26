// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ssm/test/parameter-store-string.test.ts

import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { StringParameter } from "../../../src/aws/storage/parameter";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("parameterstore", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props?
      // account: "1234",
      // region: "us-east-1",
    });
  });
  test("can reference SSMPS string - specific version", () => {
    // WHEN
    const ref = StringParameter.fromStringParameterAttributes(stack, "Ref", {
      parameterName: "/some/key",
      version: 123,
    });

    // THEN
    expect(stack.resolve(ref.stringValue)).toEqual(
      "{{resolve:ssm:/some/key:123}}",
    );
  });

  test("can reference SSMPS string - latest version", () => {
    // WHEN
    const ref = StringParameter.fromStringParameterAttributes(stack, "Ref", {
      parameterName: "/some/key",
    });

    // THEN
    Template.fromStack(stack, { snapshot: true });
    // templateMatches({
    //   Parameters: {
    //     RefParameter: {
    //       Type: "AWS::SSM::Parameter::Value<String>",
    //       Default: "/some/key",
    //     },
    //   },
    // });

    expect(stack.resolve(ref.stringValue)).toEqual({ Ref: "RefParameter" });
  });

  test("can reference SSMPS secure string", () => {
    // WHEN
    const ref = StringParameter.fromSecureStringParameterAttributes(
      stack,
      "Ref",
      {
        parameterName: "/some/key",
        version: 123,
      },
    ).stringValue;

    // THEN
    expect(stack.resolve(ref)).toEqual("{{resolve:ssm-secure:/some/key:123}}");
  });

  test("empty parameterName will throw", () => {
    // WHEN
    expect(() => {
      StringParameter.fromStringParameterAttributes(stack, "Ref", {
        parameterName: "",
      });
    }).toThrow(/parameterName cannot be an empty string/);
  });
});
