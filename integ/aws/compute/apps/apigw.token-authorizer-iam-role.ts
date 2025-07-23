// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/authorizers/integ.token-authorizer-iam-role.ts

import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.token-authorizer-iam-role";

/**
 * The standard nodejs runtime used for integration tests.
 * Use this, unless specifically testing a certain runtime.
 *
 * The runtime should be the lowest runtime currently supported by the AWS CDK.
 * Updating this value will require you to run a lot of integration tests.
 */
export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

class SampleStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);
    const authorizerFn = new aws.compute.LambdaFunction(
      this,
      "MyAuthorizerFunction",
      {
        runtime: STANDARD_NODEJS_RUNTIME,
        handler: "index.handler",
        code: aws.compute.AssetCode.fromAsset(
          path.join(__dirname, "handlers", "token-authorizer"),
          { exclude: ["*.ts"] },
        ),
      },
    );

    const role = new aws.iam.Role(this, "authorizerRole", {
      assumedBy: new aws.iam.ServicePrincipal("apigateway.amazonaws.com"),
    });

    const authorizer = new aws.compute.TokenAuthorizer(this, "MyAuthorizer", {
      handler: authorizerFn,
      assumeRole: role,
    });

    const restapi = new aws.compute.RestApi(this, "MyRestApi", {
      cloudWatchRole: true,
      registerOutputs: true,
      outputName: "api",
    });

    restapi.root.addMethod(
      "ANY",
      new aws.compute.MockIntegration({
        integrationResponses: [{ statusCode: "200" }],
        passthroughBehavior: aws.compute.PassthroughBehavior.NEVER,
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
      }),
      {
        methodResponses: [{ statusCode: "200" }],
        authorizer,
        authorizationType: aws.compute.AuthorizationType.CUSTOM,
      },
    );
  }
}

const app = new App({
  outdir,
});

/*
 * Stack verification steps:
 * * `curl -s -o /dev/null -w "%{http_code}" <url>` should return 401
 * * `curl -s -o /dev/null -w "%{http_code}" -H 'Authorization: deny' <url>` should return 403
 * * `curl -s -o /dev/null -w "%{http_code}" -H 'Authorization: allow' <url>` should return 200
 */
const stack = new SampleStack(app, stackName, {
  gridUUID: "12345678-333",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
