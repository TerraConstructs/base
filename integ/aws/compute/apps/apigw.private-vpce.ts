// Private REST API that only allows invocations through an execute-api VPC
// interface endpoint (`grantInvokeFromVpcEndpointsOnly`).
//
// Regression test for TerraConstructs/base#167: the resource policy must be
// rendered with the API's full execution ARN (not the `execute-api:/*`
// shorthand) through a dedicated aws_api_gateway_rest_api_policy resource, so
// that a re-plan after apply shows no changes.

import { App, LocalBackend, TerraformOutput } from "cdktn";
import { Construct } from "constructs";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.private-vpce";

export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

class PrivateApiStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    // Isolated subnets only: the Lambda reaches the API through the interface
    // endpoint (private DNS), so no NAT gateway is needed.
    const vpc = new aws.compute.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "isolated",
          subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const vpcEndpoint = vpc.addInterfaceEndpoint("ExecuteApiEndpoint", {
      service: aws.compute.InterfaceVpcEndpointAwsService.APIGATEWAY,
      privateDnsEnabled: true,
    });

    const api = new aws.compute.RestApi(this, "PrivateApi", {
      cloudWatchRole: true,
      endpointTypes: [aws.compute.EndpointType.PRIVATE],
    });
    api.root.addMethod(
      "GET",
      new aws.compute.MockIntegration({
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": '{ "message": "private ok" }',
            },
          },
        ],
      }),
      {
        methodResponses: [{ statusCode: "200" }],
      },
    );
    api.grantInvokeFromVpcEndpointsOnly([vpcEndpoint]);

    // Invoker inside the VPC: resolves the API hostname to the interface
    // endpoint through private DNS and calls it.
    const invoker = new aws.compute.LambdaFunction(this, "Invoker", {
      runtime: STANDARD_NODEJS_RUNTIME,
      handler: "index.handler",
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: {
        subnetType: aws.compute.SubnetType.PRIVATE_ISOLATED,
      },
      environment: {
        API_URL: api.url,
      },
      code: aws.compute.Code.fromInline(
        `exports.handler = async function() {
          const res = await fetch(process.env.API_URL);
          return { statusCode: res.status, body: await res.text() };
        }`,
      ),
    });
    vpcEndpoint.connections.allowDefaultPortFrom(invoker);

    new TerraformOutput(this, "ApiUrl", { value: api.url });
    new TerraformOutput(this, "RestApiId", { value: api.restApiId });
    new TerraformOutput(this, "VpcEndpointId", {
      value: vpcEndpoint.vpcEndpointId,
    });
    new TerraformOutput(this, "InvokerFunctionName", {
      value: invoker.functionName,
    });
  }
}

const app = new App({
  outdir,
});

const stack = new PrivateApiStack(app, stackName, {
  gridUUID: "g12345678-444",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
