// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/listener.test.ts

import {
  lbListener as tfListener,
  lbListenerRule as tfListenerRule,
  lbTargetGroup as tfTargetGroup,
  lbTargetGroupAttachment as tfTargetGroupAttachment,
  securityGroup as tfSecurityGroup,
  lbListenerCertificate as tfListenerCertificate,
  vpcSecurityGroupIngressRule as tfVpcSecurityGroupIngressRule,
  vpcSecurityGroupEgressRule as tfVpcSecurityGroupEgressRule,
} from "@cdktf/provider-aws";
import {
  App,
  TerraformResource,
  TerraformVariable,
  // TerraformElement,
  Testing,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import * as constructs from "constructs";
import { AwsStack } from "../../../../src/aws";
import { Metric } from "../../../../src/aws/cloudwatch";
import * as ec2 from "../../../../src/aws/compute";
import * as acm from "../../../../src/aws/edge";
import * as s3 from "../../../../src/aws/storage";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";
import { FakeSelfRegisteringTarget } from "../lb-helpers";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("tests", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });
  test("Listener guesses protocol from port", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      certificates: [importedCertificate(stack)],
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      protocol: "HTTPS",
    });
  });

  test("Listener guesses port from protocol", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.addListener("Listener", {
      protocol: ec2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      port: 80,
    });
  });

  test("Listener default to open - IPv4", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const loadBalancer = new ec2.ApplicationLoadBalancer(stack, "LB", {
      vpc,
    });

    // WHEN
    loadBalancer.addListener("MyListener", {
      port: 80,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        ingress: [
          expect.objectContaining({
            description: "Allow from anyone on port 80",
            protocol: "tcp",
            cidr_blocks: ["0.0.0.0/0"],
            from_port: 80,
            to_port: 80,
          }),
        ],
      },
    );
  });

  test("Listener default to open - IPv4 and IPv6 (dual stack)", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const loadBalancer = new ec2.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      ipAddressType: ec2.IpAddressType.DUAL_STACK,
    });

    // WHEN
    loadBalancer.addListener("MyListener", {
      port: 80,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        ingress: [
          expect.objectContaining({
            description: "Allow from anyone on port 80",
            protocol: "tcp",
            cidr_blocks: ["0.0.0.0/0"],
            from_port: 80,
            to_port: 80,
          }),
          expect.objectContaining({
            description: "Allow from anyone on port 80",
            protocol: "tcp",
            ipv6_cidr_blocks: ["::/0"],
            from_port: 80,
            to_port: 80,
          }),
        ],
      },
    );
  });

  // TerraConstructs - feature flag always enabled
  test("Listener default to open - IPv6 (dual stack without public IPv4) with feature flag enabled", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const loadBalancer = new ec2.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
      ipAddressType: ec2.IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4,
    });

    // WHEN
    loadBalancer.addListener("MyListener", {
      port: 80,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        ingress: [
          expect.objectContaining({
            description: "Allow from anyone on port 80",
            protocol: "tcp",
            cidr_blocks: ["0.0.0.0/0"],
            from_port: 80,
            to_port: 80,
          }),
          expect.objectContaining({
            description: "Allow from anyone on port 80",
            protocol: "tcp",
            ipv6_cidr_blocks: ["::/0"],
            from_port: 80,
            to_port: 80,
          }),
        ],
      },
    );
  });

  // // TerraConstructs don't have feature flag - always enabled
  // test("Listener default to open - IPv6 (dual stack without public IPv4) with feature flag disabled", () => {
  //   // GIVEN
  //   const app = new cdk.App({
  //     context: {
  //       [cxapi.ALB_DUALSTACK_WITHOUT_PUBLIC_IPV4_SECURITY_GROUP_RULES_DEFAULT]:
  //         false,
  //     },
  //   });
  //   const stack = new cdk.Stack(app);
  //   const vpc = new ec2.Vpc(stack, "Stack");
  //   const loadBalancer = new ec2.ApplicationLoadBalancer(stack, "LB", {
  //     vpc,
  //     internetFacing: true,
  //     ipAddressType: ec2.IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4,
  //   });

  //   // WHEN
  //   loadBalancer.addListener("MyListener", {
  //     port: 80,
  //     defaultTargetGroups: [
  //       new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
  //     ],
  //   });

  //   // THEN
  //   Template.synth(stack).toHaveResourceWithProperties(
  //     tfSecurityGroup.SecurityGroup,
  //     {
  //       SecurityGroupIngress: [
  //         {
  //           Description: "Allow from anyone on port 80",
  //           CidrIp: "0.0.0.0/0",
  //           FromPort: 80,
  //           IpProtocol: "tcp",
  //           ToPort: 80,
  //         },
  //       ],
  //     },
  //   );
  // });

  test("HTTPS listener requires certificate", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    const errors = listener.node.validate();
    expect(errors).toEqual([
      "HTTPS Listener needs at least one certificate (call addCertificates)",
    ]);
  });

  test("HTTPS listener can add certificate after construction", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    listener.addCertificates("Certs", [importedCertificate(stack, "cert")]);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      certificate_arn: "cert",
    });
  });

  test("HTTPS listener can add more than two certificates", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
      certificates: [
        ec2.ListenerCertificate.fromArn("cert1"),
        ec2.ListenerCertificate.fromArn("cert2"),
        ec2.ListenerCertificate.fromArn("cert3"),
      ],
    });

    expect(listener.node.tryFindChild("DefaultCertificates1")).toBeDefined();
    expect(listener.node.tryFindChild("DefaultCertificates2")).toBeDefined();
    expect(
      listener.node.tryFindChild("DefaultCertificates3"),
    ).not.toBeDefined();

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListener.LbListener, {
      certificate_arn: "cert1",
    });

    template.toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert2",
      },
    );

    template.toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert3",
      },
    );
  });

  test("Can configure targetType on TargetGroups", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
      targetType: ec2.TargetType.IP,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        target_type: "ip",
      },
    );
  });

  test("Can configure name on TargetGroups", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
      targetGroupName: "foo",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        name: "foo",
      },
    );
  });

  test("Can add target groups with and without conditions", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });

    // WHEN
    listener.addTargetGroups("Default", {
      targetGroups: [group],
    });
    listener.addTargetGroups("WithPath", {
      priority: 10,
      conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
      targetGroups: [group],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          target_group_arn: stack.resolve(group.targetGroupArn),
          type: "forward",
        },
      ],
    });
    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 10,
      condition: [
        {
          path_pattern: {
            values: ["/hello"],
          },
        },
      ],
      action: [
        {
          target_group_arn: stack.resolve(group.targetGroupArn),
          type: "forward",
        },
      ],
    });
  });

  test("bind is called for all next targets", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });
    const fake = new FakeSelfRegisteringTarget(stack, "FakeTG", vpc);
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
      targets: [fake],
    });

    // WHEN
    listener.addAction("first-action", {
      action: ec2.ListenerAction.authenticateOidc({
        next: ec2.ListenerAction.forward([group]),
        issuer: "dummy",
        clientId: "dummy",
        clientSecret: "dummy", // SecretValue.unsafePlainText("dummy"),
        tokenEndpoint: "dummy",
        userInfoEndpoint: "dummy",
        authorizationEndpoint: "dummy",
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        ip_protocol: "tcp",
        description: "Load balancer to target",
        from_port: 80,
        to_port: 80,
        security_group_id: "${aws_security_group.FakeTG_SG_50E257DF.id}",
        // "Fn::GetAtt": ["FakeTGSG50E257DF", "GroupId"],
        referenced_security_group_id:
          "${aws_security_group.LB_SecurityGroup_8A41EA2B.id}",
        // "Fn::GetAtt": ["LBSecurityGroup8A41EA2B", "GroupId"],
        tags: {
          Name: "Test-SG",
          "grid:EnvironmentName": "Test",
          "grid:UUID": "123e4567-e89b-12d3",
        },
      },
    );
  });

  // deprecated
  test("Can implicitly create target groups with and without conditions", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addTargets("Targets", {
      port: 80,
      targets: [new ec2.InstanceTarget("i-12345")],
    });
    listener.addTargets("WithPath", {
      priority: 10,
      conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
      port: 80,
      targets: [new ec2.InstanceTarget("i-5678")],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          target_group_arn:
            "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
          type: "forward",
        },
      ],
    });
    template.toHaveResourceWithProperties(tfTargetGroup.LbTargetGroup, {
      name: expect.stringContaining("Targets"),
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "HTTP",
      target_type: "instance",
      // Targets: [{ Id: "i-12345" }],
    });
    template.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_group_arn:
          "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
        target_id: "i-12345",
      },
    );
    // conditional rule
    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 10,
      action: [
        {
          target_group_arn:
            "${aws_lb_target_group.LB_Listener_WithPathGroup_E889F9E5.arn}",
          type: "forward",
        },
      ],
      condition: [
        {
          path_pattern: {
            values: ["/hello"],
          },
        },
      ],
    });
    template.toHaveResourceWithProperties(tfTargetGroup.LbTargetGroup, {
      name: expect.stringContaining("Path"),
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "HTTP",
      target_type: "instance",
      // Targets: [{ Id: "i-5678" }],
    });
    template.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_group_arn:
          "${aws_lb_target_group.LB_Listener_WithPathGroup_E889F9E5.arn}",
        target_id: "i-5678",
      },
    );
  });

  // deprecated
  test("Add certificate to constructed listener", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 443 });

    // WHEN
    listener.addCertificates("Certs", [importedCertificate(stack, "cert")]);
    listener.addTargets("Targets", {
      port: 8080,
      targets: [new ec2.IpTarget("1.2.3.4")],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      certificate_arn: "cert",
    });
  });

  test("Add certificate to imported listener", () => {
    // GIVEN
    const stack2 = new AwsStack(app, "TestStack2", {
      environmentName, // TODO: should be different stack for test
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const listener2 = ec2.ApplicationListener.fromApplicationListenerAttributes(
      stack2,
      "Listener",
      {
        listenerArn: "listener-arn",
        defaultPort: 443,
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          stack2,
          "SG",
          "security-group-id",
        ),
      },
    );

    // WHEN
    listener2.addCertificates("Certs", [importedCertificate(stack2, "cert")]);

    // THEN
    Template.synth(stack2).toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert",
      },
    );
  });

  test("Enable alb stickiness for targets", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    const group = listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });
    group.enableCookieStickiness(Duration.hours(1));

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        stickiness: {
          enabled: true,
          type: "lb_cookie",
          cookie_duration: 3600,
        },
      },
    );
  });

  test("Enable app stickiness for targets", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    const group = listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });
    group.enableCookieStickiness(Duration.hours(1), "MyDeliciousCookie");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        stickiness: {
          enabled: true,
          type: "app_cookie",
          cookie_name: "MyDeliciousCookie",
          cookie_duration: 3600,
        },
      },
    );
  });

  test("Enable health check for targets", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    const group = listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });
    group.configureHealthCheck({
      unhealthyThresholdCount: 3,
      timeout: Duration.seconds(30),
      interval: Duration.seconds(60),
      path: "/test",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        health_check: {
          interval: 60,
          path: "/test",
          timeout: 30,
          unhealthy_threshold: 3,
        },
      },
    );
  });

  test("validation error if invalid health check protocol", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    const group = listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });

    group.configureHealthCheck({
      unhealthyThresholdCount: 3,
      timeout: Duration.seconds(30),
      interval: Duration.seconds(60),
      path: "/test",
      protocol: ec2.LbProtocol.TCP,
    });

    // THEN
    const validationErrors: string[] = group.node.validate();
    expect(validationErrors).toEqual([
      "Health check protocol 'TCP' is not supported. Must be one of [HTTP, HTTPS]",
    ]);
  });

  test("adding targets passes in provided protocol version", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [importedCertificate(stack, "arn:someCert")],
    });

    // WHEN
    listener.addTargets("Group", {
      port: 443,
      protocolVersion: ec2.ApplicationProtocolVersion.GRPC,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        protocol_version: "GRPC",
      },
    );
  });

  test("Can call addTargetGroups on imported listener", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const listener = ec2.ApplicationListener.fromApplicationListenerAttributes(
      stack,
      "Listener",
      {
        listenerArn: "ieks",
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          stack,
          "SG",
          "sg-12345",
        ),
      },
    );
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });

    // WHEN
    listener.addTargetGroups("Gruuup", {
      priority: 30,
      conditions: [ec2.ListenerCondition.hostHeaders(["example.com"])],
      targetGroups: [group],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        listener_arn: "ieks",
        priority: 30,
        action: [
          {
            target_group_arn: stack.resolve(group.targetGroupArn),
            type: "forward",
          },
        ],
      },
    );
  });

  test("Can call addTargetGroups on imported listener with conditions prop", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const listener = ec2.ApplicationListener.fromApplicationListenerAttributes(
      stack,
      "Listener",
      {
        listenerArn: "ieks",
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          stack,
          "SG",
          "sg-12345",
        ),
      },
    );
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });

    // WHEN
    listener.addTargetGroups("Gruuup", {
      priority: 30,
      conditions: [ec2.ListenerCondition.hostHeaders(["example.com"])],
      targetGroups: [group],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        listener_arn: "ieks",
        priority: 30,
        action: [
          {
            target_group_arn: stack.resolve(group.targetGroupArn),
            type: "forward",
          },
        ],
      },
    );
  });

  test("Can depend on eventual listener via TargetGroup", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const loadBalancer = new ec2.ApplicationLoadBalancer(
      stack,
      "LoadBalancer",
      { vpc },
    );
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });

    // WHEN
    new ResourceWithLBDependency(stack, "SomeResource", group);

    loadBalancer.addListener("Listener", {
      port: 80,
      defaultTargetGroups: [group],
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        test_resource: {
          SomeResource: {
            depends_on: ["aws_lb_listener.LoadBalancer_Listener_E1A099B9"],
          },
        },
      },
    });
  });

  test("Exercise metrics", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });
    lb.addListener("SomeListener", {
      port: 80,
      defaultTargetGroups: [group],
    });

    // WHEN
    const metrics = new Array<Metric>();
    metrics.push(
      group.metrics.httpCodeTarget(ec2.HttpCodeTarget.TARGET_3XX_COUNT),
    );
    metrics.push(group.metrics.ipv6RequestCount());
    metrics.push(group.metrics.unhealthyHostCount());
    metrics.push(group.metrics.unhealthyHostCount());
    metrics.push(group.metrics.requestCount());
    metrics.push(group.metrics.targetConnectionErrorCount());
    metrics.push(group.metrics.targetResponseTime());
    metrics.push(group.metrics.targetTLSNegotiationErrorCount());

    for (const metric of metrics) {
      expect(metric.namespace).toEqual("AWS/ApplicationELB");
      const loadBalancerArn = "aws_lb_listener.LB_SomeListener_CA01F1A0.arn";

      expect(stack.resolve(metric.dimensions)).toEqual({
        TargetGroup:
          // TODO: is ARN correct here? or should be Name?
          // "Fn::GetAtt": ["TargetGroup3D7CD9B8", "TargetGroupFullName"],
          '${element(split("/", element(split(":", aws_lb_target_group.TargetGroup_3D7CD9B8.arn), 5)), 0)}',
        LoadBalancer: [
          `\${element(split("/", ${loadBalancerArn}), 1)}`,
          `\${element(split("/", ${loadBalancerArn}), 2)}`,
          `\${element(split("/", ${loadBalancerArn}), 3)}`,
        ].join("/"),
      });
    }
  });

  test("Can add dependency on ListenerRule via TargetGroup", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const loadBalancer = new ec2.ApplicationLoadBalancer(
      stack,
      "LoadBalancer",
      { vpc },
    );
    const group1 = new ec2.ApplicationTargetGroup(stack, "TargetGroup1", {
      vpc,
      port: 80,
    });
    const group2 = new ec2.ApplicationTargetGroup(stack, "TargetGroup2", {
      vpc,
      port: 80,
    });
    const listener = loadBalancer.addListener("Listener", {
      port: 80,
      defaultTargetGroups: [group1],
    });

    // WHEN
    new ResourceWithLBDependency(stack, "SomeResource", group2);

    listener.addTargetGroups("SecondGroup", {
      conditions: [ec2.ListenerCondition.pathPatterns(["/bla"])],
      priority: 10,
      targetGroups: [group2],
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        test_resource: {
          SomeResource: {
            depends_on: [
              "aws_lb_listener_rule.LoadBalancer_Listener_SecondGroupRule_F5FDC196",
            ],
          },
        },
      },
    });
  });

  test("Can add fixed responses", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // WHEN
    listener.addAction("Default", {
      action: ec2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not Found",
      }),
    });
    listener.addAction("Hello", {
      action: ec2.ListenerAction.fixedResponse(503, {
        // TODO: Automatically determine content type?
        // * @default - Automatically determined
        // Required in elbv2 - CreateRule - API Call
        // https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_FixedResponseActionConfig.html
        // Optional in CloudFormation resource
        // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-listener-fixedresponseconfig.html#cfn-elasticloadbalancingv2-listener-fixedresponseconfig-contenttype
        contentType: "text/plain",
      }),
      conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
      priority: 10,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          fixed_response: {
            content_type: "text/plain",
            message_body: "Not Found",
            status_code: "404",
          },
          type: "fixed-response",
        },
      ],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        action: [
          {
            fixed_response: {
              content_type: "text/plain", // required for TF
              status_code: "503",
            },
            type: "fixed-response",
          },
        ],
      },
    );
  });

  test("imported listener only need securityGroup and listenerArn as attributes", () => {
    // GIVEN
    const importedListener =
      ec2.ApplicationListener.fromApplicationListenerAttributes(
        stack,
        "listener",
        {
          listenerArn: "listener-arn",
          defaultPort: 443,
          securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
            stack,
            "SG",
            "security-group-id",
            {
              allowAllOutbound: false,
            },
          ),
        },
      );
    importedListener.addAction("Hello", {
      action: ec2.ListenerAction.fixedResponse(503, {
        contentType: "text/plain",
      }),
      conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
      priority: 10,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        listener_arn: "listener-arn",
        priority: 10,
        action: [
          {
            fixed_response: {
              content_type: "text/plain", // required for TF
              status_code: "503",
            },
            type: "fixed-response",
          },
        ],
        condition: [
          {
            path_pattern: {
              values: ["/hello"],
            },
          },
        ],
      },
    );
  });

  test("Can add actions to an imported listener", () => {
    // GIVEN
    const stack2 = new AwsStack(app, "TestStack2", {
      environmentName, // TODO: should be different stack for test
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // WHEN
    listener.addAction("Default", {
      action: ec2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not Found",
      }),
    });

    const importedListener =
      ec2.ApplicationListener.fromApplicationListenerAttributes(
        stack2,
        "listener",
        {
          listenerArn: "listener-arn",
          defaultPort: 443,
          securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
            stack2,
            "SG",
            "security-group-id",
            {
              allowAllOutbound: false,
            },
          ),
        },
      );
    importedListener.addAction("Hello", {
      action: ec2.ListenerAction.fixedResponse(503, {
        contentType: "text/plain",
      }),
      conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
      priority: 10,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          fixed_response: {
            content_type: "text/plain",
            message_body: "Not Found",
            status_code: "404",
          },
          type: "fixed-response",
        },
      ],
    });

    Template.synth(stack2).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        listener_arn: "listener-arn",
        priority: 10,
        action: [
          {
            fixed_response: {
              content_type: "text/plain", // required for TF
              status_code: "503",
            },
            type: "fixed-response",
          },
        ],
      },
    );
  });

  test("actions added to an imported listener must have a priority", () => {
    // GIVE

    const importedListener =
      ec2.ApplicationListener.fromApplicationListenerAttributes(
        stack,
        "listener",
        {
          listenerArn: "listener-arn",
          defaultPort: 443,
          securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
            stack,
            "SG",
            "security-group-id",
            {
              allowAllOutbound: false,
            },
          ),
        },
      );
    expect(() => {
      importedListener.addAction("Hello", {
        action: ec2.ListenerAction.fixedResponse(503, {
          contentType: "text/plain",
        }),
      });
    }).toThrow(
      /priority must be set for actions added to an imported listener/,
    );
  });

  // deprecated
  test("Can add redirect responses", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // WHEN
    listener.addRedirectResponse("Default", {
      statusCode: "HTTP_301",
      port: "443",
      protocol: "HTTPS",
    });
    listener.addRedirectResponse("Hello", {
      priority: 10,
      conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
      path: "/new/#{path}",
      statusCode: "HTTP_302",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      default_action: [
        {
          redirect: {
            port: "443",
            protocol: "HTTPS",
            status_code: "HTTP_301",
          },
          type: "redirect",
        },
      ],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        action: [
          {
            redirect: {
              path: "/new/#{path}",
              status_code: "HTTP_302",
            },
            type: "redirect",
          },
        ],
      },
    );
  });

  test("Can add simple redirect responses", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });

    // WHEN
    lb.addRedirect();

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      port: 80,
      protocol: "HTTP",
      default_action: [
        {
          redirect: {
            port: "443",
            protocol: "HTTPS",
            status_code: "HTTP_301",
          },
          type: "redirect",
        },
      ],
    });
  });

  test("Can supress default ingress rules on a simple redirect response", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    const loadBalancer = new ec2.ApplicationLoadBalancer(stack, "LB", {
      vpc,
    });

    // WHEN
    loadBalancer.addRedirect({ open: false });

    // THEN
    const template = new Template(stack);
    // expect(Object.keys(matchingGroups).length).toBe(0);
    template.resourceTypeArrayNotContaining(tfSecurityGroup.SecurityGroup, [
      expect.objectContaining({
        ingress: [
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow from anyone on port 80",
            protocol: "tcp",
            from_port: 80,
            to_port: 80,
          }),
        ],
      }),
    ]);
  });

  test("Can add simple redirect responses with custom values", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });

    // WHEN
    const listener = lb.addRedirect({
      sourceProtocol: ec2.ApplicationProtocol.HTTPS,
      sourcePort: 8443,
      targetProtocol: ec2.ApplicationProtocol.HTTP,
      targetPort: 8080,
    });
    listener.addCertificates("ListenerCertificateX", [
      importedCertificate(stack, "cert3"),
    ]);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      certificate_arn: "cert3",
      port: 8443,
      protocol: "HTTPS",
      default_action: [
        {
          redirect: {
            port: "8080",
            protocol: "HTTP",
            status_code: "HTTP_301",
          },
          type: "redirect",
        },
      ],
    });
  });

  test("Can configure deregistration_delay for targets", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
      deregistrationDelay: Duration.seconds(30),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        deregistration_delay: "30",
        // TODO: missing stickiness.enabled: false
      },
    );
  });

  test("Custom Load balancer algorithm type", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    // WHEN
    listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
      loadBalancingAlgorithmType:
        ec2.TargetGroupLoadBalancingAlgorithmType.LEAST_OUTSTANDING_REQUESTS,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        load_balancing_algorithm_type: "least_outstanding_requests",
        // TODO: missing stickiness.enabled: false
      },
    );
  });

  // deprecated
  describe("Throws with bad fixed responses", () => {
    // deprecated
    test("status code", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
        vpc,
      });
      const listener = lb.addListener("Listener", {
        port: 80,
      });

      // THEN
      expect(() =>
        listener.addFixedResponse("Default", {
          statusCode: "301",
        }),
      ).toThrow(/`statusCode`/);
    });

    // deprecated
    test("message body", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
        vpc,
      });
      const listener = lb.addListener("Listener", {
        port: 80,
      });

      // THEN
      expect(() =>
        listener.addFixedResponse("Default", {
          messageBody: "a".repeat(1025),
          statusCode: "500",
        }),
      ).toThrow(/`messageBody`/);
    });
  });

  // deprecated
  describe("Throws with bad redirect responses", () => {
    // deprecated
    test("status code", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
        vpc,
      });
      const listener = lb.addListener("Listener", {
        port: 80,
      });

      // THEN
      expect(() =>
        listener.addRedirectResponse("Default", {
          statusCode: "301",
        }),
      ).toThrow(/`statusCode`/);
    });

    // deprecated
    test("protocol", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
        vpc,
      });
      const listener = lb.addListener("Listener", {
        port: 80,
      });

      // THEN
      expect(() =>
        listener.addRedirectResponse("Default", {
          protocol: "tcp",
          statusCode: "HTTP_301",
        }),
      ).toThrow(/`protocol`/);
    });
  });

  test("Throws when specifying both target groups and an action", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // THEN
    expect(
      () =>
        new ec2.ApplicationListenerRule(stack, "Rule", {
          action: ec2.ListenerAction.fixedResponse(500, {
            contentType: "text/plain",
          }),
          listener,
          priority: 10,
          conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
          targetGroups: [
            new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
              vpc,
              port: 80,
            }),
          ],
        }),
    ).toThrow(/'action,targetGroups'.*/);
  });

  test("Throws when specifying priority 0", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // THEN
    expect(
      () =>
        new ec2.ApplicationListenerRule(stack, "Rule", {
          action: ec2.ListenerAction.fixedResponse(500, {
            contentType: "text/plain",
          }),
          listener,
          priority: 0,
          conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
        }),
    ).toThrow("Priority must have value greater than or equal to 1");
  });

  test("Accepts unresolved priority", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // THEN
    expect(
      () =>
        new ec2.ApplicationListenerRule(stack, "Rule", {
          listener,
          priority: new TerraformVariable(stack, "PriorityParam", {
            type: "Number",
          }).numberValue,
          conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
          fixedResponse: {
            statusCode: "500",
          },
        }),
    ).not.toThrow("Priority must have value greater than or equal to 1");
  });

  // deprecated
  test("Throws when specifying both target groups and redirect response", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "VPC");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LoadBalancer", {
      vpc,
    });
    const listener = lb.addListener("Listener", {
      port: 80,
    });

    // THEN
    expect(
      () =>
        new ec2.ApplicationListenerRule(stack, "Rule", {
          listener,
          priority: 10,
          conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
          targetGroups: [
            new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
              vpc,
              port: 80,
            }),
          ],
          redirectResponse: {
            statusCode: "HTTP_301",
          },
        }),
    ).toThrow(/'targetGroups,redirectResponse'.*/);

    expect(
      () =>
        new ec2.ApplicationListenerRule(stack, "Rule2", {
          listener,
          priority: 10,
          conditions: [ec2.ListenerCondition.pathPatterns(["/hello"])],
          targetGroups: [
            new ec2.ApplicationTargetGroup(stack, "TargetGroup2", {
              vpc,
              port: 80,
            }),
          ],
          fixedResponse: {
            statusCode: "500",
          },
          redirectResponse: {
            statusCode: "HTTP_301",
          },
        }),
    ).toThrow(/'targetGroups,fixedResponse,redirectResponse'.*/);
  });

  test("Imported listener with imported security group and allowAllOutbound set to false", () => {
    // GIVEN
    const listener = ec2.ApplicationListener.fromApplicationListenerAttributes(
      stack,
      "Listener",
      {
        listenerArn: "listener-arn",
        defaultPort: 443,
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          stack,
          "SG",
          "security-group-id",
          {
            allowAllOutbound: false,
          },
        ),
      },
    );

    // WHEN
    listener.connections.allowToAnyIpv4(ec2.Port.tcp(443));

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        security_group_id: "security-group-id",
        description: "to 0.0.0.0/0:443",
      },
    );
  });

  test("Can pass multiple certificate arns to application listener constructor", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      certificates: [
        importedCertificate(stack, "cert1"),
        importedCertificate(stack, "cert2"),
      ],
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      certificate_arn: "cert1",
      protocol: "HTTPS",
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert2",
      },
    );
  });

  test("Can use certificate wrapper class", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      certificates: [
        ec2.ListenerCertificate.fromArn("cert1"),
        ec2.ListenerCertificate.fromArn("cert2"),
      ],
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfListener.LbListener, {
      certificate_arn: "cert1",
      protocol: "HTTPS",
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert2",
      },
    );
  });

  // deprecated
  test("Can add additional certificates via addCertificateArns to application listener", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificateArns: ["cert1", "cert2"],
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    listener.addCertificateArns("ListenerCertificateX", ["cert3"]);

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListener.LbListener, {
      protocol: "HTTPS",
    });

    template.toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert2",
      },
    );

    template.toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: "cert3",
      },
    );
  });

  test("Can add multiple path patterns to listener rule", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [
        importedCertificate(stack, "cert1"),
        importedCertificate(stack, "cert2"),
      ],
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    listener.addTargets("Target1", {
      priority: 10,
      conditions: [
        ec2.ListenerCondition.pathPatterns(["/test/path/1", "/test/path/2"]),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        priority: 10,
        condition: [
          {
            path_pattern: {
              values: ["/test/path/1", "/test/path/2"],
            },
          },
        ],
      },
    );
  });

  // deprecated
  test("Cannot add pathPattern and pathPatterns to listener rule", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [
        importedCertificate(stack, "cert1"),
        importedCertificate(stack, "cert2"),
      ],
      defaultTargetGroups: [
        new ec2.ApplicationTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    expect(() =>
      listener.addTargets("Target1", {
        priority: 10,
        pathPatterns: ["/test/path/1", "/test/path/2"],
        pathPattern: "/test/path/3",
      }),
    ).toThrow(
      "Both `pathPatterns` and `pathPattern` are specified, specify only one",
    );
  });

  test("Add additional condition to listener rule", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const group1 = new ec2.ApplicationTargetGroup(stack, "Group1", {
      vpc,
      port: 80,
    });
    const group2 = new ec2.ApplicationTargetGroup(stack, "Group2", {
      vpc,
      port: 81,
      protocol: ec2.ApplicationProtocol.HTTP,
    });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [importedCertificate(stack, "cert1")],
      defaultTargetGroups: [group2],
    });
    listener.addTargetGroups("TargetGroup1", {
      priority: 10,
      conditions: [
        ec2.ListenerCondition.hostHeaders(["app.test"]),
        ec2.ListenerCondition.httpHeader("Accept", [
          "application/vnd.myapp.v2+json",
        ]),
      ],
      targetGroups: [group1],
    });
    listener.addTargetGroups("TargetGroup2", {
      priority: 20,
      conditions: [ec2.ListenerCondition.hostHeaders(["app.test"])],
      targetGroups: [group2],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 10,
      condition: [
        {
          host_header: {
            values: ["app.test"],
          },
        },
        {
          http_header: {
            http_header_name: "Accept",
            values: ["application/vnd.myapp.v2+json"],
          },
        },
      ],
    });

    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 20,
      condition: [
        {
          host_header: {
            values: ["app.test"],
          },
        },
      ],
    });
  });

  test("Add multiple additonal condition to listener rule", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const group1 = new ec2.ApplicationTargetGroup(stack, "Group1", {
      vpc,
      port: 80,
    });
    const group2 = new ec2.ApplicationTargetGroup(stack, "Group2", {
      vpc,
      port: 81,
      protocol: ec2.ApplicationProtocol.HTTP,
    });
    const group3 = new ec2.ApplicationTargetGroup(stack, "Group3", {
      vpc,
      port: 82,
      protocol: ec2.ApplicationProtocol.HTTP,
    });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [importedCertificate(stack, "cert1")],
      defaultTargetGroups: [group3],
    });
    listener.addTargetGroups("TargetGroup1", {
      priority: 10,
      conditions: [
        ec2.ListenerCondition.hostHeaders(["app.test"]),
        ec2.ListenerCondition.sourceIps(["192.0.2.0/24"]),
        ec2.ListenerCondition.queryStrings([
          { key: "version", value: "2" },
          { value: "foo*" },
        ]),
      ],
      targetGroups: [group1],
    });
    listener.addTargetGroups("TargetGroup2", {
      priority: 20,
      conditions: [
        ec2.ListenerCondition.hostHeaders(["app.test"]),
        ec2.ListenerCondition.httpHeader("Accept", [
          "application/vnd.myapp.v2+json",
        ]),
      ],
      targetGroups: [group1],
    });
    listener.addTargetGroups("TargetGroup3", {
      priority: 30,
      conditions: [
        ec2.ListenerCondition.hostHeaders(["app.test"]),
        ec2.ListenerCondition.httpRequestMethods([
          "PUT",
          "COPY",
          "LOCK",
          "MKCOL",
          "MOVE",
          "PROPFIND",
          "PROPPATCH",
          "UNLOCK",
        ]),
      ],
      targetGroups: [group2],
    });
    listener.addTargetGroups("TargetGroup4", {
      priority: 40,
      conditions: [ec2.ListenerCondition.hostHeaders(["app.test"])],
      targetGroups: [group3],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 10,
      condition: [
        {
          host_header: {
            values: ["app.test"],
          },
        },
        {
          source_ip: {
            values: ["192.0.2.0/24"],
          },
        },
        {
          query_string: [
            {
              key: "version",
              value: "2",
            },
            {
              value: "foo*",
            },
          ],
        },
      ],
    });

    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 20,
      condition: [
        {
          host_header: {
            values: ["app.test"],
          },
        },
        {
          http_header: {
            http_header_name: "Accept",
            values: ["application/vnd.myapp.v2+json"],
          },
        },
      ],
    });

    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 30,
      condition: [
        {
          host_header: {
            values: ["app.test"],
          },
        },
        {
          http_request_method: {
            values: [
              "PUT",
              "COPY",
              "LOCK",
              "MKCOL",
              "MOVE",
              "PROPFIND",
              "PROPPATCH",
              "UNLOCK",
            ],
          },
        },
      ],
    });

    template.toHaveResourceWithProperties(tfListenerRule.LbListenerRule, {
      priority: 40,
      condition: [
        {
          host_header: {
            values: ["app.test"],
          },
        },
      ],
    });
  });

  // deprecated
  test("Can exist together legacy style conditions and modern style conditions", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const group1 = new ec2.ApplicationTargetGroup(stack, "Group1", {
      vpc,
      port: 80,
    });
    const group2 = new ec2.ApplicationTargetGroup(stack, "Group2", {
      vpc,
      port: 81,
      protocol: ec2.ApplicationProtocol.HTTP,
    });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [importedCertificate(stack, "cert1")],
      defaultTargetGroups: [group2],
    });
    listener.addTargetGroups("TargetGroup1", {
      hostHeader: "app.test",
      pathPattern: "/test",
      conditions: [ec2.ListenerCondition.sourceIps(["192.0.2.0/24"])],
      priority: 10,
      targetGroups: [group1],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        priority: 10,
        condition: [
          {
            host_header: {
              values: ["app.test"],
            },
          },
          {
            path_pattern: {
              values: ["/test"],
            },
          },
          {
            source_ip: {
              values: ["192.0.2.0/24"],
            },
          },
        ],
      },
    );
  });

  test("Add condition to imported application listener", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });
    const listener = ec2.ApplicationListener.fromApplicationListenerAttributes(
      stack,
      "Listener",
      {
        listenerArn: "listener-arn",
        defaultPort: 443,
        securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
          stack,
          "SG",
          "security-group-id",
        ),
      },
    );

    // WHEN
    listener.addTargetGroups("OtherTG", {
      targetGroups: [group],
      priority: 1,
      conditions: [ec2.ListenerCondition.pathPatterns(["/path1", "/path2"])],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfListenerRule.LbListenerRule,
      {
        priority: 1,
        condition: [
          {
            path_pattern: {
              values: ["/path1", "/path2"],
            },
          },
        ],
      },
    );
  });

  // deprecated
  test("not allowed to combine action specifiers when instantiating a Rule directly", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 80 });

    const baseProps = {
      listener,
      priority: 1,
      pathPatterns: ["/path1", "/path2"],
    };

    // WHEN
    expect(() => {
      new ec2.ApplicationListenerRule(stack, "Rule1", {
        ...baseProps,
        fixedResponse: { statusCode: "200" },
        action: ec2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
        }),
      });
    }).toThrow(/specify only one/);

    expect(() => {
      new ec2.ApplicationListenerRule(stack, "Rule2", {
        ...baseProps,
        targetGroups: [group],
        action: ec2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
        }),
      });
    }).toThrow(/specify only one/);
  });

  test("not allowed to specify defaultTargetGroups and defaultAction together", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const group = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });
    const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    expect(() => {
      lb.addListener("Listener1", {
        port: 80,
        defaultTargetGroups: [group],
        defaultAction: ec2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
        }),
      });
    }).toThrow(/Specify at most one/);
  });

  // TODO: Add support for Grid Loookup
  // describe("Rule suffix for logicalId", () => {
  //   const identifierToken = "SuperMagicToken";
  //   interface TestCase {
  //     readonly removeSuffix?: boolean;
  //     readonly expectedLogicalId: string;
  //   }
  //   const nonDefaultTestCases: TestCase[] = [
  //     { removeSuffix: true, expectedLogicalId: identifierToken },
  //     { removeSuffix: false, expectedLogicalId: identifierToken + "Rule" },
  //   ];
  //   test.each<TestCase>([
  //     // Default is consistent, which means it has the `Rule` suffix. This means no change from legacy behavior
  //     { removeSuffix: undefined, expectedLogicalId: identifierToken + "Rule" },
  //     ...nonDefaultTestCases,
  //   ])("addAction %s", ({ removeSuffix, expectedLogicalId }) => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     const stack = new cdk.Stack(app, "TestStack", {
  //       env: { account: "123456789012", region: "us-east-1" },
  //     });
  //     const vpc = new ec2.Vpc(stack, "Stack");
  //     const targetGroup = new ec2.ApplicationTargetGroup(stack, "TargetGroup", {
  //       vpc,
  //       port: 80,
  //     });
  //     const listener = ec2.ApplicationListener.fromLookup(stack, "a", {
  //       loadBalancerTags: {
  //         some: "tag",
  //       },
  //     });

  //     // WHEN
  //     listener.addAction(identifierToken, {
  //       action: ec2.ListenerAction.weightedForward([
  //         { targetGroup, weight: 1 },
  //       ]),
  //       conditions: [ec2.ListenerCondition.pathPatterns(["/fake"])],
  //       priority: 42,
  //       removeSuffix,
  //     });

  //     // THEN
  //     const applicationListenerRule = listener.node.children.find((v) =>
  //       v.hasOwnProperty("conditions"),
  //     );
  //     expect(applicationListenerRule).toBeDefined();
  //     expect(applicationListenerRule!.node.id).toBe(expectedLogicalId);
  //   });
  // });

  // describe("lookup", () => {
  // TODO: Add support for Grid Loookup
  // test("Can look up an ApplicationListener", () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, "stack", {
  //     env: {
  //       account: "123456789012",
  //       region: "us-west-2",
  //     },
  //   });
  //   // WHEN
  //   const listener = ec2.ApplicationListener.fromLookup(stack, "a", {
  //     loadBalancerTags: {
  //       some: "tag",
  //     },
  //   });
  //   // THEN
  //   Template.fromStack(stack).resourceCountIs(tfListener.LbListener, 0);
  //   expect(listener.listenerArn).toEqual(
  //     "arn:aws:elasticloadbalancing:us-west-2:123456789012:listener/application/my-load-balancer/50dc6c495c0c9188/f2f7dc8efc522ab2",
  //   );
  //   expect(listener.connections.securityGroups[0].securityGroupId).toEqual(
  //     "sg-12345678",
  //   );
  // });
  // // TODO: Add support for Grid Loookup
  // test("Can add rules to a looked-up ApplicationListener", () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack = new cdk.Stack(app, "stack", {
  //     env: {
  //       account: "123456789012",
  //       region: "us-west-2",
  //     },
  //   });
  //   const listener = ec2.ApplicationListener.fromLookup(stack, "a", {
  //     loadBalancerTags: {
  //       some: "tag",
  //     },
  //   });
  //   // WHEN
  //   new ec2.ApplicationListenerRule(stack, "rule", {
  //     listener,
  //     conditions: [ec2.ListenerCondition.hostHeaders(["example.com"])],
  //     action: ec2.ListenerAction.fixedResponse(200, {
  //       contentType: "text/plain",
  //     }),
  //     priority: 5,
  //   });
  //   // THEN
  //   Template.synth(stack).toHaveResourceWithProperties(
  //     tfListenerRule.LbListenerRule,
  //     {
  //       Priority: 5,
  //     },
  //   );
  // });
  // // TODO: Add support for Grid Loookup
  //   test("Can add certificates to a looked-up ApplicationListener", () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     const stack = new cdk.Stack(app, "stack", {
  //       env: {
  //         account: "123456789012",
  //         region: "us-west-2",
  //       },
  //     });
  //     const listener = ec2.ApplicationListener.fromLookup(stack, "a", {
  //       loadBalancerTags: {
  //         some: "tag",
  //       },
  //     });
  //     // WHEN
  //     listener.addCertificates("certs", [
  //       importedCertificate(stack, "arn:something"),
  //     ]);
  //     // THEN
  //     Template.synth(stack).toHaveResourceWithProperties(
  //       tfListenerCertificate.LbListenerCertificate,
  //       {
  //         Certificates: [{ CertificateArn: "arn:something" }],
  //       },
  //     );
  //   });
  // });

  describe("weighted_random algorithm test", () => {
    test("Can add targets with weight_random algorithm and anomaly mitigation enabled", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
      const listener = lb.addListener("Listener", { port: 80 });

      // WHEN
      listener.addTargets("Group", {
        port: 80,
        targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
        loadBalancingAlgorithmType:
          ec2.TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM,
        enableAnomalyMitigation: true,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfTargetGroup.LbTargetGroup,
        {
          load_balancing_algorithm_type: "weighted_random",
          load_balancing_anomaly_mitigation: "on",
          // TODO: missing stickiness.enabled: false
        },
      );
    });

    test("Can add targets with weight_random algorithm and anomaly mitigation disabled", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
      const listener = lb.addListener("Listener", { port: 80 });

      // WHEN
      listener.addTargets("Group", {
        port: 80,
        targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
        loadBalancingAlgorithmType:
          ec2.TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM,
        enableAnomalyMitigation: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfTargetGroup.LbTargetGroup,
        {
          load_balancing_algorithm_type: "weighted_random",
          load_balancing_anomaly_mitigation: "off",
          // TODO: missing stickiness.enabled: false
        },
      );
    });

    test("Throws an error when adding targets with weight_random algorithm and slow start setting enabled.", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
      const listener = lb.addListener("Listener", { port: 80 });

      // WHEN
      expect(() =>
        listener.addTargets("Group", {
          port: 80,
          targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
          loadBalancingAlgorithmType:
            ec2.TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM,
          slowStart: Duration.seconds(60),
        }),
      ).toThrow(
        "The weighted random routing algorithm can not be used with slow start mode.",
      );
    });

    test("Throws an error when adding targets with anomaly mitigation enabled and an algorithm other than weight_random.", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
      const listener = lb.addListener("Listener", { port: 80 });

      // WHEN
      expect(() =>
        listener.addTargets("Group", {
          port: 80,
          targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
          loadBalancingAlgorithmType:
            ec2.TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
          enableAnomalyMitigation: true,
        }),
      ).toThrow(
        "Anomaly mitigation is only available when `loadBalancingAlgorithmType` is `TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM`.",
      );
    });
  });

  describe("Mutual Authentication", () => {
    test("Mutual Authentication settings with all properties when mutualAuthenticationMode is verify", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "Stack");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
      const bucket = new s3.Bucket(stack, "Bucket");

      const trustStore = new ec2.TrustStore(stack, "TrustStore", {
        bucket,
        key: "dummy.pem",
      });

      // WHEN
      lb.addListener("Listener", {
        protocol: ec2.ApplicationProtocol.HTTPS,
        certificates: [importedCertificate(stack)],
        mutualAuthentication: {
          ignoreClientCertificateExpiry: true,
          mutualAuthenticationMode: ec2.MutualAuthenticationMode.VERIFY,
          trustStore,
        },
        defaultAction: ec2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
          messageBody: "Success mTLS",
        }),
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfListener.LbListener,
        {
          mutual_authentication: {
            ignore_client_certificate_expiry: true,
            mode: "verify",
            trust_store_arn: stack.resolve(trustStore.trustStoreArn),
          },
        },
      );
    });

    test.each([
      ec2.MutualAuthenticationMode.OFF,
      ec2.MutualAuthenticationMode.PASS_THROUGH,
    ])(
      "Mutual Authentication settings with all properties when mutualAuthenticationMode is %s",
      (mutualAuthenticationMode) => {
        // GIVEN
        const vpc = new ec2.Vpc(stack, "Stack");
        const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

        // WHEN
        lb.addListener("Listener", {
          protocol: ec2.ApplicationProtocol.HTTPS,
          certificates: [importedCertificate(stack)],
          mutualAuthentication: {
            mutualAuthenticationMode,
          },
          defaultAction: ec2.ListenerAction.fixedResponse(200, {
            contentType: "text/plain",
            messageBody: "Success mTLS",
          }),
        });

        // THEN
        Template.synth(stack).toHaveResourceWithProperties(
          tfListener.LbListener,
          {
            mutual_authentication: {
              mode: mutualAuthenticationMode,
            },
          },
        );
      },
    );

    test("Mutual Authentication settings without all properties", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "Stack");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

      // WHEN
      lb.addListener("Listener", {
        protocol: ec2.ApplicationProtocol.HTTPS,
        certificates: [importedCertificate(stack)],
        mutualAuthentication: {},
        defaultAction: ec2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
          messageBody: "Success mTLS",
        }),
      });

      // THEN
      Template.synth(stack).not.toHaveResourceWithProperties(
        tfListener.LbListener,
        {
          mutual_authentication: expect.anything(),
        },
      );
    });

    test("Throw an error when mode is verify without TrustStore", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "Stack");
      const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

      // WHEN
      expect(() => {
        lb.addListener("Listener", {
          protocol: ec2.ApplicationProtocol.HTTPS,
          certificates: [importedCertificate(stack)],
          mutualAuthentication: {
            ignoreClientCertificateExpiry: true,
            mutualAuthenticationMode: ec2.MutualAuthenticationMode.VERIFY,
          },
          defaultAction: ec2.ListenerAction.fixedResponse(200, {
            contentType: "text/plain",
            messageBody: "Success mTLS",
          }),
        });
      }).toThrow("You must set 'trustStore' when 'mode' is 'verify'");
    });

    test.each([
      ec2.MutualAuthenticationMode.OFF,
      ec2.MutualAuthenticationMode.PASS_THROUGH,
    ])(
      "Throw an error when mode is %s with trustStore",
      (mutualAuthenticationMode) => {
        // GIVEN
        const vpc = new ec2.Vpc(stack, "Stack");
        const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });
        const bucket = new s3.Bucket(stack, "Bucket");

        const trustStore = new ec2.TrustStore(stack, "TrustStore", {
          bucket,
          key: "dummy.pem",
        });

        // WHEN
        expect(() => {
          lb.addListener("Listener", {
            protocol: ec2.ApplicationProtocol.HTTPS,
            certificates: [importedCertificate(stack)],
            mutualAuthentication: {
              mutualAuthenticationMode,
              trustStore,
            },
            defaultAction: ec2.ListenerAction.fixedResponse(200, {
              contentType: "text/plain",
              messageBody: "Success mTLS",
            }),
          });
        }).toThrow(
          "You cannot set 'trustStore' when 'mode' is 'off' or 'passthrough'",
        );
      },
    );

    test.each([
      ec2.MutualAuthenticationMode.OFF,
      ec2.MutualAuthenticationMode.PASS_THROUGH,
    ])(
      "Throw an error when mode is %s with ignoreClientCertificateExpiry",
      (mutualAuthenticationMode) => {
        // GIVEN
        const vpc = new ec2.Vpc(stack, "Stack");
        const lb = new ec2.ApplicationLoadBalancer(stack, "LB", { vpc });

        // WHEN
        expect(() => {
          lb.addListener("Listener", {
            protocol: ec2.ApplicationProtocol.HTTPS,
            certificates: [importedCertificate(stack)],
            mutualAuthentication: {
              mutualAuthenticationMode,
              ignoreClientCertificateExpiry: true,
            },
            defaultAction: ec2.ListenerAction.fixedResponse(200, {
              contentType: "text/plain",
              messageBody: "Success mTLS",
            }),
          });
        }).toThrow(
          "You cannot set 'ignoreClientCertificateExpiry' when 'mode' is 'off' or 'passthrough'",
        );
      },
    );
  });
});

class ResourceWithLBDependency extends TerraformResource {
  constructor(
    scope: constructs.Construct,
    id: string,
    targetGroup: ec2.ITargetGroup,
  ) {
    super(scope, id, { terraformResourceType: "test_resource" });
    this.node.addDependency(targetGroup.loadBalancerAttached);
  }
}

function importedCertificate(
  stack: AwsStack,
  certificateArn = "arn:aws:certificatemanager:123456789012:testregion:certificate/fd0b8392-3c0e-4704-81b6-8edf8612c852",
) {
  return acm.PublicCertificate.fromCertificateArn(
    stack,
    certificateArn,
    certificateArn,
  );
}
