// https://github.com/aws/aws-cdk/blob/v2.164.1/packages/%40aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/aws-sdk/integ.call-aws-service.ts
import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "call-aws-service";

/**
 *
 * Stack verification steps:
 * * aws stepfunctions start-execution --state-machine-arn <deployed state machine arn> --input {"body": "hello world!"} : should return execution arn
 * *
 * * aws stepfunctions describe-execution --execution-arn <execution-arn generated before> --query 'status': should return status as SUCCEEDED
 * * aws stepfunctions describe-execution --execution-arn <execution-arn generated before> --query 'output': should return "hello world!"
 */
class TestStack extends aws.AwsStack {
  constructor(scope: App, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const bucket = new aws.storage.Bucket(this, "Bucket");

    const commonParameters = {
      Bucket: bucket.bucketName,
      Key: "test.txt",
    };

    const iamResources = [bucket.arnForObjects("*")];

    const putObject = new aws.compute.tasks.CallAwsService(this, "PutObject", {
      service: "s3",
      action: "putObject",
      parameters: {
        Body: aws.compute.JsonPath.stringAt("$.body"),
        ...commonParameters,
      },
      iamResources,
    });

    const getObject = new aws.compute.tasks.CallAwsService(this, "GetObject", {
      service: "s3",
      action: "getObject",
      parameters: commonParameters,
      iamResources,
    });

    const deleteObject = new aws.compute.tasks.CallAwsService(
      this,
      "DeleteObject",
      {
        service: "s3",
        action: "deleteObject",
        parameters: commonParameters,
        iamResources,
        resultPath: aws.compute.JsonPath.DISCARD,
      },
    );

    new aws.compute.StateMachine(this, "StateMachine", {
      definitionBody: aws.compute.DefinitionBody.fromChainable(
        putObject.next(getObject).next(deleteObject),
      ),
      registerOutputs: true,
      outputName: "state_machine",
    });
  }
}

const app = new App({
  outdir,
});
const stack = new TestStack(app, stackName, {
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
