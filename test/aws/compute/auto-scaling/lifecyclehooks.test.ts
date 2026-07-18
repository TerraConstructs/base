// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/test/lifecyclehooks.test.ts

import {
  autoscalingLifecycleHook,
  dataAwsIamPolicyDocument,
  iamRole,
  iamRolePolicy,
} from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import * as constructs from "constructs";
import { AwsStack } from "../../../../src/aws";
import {
  AmazonLinuxImage,
  InstanceClass,
  InstanceSize,
  InstanceType,
  Vpc,
} from "../../../../src/aws/compute";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import * as iam from "../../../../src/aws/iam";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

describe("lifecycle hooks", () => {
  test("we can add a lifecycle hook with no role and with a notifcationTarget to an ASG", () => {
    // GIVEN
    const stack = newStack();
    const asg = newASG(stack);

    // WHEN
    asg.addLifecycleHook("Transition", {
      notificationTarget: new FakeNotificationTarget(),
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
      defaultResult: autoscaling.DefaultResult.ABANDON,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingLifecycleHook.AutoscalingLifecycleHook,
      {
        lifecycle_transition: "autoscaling:EC2_INSTANCE_LAUNCHING",
        default_result: "ABANDON",
        notification_target_arn: "target:arn",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LifecycleHook', {
    //   LifecycleTransition: 'autoscaling:EC2_INSTANCE_LAUNCHING',
    //   DefaultResult: 'ABANDON',
    //   NotificationTargetARN: 'target:arn',
    // });

    // Lifecycle Hook has a dependency on the policy object
    // (the default Role's DefaultPolicy `aws_iam_role_policy` and the Role
    // itself, propagated by the repo's TerraformDependencyAspect from the
    // construct-level `resource.node.addDependency(this.role)` call in
    // LifecycleHook - see src/aws/compute/auto-scaling/lifecycle-hook.ts)
    Template.synth(stack).toHaveResourceWithProperties(
      autoscalingLifecycleHook.AutoscalingLifecycleHook,
      {
        depends_on: expect.arrayContaining([
          `${iamRolePolicy.IamRolePolicy.tfResourceType}.ASG_LifecycleHookTransition_Role_DefaultPolicy_ResourceRoles0_6443BDAD`,
          `${iamRole.IamRole.tfResourceType}.ASG_LifecycleHookTransition_Role_3AAA6BB7`,
        ]),
      },
    );
    // Template.fromStack(stack).hasResource('AWS::AutoScaling::LifecycleHook', {
    //   DependsOn: [
    //     'ASGLifecycleHookTransitionRoleDefaultPolicy2E50C7DB',
    //     'ASGLifecycleHookTransitionRole3AAA6BB7',
    //   ],
    // });

    // A default role is provided
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [autoscalingServicePrincipal(stack)],
              },
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    //   AssumeRolePolicyDocument: {
    //     Version: '2012-10-17',
    //     Statement: [
    //       {
    //         Action: 'sts:AssumeRole',
    //         Effect: 'Allow',
    //         Principal: {
    //           Service: 'autoscaling.amazonaws.com',
    //         },
    //       },
    //     ],
    //   },
    // });

    // FakeNotificationTarget.bind() was executed
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["action:Work"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Version: '2012-10-17',
    //     Statement: [
    //       {
    //         Action: 'action:Work',
    //         Effect: 'Allow',
    //         Resource: '*',
    //       },
    //     ],
    //   },
    // });
  });
});

test("we can add a lifecycle hook to an ASG with no role and with no notificationTargetArn", () => {
  // GIVEN
  const stack = newStack();
  const asg = newASG(stack);

  // WHEN
  asg.addLifecycleHook("Transition", {
    lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
    defaultResult: autoscaling.DefaultResult.ABANDON,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    autoscalingLifecycleHook.AutoscalingLifecycleHook,
    {
      lifecycle_transition: "autoscaling:EC2_INSTANCE_LAUNCHING",
      default_result: "ABANDON",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LifecycleHook', {
  //   LifecycleTransition: 'autoscaling:EC2_INSTANCE_LAUNCHING',
  //   DefaultResult: 'ABANDON',
  // });

  // A default role is NOT provided
  // (newASG's AutoScalingGroup already creates its own EC2 instance role, so
  // asserting "no aws_iam_role at all" would be wrong - assert instead that no
  // role was created carrying the autoscaling.amazonaws.com assume-role
  // statement that LifecycleHook's default role would have used)
  Template.synth(stack).not.toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          principals: [
            {
              type: "Service",
              identifiers: [autoscalingServicePrincipal(stack)],
            },
          ],
        },
      ],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', Match.not({
  //   AssumeRolePolicyDocument: {
  //     Version: '2012-10-17',
  //     Statement: [
  //       {
  //         Action: 'sts:AssumeRole',
  //         Effect: 'Allow',
  //         Principal: {
  //           Service: 'autoscaling.amazonaws.com',
  //         },
  //       },
  //     ],
  //   },
  // }));

  // FakeNotificationTarget.bind() was NOT executed
  new Template(stack).resourceCountIs(iamRolePolicy.IamRolePolicy, 0);
  // Template.fromStack(stack).resourceCountIs('AWS::IAM::Policy', 0);
});

test("we can add a lifecycle hook to an ASG with a role and with a notificationTargetArn", () => {
  // GIVEN
  const stack = newStack();
  const asg = newASG(stack);
  const myrole = new iam.Role(stack, "MyRole", {
    assumedBy: new iam.ServicePrincipal("custom.role.domain.com"),
  });

  // WHEN
  asg.addLifecycleHook("Transition", {
    lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
    defaultResult: autoscaling.DefaultResult.ABANDON,
    notificationTarget: new FakeNotificationTarget(),
    role: myrole,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    autoscalingLifecycleHook.AutoscalingLifecycleHook,
    {
      notification_target_arn: "target:arn",
      lifecycle_transition: "autoscaling:EC2_INSTANCE_LAUNCHING",
      default_result: "ABANDON",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::AutoScaling::LifecycleHook', {
  //   NotificationTargetARN: 'target:arn',
  //   LifecycleTransition: 'autoscaling:EC2_INSTANCE_LAUNCHING',
  //   DefaultResult: 'ABANDON',
  // });

  // the provided role (myrole), not the default role, is used
  Template.synth(stack).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          principals: [
            {
              type: "Service",
              identifiers: [
                stack.resolve(
                  new iam.ServicePrincipal("custom.role.domain.com")
                    .policyFragment.principals[0].identifiers[0],
                ),
              ],
            },
          ],
        },
      ],
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
  //   AssumeRolePolicyDocument: {
  //     Version: '2012-10-17',
  //     Statement: [
  //       {
  //         Action: 'sts:AssumeRole',
  //         Effect: 'Allow',
  //         Principal: {
  //           Service: 'custom.role.domain.com',
  //         },
  //       },
  //     ],
  //   },
  // });
});

test("adding a lifecycle hook with a role and with no notificationTarget to an ASG throws an error", () => {
  // GIVEN
  const stack = newStack();
  const asg = newASG(stack);
  const myrole = new iam.Role(stack, "MyRole", {
    assumedBy: new iam.ServicePrincipal("custom.role.domain.com"),
  });

  // WHEN
  expect(() => {
    asg.addLifecycleHook("Transition", {
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
      defaultResult: autoscaling.DefaultResult.ABANDON,
      role: myrole,
    });
  }).toThrow(
    /'notificationTarget' parameter required when 'role' parameter is specified/,
  );
});

class FakeNotificationTarget implements autoscaling.ILifecycleHookTarget {
  private createRole(scope: constructs.Construct, _role?: iam.IRole) {
    let role = _role;
    if (!role) {
      role = new iam.Role(scope, "Role", {
        assumedBy: new iam.ServicePrincipal("autoscaling.amazonaws.com"),
      });
    }

    return role;
  }

  public bind(
    _scope: constructs.Construct,
    options: autoscaling.BindHookTargetOptions,
  ): autoscaling.LifecycleHookTargetConfig {
    const role = this.createRole(options.lifecycleHook, options.role);

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["action:Work"],
        resources: ["*"],
      }),
    );

    return { notificationTargetArn: "target:arn", createdRole: role };
  }
}

function newStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app);
}

