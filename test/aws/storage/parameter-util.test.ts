// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ssm/test/util.test.ts

import { App, TerraformVariable, Testing, Token } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { arnForParameterName } from "../../../src/aws/storage/parameter-util";

describe("arnForParameterName", () => {
  let app: App;
  let stack: AwsStack;
  let varBoom: TerraformVariable;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
    varBoom = new TerraformVariable(stack, "Boom", {
      type: "string",
      default: "foo/bar",
    });
  });
  describe("simple names", () => {
    test('concrete parameterName and no physical name (sep is "/")', () => {
      expect(
        stack.resolve(arnForParameterName(stack, "myParam", undefined)),
      ).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ssm:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/myParam",
      );
    });

    test('token parameterName and concrete physical name (no additional "/")', () => {
      expect(
        stack.resolve(
          arnForParameterName(stack, Token.asString(varBoom.stringValue), {
            physicalName: "myParam",
          }),
        ),
      ).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ssm:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${var.Boom}",
      );
    });

    test('token parameterName, explicit "/" separator', () => {
      expect(
        stack.resolve(
          arnForParameterName(stack, Token.asString(varBoom.stringValue), {
            simpleName: true,
          }),
        ),
      ).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ssm:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${var.Boom}",
      );
    });
  });

  describe("path names", () => {
    test('concrete parameterName and no physical name (sep is "/")', () => {
      expect(
        stack.resolve(arnForParameterName(stack, "/foo/bar", undefined)),
      ).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ssm:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/foo/bar",
      );
    });

    test("token parameterName and concrete physical name (no sep)", () => {
      expect(
        stack.resolve(
          arnForParameterName(stack, Token.asString(varBoom.stringValue), {
            physicalName: "/foo/bar",
          }),
        ),
      ).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ssm:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${var.Boom}",
      );
    });

    test('token parameterName, explicit "" separator', () => {
      expect(
        stack.resolve(
          arnForParameterName(stack, varBoom.stringValue, {
            simpleName: false,
          }),
        ),
      ).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ssm:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${var.Boom}",
      );
    });
  });

  test("fails if explicit separator is not defined and parameterName is a token", () => {
    expect(() =>
      arnForParameterName(stack, Token.asString({ Ref: "Boom" })),
    ).toThrow(
      /Unable to determine ARN separator for SSM parameter since the parameter name is an unresolved token. Use "fromAttributes" and specify "simpleName" explicitly/,
    );
  });
});
