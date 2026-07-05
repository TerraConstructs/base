// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-elasticloadbalancingv2-targets/test/lambda-target.test.ts

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

describe("lambda targets", () => {
  let app: App;
  let stack: AwsStack;
  let listener: compute.ApplicationListener;
  let fn: compute.LambdaFunction;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });
    listener = lb.addListener("Listener", { port: 80 });

    fn = new compute.LambdaFunction(stack, "Fun", {
      code: compute.Code.fromInline("foo"),
      runtime: compute.Runtime.PYTHON_3_9,
      handler: "index.handler",
    });
  });

  test("Can create target groups with lambda targets", () => {
    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.LambdaTarget(fn)],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      target_type: "lambda",
    });
    t.expect.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_id: stack.resolve(fn.functionArn),
      },
    );
  });

  test("Lambda targets create dependency on Invoke permission", () => {
    // WHEN
    listener.addTargets("Targets", {
      targets: [new targets.LambdaTarget(fn)],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      depends_on: [
        "aws_lambda_permission.Fun_InvokeiP6bR4zK3FgHsi--URVy6DMgqmlO8vYqrrmR37ZRfw_77765659",
      ],
    });
  });
});
