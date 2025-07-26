// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-apigateway/test/integ.stepfunctions-api.ts

import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "apigw.stepfunctions";

/**
 * Stack verification steps:
 * * `curl -X POST 'https://<api-id>.execute-api.<region>.amazonaws.com/prod' \
 * * -d '{"key":"Hello"}' -H 'Content-Type: application/json'`
 * The above should return a "Hello" response
 */

class StepFunctionsRestApiStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const passTask = new aws.compute.Pass(this, "PassTask", {
      result: { value: "Hello" },
    });

    const stateMachine = new aws.compute.StateMachine(this, "StateMachine", {
      stateMachineName: "StepFunctionsApiTest",
      definitionBody: aws.compute.DefinitionBody.fromChainable(passTask),
      stateMachineType: aws.compute.StateMachineType.EXPRESS,
    });

    const api = new aws.compute.StepFunctionsRestApi(
      this,
      "StepFunctionsRestApi",
      {
        restApiName: "step-functions-api-test",
        deploy: false,
        cloudWatchRole: true,
        stateMachine: stateMachine,
        headers: true,
        path: false,
        querystring: false,
        requestContext: {
          accountId: true,
          userArn: true,
        },
        registerOutputs: true,
        outputName: "api",
      },
    );

    api.deploymentStage = new aws.compute.Stage(this, "stage", {
      deployment: new aws.compute.Deployment(this, "deployment", {
        api: api,
      }),
    });
  }
}

const app = new App({
  outdir,
});

const stack = new StepFunctionsRestApiStack(app, stackName, {
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
