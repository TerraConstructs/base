// https://github.com/aws/aws-cdk/blob/a12887b593ef6796f63bf754a3d381676d2e5155/packages/aws-cdk-lib/aws-cloudwatch-actions/lib/lambda.ts

import path from "node:path";
import { cloudwatchMetricAlarm, lambdaPermission } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as actions from "../../../../src/aws/cloudwatch/actions";
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

let alarmLambda: compute.LambdaFunction;

beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  // GIVEN
  alarmLambda = new compute.NodejsFunction(stack, "HelloWorld", {
    path: path.join(__dirname, "fixtures", "hello-world.ts"),
  });
});

test("can use lambda as alarm action", () => {
  // GIVEN
  const alarm = new cloudwatch.Alarm(stack, "Alarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS",
      metricName: "Test",
    }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  alarm.addAlarmAction(new actions.LambdaAction(alarmLambda));

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      alarm_actions: [stack.resolve(alarmLambda.functionArn)],
    },
  );
  // Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
  //   AlarmActions: [
  //     {
  //       "Fn::GetAtt": ["alarmLambda131DB691", "Arn"],
  //     },
  //   ],
  // });
});

test("can use lambda alias as alarm action", () => {
  // GIVEN
  const alarm = new cloudwatch.Alarm(stack, "Alarm", {
    metric: new cloudwatch.Metric({
      namespace: "AWS",
      metricName: "Test",
    }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  const alias = alarmLambda.addAlias("aliasName");
  alarm.addAlarmAction(new actions.LambdaAction(alias));

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      alarm_actions: [stack.resolve(alias.functionArn)],
    },
  );
  // Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
  //   AlarmActions: [
  //     {
  //       Ref: "alarmLambdaAliasaliasName41B27313",
  //     },
  //   ],
  // });
});

// test("can use lambda version as alarm action", () => {
//   // GIVEN
//   const alarm = new cloudwatch.Alarm(stack, "Alarm", {
//     metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test" }),
//     evaluationPeriods: 3,
//     threshold: 100,
//   });

//   // WHEN
//   const version = alarmLambda.currentVersion;
//   alarm.addAlarmAction(new actions.LambdaAction(version));

//   // THEN
//   Template.synth(stack).toHaveResourceWithProperties(
//     cloudwatchMetricAlarm.CloudwatchMetricAlarm,
//     {
//       alarm_actions: [stack.resolve(version.versionName)],
//     },
//   );
//   // Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
//   //   AlarmActions: [
//   //     {
//   //       Ref: "alarmLambdaCurrentVersionBDCE825Cf5e98d107ecb420808f3d9421127310e",
//   //     },
//   //   ],
//   // });
// });

test("can create multiple alarms for the same lambda if feature flag is set", () => {
  // GIVEN
  // stack.node.setContext(LAMBDA_PERMISSION_LOGICAL_ID_FOR_LAMBDA_ACTION, true);
  const alarm1 = new cloudwatch.Alarm(stack, "Alarm1", {
    metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test" }),
    evaluationPeriods: 3,
    threshold: 100,
  });
  const alarm2 = new cloudwatch.Alarm(stack, "Alarm2", {
    metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test2" }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  alarm1.addAlarmAction(new actions.LambdaAction(alarmLambda));
  alarm1.addOkAction(new actions.LambdaAction(alarmLambda));
  alarm1.addInsufficientDataAction(new actions.LambdaAction(alarmLambda));

  alarm2.addAlarmAction(new actions.LambdaAction(alarmLambda));
  alarm2.addOkAction(new actions.LambdaAction(alarmLambda));
  alarm2.addInsufficientDataAction(new actions.LambdaAction(alarmLambda));

  // THEN
  Template.resources(
    stack,
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
  ).toHaveLength(2);
  // Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 2);
  Template.resources(stack, lambdaPermission.LambdaPermission).toHaveLength(2);
  // Template.fromStack(stack).resourceCountIs("AWS::Lambda::Permission", 2);
});

// // TODO: We don't use LAMBDA_PERMISSION_LOGICAL_ID_FOR_LAMBDA_ACTION feature flag
// test("throws when multiple alarms are created for the same lambda if feature flag is set to false", () => {
//   // GIVEN
//   // stack.node.setContext(LAMBDA_PERMISSION_LOGICAL_ID_FOR_LAMBDA_ACTION, false); // Default, but explicit just in case.
//   const alarm1 = new cloudwatch.Alarm(stack, "Alarm1", {
//     metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test" }),
//     evaluationPeriods: 3,
//     threshold: 100,
//   });
//   const alarm2 = new cloudwatch.Alarm(stack, "Alarm2", {
//     metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test2" }),
//     evaluationPeriods: 3,
//     threshold: 100,
//   });

//   // WHEN
//   alarm1.addAlarmAction(new actions.LambdaAction(alarmLambda));
//   alarm1.addOkAction(new actions.LambdaAction(alarmLambda));
//   alarm1.addInsufficientDataAction(new actions.LambdaAction(alarmLambda));

//   // THEN
//   expect(() => {
//     alarm2.addAlarmAction(new actions.LambdaAction(alarmLambda));
//   }).toThrow(
//     /There is already a Construct with name 'AlarmPermission' in Function \[alarmLambda\]/,
//   );
// });

test("can use same lambda for same action multiple time", () => {
  const alarm = new cloudwatch.Alarm(stack, "Alarm", {
    metric: new cloudwatch.Metric({ namespace: "AWS", metricName: "Test" }),
    evaluationPeriods: 3,
    threshold: 100,
  });

  // WHEN
  alarm.addAlarmAction(new actions.LambdaAction(alarmLambda));
  alarm.addAlarmAction(new actions.LambdaAction(alarmLambda));

  // THEN
  Template.resources(stack, lambdaPermission.LambdaPermission).toHaveLength(1);
  // Template.fromStack(stack).resourceCountIs("AWS::Lambda::Permission", 1);
  Template.synth(stack).toHaveResourceWithProperties(
    cloudwatchMetricAlarm.CloudwatchMetricAlarm,
    {
      alarm_actions: [
        stack.resolve(alarmLambda.functionArn),
        stack.resolve(alarmLambda.functionArn),
      ],
    },
  );
  // Template.synth(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
  //   AlarmActions: [
  //     {
  //       "Fn::GetAtt": ["alarmLambda131DB691", "Arn"],
  //     },
  //     {
  //       "Fn::GetAtt": ["alarmLambda131DB691", "Arn"],
  //     },
  //   ],
  // });
});
