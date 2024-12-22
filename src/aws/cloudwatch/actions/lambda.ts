// https://github.com/aws/aws-cdk/blob/a12887b593ef6796f63bf754a3d381676d2e5155/packages/aws-cdk-lib/aws-cloudwatch-actions/lib/lambda.ts

import { lambdaPermission } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import * as cloudwatch from "..";
import * as lambda from "../../compute";
import * as iam from "../../iam";
import { AwsSpec } from "../../spec";

/**
 * Use a Lambda action as an Alarm action
 */
export class LambdaAction implements cloudwatch.IAlarmAction {
  // lambda.IVersion
  private lambdaFunction: lambda.IAlias | lambda.IFunction;
  constructor(lambdaFunction: lambda.IAlias | lambda.IFunction) {
    this.lambdaFunction = lambdaFunction;
  }

  /**
   * Returns an alarm action configuration to use a Lambda action as an alarm action.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html
   */
  bind(
    scope: Construct,
    alarm: cloudwatch.IAlarm,
  ): cloudwatch.AlarmActionConfig {
    // https://github.com/aws/aws-cdk/pull/28712
    // const idPrefix = FeatureFlags.of(scope).isEnabled(
    //   LAMBDA_PERMISSION_LOGICAL_ID_FOR_LAMBDA_ACTION,
    // )
    //   ? alarm.node.id
    //   : "";
    const permissionId = `${alarm.node.id}AlarmPermission`;
    const permissionNode = this.lambdaFunction.permissionsNode.tryFindChild(
      permissionId,
    ) as lambdaPermission.LambdaPermission | undefined;

    // If the Lambda permission has already been added to this function
    // we skip adding it to avoid an exception being thrown
    // see https://github.com/aws/aws-cdk/issues/29514
    if (permissionNode?.sourceArnInput !== alarm.alarmArn) {
      this.lambdaFunction.addPermission(permissionId, {
        sourceAccount: AwsSpec.ofAwsBeacon(scope).account,
        action: "lambda:InvokeFunction",
        sourceArn: alarm.alarmArn,
        principal: new iam.ServicePrincipal(
          "lambda.alarms.cloudwatch.amazonaws.com",
        ),
      });
    }

    return {
      alarmActionArn: this.lambdaFunction.functionArn,
    };
  }
}
