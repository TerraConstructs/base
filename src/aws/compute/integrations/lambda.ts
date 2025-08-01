// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/integrations/lambda.ts

import { lambdaFunction } from "@cdktf/provider-aws";
import { Lazy, Token } from "cdktf";
import * as lambda from "..";
import { AwsIntegration } from "./aws";
import { AwsStack } from "../../aws-stack";
import * as iam from "../../iam";
import { IntegrationConfig, IntegrationOptions } from "../integration";
import { Method } from "../method";

export interface LambdaIntegrationOptions extends IntegrationOptions {
  /**
   * Use proxy integration or normal (request/response mapping) integration.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-output-format
   *
   * @default true
   */
  readonly proxy?: boolean;

  /**
   * Allow invoking method from AWS Console UI (for testing purposes).
   *
   * This will add another permission to the AWS Lambda resource policy which
   * will allow the `test-invoke-stage` stage to invoke this handler. If this
   * is set to `false`, the function will only be usable from the deployment
   * endpoint.
   *
   * @default true
   */
  readonly allowTestInvoke?: boolean;
}

/**
 * Integrates an AWS Lambda function to an API Gateway method.
 *
 * @example
 *
 *    declare const resource: apigateway.Resource;
 *    declare const handler: lambda.Function;
 *    resource.addMethod('GET', new apigateway.LambdaIntegration(handler));
 *
 */
export class LambdaIntegration extends AwsIntegration {
  private readonly handler: lambda.IFunction;
  private readonly enableTest: boolean;

  constructor(
    handler: lambda.IFunction,
    options: LambdaIntegrationOptions = {},
  ) {
    const proxy = options.proxy ?? true;

    super({
      proxy,
      service: "lambda",
      path: `2015-03-31/functions/${handler.functionArn}/invocations`,
      options,
    });

    this.handler = handler;
    this.enableTest = options.allowTestInvoke ?? true;
  }

  public bind(method: Method): IntegrationConfig {
    const bindResult = super.bind(method);
    const principal = new iam.ServicePrincipal("apigateway.amazonaws.com");

    const desc = `${AwsStack.uniqueId(method.api.node)}.${method.httpMethod}.${method.resource.path.replace(/\//g, ".")}`;

    this.handler.addPermission(`ApiPermission.${desc}`, {
      principal,
      scope: method,
      sourceArn: Lazy.stringValue({ produce: () => method.methodArn }),
    });

    // add permission to invoke from the console
    if (this.enableTest) {
      this.handler.addPermission(`ApiPermission.Test.${desc}`, {
        principal,
        scope: method,
        sourceArn: method.testMethodArn,
      });
    }

    let functionName;

    if (this.handler instanceof lambda.LambdaFunction) {
      // if not imported, extract the name from the TF provider layer to reach
      // the literal value if it is given (rather than a token)
      functionName = (
        this.handler.node.defaultChild as lambdaFunction.LambdaFunction
      ).functionNameInput;
    } else {
      // imported, just take the function name.
      functionName = this.handler.functionName;
    }

    let deploymentToken;
    if (!Token.isUnresolved(functionName)) {
      deploymentToken = JSON.stringify({ functionName });
    }
    return {
      ...bindResult,
      deploymentToken,
    };
  }
}
