// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-apigateway/test/integ.api-definition.inline.ts

import { App, LocalBackend, TerraformOutput } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.definition-inline";

/*
 * Stack verification steps:
 * * `curl -i <CFN output PetsURL>` should return HTTP code 200
 */
const app = new App({
  outdir,
});
const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-444",
  environmentName,
  providerConfig: {
    region,
  },
});

const api = new aws.compute.SpecRestApi(stack, "my-api", {
  cloudWatchRole: true,
  apiDefinition: aws.compute.ApiDefinition.fromInline({
    openapi: "3.0.2",
    info: {
      version: "1.0.0",
      title: "Test API for CDK",
    },
    paths: {
      "/pets": {
        get: {
          summary: "Test Method",
          operationId: "testMethod",
          responses: {
            200: {
              description: "A paged array of pets",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Empty",
                  },
                },
              },
            },
          },
          "x-amazon-apigateway-integration": {
            responses: {
              default: {
                statusCode: "200",
              },
            },
            requestTemplates: {
              "application/json": '{"statusCode": 200}',
            },
            passthroughBehavior: "when_no_match",
            type: "mock",
          },
        },
      },
    },
    components: {
      schemas: {
        Empty: {
          title: "Empty Schema",
          type: "object",
        },
      },
    },
  }),
});

new TerraformOutput(stack, "PetsURL", {
  value: api.urlForPath("/pets"),
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});
app.synth();
