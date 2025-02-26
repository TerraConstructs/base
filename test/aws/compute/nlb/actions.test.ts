// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/nlb/actions.test.ts

import { lbListener as tfLbListener } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as ec2 from "../../../../src/aws/compute";
import { NetworkListenerAction } from "../../../../src/aws/compute/nlb/network-listener-action";
import { NetworkLoadBalancer } from "../../../../src/aws/compute/nlb/network-load-balancer";
import { NetworkTargetGroup } from "../../../../src/aws/compute/nlb/network-target-group";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let stack: AwsStack;
let group1: NetworkTargetGroup;
let group2: NetworkTargetGroup;
let lb: NetworkLoadBalancer;

beforeEach(() => {
  let app: App;
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  const vpc = new ec2.Vpc(stack, "Stack");
  group1 = new NetworkTargetGroup(stack, "TargetGroup1", {
    vpc,
    port: 80,
  });
  group2 = new NetworkTargetGroup(stack, "TargetGroup2", {
    vpc,
    port: 80,
  });
  lb = new NetworkLoadBalancer(stack, "LB", { vpc });
});

describe("tests", () => {
  test("Forward to multiple targetgroups with an Action and stickiness", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: NetworkListenerAction.forward([group1, group2], {
        stickinessDuration: Duration.hours(1),
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        default_action: [
          {
            forward: {
              stickiness: {
                duration: 3600,
                enabled: true,
              },
              target_group: [
                {
                  arn: stack.resolve(group1.targetGroupArn),
                },
                {
                  arn: stack.resolve(group2.targetGroupArn),
                },
              ],
            },
            type: "forward",
          },
        ],
      },
    );
  });

  test("Weighted forward to multiple targetgroups with an Action", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: NetworkListenerAction.weightedForward(
        [
          { targetGroup: group1, weight: 10 },
          { targetGroup: group2, weight: 50 },
        ],
        {
          stickinessDuration: Duration.hours(1),
        },
      ),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        default_action: [
          {
            forward: {
              stickiness: {
                duration: 3600,
                enabled: true,
              },
              target_group: [
                {
                  arn: stack.resolve(group1.targetGroupArn),
                  weight: 10,
                },
                {
                  arn: stack.resolve(group2.targetGroupArn),
                  weight: 50,
                },
              ],
            },
            type: "forward",
          },
        ],
      },
    );
  });
});
