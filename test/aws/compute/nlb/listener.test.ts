// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/nlb/listener.test.ts

import {
  lbListener as tfLbListener,
  lbListenerCertificate as tfListenerCertificate,
  lbTargetGroup as tfLbTargetGroup,
  lbTargetGroupAttachment as tfTargetGroupAttachment,
} from "@cdktf/provider-aws";
import { App, Testing, TerraformResource } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { ITargetGroup } from "../../../../src/aws/compute/lb-shared/base-target-group.ts";
import {
  LbProtocol,
  SslPolicy,
  AlpnPolicy,
} from "../../../../src/aws/compute/lb-shared/enums";
import { ListenerCertificate } from "../../../../src/aws/compute/lb-shared/listener-certificate.ts";
import { InstanceTarget } from "../../../../src/aws/compute/lb-shared/load-balancer-targets";
import { NetworkListenerAction } from "../../../../src/aws/compute/nlb/network-listener-action";
import { NetworkListener } from "../../../../src/aws/compute/nlb/network-listener.ts";
import { NetworkLoadBalancer } from "../../../../src/aws/compute/nlb/network-load-balancer";
import { NetworkTargetGroup } from "../../../../src/aws/compute/nlb/network-target-group";
import * as edge from "../../../../src/aws/edge";
import { Duration } from "../../../../src/duration.ts";
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
    stack = new AwsStack(app, "IPAMTestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("Trivial add listener", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        protocol: "TCP",
        port: 443,
      },
    );
  });

  test("Can add target groups", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 443 });
    const group = new NetworkTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });

    // WHEN
    listener.addTargetGroups("Default", group);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        default_action: [
          {
            target_group_arn: stack.resolve(group.targetGroupArn),
            type: "forward",
          },
        ],
      },
    );
  });

  // TODO: AWSCDK Deprecated
  test("Can implicitly create target groups", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 443 });

    // WHEN
    listener.addTargets("Targets", {
      port: 80,
      targets: [new InstanceTarget("i-12345")],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLbListener.LbListener, {
      default_action: [
        {
          target_group_arn:
            "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
          type: "forward",
        },
      ],
    });
    template.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "TCP",
      target_type: "instance",
    });
    template.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_group_arn:
          "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
        target_id: "i-12345",
        // port: 9700,
      },
    );
  });

  // TODO: InstanceTarget is deprecated, Use IpTarget from the compute/lb-targets
  test("implicitly created target group inherits protocol", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", {
      port: 9700,
      protocol: LbProtocol.TCP_UDP,
    });

    // WHEN
    listener.addTargets("Targets", {
      port: 9700,
      targets: [new InstanceTarget("i-12345")],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLbListener.LbListener, {
      default_action: [
        {
          target_group_arn:
            "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
          type: "forward",
        },
      ],
    });
    template.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 9700,
      protocol: "TCP_UDP",
      target_type: "instance",
    });
    template.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_group_arn:
          "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
        target_id: "i-12345",
        // port: 9700,
      },
    );
  });

  // TODO: InstanceTarget is deprecated, Use IpTarget from the compute/lb-targets
  test("implicitly created target group but overrides inherited protocol", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const cert = new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.com",
    });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      protocol: LbProtocol.TLS,
      certificates: [ListenerCertificate.fromCertificateManager(cert)],
      sslPolicy: SslPolicy.TLS12,
    });

    // WHEN
    listener.addTargets("Targets", {
      port: 80,
      protocol: LbProtocol.TCP,
      targets: [new InstanceTarget("i-12345")],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLbListener.LbListener, {
      protocol: "TLS",
      port: 443,
      certificate_arn: "${aws_acm_certificate.Certificate_4E7ABB08.arn}",
      ssl_policy: "ELBSecurityPolicy-TLS-1-2-2017-01",
      default_action: [
        {
          target_group_arn:
            "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
          type: "forward",
        },
      ],
    });
    template.toHaveResourceWithProperties(tfLbTargetGroup.LbTargetGroup, {
      vpc_id: stack.resolve(vpc.vpcId),
      port: 80,
      protocol: "TCP",
      target_type: "instance",
    });
    template.toHaveResourceWithProperties(
      tfTargetGroupAttachment.LbTargetGroupAttachment,
      {
        target_group_arn:
          "${aws_lb_target_group.LB_Listener_TargetsGroup_76EF81E8.arn}",
        target_id: "i-12345",
        // port: 80,
      },
    );
  });

  test("Enable health check for targets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 443 });

    // WHEN
    const group = listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });
    group.configureHealthCheck({
      interval: Duration.seconds(30),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        health_check: {
          interval: 30,
        },
      },
    );
  });

  test("Enable taking a dependency on an NLB target group's load balancer", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("Listener", { port: 443 });
    const group = listener.addTargets("Group", {
      port: 80,
      targets: [new FakeSelfRegisteringTarget(stack, "Target", vpc)],
    });

    // WHEN
    new ResourceWithLBDependency(stack, "MyResource", group);

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        test_resource: {
          MyResource: {
            depends_on: expect.arrayContaining([
              // 2nd dependency is there because of the structure of the construct tree.
              // It does not harm.
              "aws_lb_target_group.LB_Listener_GroupGroup_79B304FF",
              "aws_lb_listener.LB_Listener_49E825B4",
            ]),
          },
        },
      },
    });
  });

  test("Trivial add TLS listener", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const cert = new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.com",
    });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      protocol: LbProtocol.TLS,
      certificates: [ListenerCertificate.fromCertificateManager(cert)],
      sslPolicy: SslPolicy.TLS12,
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        protocol: "TLS",
        port: 443,
        certificate_arn: stack.resolve(cert.certificateArn),
        ssl_policy: "ELBSecurityPolicy-TLS-1-2-2017-01",
      },
    );
  });

  test("Trivial add TLS listener with ALPN", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const cert = new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.com",
    });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      protocol: LbProtocol.TLS,
      alpnPolicy: AlpnPolicy.HTTP2_ONLY,
      certificates: [ListenerCertificate.fromCertificateManager(cert)],
      sslPolicy: SslPolicy.TLS12,
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        protocol: "TLS",
        port: 443,
        alpn_policy: "HTTP2Only",
        certificate_arn: stack.resolve(cert.certificateArn),
        ssl_policy: "ELBSecurityPolicy-TLS-1-2-2017-01",
      },
    );
  });

  test("Incompatible Protocol with ALPN", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    expect(() =>
      lb.addListener("Listener", {
        port: 443,
        protocol: LbProtocol.TCP,
        alpnPolicy: AlpnPolicy.HTTP2_OPTIONAL,
        defaultTargetGroups: [
          new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
        ],
      }),
    ).toThrow(/Protocol must be TLS when alpnPolicy have been specified/);
  });

  test("Invalid Protocol listener", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    expect(() =>
      lb.addListener("Listener", {
        port: 443,
        protocol: LbProtocol.HTTP,
        defaultTargetGroups: [
          new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
        ],
      }),
    ).toThrow(
      /The protocol must be one of TCP, TLS, UDP, TCP_UDP\. Found HTTP/,
    );
  });

  test("Invalid Listener Target Healthcheck Interval", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("PublicListener", { port: 80 });
    const targetGroup = listener.addTargets("ECS", {
      port: 80,
      healthCheck: {
        interval: Duration.seconds(350),
      },
    });

    const validationErrors: string[] = targetGroup.node.validate();
    const intervalError = validationErrors.find((err) =>
      /Health check interval '350' not supported. Must be between/.test(err),
    );
    expect(intervalError).toBeDefined();
  });

  test("validation error if invalid health check protocol", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("PublicListener", { port: 80 });
    const targetGroup = listener.addTargets("ECS", {
      port: 80,
      healthCheck: {
        interval: Duration.seconds(60),
      },
    });

    targetGroup.configureHealthCheck({
      interval: Duration.seconds(30),
      protocol: LbProtocol.UDP,
    });

    // THEN
    const validationErrors: string[] = targetGroup.node.validate();
    expect(validationErrors).toEqual([
      "Health check protocol 'UDP' is not supported. Must be one of [HTTP, HTTPS, TCP]",
    ]);
  });

  test("validation error if invalid path health check protocol", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("PublicListener", { port: 80 });
    const targetGroup = listener.addTargets("ECS", {
      port: 80,
      healthCheck: {
        interval: Duration.seconds(60),
      },
    });

    targetGroup.configureHealthCheck({
      interval: Duration.seconds(30),
      protocol: LbProtocol.TCP,
      path: "/",
    });

    // THEN
    const validationErrors: string[] = targetGroup.node.validate();
    expect(validationErrors).toEqual([
      "'TCP' health checks do not support the path property. Must be one of [HTTP, HTTPS]",
    ]);
  });

  test("validation error if invalid timeout health check", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("PublicListener", { port: 80 });
    const targetGroup = listener.addTargets("ECS", {
      port: 80,
      healthCheck: {
        interval: Duration.seconds(60),
      },
    });

    targetGroup.configureHealthCheck({
      interval: Duration.seconds(150),
      protocol: LbProtocol.HTTP,
      timeout: Duration.seconds(130),
    });

    // THEN
    const validationErrors: string[] = targetGroup.node.validate();
    const timeoutError = validationErrors.find((err) =>
      /Health check timeout '130' not supported. Must be a number between/.test(
        err,
      ),
    );
    expect(timeoutError).toBeDefined();
  });

  test("validation error if Health check timeout is greater than the interval", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = lb.addListener("PublicListener", { port: 80 });
    const targetGroup = listener.addTargets("ECS", {
      port: 80,
      healthCheck: {
        interval: Duration.seconds(60),
      },
    });

    targetGroup.configureHealthCheck({
      interval: Duration.seconds(30),
      protocol: LbProtocol.HTTP,
      timeout: Duration.seconds(40),
    });

    // THEN
    const validationErrors: string[] = targetGroup.node.validate();
    expect(validationErrors).toEqual([
      "Health check interval must be greater than or equal to the timeout; received interval 30, timeout 40.",
    ]);
  });

  test("Protocol & certs TLS listener", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    expect(() =>
      lb.addListener("Listener", {
        port: 443,
        protocol: LbProtocol.TLS,
        defaultTargetGroups: [
          new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
        ],
      }),
    ).toThrow(/When the protocol is set to TLS, you must specify certificates/);
  });

  test("TLS and certs specified listener", () => {
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });
    const cert = new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.com",
    });

    expect(() =>
      lb.addListener("Listener", {
        port: 443,
        protocol: LbProtocol.TCP,
        certificates: [{ certificateArn: cert.certificateArn }],
        defaultTargetGroups: [
          new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
        ],
      }),
    ).toThrow(/Protocol must be TLS when certificates have been specified/);
  });

  test("Can pass multiple certificates to network listener constructor", () => {
    // GIVEN

    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    const cert1 = importedCertificate(stack, "cert1");
    const cert2 = importedCertificate(stack, "cert2");
    // WHEN
    lb.addListener("Listener", {
      port: 443,
      certificates: [cert1, cert2],
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLbListener.LbListener, {
      certificate_arn: stack.resolve(cert1.certificateArn),
      protocol: "TLS",
    });
    template.toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: stack.resolve(cert2.certificateArn),
      },
    );
  });

  test("Can add multiple certificates to network listener after construction", () => {
    // GIVEN

    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const listener = lb.addListener("Listener", {
      port: 443,
      certificates: [importedCertificate(stack, "cert1")],
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
    });

    const cert2 = importedCertificate(stack, "cert2");
    listener.addCertificates("extra", [cert2]);

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLbListener.LbListener, {
      protocol: "TLS",
    });
    template.toHaveResourceWithProperties(
      tfListenerCertificate.LbListenerCertificate,
      {
        certificate_arn: stack.resolve(cert2.certificateArn),
      },
    );
  });

  test("not allowed to specify defaultTargetGroups and defaultAction together", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const group = new NetworkTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    expect(() => {
      lb.addListener("Listener1", {
        port: 80,
        defaultTargetGroups: [group],
        defaultAction: NetworkListenerAction.forward([group]),
      });
    }).toThrow(/Specify at most one/);
  });

  // // TODO: Add Grid Context Provider
  // test("Can look up an NetworkListener", () => {
  //   // GIVEN
  //   // const stack = new cdk.Stack(app, "stack", {
  //   //   env: {
  //   //     account: "123456789012",
  //   //     region: "us-west-2",
  //   //   },
  //   // });

  //   // WHEN
  //   const listener = NetworkListener.fromLookup(stack, "a", {
  //     loadBalancerTags: {
  //       some: "tag",
  //     },
  //   });

  //   // THEN
  //   Template.resources(stack, tfLbListener.LbListener).toHaveLength(0);
  //   expect(listener.listenerArn).toEqual(
  //     "arn:aws:elasticloadbalancing:us-west-2:123456789012:listener/network/my-load-balancer/50dc6c495c0c9188/f2f7dc8efc522ab2",
  //   );
  // });

  test("Create Listener with TCP idle timeout", () => {
    // GIVEN

    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    new NetworkListener(stack, "Listener", {
      loadBalancer: lb,
      port: 443,
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
      tcpIdleTimeout: Duration.seconds(100),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        protocol: "TCP",
        port: 443,
        tcp_idle_timeout_seconds: 100,
      },
    );
  });

  test("Add Listener with TCP idle timeout", () => {
    // GIVEN

    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.addListener("Listener", {
      port: 443,
      defaultTargetGroups: [
        new NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
      ],
      tcpIdleTimeout: Duration.seconds(100),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbListener.LbListener,
      {
        protocol: "TCP",
        port: 443,
        tcp_idle_timeout_seconds: 100,
      },
    );
  });

  test("throws when tcpIdleTimeout is set with UDP.", () => {
    // GIVEN

    const vpc = new compute.Vpc(stack, "Stack");
    const group = new NetworkTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
      protocol: LbProtocol.UDP,
    });
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    expect(() => {
      lb.addListener("Listener1", {
        port: 80,
        defaultAction: NetworkListenerAction.forward([group]),
        tcpIdleTimeout: Duration.seconds(100),
        protocol: LbProtocol.UDP,
      });
    }).toThrow(
      "`tcpIdleTimeout` cannot be set when `protocol` is `Protocol.UDP`.",
    );
  });

  test("throws when tcpIdleTimeout is smaller than 1 second.", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const group = new NetworkTargetGroup(stack, "TargetGroup", {
      vpc,
      port: 80,
    });
    const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    expect(() => {
      lb.addListener("Listener1", {
        port: 80,
        defaultAction: NetworkListenerAction.forward([group]),
        tcpIdleTimeout: Duration.millis(1),
      });
    }).toThrow(
      "`tcpIdleTimeout` must be between 60 and 6000 seconds, got 1 milliseconds.",
    );
  });

  test.each([1, 10000])(
    "throws when tcpIdleTimeout is invalid seconds, got: %d seconds",
    (tcpIdleTimeoutSeconds) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");
      const group = new NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
      });
      const lb = new NetworkLoadBalancer(stack, "LB", { vpc });

      // WHEN
      expect(() => {
        lb.addListener("Listener1", {
          port: 80,
          defaultAction: NetworkListenerAction.forward([group]),
          tcpIdleTimeout: Duration.seconds(tcpIdleTimeoutSeconds),
        });
      }).toThrow(
        `\`tcpIdleTimeout\` must be between 60 and 6000 seconds, got ${tcpIdleTimeoutSeconds} seconds.`,
      );
    },
  );
});

class ResourceWithLBDependency extends TerraformResource {
  constructor(scope: Construct, id: string, targetGroup: ITargetGroup) {
    super(scope, id, { terraformResourceType: "test_resource" });
    this.node.addDependency(targetGroup.loadBalancerAttached);
  }
}

function importedCertificate(
  stack: AwsStack,
  certificateArn = "arn:aws:certificatemanager:123456789012:testregion:certificate/fd0b8392-3c0e-4704-81b6-8edf8612c852",
) {
  return edge.PublicCertificate.fromCertificateArn(
    stack,
    certificateArn,
    certificateArn,
  );
}
