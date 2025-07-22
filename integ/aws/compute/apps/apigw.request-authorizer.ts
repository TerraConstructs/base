// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/authorizers/integ.request-authorizer.lit.ts

import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.request-authorizer";

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
          path.join(__dirname, "handlers", "request-authorizer"),
          { exclude: ["*.ts"] },
        ),
      },
    );

    const restapi = new aws.compute.RestApi(this, "MyRestApi", {
      cloudWatchRole: true,
      registerOutputs: true,
      outputName: "api",
    });

    const authorizer = new aws.compute.RequestAuthorizer(this, "MyAuthorizer", {
      handler: authorizerFn,
      identitySources: [
        aws.compute.IdentitySource.header("Authorization"),
        aws.compute.IdentitySource.queryString("allow"),
      ],
    });

    const secondAuthorizer = new aws.compute.RequestAuthorizer(
      this,
      "MySecondAuthorizer",
      {
        handler: authorizerFn,
        identitySources: [
          aws.compute.IdentitySource.header("Authorization"),
          aws.compute.IdentitySource.queryString("allow"),
        ],
      },
    );

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
      },
    );

    restapi.root.resourceForPath("auth").addMethod(
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
        authorizer: secondAuthorizer,
      },
    );
  }
}

const app = new App({
  outdir,
});

// Against the RestApi endpoint from the stack output, run
// `curl -s -o /dev/null -w "%{http_code}" <url>` should return 401
// `curl -s -o /dev/null -w "%{http_code}" -H 'Authorization: deny' <url>?allow=yes` should return 403
// `curl -s -o /dev/null -w "%{http_code}" -H 'Authorization: allow' <url>?allow=yes` should return 200
const stack = new SampleStack(app, stackName, {
  gridUUID: "12345678-111",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
