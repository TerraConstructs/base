import * as path from "path";
import {
  lambdaPermission,
  cloudwatchEventTarget,
  dataAwsIamPolicyDocument,
  sqsQueuePolicy,
} from "@cdktf/provider-aws";
import { Testing, App } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { NodejsFunction } from "../../../../src/aws/compute/function-nodejs";
import { RuleTargetInput } from "../../../../src/aws/notify/input";
import { Queue } from "../../../../src/aws/notify/queue";
import { Rule } from "../../../../src/aws/notify/rule";
import { Schedule } from "../../../../src/aws/notify/schedule";
import { LambdaFunction as LambdaFunctionTarget } from "../../../../src/aws/notify/targets/function";
import { AwsSpec } from "../../../../src/aws/spec";
import { Duration } from "../../../../src/duration";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
describe("LambdaFunction as an event rule target", () => {
  let app: App;
  let spec: AwsSpec;
  // let rule: Rule;

  beforeEach(() => {
    app = Testing.app();
    spec = getAwsSpec(app);
    // rule = new Rule(spec, "Rule", {
    //   schedule: Schedule.expression("rate(1 min)"),
    // });
  });

  test("with multiple rules", () => {
    // GIVEN
    const fn = newTestLambda(spec);
    const rule1 = new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });
    const rule2 = new Rule(spec, "Rule2", {
      schedule: Schedule.rate(Duration.minutes(5)),
    });

    // WHEN
    rule1.addTarget(new LambdaFunctionTarget(fn));
    rule2.addTarget(new LambdaFunctionTarget(fn));

    // THEN
    // Do prepare run to resolve all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // expect(synthesized).toMatchSnapshot();
    const lambdaId = "MyLambda_CCE802FB";
    expect(synthesized).toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        function_name: `\${aws_lambda_function.${lambdaId}.arn}`,
        action: "lambda:InvokeFunction",
        principal: "events.amazonaws.com",
        source_arn: "${aws_cloudwatch_event_rule.Rule_4C995B7F.arn}",
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      lambdaPermission.LambdaPermission,
      {
        function_name: `\${aws_lambda_function.${lambdaId}.arn}`,
        action: "lambda:InvokeFunction",
        principal: "events.amazonaws.com",
        source_arn: "${aws_cloudwatch_event_rule.Rule2_70732244.arn}",
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        target_id: "Target0",
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
        arn: `\${aws_lambda_function.${lambdaId}.arn}`,
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        target_id: "Target0",
        rule: "${aws_cloudwatch_event_rule.Rule2_70732244.name}",
        arn: `\${aws_lambda_function.${lambdaId}.arn}`,
      },
    );

    // Template.fromStack(spec).hasResourceProperties("AWS::Lambda::Permission", {
    //   Action: "lambda:InvokeFunction",
    //   FunctionName: {
    //     "Fn::GetAtt": [lambdaId, "Arn"],
    //   },
    //   Principal: "events.amazonaws.com",
    //   SourceArn: { "Fn::GetAtt": ["Rule4C995B7F", "Arn"] },
    // });

    // Template.fromStack(spec).hasResourceProperties("AWS::Lambda::Permission", {
    //   Action: "lambda:InvokeFunction",
    //   FunctionName: {
    //     "Fn::GetAtt": [lambdaId, "Arn"],
    //   },
    //   Principal: "events.amazonaws.com",
    //   SourceArn: { "Fn::GetAtt": ["Rule270732244", "Arn"] },
    // });

    // Template.fromStack(spec).resourceCountIs("AWS::Events::Rule", 2);
    // Template.fromStack(spec).hasResourceProperties("AWS::Events::Rule", {
    //   Targets: [
    //     {
    //       Arn: { "Fn::GetAtt": [lambdaId, "Arn"] },
    //       Id: "Target0",
    //     },
    //   ],
    // });
  });

  test("adding same lambda function as target mutiple times creates permission only once", () => {
    // GIVEN
    const fn = newTestLambda(spec);
    const rule = new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule.addTarget(
      new LambdaFunctionTarget(fn, {
        event: RuleTargetInput.fromObject({ key: "value1" }),
      }),
    );
    rule.addTarget(
      new LambdaFunctionTarget(fn, {
        event: RuleTargetInput.fromObject({ key: "value2" }),
      }),
    );

    // THEN
    // Do prepare run to resolve all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // expect(synthesized).toMatchSnapshot();
    expect(
      resourceCount(JSON.parse(synthesized), lambdaPermission.LambdaPermission),
    ).toBe(1);
    // Template.fromStack(spec).resourceCountIs("AWS::Lambda::Permission", 1);
  });

  test("adding different lambda functions as target mutiple times creates multiple permissions", () => {
    // GIVEN
    const fn1 = newTestLambda(spec);
    const fn2 = newTestLambda(spec, "2");
    const rule = new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    // WHEN
    rule.addTarget(
      new LambdaFunctionTarget(fn1, {
        event: RuleTargetInput.fromObject({ key: "value1" }),
      }),
    );
    rule.addTarget(
      new LambdaFunctionTarget(fn2, {
        event: RuleTargetInput.fromObject({ key: "value2" }),
      }),
    );

    // THEN
    // Do prepare run to resolve all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // expect(synthesized).toMatchSnapshot();
    expect(
      resourceCount(JSON.parse(synthesized), lambdaPermission.LambdaPermission),
    ).toBe(2);
    // Template.fromStack(spec).resourceCountIs("AWS::Lambda::Permission", 2);
  });

  // // TODO: Re-add SingletonFunction
  // test("adding same singleton lambda function as target mutiple times creates permission only once", () => {
  //   // GIVEN
  //   const stack = new cdk.Stack();
  //   const fn = new lambda.SingletonFunction(stack, "MyLambda", {
  //     code: new lambda.InlineCode("foo"),
  //     handler: "bar",
  //     runtime: lambda.Runtime.PYTHON_3_9,
  //     uuid: "uuid",
  //   });
  //   const rule = new events.Rule(stack, "Rule", {
  //     schedule: events.Schedule.rate(Duration.minutes(1)),
  //   });

  //   // WHEN
  //   rule.addTarget(
  //     new LambdaFunctionTarget(fn, {
  //       event: RuleTargetInput.fromObject({ key: "value1" }),
  //     }),
  //   );
  //   rule.addTarget(
  //     new LambdaFunctionTarget(fn, {
  //       event: RuleTargetInput.fromObject({ key: "value2" }),
  //     }),
  //   );

  //   // THEN
  //   Template.fromStack(stack).resourceCountIs("AWS::Lambda::Permission", 1);
  // });

  // // TODO: Re-add cross stack tests?
  // test("lambda handler and cloudwatch event across stacks", () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const lambdaStack = new cdk.Stack(app, "LambdaStack");

  //   const fn = new lambda.Function(lambdaStack, "MyLambda", {
  //     code: new lambda.InlineCode("foo"),
  //     handler: "bar",
  //     runtime: lambda.Runtime.PYTHON_3_9,
  //   });

  //   const eventStack = new cdk.Stack(app, "EventStack");
  //   new events.Rule(eventStack, "Rule", {
  //     schedule: events.Schedule.rate(Duration.minutes(1)),
  //     targets: [new LambdaFunctionTarget(fn)],
  //   });

  //   expect(() => app.synth()).not.toThrow();

  //   // the Permission resource should be in the event stack
  //   Template.fromStack(eventStack).resourceCountIs(
  //     "AWS::Lambda::Permission",
  //     1,
  //   );
  // });

  test("use a Dead Letter Queue for the rule target", () => {
    // GIVEN
    const fn = newTestLambda(spec);

    const queue = new Queue(spec, "Queue");

    new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [
        new LambdaFunctionTarget(fn, {
          deadLetterQueue: queue,
        }),
      ],
    });

    // expect(() => app.synth()).not.toThrow();
    // Do prepare run to resolve all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
        target_id: "Target0",
        arn: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        dead_letter_config: {
          arn: "${aws_sqs_queue.Queue_4A7E3555.arn}",
        },
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      sqsQueuePolicy.SqsQueuePolicy,
      {
        policy: "${data.aws_iam_policy_document.Queue_Policy_E851DAAC.json}",
        queue_url: "${aws_sqs_queue.Queue_4A7E3555.url}",
      },
    );
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "AllowEventRuleTestSpecRule5C250C1D",
            effect: "Allow",
            actions: ["sqs:SendMessage"],
            condition: [
              {
                test: "ArnEquals",
                values: ["${aws_cloudwatch_event_rule.Rule_4C995B7F.arn}"],
                variable: "aws:SourceArn",
              },
            ],
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_events.name}",
                ],
                type: "Service",
              },
            ],
            resources: ["${aws_sqs_queue.Queue_4A7E3555.arn}"],
          },
        ],
      },
    );
    // // the Permission resource should be in the event stack
    // Template.fromStack(spec).hasResourceProperties("AWS::Events::Rule", {
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"],
    //       },
    //       DeadLetterConfig: {
    //         Arn: {
    //           "Fn::GetAtt": ["Queue4A7E3555", "Arn"],
    //         },
    //       },
    //       Id: "Target0",
    //     },
    //   ],
    // });

    // Template.fromStack(spec).hasResourceProperties("AWS::SQS::QueuePolicy", {
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
    //         Sid: "AllowEventRuleStackRuleF6E31DD0",
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

  test("throw an error when using a Dead Letter Queue for the rule target in a different region", () => {
    // GIVEN
    const spec2 = getAwsSpec(app, "us-east-2", "2");

    const fn = newTestLambda(spec);

    const queue = new Queue(spec2, "Queue");

    let rule = new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    expect(() => {
      rule.addTarget(
        new LambdaFunctionTarget(fn, {
          deadLetterQueue: queue,
        }),
      );
    }).toThrow(
      /Cannot assign Dead Letter Queue in region us-east-2 to the rule TestSpecRule5C250C1D in region us-east-1. Both the queue and the rule must be in the same region./,
    );
  });

  // TODO: Re-add cross account tests?
  // test("must display a warning when using a Dead Letter Queue from another account", () => {
  //   // GIVEN
  //   const spec2 = getAwsSpec(app, "us-east-2", "2"); //  account: "222222222222"

  //   const fn = new NodejsFunction(spec, "MyLambda", {
  //     path: path.join(__dirname, "handlers", "hello-world.ts"),
  //   });

  //   const queue = Queue.fromQueueArn(
  //     spec2,
  //     "Queue",
  //     "arn:aws:sqs:eu-west-1:444455556666:queue1",
  //   );

  //   new Rule(spec, "Rule", {
  //     schedule: Schedule.rate(Duration.minutes(1)),
  //     targets: [
  //       new LambdaFunctionTarget(fn, {
  //         deadLetterQueue: queue,
  //       }),
  //     ],
  //   });

  //   expect(() => app.synth()).not.toThrow();
  //   // Do prepare run to resolve all Terraform resources
  //   spec.prepareStack();
  //   const synthesized = Testing.synth(spec);
  //   expect(synthesized).toMatchSnapshot();

  //   // // the Permission resource should be in the event stack
  //   // Template.fromStack(spec).hasResourceProperties("AWS::Events::Rule", {
  //   //   ScheduleExpression: "rate(1 minute)",
  //   //   State: "ENABLED",
  //   //   Targets: [
  //   //     {
  //   //       Arn: {
  //   //         "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"],
  //   //       },
  //   //       DeadLetterConfig: {
  //   //         Arn: "arn:aws:sqs:eu-west-1:444455556666:queue1",
  //   //       },
  //   //       Id: "Target0",
  //   //     },
  //   //   ],
  //   // });

  //   // Template.fromStack(spec).resourceCountIs("AWS::SQS::QueuePolicy", 0);

  //   // Annotations.fromStack(spec).hasWarning(
  //   //   "/Stack1/Rule",
  //   //   Match.objectLike({
  //   //     "Fn::Join": Match.arrayWith([
  //   //       Match.arrayWith([
  //   //         "Cannot add a resource policy to your dead letter queue associated with rule ",
  //   //       ]),
  //   //     ]),
  //   //   }),
  //   // );
  // });

  test("specifying retry policy", () => {
    // GIVEN
    const fn = newTestLambda(spec);

    // WHEN
    new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [
        new LambdaFunctionTarget(fn, {
          retryAttempts: 2,
          maxEventAge: Duration.hours(2),
        }),
      ],
    });

    // THEN
    // expect(() => app.synth()).not.toThrow();
    // Do prepare run to resolve all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // expect(synthesized).toMatchSnapshot();

    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        target_id: "Target0",
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
        arn: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        retry_policy: {
          maximum_event_age_in_seconds: 7200,
          maximum_retry_attempts: 2,
        },
      },
    );
    // Template.fromStack(spec).hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"],
    //       },
    //       Id: "Target0",
    //       RetryPolicy: {
    //         MaximumEventAgeInSeconds: 7200,
    //         MaximumRetryAttempts: 2,
    //       },
    //     },
    //   ],
    // });
  });

  test("specifying retry policy with 0 retryAttempts", () => {
    // GIVEN
    const fn = newTestLambda(spec);
    // WHEN
    new Rule(spec, "Rule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [
        new LambdaFunctionTarget(fn, {
          retryAttempts: 0,
        }),
      ],
    });

    // THEN
    // expect(() => app.synth()).not.toThrow();
    // Do prepare run to resolve all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        target_id: "Target0",
        rule: "${aws_cloudwatch_event_rule.Rule_4C995B7F.name}",
        arn: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        retry_policy: {
          maximum_retry_attempts: 0,
        },
      },
    );
    // Template.fromStack(spec).hasResourceProperties("AWS::Events::Rule", {
    //   ScheduleExpression: "rate(1 minute)",
    //   State: "ENABLED",
    //   Targets: [
    //     {
    //       Arn: {
    //         "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"],
    //       },
    //       Id: "Target0",
    //       RetryPolicy: {
    //         MaximumRetryAttempts: 0,
    //       },
    //     },
    //   ],
    // });
  });
});

function newTestLambda(scope: Construct, suffix = "") {
  return new NodejsFunction(scope, `MyLambda${suffix}`, {
    path: path.join(__dirname, "handlers", "hello-world.ts"),
  });
}

function getAwsSpec(
  app: App,
  region: string = "us-east-1",
  suffix: string = "",
): AwsSpec {
  return new AwsSpec(app, `TestSpec${suffix}`, {
    environmentName,
    gridUUID,
    providerConfig: {
      region,
    },
    gridBackendConfig,
  });
}

/**
 * Get resources count of a given type from a synthesized stack
 */
function resourceCount(parsed: any, constructor: TerraformConstructor) {
  // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
  if (!parsed.resource || !parsed.resource[constructor.tfResourceType]) {
    return 0;
  }
  return Object.values(parsed.resource[constructor.tfResourceType]).length;
}
interface TerraformConstructor {
  readonly tfResourceType: string;
}
