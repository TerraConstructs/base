import {
  apiGatewayAuthorizer,
  apiGatewayRestApi,
  lambdaFunction,
  lambdaPermission,
  iamRole,
  iamRolePolicy,
  apiGatewayDeployment,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { Testing, App } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as compute from "../../../../src/aws/compute";
import * as iam from "../../../../src/aws/iam";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("lambda authorizer", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("default token authorizer", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const auth = new compute.TokenAuthorizer(stack, "myauthorizer", {
      handler: func,
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "TOKEN",
        rest_api_id: stack.resolve(restApi.restApiId),
        identity_source: "method.request.header.Authorization",
        authorizer_result_ttl_in_seconds: 300,
        authorizer_uri: stack.resolve(func.functionInvokeArn),
        // // (NOTE: no resolver for handler.invokeArn...)
        // authorizer_uri:
        //   'arn:${element(split(":", aws_lambda_function.myfunction_9B95E948.arn), 1)}:apigateway:${element(split(":", aws_lambda_function.myfunction_9B95E948.arn), 3)}:lambda:path/2015-03-31/functions/${aws_lambda_function.myfunction_9B95E948.arn}/invocations',
      },
    );

    template.expect.toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        action: "lambda:InvokeFunction",
        principal: "apigateway.amazonaws.com",
        function_name: stack.resolve(func.functionName),
        source_arn: stack.resolve(auth.authorizerArn),
      },
    );

    // ends with /authorizers/{authorizerId}
    expect(stack.resolve(auth.authorizerArn)).toMatch(
      new RegExp(`/authorizers/\\${stack.resolve(auth.authorizerId)}$`),
    );
  });

  test("default request authorizer", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const auth = new compute.RequestAuthorizer(stack, "myauthorizer", {
      handler: func,
      resultsCacheTtl: Duration.seconds(0),
      identitySources: [],
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "REQUEST",
        rest_api_id: stack.resolve(restApi.restApiId),
        authorizer_result_ttl_in_seconds: 0,
        authorizer_uri: stack.resolve(func.functionInvokeArn),
      },
    );
    // Check that identity_source is not present or is null/empty
    template.expect.not.toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      { identity_source: expect.anything() },
    );

    template.expect.toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        action: "lambda:InvokeFunction",
        principal: "apigateway.amazonaws.com",
        function_name: stack.resolve(func.functionName),
        source_arn: stack.resolve(auth.authorizerArn),
      },
    );

    expect(stack.resolve(auth.authorizerArn)).toContain(
      `/authorizers/${stack.resolve(auth.authorizerId)}`,
    );
  });

  test("request authorizer with default cache TTL", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const auth = new compute.RequestAuthorizer(stack, "myauthorizer", {
      handler: func,
      identitySources: [compute.IdentitySource.header("whoami")],
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "REQUEST",
        rest_api_id: stack.resolve(restApi.restApiId),
        authorizer_result_ttl_in_seconds: 300,
        identity_source: "method.request.header.whoami",
      },
    );
  });

  test("invalid request authorizer config", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    expect(
      () =>
        new compute.RequestAuthorizer(stack, "myauthorizer", {
          handler: func,
          resultsCacheTtl: Duration.seconds(1),
          identitySources: [],
        }),
    ).toThrow(
      "At least one Identity Source is required for a REQUEST-based Lambda authorizer if caching is enabled.",
    );
  });

  test("token authorizer with all parameters specified", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const auth = new compute.TokenAuthorizer(stack, "myauthorizer", {
      handler: func,
      identitySource: "method.request.header.whoami",
      validationRegex: "a-hacker",
      authorizerName: "myauthorizername", // Changed to avoid conflict with construct ID
      resultsCacheTtl: Duration.minutes(1),
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "TOKEN",
        rest_api_id: stack.resolve(restApi.restApiId),
        identity_source: "method.request.header.whoami",
        identity_validation_expression: "a-hacker",
        name: "myauthorizername",
        authorizer_result_ttl_in_seconds: 60,
        authorizer_uri: stack.resolve(func.functionInvokeArn),
      },
    );
  });

  test("request authorizer with all parameters specified", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const auth = new compute.RequestAuthorizer(stack, "myauthorizer", {
      handler: func,
      identitySources: [compute.IdentitySource.header("whoami")],
      authorizerName: "myauthorizername", // Changed to avoid conflict with construct ID
      resultsCacheTtl: Duration.minutes(1),
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "REQUEST",
        rest_api_id: stack.resolve(restApi.restApiId),
        identity_source: "method.request.header.whoami",
        name: "myauthorizername",
        authorizer_result_ttl_in_seconds: 60,
        authorizer_uri: stack.resolve(func.functionInvokeArn),
      },
    );
  });

  test("token authorizer with assume role", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const role = new iam.Role(stack, "authorizerassumerole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      roleName: "authorizerassumerole",
    });

    const auth = new compute.TokenAuthorizer(stack, "myauthorizer", {
      handler: func,
      assumeRole: role,
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "TOKEN",
        rest_api_id: stack.resolve(restApi.restApiId),
        authorizer_uri: stack.resolve(func.functionInvokeArn),
        authorizer_credentials: stack.resolve(role.roleArn),
      },
    );

    template.expect.toHaveResource(iamRole.IamRole);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["lambda:InvokeFunction"],
            effect: "Allow",
            resources: stack.resolve(func.resourceArnsForGrantInvoke),
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(iamRolePolicy.IamRolePolicy, {
      role: stack.resolve(role.roleName),
      policy:
        "${data.aws_iam_policy_document.myauthorizer_authorizerInvokePolicy_02D8146C.json}",
    });

    template.resourceCountIs(lambdaPermission.LambdaPermission, 0);
  });

  test("request authorizer with assume role", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });

    const role = new iam.Role(stack, "authorizerassumerole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      roleName: "authorizerassumerole",
    });

    const auth = new compute.RequestAuthorizer(stack, "myauthorizer", {
      handler: func,
      assumeRole: role,
      resultsCacheTtl: Duration.seconds(0),
      identitySources: [],
    });

    const restApi = new compute.RestApi(stack, "myrestapi");
    restApi.root.addMethod("ANY", undefined, {
      authorizer: auth,
      authorizationType: compute.AuthorizationType.CUSTOM,
    });

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(
      apiGatewayAuthorizer.ApiGatewayAuthorizer,
      {
        type: "REQUEST",
        rest_api_id: stack.resolve(restApi.restApiId),
        authorizer_uri: stack.resolve(func.functionInvokeArn),
        authorizer_credentials: stack.resolve(role.roleArn),
      },
    );

    template.expect.toHaveResource(iamRole.IamRole);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["lambda:InvokeFunction"],
            effect: "Allow",
            resources: stack.resolve(func.resourceArnsForGrantInvoke),
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(iamRolePolicy.IamRolePolicy, {
      role: stack.resolve(role.roleName),
      policy:
        "${data.aws_iam_policy_document.myauthorizer_authorizerInvokePolicy_02D8146C.json}",
    });

    template.resourceCountIs(lambdaPermission.LambdaPermission, 0);
  });

  test("token authorizer throws when not attached to a rest api", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });
    const auth = new compute.TokenAuthorizer(stack, "myauthorizer", {
      handler: func,
    });

    expect(() => stack.resolve(auth.authorizerArn)).toThrow(
      /must be attached to a RestApi/,
    );
  });

  test("request authorizer throws when not attached to a rest api", () => {
    const func = new compute.LambdaFunction(stack, "myfunction", {
      handler: "handler",
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.NODEJS_LATEST,
    });
    const auth = new compute.RequestAuthorizer(stack, "myauthorizer", {
      handler: func,
      identitySources: [compute.IdentitySource.header("myheader")],
    });

    expect(() => stack.resolve(auth.authorizerArn)).toThrow(
      /must be attached to a RestApi/,
    );
  });

  test("a new deployment is created when a lambda function changes name", () => {
    const createApiStack = (lambdaFunctionName: string) => {
      const tmpStack = new AwsStack(Testing.app(), "Stack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });

      const func = new compute.LambdaFunction(tmpStack, "myfunction", {
        handler: "handler",
        functionName: lambdaFunctionName,
        code: compute.Code.fromInline("foo"),
        runtime: compute.Runtime.NODEJS_18_X,
      });

      const auth = new compute.RequestAuthorizer(tmpStack, "myauthorizer", {
        handler: func,
        resultsCacheTtl: Duration.seconds(0),
        identitySources: [],
      });

      const restApi = new compute.RestApi(tmpStack, "myrestapi");
      restApi.root.addMethod("ANY", undefined, {
        authorizer: auth,
        authorizationType: compute.AuthorizationType.CUSTOM,
      });
      return tmpStack;
    };

    const stack1 = createApiStack("foo");
    const stack2 = createApiStack("bar");
    const t1 = new Template(stack1);
    const d1 = t1.resourceTypeArray(
      apiGatewayDeployment.ApiGatewayDeployment,
    )[0] as any;

    const t2 = new Template(stack2);
    const d2 = t2.resourceTypeArray(
      apiGatewayDeployment.ApiGatewayDeployment,
    )[0] as any;

    // This assertion assumes that the RestApi construct changes the TF resource name
    // of the deployment if its configuration (dependent on lambda name via authorizer) changes.
    // Or, at least, that the hash in `triggers` changes, leading to a new deployment in AWS.
    // For this test, comparing TF triggers is the closest to CFN logical ID comparison.
    expect(d1.triggers).not.toEqual(d2.triggers);
  });

  test("a new deployment is created when an imported lambda function changes name", () => {
    const createApiStack = (lambdaFunctionName: string) => {
      const tmpStack = new AwsStack(Testing.app(), "Stack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });

      const func = compute.LambdaFunction.fromFunctionName(
        tmpStack,
        "myfunction",
        lambdaFunctionName,
      );

      const auth = new compute.RequestAuthorizer(tmpStack, "myauthorizer", {
        handler: func,
        resultsCacheTtl: Duration.seconds(0),
        identitySources: [],
      });

      const restApi = new compute.RestApi(tmpStack, "myrestapi");
      restApi.root.addMethod("ANY", undefined, {
        authorizer: auth,
        authorizationType: compute.AuthorizationType.CUSTOM,
      });
      return tmpStack;
    };

    const stack1 = createApiStack("foo");
    const stack2 = createApiStack("bar");

    const t1 = new Template(stack1);
    const d1 = t1.resourceTypeArray(
      apiGatewayDeployment.ApiGatewayDeployment,
    )[0] as any;

    const t2 = new Template(stack2);
    const d2 = t2.resourceTypeArray(
      apiGatewayDeployment.ApiGatewayDeployment,
    )[0] as any;

    expect(d1.triggers).not.toEqual(d2.triggers);
  });
});
