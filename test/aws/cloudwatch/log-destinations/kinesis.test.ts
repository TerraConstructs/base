// https://github.com/aws/aws-cdk/blob/4af3685888383e5451884bc6a9ddde7f0cdefa0c/packages/aws-cdk-lib/aws-logs-destinations/test/kinesis.test.ts

import {
  cloudwatchLogSubscriptionFilter,
  dataAwsIamPolicyDocument,
  iamRole,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as logs from "../../../../src/aws/cloudwatch";
import * as dests from "../../../../src/aws/cloudwatch/log-destinations/";
import * as iam from "../../../../src/aws/iam";
import * as kinesis from "../../../../src/aws/notify";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("kinesis stream", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("can be subscription destination", () => {
    // GIVEN
    const stream = new kinesis.Stream(stack, "MyStream");
    const logGroup = new logs.LogGroup(stack, "LogGroup");

    // WHEN
    new logs.SubscriptionFilter(stack, "Subscription", {
      logGroup,
      destination: new dests.KinesisDestination(stream),
      filterPattern: logs.FilterPattern.allEvents(),
    });

    const template = Template.synth(stack);

    // THEN: subscription target is Stream
    template.toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        destination_arn: stack.resolve(stream.streamArn),
        role_arn:
          "${aws_iam_role.Subscription_CloudWatchLogsCanPutRecords_9C1223EC.arn}",
      },
    );

    // THEN: we have a role to write to the Stream
    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_logs.name}",
                ],
                type: "Service",
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
    //   AssumeRolePolicyDocument: {
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: "sts:AssumeRole",
    //         Effect: "Allow",
    //         Principal: {
    //           Service: "logs.amazonaws.com",
    //         },
    //       },
    //     ],
    //   },
    // });

    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "kinesis:ListShards",
              "kinesis:PutRecord",
              "kinesis:PutRecords",
            ],
            effect: "Allow",
            resources: [stack.resolve(stream.streamArn)],
          },
          {
            actions: ["iam:PassRole"],
            effect: "Allow",
            resources: [
              "${aws_iam_role.Subscription_CloudWatchLogsCanPutRecords_9C1223EC.arn}",
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: [
    //           "kinesis:ListShards",
    //           "kinesis:PutRecord",
    //           "kinesis:PutRecords",
    //         ],
    //         Effect: "Allow",
    //         Resource: { "Fn::GetAtt": ["MyStream5C050E93", "Arn"] },
    //       },
    //       {
    //         Action: "iam:PassRole",
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::GetAtt": [
    //             "SubscriptionCloudWatchLogsCanPutRecords9C1223EC",
    //             "Arn",
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("can be subscription destination twice, without duplicating permissions", () => {
    // GIVEN
    const stream = new kinesis.Stream(stack, "MyStream");
    const logGroup1 = new logs.LogGroup(stack, "LogGroup");
    const logGroup2 = new logs.LogGroup(stack, "LogGroup2");

    // WHEN
    new logs.SubscriptionFilter(stack, "Subscription", {
      logGroup: logGroup1,
      destination: new dests.KinesisDestination(stream),
      filterPattern: logs.FilterPattern.allEvents(),
    });

    new logs.SubscriptionFilter(stack, "Subscription2", {
      logGroup: logGroup2,
      destination: new dests.KinesisDestination(stream),
      filterPattern: logs.FilterPattern.allEvents(),
    });

    // THEN: subscription target is Stream
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        destination_arn: stack.resolve(stream.streamArn),
        role_arn:
          "${aws_iam_role.Subscription_CloudWatchLogsCanPutRecords_9C1223EC.arn}",
      },
    );
    // hasResourceProperties(
    //   "AWS::Logs::SubscriptionFilter",
    //   {
    //     DestinationArn: { "Fn::GetAtt": ["MyStream5C050E93", "Arn"] },
    //     RoleArn: {
    //       "Fn::GetAtt": [
    //         "SubscriptionCloudWatchLogsCanPutRecords9C1223EC",
    //         "Arn",
    //       ],
    //     },
    //   },
    // );

    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_logs.name}",
                ],
                type: "Service",
              },
            ],
          },
        ],
      },
    );
    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "kinesis:ListShards",
              "kinesis:PutRecord",
              "kinesis:PutRecords",
            ],
            effect: "Allow",
            resources: [stack.resolve(stream.streamArn)],
          },
          {
            actions: ["iam:PassRole"],
            effect: "Allow",
            resources: [
              "${aws_iam_role.Subscription_CloudWatchLogsCanPutRecords_9C1223EC.arn}",
            ],
          },
        ],
      },
    );
    // // THEN: we have a role to write to the Stream
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
    //   AssumeRolePolicyDocument: {
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: "sts:AssumeRole",
    //         Effect: "Allow",
    //         Principal: {
    //           Service: "logs.amazonaws.com",
    //         },
    //       },
    //     ],
    //   },
    // });

    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Version: "2012-10-17",
    //     Statement: [
    //       {
    //         Action: [
    //           "kinesis:ListShards",
    //           "kinesis:PutRecord",
    //           "kinesis:PutRecords",
    //         ],
    //         Effect: "Allow",
    //         Resource: { "Fn::GetAtt": ["MyStream5C050E93", "Arn"] },
    //       },
    //       {
    //         Action: "iam:PassRole",
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::GetAtt": [
    //             "SubscriptionCloudWatchLogsCanPutRecords9C1223EC",
    //             "Arn",
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("an existing IAM role can be passed to new destination instance instead of auto-created ", () => {
    // GIVEN
    const stream = new kinesis.Stream(stack, "MyStream");
    const logGroup = new logs.LogGroup(stack, "LogGroup");

    const importedRole = iam.Role.fromRoleArn(
      stack,
      "ImportedRole",
      "arn:aws:iam::123456789012:role/ImportedRoleKinesisDestinationTest",
    );

    const kinesisDestination = new dests.KinesisDestination(stream, {
      role: importedRole,
    });

    new logs.SubscriptionFilter(logGroup, "MySubscriptionFilter", {
      logGroup: logGroup,
      destination: kinesisDestination,
      filterPattern: logs.FilterPattern.allEvents(),
    });

    // THEN
    const template = Template.synth(stack);
    template.not.toHaveResource(iamRole.IamRole);
    // template.resourceCountIs("AWS::IAM::Role", 0);
    template.toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        role_arn: stack.resolve(importedRole.roleArn),
      },
    );
    // template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
    //   RoleArn: importedRole.roleArn,
    // });
  });

  test("creates a new IAM Role if not passed on new destination instance", () => {
    // GIVEN
    const stream = new kinesis.Stream(stack, "MyStream");
    const logGroup = new logs.LogGroup(stack, "LogGroup");

    const kinesisDestination = new dests.KinesisDestination(stream);

    new logs.SubscriptionFilter(logGroup, "MySubscriptionFilter", {
      logGroup: logGroup,
      destination: kinesisDestination,
      filterPattern: logs.FilterPattern.allEvents(),
    });

    // THEN
    const template = Template.synth(stack, { snapshot: false });
    template.toHaveResource(iamRole.IamRole);
    // template.resourceCountIs("AWS::IAM::Role", 1);
    template.toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        role_arn:
          "${aws_iam_role.LogGroup_MySubscriptionFilter_CloudWatchLogsCanPutRecords_9112BD02.arn}",

        // THEN: SubscriptionFilter depends on the default Role's Policy attachment
        depends_on: expect.arrayContaining([
          "aws_iam_role_policy.LogGroup_MySubscriptionFilter_CloudWatchLogsCanPutRecords_DefaultPolicy_ResourceRoles0_36CC5683",
        ]),
      },
    );
    // template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
    //   RoleArn: {
    //     "Fn::GetAtt": [
    //       "LogGroupMySubscriptionFilterCloudWatchLogsCanPutRecords9112BD02",
    //       "Arn",
    //     ],
    //   },
    // });

    // template.hasResource("AWS::Logs::SubscriptionFilter", {
    //   DependsOn: [
    //     "LogGroupMySubscriptionFilterCloudWatchLogsCanPutRecordsDefaultPolicyEC6729D5",
    //   ],
    // });
  });
});
