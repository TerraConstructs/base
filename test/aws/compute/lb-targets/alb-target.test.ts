// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2-targets/test/alb-target.test.ts

import {
  lbTargetGroup as tfLbTargetGroup,
  lbTargetGroupAttachment as tfTargetGroupAttachment,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as targets from "../../../../src/aws/compute/lb-targets";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("alb targets", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "IPAMTestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });
  // Deprecated
  test("Can create target groups with alb target", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const alb = new compute.ApplicationLoadBalancer(stack, "ALB", { vpc });
    const nlb = new compute.NetworkLoadBalancer(stack, "NLB", { vpc });
    const listener = nlb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.AlbTarget(alb, 80)],
      port: 80,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "TCP",
      target_type: "alb",
    });
    t.expect.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_id: stack.resolve(alb.loadBalancerArn),
        port: 80,
      },
    );
  });

  test("AlbListener target creates a dependency on the NLB target group and ALB listener", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const alb = new compute.ApplicationLoadBalancer(stack, "ALB", { vpc });
    const albListener = alb.addListener("ALBListener", {
      port: 80,
      defaultAction: compute.ListenerAction.fixedResponse(200),
    });
    const nlb = new compute.NetworkLoadBalancer(stack, "NLB", { vpc });
    const listener = nlb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.AlbListenerTarget(albListener)],
      port: 80,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "TCP",
      target_type: "alb",
    });
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      depends_on: ["aws_lb_listener.ALB_ALBListener_DB80B4FD"],
    });
    t.expect.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_id: stack.resolve(alb.loadBalancerArn),
        port: 80,
      },
    );
  });

  test("Can create target groups with alb arn target", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const nlb = new compute.NetworkLoadBalancer(stack, "NLB", { vpc });
    const listener = nlb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.AlbArnTarget("MOCK_ARN", 80)],
      port: 80,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "TCP",
      target_type: "alb",
    });
    t.expect.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_id: "MOCK_ARN",
        port: 80,
      },
    );
  });
});
