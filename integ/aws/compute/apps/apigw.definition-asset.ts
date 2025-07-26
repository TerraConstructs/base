// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-apigateway/test/integ.api-definition.asset.ts

import * as path from "path";
import { App, LocalBackend, TerraformOutput } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.definition-asset";

/**
 * Stack verification steps:
 * * `curl -s -o /dev/null -w "%{http_code}" <output PetsURL>` should return HTTP code 200
 * * `curl -s -o /dev/null -w "%{http_code}" <output BooksURL>` should return HTTP code 200
 */

class ApiDefinitionAssetsStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const api = new aws.compute.SpecRestApi(this, "my-api", {
      cloudWatchRole: true,
      apiDefinition: aws.compute.ApiDefinition.fromAsset(
        path.join(__dirname, "sample-definition.yaml"),
      ),
    });

    api.root.addResource("books").addMethod(
      "GET",
      new aws.compute.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
          },
        ],
        passthroughBehavior: aws.compute.PassthroughBehavior.NEVER,
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
      }),
      {
        methodResponses: [{ statusCode: "200" }],
      },
    );

    // Create additional TerraformOutputs for URL endpoints
    new TerraformOutput(this, "PetsURL", {
      value: api.urlForPath("/pets"),
    });

    new TerraformOutput(this, "BooksURL", {
      value: api.urlForPath("/books"),
    });
  }
}

const app = new App({
  outdir,
});

const stack = new ApiDefinitionAssetsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
