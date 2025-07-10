// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda/test/alias.test.ts

import {
  lambdaAlias,
  lambdaFunctionEventInvokeConfig,
  lambdaFunctionUrl,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { compute, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

const gridUUID = "123e4567-e89b-12d3";

describe("alias", () => {
  let stack: AwsStack;
  let fn: compute.LambdaFunction;
  beforeEach(() => {
    stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
    fn = new compute.LambdaFunction(stack, "MyLambda", {
      code: new compute.InlineCode("hello()"),
      handler: "index.hello",
      runtime: compute.Runtime.NODEJS_LATEST,
    });
  });

  test("can create an alias to $LATEST", () => {
    new compute.Alias(stack, "Alias", {
      aliasName: "latest",
      version: fn.version,
      function: fn,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(lambdaAlias.LambdaAlias, {
      function_name: "${aws_lambda_function.MyLambda_CCE802FB.function_name}",
      function_version: "${aws_lambda_function.MyLambda_CCE802FB.version}",
      name: "123e4567-e89b-12d3-latest",
    });
    // Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Alias", {
    //   FunctionName: { Ref: "MyLambdaCCE802FB" },
    //   FunctionVersion: "$LATEST",
    //   Name: "latest",
    // });
    // Template.fromStack(stack).resourceCountIs("AWS::Lambda::Version", 0);
  });

  test("sanity checks on version weights", () => {
    const version = fn.version;

    // WHEN: Individual weight too high
    expect(() => {
      new compute.Alias(stack, "Alias1", {
        aliasName: "prod",
        version,
        additionalVersions: [{ version, weight: 5 }],
        function: fn,
      });
    }).toThrow();

    // WHEN: Sum too high
    expect(() => {
      new compute.Alias(stack, "Alias2", {
        aliasName: "prod",
        version,
        additionalVersions: [
          { version, weight: 0.5 },
          { version, weight: 0.6 },
        ],
        function: fn,
      });
    }).toThrow();
  });

  test("alias exposes real Lambdas role", () => {
    const version = fn.version;
    const alias = new compute.Alias(stack, "Alias", {
      aliasName: "prod",
      function: fn,
      version,
    });

    // THEN
    expect(alias.role).toEqual(fn.role);
  });

  test("functionName is derived from the aliasArn so that dependencies are sound", () => {
    const version = fn.version;
    new compute.Alias(stack, "Alias", {
      aliasName: "prod",
      function: fn,
      version,
    });

    // WHEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(lambdaAlias.LambdaAlias, {
      function_name: "${aws_lambda_function.MyLambda_CCE802FB.function_name}",
      function_version: "${aws_lambda_function.MyLambda_CCE802FB.version}",
    });
  });

  test("with event invoke config", () => {
    // WHEN
    new compute.Alias(stack, "Alias", {
      aliasName: "prod",
      function: fn,
      version: fn.version,
      onSuccess: {
        bind: () => ({
          destination: "on-success-arn",
        }),
      },
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaFunctionEventInvokeConfig.LambdaFunctionEventInvokeConfig,
      {
        destination_config: {
          on_success: {
            destination: "on-success-arn",
          },
        },
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.function_name}",
        qualifier: "${aws_lambda_function.MyLambda_CCE802FB.version}", // TODO: Qualifier should be alias name?
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventInvokeConfig",
    //   {
    //     FunctionName: {
    //       Ref: "fn5FF616E3",
    //     },
    //     Qualifier: {
    //       "Fn::Select": [
    //         7,
    //         {
    //           "Fn::Split": [
    //             ":",
    //             {
    //               Ref: "Alias325C5727",
    //             },
    //           ],
    //         },
    //       ],
    //     },
    //     DestinationConfig: {
    //       OnSuccess: {
    //         Destination: "on-success-arn",
    //       },
    //     },
    //   },
    // );
  });

  // TODO: Lambda Alias should point to Function name through Ref, not fixed string
  test("throws when calling configureAsyncInvoke on already configured alias", () => {
    // GIVEN
    const alias = new compute.Alias(stack, "Alias", {
      aliasName: "prod",
      function: fn,
      version: fn.version,
      onSuccess: {
        bind: () => ({
          destination: "on-success-arn",
        }),
      },
    });

    // THEN
    expect(() => alias.configureAsyncInvoke({ retryAttempts: 0 })).toThrow(
      /An EventInvokeConfig has already been configured/,
    );
  });

  test("event invoke config on imported alias", () => {
    // GIVEN
    const fn2 = compute.LambdaFunction.fromFunctionArn(
      stack,
      "Fn2",
      "arn:aws:lambda:region:account-id:function:function-name:version",
    );
    const alias = compute.Alias.fromAliasAttributes(stack, "Alias", {
      aliasName: "alias-name",
      function: fn2,
    });

    // WHEN
    alias.configureAsyncInvoke({
      retryAttempts: 1,
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    const template = new Template(stack);
    stack.prepareStack();
    template.expect.toHaveResourceWithProperties(
      lambdaFunctionEventInvokeConfig.LambdaFunctionEventInvokeConfig,
      {
        // Name or Amazon Resource Name (ARN) of the Lambda Function,
        // omitting any version or alias qualifier.
        function_name: "function-name",
        maximum_retry_attempts: 1,
        // Lambda Function published version, `$LATEST`, or Lambda Alias name.
        qualifier: "${data.aws_lambda_alias.Alias_325C5727.function_version}",
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventInvokeConfig",
    //   {
    //     FunctionName: "function-name",
    //     Qualifier: "alias-name",
    //     MaximumRetryAttempts: 1,
    //   },
    // );
  });

  // // TOOD: re-add autoscaling
  // test("can enable AutoScaling on aliases with Provisioned Concurrency set", () => {
  //   // GIVEN

  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //     provisionedConcurrentExecutions: 10,
  //   });

  //   // WHEN
  //   alias.addAutoScaling({ maxCapacity: 5 });

  //   // THEN
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::ApplicationAutoScaling::ScalableTarget",
  //   //   {
  //   //     MinCapacity: 1,
  //   //     MaxCapacity: 5,
  //   //     ResourceId: Match.objectLike({
  //   //       "Fn::Join": Match.arrayWith([
  //   //         Match.arrayWith([
  //   //           "function:",
  //   //           Match.objectLike({
  //   //             "Fn::Select": Match.arrayWith([
  //   //               {
  //   //                 "Fn::Split": Match.arrayWith([{ Ref: "Alias325C5727" }]),
  //   //               },
  //   //             ]),
  //   //           }),
  //   //           ":prod",
  //   //         ]),
  //   //       ]),
  //   //     }),
  //   //   },
  //   // );

  //   // Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Alias", {
  //   //   ProvisionedConcurrencyConfig: {
  //   //     ProvisionedConcurrentExecutions: 10,
  //   //   },
  //   // });
  // });

  // // TOOD: re-add autoscaling
  // test("validation for utilizationTarget does not fail when using Tokens", () => {
  //   // GIVEN

  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //     provisionedConcurrentExecutions: 10,
  //   });

  //   // WHEN
  //   const target = alias.addAutoScaling({ maxCapacity: 5 });

  //   target.scaleOnUtilization({
  //     utilizationTarget: Lazy.numberValue({ produce: () => 0.95 }),
  //   });

  //   // THEN: no exception
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::ApplicationAutoScaling::ScalingPolicy",
  //   //   {
  //   //     PolicyType: "TargetTrackingScaling",
  //   //     TargetTrackingScalingPolicyConfiguration: {
  //   //       PredefinedMetricSpecification: {
  //   //         PredefinedMetricType: "LambdaProvisionedConcurrencyUtilization",
  //   //       },
  //   //       TargetValue: 0.95,
  //   //     },
  //   //   },
  //   // );
  // });

  // // TOOD: re-add autoscaling
  // test("cannot enable AutoScaling twice on same property", () => {
  //   // GIVEN

  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //   });

  //   // WHEN
  //   alias.addAutoScaling({ maxCapacity: 5 });

  //   // THEN
  //   expect(() => alias.addAutoScaling({ maxCapacity: 8 })).toThrow(
  //     /AutoScaling already enabled for this alias/,
  //   );
  // });

  // test("error when specifying invalid utilization value when AutoScaling on utilization", () => {
  //   // GIVEN

  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //   });

  //   // WHEN
  //   const target = alias.addAutoScaling({ maxCapacity: 5 });

  //   // THEN
  //   expect(() =>
  //     target.scaleOnUtilization({ utilizationTarget: 0.95 }),
  //   ).toThrow(/Utilization Target should be between 0.1 and 0.9. Found 0.95/);
  // });

  // test("can autoscale on a schedule", () => {
  //   // GIVEN

  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //   });

  //   // WHEN
  //   const target = alias.addAutoScaling({ maxCapacity: 5 });
  //   target.scaleOnSchedule("Scheduling", {
  //     schedule: appscaling.Schedule.cron({}),
  //     maxCapacity: 10,
  //   });

  //   // THEN
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::ApplicationAutoScaling::ScalableTarget",
  //   //   {
  //   //     ScheduledActions: [
  //   //       {
  //   //         ScalableTargetAction: { MaxCapacity: 10 },
  //   //         Schedule: "cron(* * * * ? *)",
  //   //         ScheduledActionName: "Scheduling",
  //   //       },
  //   //     ],
  //   //   },
  //   // );
  // });

  // test("scheduled scaling shows warning when minute is not defined in cron", () => {
  //   // GIVEN
  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //   });

  //   // WHEN
  //   const target = alias.addAutoScaling({ maxCapacity: 5 });
  //   target.scaleOnSchedule("Scheduling", {
  //     schedule: appscaling.Schedule.cron({}),
  //     maxCapacity: 10,
  //   });

  //   // THEN
  //   Annotations.fromStack(stack).hasWarning(
  //     "/Default/Alias/AliasScaling/Target",
  //     "cron: If you don't pass 'minute', by default the event runs every minute. Pass 'minute: '*'' if that's what you intend, or 'minute: 0' to run once per hour instead. [ack: @aws-cdk/aws-applicationautoscaling:defaultRunEveryMinute]",
  //   );
  // });

  // test("scheduled scaling shows no warning when minute is * in cron", () => {
  //   // GIVEN

  //   const alias = new compute.Alias(stack, "Alias", {
  //     aliasName: "prod",
  //     function: fn,
  //     version: fn.version,
  //   });

  //   // WHEN
  //   const target = alias.addAutoScaling({ maxCapacity: 5 });
  //   target.scaleOnSchedule("Scheduling", {
  //     schedule: appscaling.Schedule.cron({ minute: "*" }),
  //     maxCapacity: 10,
  //   });

  //   // THEN
  //   const annotations = Annotations.fromStack(stack).findWarning(
  //     "*",
  //     Match.anyValue(),
  //   );
  //   expect(annotations.length).toBe(0);
  // });

  test("addFunctionUrl creates a function url", () => {
    // GIVEN
    const aliasName = "prod";
    const alias = new compute.Alias(stack, "Alias", {
      aliasName,
      function: fn,
      version: fn.version,
    });

    // WHEN
    alias.addFunctionUrl();

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaFunctionUrl.LambdaFunctionUrl,
      {
        authorization_type: "AWS_IAM",
        depends_on: ["aws_lambda_alias.Alias_325C5727"],
        function_name: "${aws_lambda_function.MyLambda_CCE802FB.arn}",
        qualifier: `${gridUUID}-${aliasName}`,
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Url", {
    //   AuthType: "AWS_IAM",
    //   TargetFunctionArn: {
    //     "Fn::GetAtt": ["MyLambdaCCE802FB", "Arn"],
    //   },
    //   Qualifier: aliasName,
    // });
  });
});
