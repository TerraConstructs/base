// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/security-group.test.ts

import {
  securityGroup as tfSecurityGroup,
  vpcSecurityGroupIngressRule as tfVpcSecurityGroupIngressRule,
  vpcSecurityGroupEgressRule as tfVpcSecurityGroupEgressRule,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { Template } from "../../../assertions";
import { FakeSelfRegisteringTarget } from "../lb-helpers";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("tests", () => {
  test("security groups are automatically opened bidi for default rule", () => {
    // GIVEN
    const fixture = new TestFixture();
    const target = new FakeSelfRegisteringTarget(
      fixture.stack,
      "Target",
      fixture.vpc,
    );

    // WHEN
    fixture.listener.addTargets("TargetGroup", {
      port: 8008,
      targets: [target],
    });

    // THEN
    expectSameStackSGRules(fixture.stack);
  });

  test("security groups are automatically opened bidi for additional rule", () => {
    // GIVEN
    const fixture = new TestFixture();
    const target1 = new FakeSelfRegisteringTarget(
      fixture.stack,
      "DefaultTarget",
      fixture.vpc,
    );
    const target2 = new FakeSelfRegisteringTarget(
      fixture.stack,
      "Target",
      fixture.vpc,
    );

    // WHEN
    fixture.listener.addTargets("TargetGroup1", {
      port: 80,
      targets: [target1],
    });

    fixture.listener.addTargetGroups("Rule", {
      priority: 10,
      conditions: [compute.ListenerCondition.hostHeaders(["example.com"])],
      targetGroups: [
        new compute.ApplicationTargetGroup(fixture.stack, "TargetGroup2", {
          vpc: fixture.vpc,
          port: 8008,
          targets: [target2],
        }),
      ],
    });

    // THEN
    expectSameStackSGRules(fixture.stack);
  });

  test("adding the same targets twice also works", () => {
    // GIVEN
    const fixture = new TestFixture();
    const target = new FakeSelfRegisteringTarget(
      fixture.stack,
      "Target",
      fixture.vpc,
    );

    // WHEN
    const group = new compute.ApplicationTargetGroup(
      fixture.stack,
      "TargetGroup",
      {
        vpc: fixture.vpc,
        port: 8008,
        targets: [target],
      },
    );

    fixture.listener.addTargetGroups("Default", {
      targetGroups: [group],
    });
    fixture.listener.addTargetGroups("WithPath", {
      priority: 10,
      conditions: [compute.ListenerCondition.pathPatterns(["/hello"])],
      targetGroups: [group],
    });

    // THEN
    expectSameStackSGRules(fixture.stack);
  });

  test("same result if target is added to group after assigning to listener", () => {
    // GIVEN
    const fixture = new TestFixture();
    const group = new compute.ApplicationTargetGroup(
      fixture.stack,
      "TargetGroup",
      {
        vpc: fixture.vpc,
        port: 8008,
      },
    );
    fixture.listener.addTargetGroups("Default", {
      targetGroups: [group],
    });

    // WHEN
    const target = new FakeSelfRegisteringTarget(
      fixture.stack,
      "Target",
      fixture.vpc,
    );
    group.addTarget(target);

    // THEN
    expectSameStackSGRules(fixture.stack);
  });

  test("ingress is added to child stack SG instead of parent stack", () => {
    // GIVEN
    const fixture = new TestFixture(true);

    const parentGroup = new compute.ApplicationTargetGroup(
      fixture.stack,
      "TargetGroup",
      {
        vpc: fixture.vpc,
        port: 8008,
        targets: [
          new FakeSelfRegisteringTarget(fixture.stack, "Target", fixture.vpc),
        ],
      },
    );

    // listener requires at least one rule for ParentStack to create
    fixture.listener.addTargetGroups("Default", {
      targetGroups: [parentGroup],
    });

    const childStack = new AwsStack(fixture.app, "childStack", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });

    // WHEN
    const childGroup = new compute.ApplicationTargetGroup(
      childStack,
      "TargetGroup",
      {
        // We're assuming the 2nd VPC is peered to the 1st, or something.
        vpc: fixture.vpc,
        port: 8008,
        targets: [
          new FakeSelfRegisteringTarget(childStack, "Target", fixture.vpc),
        ],
      },
    );

    new compute.ApplicationListenerRule(childStack, "ListenerRule", {
      listener: fixture.listener,
      targetGroups: [childGroup],
      priority: 100,
      conditions: [compute.ListenerCondition.hostHeaders(["www.foo.com"])],
    });

    // THEN
    expectSameStackSGRules(fixture.stack);
    expectedImportedSGRules(childStack);
  });

  test("SG peering works on exported/imported load balancer", () => {
    // GIVEN
    const fixture = new TestFixture(false);
    const stack2 = new AwsStack(fixture.app, "stack2", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });
    const vpc2 = new compute.Vpc(stack2, "VPC");
    const group = new compute.ApplicationTargetGroup(stack2, "TargetGroup", {
      // We're assuming the 2nd VPC is peered to the 1st, or something.
      vpc: vpc2,
      port: 8008,
      targets: [new FakeSelfRegisteringTarget(stack2, "Target", vpc2)],
    });

    // WHEN
    const lb2 =
      compute.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
        stack2,
        "LB",
        {
          loadBalancerArn: fixture.lb.loadBalancerArn,
          securityGroupId:
            fixture.lb.connections.securityGroups[0].securityGroupId,
          securityGroupAllowsAllOutbound: false,
        },
      );
    const listener2 = lb2.addListener("YetAnotherListener", { port: 80 });
    listener2.addTargetGroups("Default", { targetGroups: [group] });

    // THEN
    expectedImportedSGRules(stack2);
  });

  test("SG peering works on exported/imported listener", () => {
    // GIVEN
    const fixture = new TestFixture();
    const stack2 = new AwsStack(fixture.app, "stack2", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });
    const vpc2 = new compute.Vpc(stack2, "VPC");
    const group = new compute.ApplicationTargetGroup(stack2, "TargetGroup", {
      // We're assuming the 2nd VPC is peered to the 1st, or something.
      vpc: vpc2,
      port: 8008,
      targets: [new FakeSelfRegisteringTarget(stack2, "Target", vpc2)],
    });
    fixture.listener.addTargets("default", { port: 80 });

    // WHEN
    const securityGroup = compute.SecurityGroup.fromSecurityGroupId(
      stack2,
      "SecurityGroup",
      fixture.listener.connections.securityGroups[0].securityGroupId,
      { allowAllOutbound: false },
    );
    const listener2 =
      compute.ApplicationListener.fromApplicationListenerAttributes(
        stack2,
        "YetAnotherListener",
        {
          defaultPort: 8008,
          listenerArn: fixture.listener.listenerArn,
          securityGroup,
        },
      );
    listener2.addTargetGroups("Default", {
      // Must be a non-default target
      priority: 10,
      conditions: [compute.ListenerCondition.hostHeaders(["example.com"])],
      targetGroups: [group],
    });

    // THEN
    expectedImportedSGRules(stack2);
  });

  // DEPRECATED
  test("default port peering works on constructed listener", () => {
    // GIVEN
    const fixture = new TestFixture();
    fixture.listener.addTargets("Default", {
      port: 8080,
      targets: [new compute.InstanceTarget("i-12345")],
    });

    // WHEN
    fixture.listener.connections.allowDefaultPortFromAnyIpv4(
      "Open to the world",
    );

    // THEN
    Template.synth(fixture.stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        ingress: [
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Open to the world",
            protocol: "tcp",
            from_port: 80,
            to_port: 80,
          }),
        ],
      },
    );
  });

  test("default port peering works on imported listener", () => {
    // GIVEN
    const stack2 = new AwsStack(Testing.app(), "stack2", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });
    const securityGroup = compute.SecurityGroup.fromSecurityGroupId(
      stack2,
      "SecurityGroup",
      "imported-security-group-id",
    );

    // WHEN
    const listener2 =
      compute.ApplicationListener.fromApplicationListenerAttributes(
        stack2,
        "YetAnotherListener",
        {
          listenerArn: "listener-arn",
          securityGroup,
          defaultPort: 8080,
        },
      );
    listener2.connections.allowDefaultPortFromAnyIpv4("Open to the world");

    // THEN
    Template.synth(stack2).toHaveResourceWithProperties(
      tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        cidr_ipv4: "0.0.0.0/0",
        description: "Open to the world",
        ip_protocol: "tcp",
        from_port: 8080,
        to_port: 8080,
        security_group_id: "imported-security-group-id",
      },
    );
  });
});

