// https://github.com/aws/aws-cdk/blob/66a024fa8ca503677d889aa50b9dc95b9266314e/packages/aws-cdk-lib/aws-logs-destinations/test/lambda.test.ts

import path from "node:path";
import {
  cloudwatchLogSubscriptionFilter,
  lambdaPermission,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as logs from "../../../../src/aws/cloudwatch";
import * as dests from "../../../../src/aws/cloudwatch/log-destinations/";
import * as compute from "../../../../src/aws/compute";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let app: App;
let stack: AwsStack;

let fn: compute.LambdaFunction;
let logGroup: logs.LogGroup;

beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  // GIVEN
  fn = new compute.NodejsFunction(stack, "HelloWorld", {
    path: path.join(__dirname, "fixtures", "hello-world.ts"),
  });
  logGroup = new logs.LogGroup(stack, "LogGroup");
});

test("lambda can be used as metric subscription destination", () => {
  // WHEN
  new logs.SubscriptionFilter(stack, "Subscription", {
    logGroup,
    destination: new dests.LambdaDestination(fn),
    filterPattern: logs.FilterPattern.allEvents(),
  });

  const template = Template.synth(stack);

  // THEN: subscription target is Lambda
  template.toHaveResourceWithProperties(
    cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
    {
      destination_arn: stack.resolve(fn.functionArn),
    },
  );
  // template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
  //   DestinationArn: { "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"] },
  // });

  // THEN: Lambda has permissions to be invoked by CWL
  template.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(fn.functionArn),
    principal: "logs.amazonaws.com",
  });
  // template.hasResourceProperties("AWS::Lambda::Permission", {
  //   Action: "lambda:InvokeFunction",
  //   FunctionName: { "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"] },
  //   Principal: "logs.amazonaws.com",
  // });
});

test("can have multiple subscriptions use the same Lambda", () => {
  // WHEN
  new logs.SubscriptionFilter(stack, "Subscription", {
    logGroup,
    destination: new dests.LambdaDestination(fn),
    filterPattern: logs.FilterPattern.allEvents(),
  });

  new logs.SubscriptionFilter(stack, "Subscription2", {
    logGroup: new logs.LogGroup(stack, "LG2"),
    destination: new dests.LambdaDestination(fn),
    filterPattern: logs.FilterPattern.allEvents(),
  });

  const template = Template.synth(stack);

  // THEN: Lambda has permissions to be invoked by CWL from both Source Arns

  template.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(fn.functionArn),
    principal: "logs.amazonaws.com",
    source_arn: stack.resolve(logGroup.logGroupArn),
  });
  // template.hasResourceProperties("AWS::Lambda::Permission", {
  //   Action: "lambda:InvokeFunction",
  //   FunctionName: { "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"] },
  //   SourceArn: { "Fn::GetAtt": ["LogGroupF5B46931", "Arn"] },
  //   Principal: "logs.amazonaws.com",
  // });

  template.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(fn.functionArn),
    principal: "logs.amazonaws.com",
    source_arn: stack.resolve(logGroup.logGroupArn),
  });
  // template.hasResourceProperties("AWS::Lambda::Permission", {
  //   Action: "lambda:InvokeFunction",
  //   FunctionName: { "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"] },
  //   SourceArn: { "Fn::GetAtt": ["LG224A94C8F", "Arn"] },
  //   Principal: "logs.amazonaws.com",
  // });
});

test("lambda permissions are not added when addPermissions is false", () => {
  // WHEN
  new logs.SubscriptionFilter(stack, "Subscription", {
    logGroup,
    destination: new dests.LambdaDestination(fn, { addPermissions: false }),
    filterPattern: logs.FilterPattern.allEvents(),
  });

  const template = Template.synth(stack);

  // THEN: subscription target is Lambda
  template.toHaveResourceWithProperties(
    cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
    {
      destination_arn: stack.resolve(fn.functionArn),
    },
  );
  // template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
  //   DestinationArn: { "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"] },
  // });

  // THEN: Lambda does not have permissions to be invoked by CWL
  template.not.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
    action: "lambda:InvokeFunction",
    function_name: stack.resolve(fn.functionArn),
    principal: "logs.amazonaws.com",
    source_arn: stack.resolve(logGroup.logGroupArn),
  });
  // expect(Template.fromStack(stack).findResources('AWS::Lambda::Permission', {
  //   Action: 'lambda:InvokeFunction',
  //   FunctionName: { 'Fn::GetAtt': ['MyLambdaCCE802FB', 'Arn'] },
  //   Principal: 'logs.amazonaws.com',
  // })).toEqual({});
});

test("subscription depends on lambda's permission", () => {
  // WHEN
  new logs.SubscriptionFilter(stack, "Subscription", {
    logGroup,
    destination: new dests.LambdaDestination(fn),
    filterPattern: logs.FilterPattern.allEvents(),
  });
  const template = Template.synth(stack, { snapshot: false });

  // THEN: Subscription filter depends on Lambda's Permission
  template.toHaveResourceWithProperties(
    cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
    {
      depends_on: [
        "aws_lambda_permission.Subscription_CanInvokeLambda_D31DEAD2",
      ],
    },
  );
  // Template.fromStack(stack).hasResource("AWS::Logs::SubscriptionFilter", {
  //   DependsOn: ["SubscriptionCanInvokeLambdaD31DEAD2"],
  // });
});
