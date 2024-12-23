// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/aws-cdk-lib/aws-logs/test/policy.test.ts

import {
  cloudwatchLogResourcePolicy,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { LogGroup, ResourcePolicy } from "../../../src/aws/cloudwatch";
import { PolicyStatement, ServicePrincipal } from "../../../src/aws/iam";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const region = "us-east-1";
const providerConfig = { region };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("resource policy", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props to match AWS CDK cross account support
      // account: "1234",
    });
  });
  test("ResourcePolicy is added to stack, when .addToResourcePolicy() is provided a valid Statement", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    logGroup.addToResourcePolicy(
      new PolicyStatement({
        actions: ["logs:CreateLogStream"],
        resources: ["*"],
      }),
    );

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // .hasResourceProperties(
    //   "AWS::Logs::ResourcePolicy",
    //   {
    //     PolicyName: "LogGroupPolicy643B329C",
    //     PolicyDocument: JSON.stringify({
    //       Statement: [
    //         {
    //           Action: "logs:CreateLogStream",
    //           Effect: "Allow",
    //           Resource: "*",
    //         },
    //       ],
    //       Version: "2012-10-17",
    //     }),
    //   },
    // );
  });

  test("ResourcePolicy is added to stack, when created manually/directly", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    const resourcePolicy = new ResourcePolicy(stack, "ResourcePolicy", {
      resourcePolicyName: "ResourcePolicy",
    });
    resourcePolicy.document.addStatements(
      new PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        principals: [new ServicePrincipal("es.amazonaws.com")],
        resources: [logGroup.logGroupArn],
      }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogResourcePolicy.CloudwatchLogResourcePolicy,
      {
        policy_name: "ResourcePolicy",
      },
    );
  });

  test("ResourcePolicy has a defaultChild", () => {
    // WHEN
    const resourcePolicy = new ResourcePolicy(stack, "ResourcePolicy");

    // THEN
    expect(resourcePolicy.node.defaultChild).toBeDefined();
  });
});
