import { lambdaFunctionUrl, lambdaPermission } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { compute, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

const gridUUID = "a123e456-e89b-12d3";

describe("FunctionUrl", () => {
  let stack: AwsStack;
  let fn: compute.LambdaFunction;
  beforeEach(() => {
    stack = new AwsStack(Testing.app(), "MyStack", {
      gridUUID,
    });
    fn = new compute.LambdaFunction(stack, "MyLambda", {
      code: new compute.InlineCode("hello()"),
      handler: "index.hello",
      runtime: compute.Runtime.NODEJS_LATEST,
    });
  });

  test("authType NONE adds both InvokeFunctionUrl and InvokeFunction permissions", () => {
    // WHEN
    new compute.FunctionUrl(stack, "Url", {
      function: fn,
      authType: compute.FunctionUrlAuthType.NONE,
    });

    // THEN
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    const template = new Template(stack);

    expect(synthesized).toHaveResourceWithProperties(
      lambdaFunctionUrl.LambdaFunctionUrl,
      {
        authorization_type: "NONE",
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
      },
    );

    // lambda:InvokeFunctionUrl - required for the function URL invocation itself
    expect(synthesized).toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        action: "lambda:InvokeFunctionUrl",
        principal: "*",
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        function_url_auth_type: "NONE",
      },
    );

    // lambda:InvokeFunction - also required, scoped to function-url invocations,
    // matching AWS's FunctionURLAllowInvokeAction console statement.
    expect(synthesized).toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        action: "lambda:InvokeFunction",
        principal: "*",
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        invoked_via_function_url: true,
      },
    );

    template.resourceCountIs(lambdaPermission.LambdaPermission, 2);
  });

  test("authType AWS_IAM does not add any InvokeFunctionUrl/InvokeFunction permissions", () => {
    // WHEN
    new compute.FunctionUrl(stack, "Url", {
      function: fn,
      authType: compute.FunctionUrlAuthType.AWS_IAM,
    });

    // THEN
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    const template = new Template(stack);

    expect(synthesized).toHaveResourceWithProperties(
      lambdaFunctionUrl.LambdaFunctionUrl,
      {
        authorization_type: "AWS_IAM",
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
      },
    );

    template.resourceCountIs(lambdaPermission.LambdaPermission, 0);
  });

  test("authType NONE on an alias-qualified url still adds both permissions", () => {
    // GIVEN
    const alias = new compute.Alias(stack, "Alias", {
      aliasName: "prod",
      function: fn,
      version: fn.version,
    });

    // WHEN
    new compute.FunctionUrl(stack, "Url", {
      function: alias,
      authType: compute.FunctionUrlAuthType.NONE,
    });

    // THEN
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    const template = new Template(stack);

    expect(synthesized).toHaveResourceWithProperties(
      lambdaFunctionUrl.LambdaFunctionUrl,
      {
        authorization_type: "NONE",
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        qualifier: `${gridUUID}-prod`,
      },
    );

    template.resourceCountIs(lambdaPermission.LambdaPermission, 2);
  });
});
