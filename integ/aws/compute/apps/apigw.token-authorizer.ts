// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/authorizers/integ.token-authorizer.ts

import * as path from "path";
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.token-authorizer";

/**
 * The standard nodejs runtime used for integration tests.
 * Use this, unless specifically testing a certain runtime.
 *
 * The runtime should be the lowest runtime currently supported by the AWS CDK.
 * Updating this value will require you to run a lot of integration tests.
 */
export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

class SampleStack extends aws.AwsStack {
  public restApi: aws.compute.RestApi;
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

    const authorizer = new aws.compute.TokenAuthorizer(this, "MyAuthorizer", {
      handler: authorizerFn,
      resultsCacheTtl: Duration.minutes(10),
    });

    this.restApi = new aws.compute.RestApi(this, "MyRestApi", {
      cloudWatchRole: true,
      defaultMethodOptions: {
        authorizer,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: aws.compute.Cors.ALL_ORIGINS,
      },
      registerOutputs: true,
      outputName: "api",
    });

    this.restApi.root.addMethod(
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
      },
    );
  }
}
const app = new App({
  outdir,
});

const stack = new SampleStack(app, stackName, {
  gridUUID: "12345678-222",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