const LB_SECURITY_GROUP = "${aws_security_group.LB_SecurityGroup_8A41EA2B.id}";
const IMPORTED_LB_SECURITY_GROUP =
  "${data.terraform_remote_state.cross-stack-reference-input-Stack.outputs.cross-stack-output-aws_security_groupLB_SecurityGroup_8A41EA2Bid}";

function expectSameStackSGRules(stack: AwsStack) {
  expectSGRules(stack, LB_SECURITY_GROUP);
}

function expectedImportedSGRules(stack: AwsStack) {
  expectSGRules(stack, IMPORTED_LB_SECURITY_GROUP);
}

function expectSGRules(stack: AwsStack, lbGroup: string) {
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
    {
      security_group_id: lbGroup,
      ip_protocol: "tcp",
      description: "Load balancer to target",
      referenced_security_group_id:
        "${aws_security_group.Target_SG_DB98152D.id}",
      from_port: 8008,
      to_port: 8008,
    },
  );
  t.expect.toHaveResourceWithProperties(
    tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
    {
      security_group_id: "${aws_security_group.Target_SG_DB98152D.id}",
      ip_protocol: "tcp",
      description: "Load balancer to target",
      referenced_security_group_id: lbGroup,
      from_port: 8008,
      to_port: 8008,
    },
  );
}

class TestFixture {
  public readonly app: App;
  public readonly stack: AwsStack;
  public readonly vpc: compute.Vpc;
  public readonly lb: compute.ApplicationLoadBalancer;
  public readonly _listener: compute.ApplicationListener | undefined;

  constructor(createListener?: boolean) {
    this.app = Testing.app();
    this.stack = new AwsStack(this.app, "Stack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    this.vpc = new compute.Vpc(this.stack, "VPC", {
      maxAzs: 2,
    });
    this.lb = new compute.ApplicationLoadBalancer(this.stack, "LB", {
      vpc: this.vpc,
    });

    createListener = createListener ?? true;
    if (createListener) {
      this._listener = this.lb.addListener("Listener", {
        port: 80,
        open: false,
      });
    }
  }

  public get listener(): compute.ApplicationListener {
    if (this._listener === undefined) {
      throw new Error("Did not create a listener");
    }
    return this._listener;
  }
}
