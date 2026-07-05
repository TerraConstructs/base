import {
  lbTargetGroup as tfLbTargetGroup,
  lbTargetGroupAttachment as tfTargetGroupAttachment,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as targets from "../../../../src/aws/compute/lb-targets";
import { Template } from "../../../assertions";

describe("instance targets", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
  });
  test("Can create target groups with instance id target", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.InstanceIdTarget("i-1234")],
      port: 80,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "HTTP",
      target_type: "instance",
    });
    t.expect.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_id: "i-1234",
      },
    );
  });

  test("Can create target groups with instance target", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    const instance = new compute.Instance(stack, "Instance", {
      vpc,
      machineImage: new compute.AmazonLinuxImage(),
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.T3,
        compute.InstanceSize.LARGE,
      ),
    });

    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.InstanceTarget(instance)],
      port: 80,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "HTTP",
      target_type: "instance",
    });
    t.expect.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_id: stack.resolve(instance.instanceId),
      },
    );
  });
});
