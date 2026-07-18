// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/scheduled-action.test.ts

import { autoscalingSchedule } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../../src/aws";
import {
  AmazonLinuxImage,
  InstanceType,
  Vpc,
} from "../../../../src/aws/compute";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import { Annotations, Template } from "../../../assertions";

// upstream wraps this suite in `describeDeprecated('scheduled action', ...)` because
// `makeAutoScalingGroup` used the deprecated `updateType`/`UpdateType.ROLLING_UPDATE`
// props (which back CloudFormation's UpdatePolicy). Those props have no
// `aws_autoscaling_group` equivalent and are not ported here (see the Terraform
// deviation note on `CommonAutoScalingGroupProps` in auto-scaling-group.ts), so a
// plain `describe` suffices.
describe("scheduled action", () => {
  test("can schedule an action", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({ hour: "8", minute: "0" }),
      minCapacity: 10,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingSchedule.AutoscalingSchedule,
      {
        recurrence: "0 8 * * *",
        min_size: 10,
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScheduledAction', {
    //   Recurrence: '0 8 * * *',
    //   MinSize: 10,
    // });
  });

  test("correctly formats date objects", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({ hour: "8" }),
      startTime: new Date(Date.UTC(2033, 8, 10, 12, 0, 0)), // JavaScript's Date is a little silly.
      minCapacity: 11,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingSchedule.AutoscalingSchedule,
      {
        start_time: "2033-09-10T12:00:00Z",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScheduledAction', {
    //   StartTime: '2033-09-10T12:00:00Z',
    // });
  });

  test("have timezone property", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutAtMiddaySeoul", {
      schedule: autoscaling.Schedule.cron({ hour: "12", minute: "0" }),
      minCapacity: 12,
      timeZone: "Asia/Seoul",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingSchedule.AutoscalingSchedule,
      {
        min_size: 12,
        recurrence: "0 12 * * *",
        time_zone: "Asia/Seoul",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::ScheduledAction', {
    //   MinSize: 12,
    //   Recurrence: '0 12 * * *',
    //   TimeZone: 'Asia/Seoul',
    // });
  });

  // Not supported by Terraform Provider: CloudFormation's UpdatePolicy/CreationPolicy
  // (LaunchConfigurationName, AutoScalingRollingUpdate, AutoScalingScheduledAction /
  // IgnoreUnmodifiedGroupSizeProperties) is a template-level attribute pair with no
  // `aws_autoscaling_group` counterpart - the Terraform resource has no update/creation
  // policy attribute at all (see the Terraform deviation note on
  // `CommonAutoScalingGroupProps` in auto-scaling-group.ts).
  // test('autoscaling group has recommended updatepolicy for scheduled actions', () => {
  //   // GIVEN
  //   const stack = new cdk.Stack();
  //   const asg = makeAutoScalingGroup(stack);
  //
  //   // WHEN
  //   asg.scaleOnSchedule('ScaleOutInTheMorning', {
  //     schedule: autoscaling.Schedule.cron({ hour: '8' }),
  //     minCapacity: 10,
  //   });
  //
  //   // THEN
  //   Template.fromStack(stack).templateMatches({
  //     Resources: {
  //       ASG46ED3070: {
  //         Type: 'AWS::AutoScaling::AutoScalingGroup',
  //         Properties: {
  //           MaxSize: '1',
  //           MinSize: '1',
  //           LaunchConfigurationName: { Ref: 'ASGLaunchConfigC00AF12B' },
  //           Tags: [
  //             {
  //               Key: 'Name',
  //               PropagateAtLaunch: true,
  //               Value: 'Default/ASG',
  //             },
  //           ],
  //           VPCZoneIdentifier: [
  //             { Ref: 'VPCPrivateSubnet1Subnet8BCA10E0' },
  //             { Ref: 'VPCPrivateSubnet2SubnetCFCDAA7A' },
  //           ],
  //         },
  //         UpdatePolicy: {
  //           AutoScalingRollingUpdate: {
  //             WaitOnResourceSignals: false,
  //             PauseTime: 'PT0S',
  //             SuspendProcesses: [
  //               'HealthCheck',
  //               'ReplaceUnhealthy',
  //               'AZRebalance',
  //               'AlarmNotification',
  //               'ScheduledActions',
  //               'InstanceRefresh',
  //             ],
  //           },
  //           AutoScalingScheduledAction: {
  //             IgnoreUnmodifiedGroupSizeProperties: true,
  //           },
  //         },
  //       },
  //     },
  //     Parameters: {
  //       SsmParameterValueawsserviceamiamazonlinuxlatestamznamihvmx8664gp2C96584B6F00A464EAD1953AFF4B05118Parameter: {
  //         Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
  //         Default: '/aws/service/ami-amazon-linux-latest/amzn-ami-hvm-x86_64-gp2',
  //       },
  //     },
  //   });
  // });

  test("scheduled scaling shows warning when minute is not defined in cron", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({ hour: "8" }),
      minCapacity: 10,
    });

    // THEN
    Annotations.fromStack(stack).hasWarnings({
      constructPath: "Default/ASG/ScheduledActionScaleOutInTheMorning",
      message: expect.stringMatching(
        /cron: If you don't pass 'minute', by default the event runs every minute\. Pass 'minute: '\*'' if that's what you intend, or 'minute: 0' to run once per hour instead\./,
      ),
    });
    // Annotations.fromStack(stack).hasWarning('/Default/ASG/ScheduledActionScaleOutInTheMorning', "cron: If you don't pass 'minute', by default the event runs every minute. Pass 'minute: '*'' if that's what you intend, or 'minute: 0' to run once per hour instead. [ack: @aws-cdk/aws-autoscaling:scheduleDefaultRunsEveryMinute]");
  });

  test("scheduled scaling shows no warning when minute is * in cron", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({
        hour: "8",
        minute: "*",
      }),
      minCapacity: 10,
    });

    // THEN
    const warnings = Annotations.fromStack(stack).warnings;
    expect(warnings.length).toBe(0);
  });

  test("ScheduledActions have a name", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    const action = asg.scaleOnSchedule("ScaleOutAtMiddaySeoul", {
      schedule: autoscaling.Schedule.cron({ hour: "12", minute: "0" }),
      minCapacity: 12,
      timeZone: "Asia/Seoul",
    });

    expect(action.scheduledActionName).toBeDefined();
  });

  test("scheduled scaling shows no warning when day is specified and weekDay is undefined in cron", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({
        minute: "0/10",
        day: "1",
      }),
      minCapacity: 10,
    });

    // THEN
    const warnings = Annotations.fromStack(stack).warnings;
    expect(warnings.length).toBe(0);
  });

  test("scheduled scaling shows no warning when weekDay is specified and day is undefined in cron", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({
        minute: "0/10",
        weekDay: "MON-SUN",
      }),
      minCapacity: 10,
    });

    // THEN
    const warnings = Annotations.fromStack(stack).warnings;
    expect(warnings.length).toBe(0);
  });

  test("throws when both day and weekDay are specified in cron", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    // THEN
    expect(() =>
      asg.scaleOnSchedule("ScaleOutInTheMorning", {
        schedule: autoscaling.Schedule.cron({
          minute: "0/10",
          day: "1",
          weekDay: "MON-SUN",
        }),
        minCapacity: 10,
      }),
    ).toThrow(/Cannot supply both 'day' and 'weekDay', use at most one/);
  });
});