function newASG(stack: AwsStack) {
  const vpc = new Vpc(stack, "VPC");

  return new autoscaling.AutoScalingGroup(stack, "ASG", {
    vpc,
    instanceType: InstanceType.of(InstanceClass.M4, InstanceSize.MICRO),
    machineImage: new AmazonLinuxImage(),
  });
}

/**
 * The token that `new iam.ServicePrincipal("autoscaling.amazonaws.com")`
 * resolves to (the `aws_service_principal` data source lookup performed by
 * `AwsStack.servicePrincipalName`) - reused by the "default role" assertions
 * above instead of hard-coding the literal string, mirroring how
 * test/aws/iam/role.test.ts asserts service-principal identifiers.
 */
function autoscalingServicePrincipal(stack: AwsStack): string {
  return stack.resolve(
    new iam.ServicePrincipal("autoscaling.amazonaws.com").policyFragment
      .principals[0].identifiers[0],
  );
}

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/scalable-target.test.ts and
// the sibling test/aws/compute/auto-scaling/warm-pool.test.ts for the harness
// idiom) - guards against emitted-Terraform drift for the
// aws_autoscaling_lifecycle_hook resource that LifecycleHook creates.
describe("LifecycleHook", () => {
  test("Should synth and match SnapShot with a notificationTarget and no role", () => {
    // GIVEN
    const stack = newStack();
    const asg = newASG(stack);

    // WHEN
    asg.addLifecycleHook("Transition", {
      notificationTarget: new FakeNotificationTarget(),
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
      defaultResult: autoscaling.DefaultResult.ABANDON,
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Should synth and match SnapShot with a role and a notificationTarget", () => {
    // GIVEN
    const stack = newStack();
    const asg = newASG(stack);
    const myrole = new iam.Role(stack, "MyRole", {
      assumedBy: new iam.ServicePrincipal("custom.role.domain.com"),
    });

    // WHEN
    asg.addLifecycleHook("Transition", {
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
      defaultResult: autoscaling.DefaultResult.ABANDON,
      notificationTarget: new FakeNotificationTarget(),
      role: myrole,
      heartbeatTimeout: Duration.minutes(30),
      notificationMetadata: "some metadata",
      lifecycleHookName: "MyLifecycleHook",
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
