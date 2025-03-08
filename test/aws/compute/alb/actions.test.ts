// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/actions.test.ts

import {
  lbListener as tfListener,
  lbListenerRule as tfListenerRule,
  securityGroup as tfSecurityGroup,
} from "@cdktf/provider-aws";
import {
  App,
  // TerraformElement,
  Testing,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let app: App;
let stack: AwsStack;
let group1: compute.ApplicationTargetGroup;
let group2: compute.ApplicationTargetGroup;
let lb: compute.ApplicationLoadBalancer;
let vpc: compute.Vpc;

beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new compute.Vpc(stack, "Stack");
  group1 = new compute.ApplicationTargetGroup(stack, "TargetGroup1", {
    vpc,
    port: 80,
  });
  group2 = new compute.ApplicationTargetGroup(stack, "TargetGroup2", {
    vpc,
    port: 80,
  });
  lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });
});

describe("tests", () => {
  test("Forward action legacy rendering", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.forward([group1]),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          target_group_arn: stack.resolve(group1.targetGroupArn),
          type: "forward",
        },
      ],
    });
  });

  test("Forward to multiple targetgroups with an Action and stickiness", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.forward([group1, group2], {
        stickinessDuration: Duration.hours(1),
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
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
                weight: 1, // AWSCDK test don't care about the weight
              },
              {
                arn: stack.resolve(group2.targetGroupArn),
                weight: 1, // AWSCDK test don't care about the weight
              },
            ],
          },
          type: "forward",
        },
      ],
    });
  });

  test("Weighted forward to multiple targetgroups with an Action", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.weightedForward(
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
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
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
    });
  });

  test("Chaining OIDC authentication action", () => {
    // WHEN
    const listener = lb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.authenticateOidc({
        authorizationEndpoint: "A",
        clientId: "B",
        clientSecret: "C", //cdk.SecretValue.unsafePlainText("C"),
        issuer: "D",
        tokenEndpoint: "E",
        userInfoEndpoint: "F",
        sessionTimeout: Duration.days(1),
        next: compute.ListenerAction.forward([group1]),
      }),
    });
    listener.addAction("AdditionalOidcAuthenticationAction", {
      priority: 1,
      conditions: [compute.ListenerCondition.pathPatterns(["/page*"])],
      action: compute.ListenerAction.authenticateOidc({
        authorizationEndpoint: "A",
        clientId: "B",
        clientSecret: "C", //cdk.SecretValue.unsafePlainText("C"),
        issuer: "D",
        tokenEndpoint: "E",
        userInfoEndpoint: "F",
        sessionTimeout: Duration.days(1),
        next: compute.ListenerAction.forward([group1]),
      }),
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          authenticate_oidc: {
            authorization_endpoint: "A",
            client_id: "B",
            client_secret: "C",
            issuer: "D",
            session_timeout: 86400,
            token_endpoint: "E",
            user_info_endpoint: "F",
          },
          order: 1,
          type: "authenticate-oidc",
        },
        {
          order: 2,
          target_group_arn: stack.resolve(group1.targetGroupArn),
          type: "forward",
        },
      ],
    });
    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      action: [
        {
          authenticate_oidc: {
            authorization_endpoint: "A",
            client_id: "B",
            client_secret: "C",
            issuer: "D",
            token_endpoint: "E",
            user_info_endpoint: "F",
            // SessionTimeout in Actions is number
            session_timeout: 86400,
          },
          order: 1,
          type: "authenticate-oidc",
        },
        {
          order: 2,
          target_group_arn: stack.resolve(group1.targetGroupArn),
          type: "forward",
        },
      ],
    });
  });

  test("OIDC authentication action allows HTTPS outbound", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.authenticateOidc({
        authorizationEndpoint: "A",
        clientId: "B",
        clientSecret: "C", //cdk.SecretValue.unsafePlainText("C"),
        issuer: "D",
        tokenEndpoint: "E",
        userInfoEndpoint: "F",
        next: compute.ListenerAction.forward([group1]),
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        vpc_id: stack.resolve(vpc.vpcId),
        description:
          "Automatically created Security Group for ELB TestStackLBC7C3DDBD",
        ingress: [
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow from anyone on port 80",
            from_port: 80,
            protocol: "tcp",
            to_port: 80,
          }),
        ],
        egress: [
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow to IdP endpoint",
            from_port: 443,
            protocol: "tcp",
            to_port: 443,
          }),
        ],
      },
    );
  });

  test("OIDC authentication action not allows HTTPS outbound when allowHttpsOutbound is false", () => {
    // WHEN
    lb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.authenticateOidc({
        allowHttpsOutbound: false,
        authorizationEndpoint: "A",
        clientId: "B",
        clientSecret: "C", //cdk.SecretValue.unsafePlainText("C"),
        issuer: "D",
        tokenEndpoint: "E",
        userInfoEndpoint: "F",
        next: compute.ListenerAction.forward([group1]),
      }),
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfSecurityGroup.SecurityGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      description:
        "Automatically created Security Group for ELB TestStackLBC7C3DDBD",
      ingress: [
        expect.objectContaining({
          cidr_blocks: ["0.0.0.0/0"],
          description: "Allow from anyone on port 80",
          from_port: 80,
          protocol: "tcp",
          to_port: 80,
        }),
      ],
    });
    // TF Doesn't need blocking eggress "Disallow all traffic" rule
    // Sufficient to check that there is no egress rule
    template.not.toHaveResourceWithProperties(tfSecurityGroup.SecurityGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      description:
        "Automatically created Security Group for ELB TestStackLBC7C3DDBD",
      egress: expect.anything(),
    });
  });

  test("Add default Action and add Action with conditions", () => {
    // GIVEN
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addAction("Action1", {
      action: compute.ListenerAction.forward([group1]),
    });

    listener.addAction("Action2", {
      conditions: [compute.ListenerCondition.hostHeaders(["example.com"])],
      priority: 10,
      action: compute.ListenerAction.forward([group2]),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        action: [
          {
            target_group_arn: stack.resolve(group2.targetGroupArn),
            type: "forward",
          },
        ],
      },
    );
  });

  test("Add Action with multiple Conditions", () => {
    // GIVEN
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addAction("Action1", {
      action: compute.ListenerAction.forward([group1]),
    });

    listener.addAction("Action2", {
      conditions: [
        compute.ListenerCondition.hostHeaders(["example.com"]),
        compute.ListenerCondition.sourceIps(["1.1.1.1/32"]),
      ],
      priority: 10,
      action: compute.ListenerAction.forward([group2]),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        action: [
          {
            target_group_arn: stack.resolve(group2.targetGroupArn),
            type: "forward",
          },
        ],
        condition: [
          {
            host_header: {
              values: ["example.com"],
            },
          },
          {
            source_ip: {
              values: ["1.1.1.1/32"],
            },
          },
        ],
      },
    );
  });

  test("throw error for invalid path pattern for redirect action", () => {
    // GIVEN
    const listener = lb.addListener("Listener", { port: 80 });

    // THEN
    expect(() => {
      listener.addAction("RedirectAction", {
        action: compute.ListenerAction.redirect({
          protocol: compute.ApplicationProtocol.HTTPS,
          path: "example",
        }),
      });
    }).toThrow("Redirect path must start with a '/', got: example");
  });
});
