import {
  cloudwatchEventTarget,
  dataAwsIamPolicyDocument,
  iamRole,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
// import { LambdaFunction } from "../../../../src/aws/compute/function";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { Role, ServicePrincipal } from "../../../../src/aws/iam"; // TODO: Get rid of barrel file imports?
import { EventBus } from "../../../../src/aws/notify/event-bus";
import { Queue } from "../../../../src/aws/notify/queue";
import { Rule } from "../../../../src/aws/notify/rule";
import { Schedule } from "../../../../src/aws/notify/schedule";
import { EventBus as EventBusTarget } from "../../../../src/aws/notify/targets/event-bus";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("EventBus as an event rule target", () => {
  let stack: AwsStack;
  let rule: Rule;

  beforeEach(() => {
    stack = getAwsStack();
    rule = new Rule(stack, "Rule", {
      schedule: Schedule.expression("rate(1 min)"),
    });
  });

  test("with imported event bus", () => {
    rule.addTarget(
      new EventBusTarget(
        EventBus.fromEventBusArn(
          stack,
          "External",
          "arn:aws:events:us-east-1:111111111111:default",
        ),
      ),
    );
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    // ensure AWS eventBridge can access event bus
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["arn:aws:events:us-east-1:111111111111:default"],
          },
        ],
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:aws:events:us-east-1:111111111111:default",
        role_arn: "${aws_iam_role.Rule_EventsRole_C51A4248.arn}",
      },
    );
    // verify assume role policy
    expect(synthesized).toHaveResourceWithProperties(iamRole.IamRole, {
      assume_role_policy:
        "${data.aws_iam_policy_document.Rule_EventsRole_AssumeRolePolicy_4C6E1A9D.json}",
    });
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_events.name}",
                ],
                type: "Service",
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
    //   Targets: [
    //     {
    //       Arn: "arn:aws:events:us-east-1:111111111111:default",
    //       Id: "Target0",
    //       RoleArn: {
    //         "Fn::GetAtt": ["RuleEventsRoleC51A4248", "Arn"],
    //       },
    //     },
    //   ],
    // });
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Effect: "Allow",
    //         Action: "events:PutEvents",
    //         Resource: "arn:aws:events:us-east-1:111111111111:default",
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   Roles: [
    //     {
    //       Ref: "RuleEventsRoleC51A4248",
    //     },
    //   ],
    // });
  });

  test("with supplied role", () => {
    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("events.amazonaws.com"),
      roleName: "GivenRole",
    });

    rule.addTarget(
      new EventBusTarget(
        EventBus.fromEventBusArn(
          stack,
          "External",
          "arn:aws:events:us-east-1:123456789012:default",
        ),
        { role },
      ),
    );
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    // ensure AWS eventBridge can access event bus
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["arn:aws:events:us-east-1:123456789012:default"],
          },
        ],
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:aws:events:us-east-1:123456789012:default",
        role_arn: "${aws_iam_role.Role_1ABCC5F0.arn}",
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
      },
    );

    // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
    //   Targets: [
    //     {
    //       Arn: "arn:aws:events:us-east-1:123456789012:default",
    //       Id: "Target0",
    //       RoleArn: {
    //         "Fn::GetAtt": ["Role1ABCC5F0", "Arn"],
    //       },
    //     },
    //   ],
    // });
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Effect: "Allow",
    //         Action: "events:PutEvents",
    //         Resource: "arn:aws:events:us-east-1:123456789012:default",
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   Roles: [
    //     {
    //       Ref: "Role1ABCC5F0",
    //     },
    //   ],
    // });
  });

  test("with a Dead Letter Queue specified", () => {
    const queue = new Queue(stack, "Queue");

    rule.addTarget(
      new EventBusTarget(
        EventBus.fromEventBusArn(
          stack,
          "External",
          "arn:aws:events:us-east-1:123456789012:default",
        ),
        { deadLetterQueue: queue },
      ),
    );
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    // ensure AWS eventBridge can access event bus
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["arn:aws:events:us-east-1:123456789012:default"],
          },
        ],
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "arn:aws:events:us-east-1:123456789012:default",
        target_id: "Target0",
        role_arn: "${aws_iam_role.Rule_EventsRole_C51A4248.arn}",
        dead_letter_config: {
          arn: "${aws_sqs_queue.Queue_4A7E3555.arn}",
        },
      },
    );
    // ensure deadletter queue policy policy is created
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sqs:SendMessage"],
            condition: [
              {
                test: "ArnEquals",
                values: ["${aws_cloudwatch_event_rule.Rule_4C995B7F.arn}"],
                variable: "aws:SourceArn",
              },
            ],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_events.name}",
                ],
                type: "Service",
              },
            ],
            resources: ["${aws_sqs_queue.Queue_4A7E3555.arn}"],
            sid: "AllowEventRuleTestStackRule3795E55D",
          },
        ],
      },
    );

    // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
    //   Targets: [
    //     {
    //       Arn: "arn:aws:events:us-east-1:123456789012:default",
    //       Id: "Target0",
    //       RoleArn: {
    //         "Fn::GetAtt": ["RuleEventsRoleC51A4248", "Arn"],
    //       },
    //       DeadLetterConfig: {
    //         Arn: {
    //           "Fn::GetAtt": ["Queue4A7E3555", "Arn"],
    //         },
    //       },
    //     },
    //   ],
    // });

    // Template.fromStack(stack).hasResourceProperties("AWS::SQS::QueuePolicy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "sqs:SendMessage",
    //         Condition: {
    //           ArnEquals: {
    //             "aws:SourceArn": {
    //               "Fn::GetAtt": ["Rule4C995B7F", "Arn"],
    //             },
    //           },
    //         },
    //         Effect: "Allow",
    //         Principal: {
    //           Service: "events.amazonaws.com",
    //         },
    //         Resource: {
    //           "Fn::GetAtt": ["Queue4A7E3555", "Arn"],
    //         },
    //         Sid: "AllowEventRuleRule",
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   Queues: [
    //     {
    //       Ref: "Queue4A7E3555",
    //     },
    //   ],
    // });
  });

  test("with multiple event buses and correctly added to the rule's principal policy", () => {
    const bus1 = new EventBus(stack, "bus" + 1);
    const bus2 = new EventBus(stack, "bus" + 2);

    rule.addTarget(new EventBusTarget(bus1));
    rule.addTarget(new EventBusTarget(bus2));
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();

    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "${aws_cloudwatch_event_bus.bus1_10C385DC.arn}",
        target_id: "Target0",
        role_arn: "${aws_iam_role.Rule_EventsRole_C51A4248.arn}",
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "${aws_cloudwatch_event_bus.bus2_2D01F126.arn}",
        target_id: "Target1",
        role_arn: "${aws_iam_role.Rule_EventsRole_C51A4248.arn}",
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
      },
    );
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["${aws_cloudwatch_event_bus.bus1_10C385DC.arn}"],
          },
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["${aws_cloudwatch_event_bus.bus2_2D01F126.arn}"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::GetAtt": ["bus110C385DC", "Arn"],
    //       },
    //       Id: "Target0",
    //       RoleArn: {
    //         "Fn::GetAtt": ["RuleEventsRoleC51A4248", "Arn"],
    //       },
    //     },
    //     {
    //       Arn: {
    //         "Fn::GetAtt": ["bus22D01F126", "Arn"],
    //       },
    //       Id: "Target1",
    //       RoleArn: {
    //         "Fn::GetAtt": ["RuleEventsRoleC51A4248", "Arn"],
    //       },
    //     },
    //   ],
    // });
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Effect: "Allow",
    //         Action: "events:PutEvents",
    //         Resource: {
    //           "Fn::GetAtt": ["bus110C385DC", "Arn"],
    //         },
    //       },
    //       {
    //         Effect: "Allow",
    //         Action: "events:PutEvents",
    //         Resource: {
    //           "Fn::GetAtt": ["bus22D01F126", "Arn"],
    //         },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   Roles: [
    //     {
    //       Ref: "RuleEventsRoleC51A4248",
    //     },
    //   ],
    // });
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