function newStack(): AwsStack {
  const app: App = Testing.app();
  return new AwsStack(app);
}

function makeAutoScalingGroup(scope: Construct) {
  const vpc = new Vpc(scope, "VPC");
  return new autoscaling.AutoScalingGroup(scope, "ASG", {
    vpc,
    instanceType: new InstanceType("t2.micro"),
    machineImage: new AmazonLinuxImage(),
    // Terraform deviation: `updateType: UpdateType.ROLLING_UPDATE` (and the rest of the
    // deprecated CreationPolicy/UpdatePolicy surface) backs CloudFormation-only behavior
    // with no `aws_autoscaling_group` equivalent - omitted, see the Terraform deviation
    // note on `CommonAutoScalingGroupProps` in auto-scaling-group.ts.
  });
}

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/scalable-target.test.ts and the
// sibling test/aws/compute/auto-scaling/warm-pool.test.ts for the harness idiom) -
// guards against emitted-Terraform drift for the aws_autoscaling_schedule resource
// that ScheduledAction creates.
describe("ScheduledAction", () => {
  test("Should synth and match SnapShot with minCapacity only", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutInTheMorning", {
      schedule: autoscaling.Schedule.cron({ hour: "8", minute: "0" }),
      minCapacity: 10,
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with startTime, endTime and timeZone", () => {
    // GIVEN
    const stack = newStack();
    const asg = makeAutoScalingGroup(stack);

    // WHEN
    asg.scaleOnSchedule("ScaleOutAtMiddaySeoul", {
      schedule: autoscaling.Schedule.cron({ hour: "12", minute: "0" }),
      startTime: new Date(Date.UTC(2033, 8, 10, 12, 0, 0)),
      endTime: new Date(Date.UTC(2033, 8, 11, 12, 0, 0)),
      minCapacity: 5,
      maxCapacity: 20,
      desiredCapacity: 12,
      timeZone: "Asia/Seoul",
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
