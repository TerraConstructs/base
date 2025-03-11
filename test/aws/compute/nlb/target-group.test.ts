// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/nlb/target-group.test.ts

import {
  lb as tfLoadBalancer,
  securityGroup as tfSecurityGroup,
  lbTargetGroup as tfLbTargetGroup,
} from "@cdktf/provider-aws";
import {
  App,
  TerraformOutput,
  // TerraformElement,
  Testing,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as ec2 from "../../../../src/aws/compute";
import { Duration } from "../../../../src/duration";
import { Fn } from "../../../../src/terra-func";
import { Template } from "../../../assertions";

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
  test("Enable proxy protocol v2 attribute for target group", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Vpc");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      proxyProtocolV2: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        proxy_protocol_v2: true,
      },
    );
  });

  test("Enable preserve_client_ip attribute for target group", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Vpc");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      preserveClientIp: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        preserve_client_ip: "true",
      },
    );
  });

  test("Disable proxy protocol v2 for attribute target group", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Vpc");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      proxyProtocolV2: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        proxy_protocol_v2: false,
      },
    );
  });

  test("Disable preserve_client_ip attribute for target group", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Vpc");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      preserveClientIp: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        preserve_client_ip: "false",
      },
    );
  });

  test("Configure protocols for target group", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      protocol: ec2.LbProtocol.UDP,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        protocol: "UDP",
      },
    );
  });

  test("Target group defaults to TCP", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        protocol: "TCP",
      },
    );
  });

  test("Throws error for invalid health check interval", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      healthCheck: {
        interval: Duration.seconds(3),
      },
    });

    expect(() => {
      app.synth();
    }).toThrow(
      /Health check interval '3' not supported. Must be between 5 and 300./,
    );
  });

  test("Throws error for health check interval less than timeout", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      healthCheck: {
        interval: Duration.seconds(10),
        timeout: Duration.seconds(20),
      },
    });

    expect(() => {
      app.synth();
    }).toThrow(
      "Health check interval must be greater than or equal to the timeout; received interval 10, timeout 20.",
    );
  });

  test.each([
    ec2.TargetGroupIpAddressType.IPV4,
    ec2.TargetGroupIpAddressType.IPV6,
  ])("configure IP address type %s", (ipAddressType) => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      ipAddressType,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        ip_address_type: ipAddressType,
      },
    );
  });

  // for backwards compatibility these can be equal, see discussion in https://github.com/aws/aws-cdk/pull/26031
  test("No error for health check interval == timeout", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      healthCheck: {
        interval: Duration.seconds(10),
        timeout: Duration.seconds(10),
      },
    });

    expect(() => {
      app.synth();
    }).not.toThrow();
  });

  test("targetGroupName unallowed: more than 32 characters", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      targetGroupName: "a".repeat(33),
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Target group name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" can have a maximum of 32 characters.',
    );
  });

  test("targetGroupName unallowed: starts with hyphen", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      targetGroupName: "-myTargetGroup",
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Target group name: "-myTargetGroup" must not begin or end with a hyphen.',
    );
  });

  test("targetGroupName unallowed: ends with hyphen", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      targetGroupName: "myTargetGroup-",
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Target group name: "myTargetGroup-" must not begin or end with a hyphen.',
    );
  });

  test("targetGroupName unallowed: unallowed characters", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      targetGroupName: "my target group",
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Target group name: "my target group" must contain only alphanumeric characters or hyphens.',
    );
  });

  test("Disable deregistration_delay.connection_termination.enabled attribute for target group", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Vpc");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      connectionTermination: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        connection_termination: false,
      },
    );
  });

  test("Enable deregistration_delay.connection_termination.enabled attribute for target group", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Vpc");

    // WHEN
    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      connectionTermination: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfLbTargetGroup.LbTargetGroup,
      {
        connection_termination: true,
      },
    );
  });

  test.each([ec2.LbProtocol.UDP, ec2.LbProtocol.TCP_UDP, ec2.LbProtocol.TLS])(
    "Throws validation error, when `healthCheck` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});

      // WHEN
      new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
        healthCheck: {
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        `Health check protocol '${protocol}' is not supported. Must be one of [HTTP, HTTPS, TCP]`,
      );
    },
  );

  test.each([ec2.LbProtocol.UDP, ec2.LbProtocol.TCP_UDP, ec2.LbProtocol.TLS])(
    "Throws validation error, when `configureHealthCheck()` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const tg = new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
      });

      // WHEN
      tg.configureHealthCheck({
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        `Health check protocol '${protocol}' is not supported. Must be one of [HTTP, HTTPS, TCP]`,
      );
    },
  );

  test.each([ec2.LbProtocol.HTTP, ec2.LbProtocol.HTTPS, ec2.LbProtocol.TCP])(
    "Does not throw validation error, when `healthCheck` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});

      // WHEN
      new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
        healthCheck: {
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).not.toThrow();
    },
  );

  test.each([ec2.LbProtocol.HTTP, ec2.LbProtocol.HTTPS, ec2.LbProtocol.TCP])(
    "Does not throw validation error, when `configureHealthCheck()` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const tg = new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
      });

      // WHEN
      tg.configureHealthCheck({
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).not.toThrow();
    },
  );

  test.each([ec2.LbProtocol.TCP, ec2.LbProtocol.HTTPS])(
    "Does not throw a validation error, when `healthCheck` has `protocol` set to %s and `interval` is equal to `timeout`",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});

      // WHEN
      new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
        healthCheck: {
          interval: Duration.seconds(10),
          timeout: Duration.seconds(10),
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).not.toThrow();
    },
  );

  test.each([ec2.LbProtocol.TCP, ec2.LbProtocol.HTTPS])(
    "Does not throw a validation error, when `configureHealthCheck()` has `protocol` set to %s and `interval` is equal to `timeout`",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const tg = new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
      });

      // WHEN
      tg.configureHealthCheck({
        interval: Duration.seconds(10),
        timeout: Duration.seconds(10),
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).not.toThrow();
    },
  );

  test.each([ec2.LbProtocol.UDP, ec2.LbProtocol.TCP_UDP, ec2.LbProtocol.TLS])(
    "Throws validation error,`healthCheck` has `protocol` set to %s and `path` is provided",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});

      // WHEN
      new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
        healthCheck: {
          path: "/my-path",
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        `'${protocol}' health checks do not support the path property. Must be one of [HTTP, HTTPS]`,
      );
    },
  );

  test.each([ec2.LbProtocol.UDP, ec2.LbProtocol.TCP_UDP, ec2.LbProtocol.TLS])(
    "Throws validation error, when `configureHealthCheck()` has `protocol` set to %s and  `path` is provided",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const tg = new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
      });

      // WHEN
      tg.configureHealthCheck({
        path: "/my-path",
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        `'${protocol}' health checks do not support the path property. Must be one of [HTTP, HTTPS]`,
      );
    },
  );

  test.each([ec2.LbProtocol.HTTP, ec2.LbProtocol.HTTPS])(
    "Does not throw validation error, when `healthCheck` has `protocol` set to %s and `path` is provided",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});

      // WHEN
      new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
        healthCheck: {
          path: "/my-path",
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).not.toThrow();
    },
  );

  test.each([ec2.LbProtocol.HTTP, ec2.LbProtocol.HTTPS])(
    "Does not throw validation error, when `configureHealthCheck()` has `protocol` set to %s and `path` is provided",
    (protocol) => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});
      const tg = new ec2.NetworkTargetGroup(stack, "TargetGroup", {
        vpc,
        port: 80,
      });

      // WHEN
      tg.configureHealthCheck({
        path: "/my-path",
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).not.toThrow();
    },
  );

  test("Throws error for invalid health check healthy threshold", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      healthCheck: {
        protocol: ec2.LbProtocol.TCP,
        healthyThresholdCount: 11,
      },
    });

    expect(() => {
      app.synth();
    }).toThrow(
      /Healthy Threshold Count '11' not supported. Must be a number between 2 and 10./,
    );
  });

  test("Throws error for invalid health check unhealthy threshold", () => {
    const vpc = new ec2.Vpc(stack, "Vpc");

    new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
      healthCheck: {
        protocol: ec2.LbProtocol.TCP,
        unhealthyThresholdCount: 1,
      },
    });

    expect(() => {
      app.synth();
    }).toThrow(
      /Unhealthy Threshold Count '1' not supported. Must be a number between 2 and 10./,
    );
  });

  test("Exercise metrics", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const lb = new ec2.NetworkLoadBalancer(stack, "LB", { vpc });
    const listener = new ec2.NetworkListener(stack, "Listener", {
      loadBalancer: lb,
      port: 80,
    });
    const targetGroup = new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
    });
    listener.addTargetGroups("unused", targetGroup);

    // WHEN
    const metrics = new Array<cloudwatch.Metric>();
    metrics.push(targetGroup.metrics.healthyHostCount());
    metrics.push(targetGroup.metrics.unHealthyHostCount());

    // THEN

    // Ideally, this would just be a GetAtt of the LB name, but the target group
    // doesn't have a direct reference to the LB, and instead builds up the LB name
    // from the listener ARN.
    const splitListenerName =
      'split("/", aws_lb_listener.Listener_828B0E81.arn)';
    const loadBalancerNameFromListener = [
      `\${element(${splitListenerName}, 1)}`,
      `\${element(${splitListenerName}, 2)}`,
      `\${element(${splitListenerName}, 3)}`,
    ].join("/");

    for (const metric of metrics) {
      expect(metric.namespace).toEqual("AWS/NetworkELB");
      expect(stack.resolve(metric.dimensions)).toEqual({
        LoadBalancer: loadBalancerNameFromListener,
        // TODO: why 0?
        TargetGroup:
          '${element(split("/", element(split(":", aws_lb_target_group.Group_C77FDACD.arn), 5)), 0)}',
      });
    }
  });

  test("Metrics requires a listener to be present", () => {
    // GIVEN
    const vpc = new ec2.Vpc(stack, "Stack");
    const targetGroup = new ec2.NetworkTargetGroup(stack, "Group", {
      vpc,
      port: 80,
    });

    // THEN
    expect(() => targetGroup.metrics.healthyHostCount()).toThrow(
      /The TargetGroup needs to be attached to a LoadBalancer/,
    );
    expect(() => targetGroup.metrics.unHealthyHostCount()).toThrow(
      /The TargetGroup needs to be attached to a LoadBalancer/,
    );
  });

  test("imported targetGroup has targetGroupName", () => {
    // GIVEN
    // WHEN
    const importedTg = ec2.NetworkTargetGroup.fromTargetGroupAttributes(
      stack,
      "importedTg",
      {
        targetGroupArn:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/myNlbTargetGroup/73e2d6bc24d8a067",
      },
    );

    // THEN
    expect(importedTg.targetGroupName).toEqual("myNlbTargetGroup");
  });

  test("imported targetGroup with imported ARN has targetGroupName", () => {
    // GIVEN

    // WHEN
    const importedTgArn = Fn.importValue(stack, "ImportTargetGroupArn");
    const importedTg = ec2.ApplicationTargetGroup.fromTargetGroupAttributes(
      stack,
      "importedTg",
      {
        targetGroupArn: importedTgArn,
      },
    );
    new TerraformOutput(stack, "TargetGroupOutput", {
      value: importedTg.targetGroupName,
    });

    // THEN
    const template = new Template(stack);
    expect(template.outputByName("TargetGroupOutput")).toMatchObject({
      value:
        // arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/myNlbTargetGroup/73e2d6bc24d8a067
        // --> split(":", var.ImportTargetGroupArn)
        // [arn, aws, elasticloadbalancing, us-west-2, 123456789012, targetgroup/myNlbTargetGroup/73e2d6bc24d8a067]
        // --> element(...., 5)
        // targetgroup/myNlbTargetGroup/73e2d6bc24d8a067
        // --> split("/", ....)
        // [targetgroup, myNlbTargetGroup, 73e2d6bc24d8a067]
        // --> element(...., 1)
        // myNlbTargetGroup
        '${element(split("/", element(split(":", var.ImportTargetGroupArn), 5)), 1)}',
    });
  });

  test("imported targetGroup has metrics", () => {
    // GIVEN
    // WHEN
    const targetGroup = ec2.NetworkTargetGroup.fromTargetGroupAttributes(
      stack,
      "importedTg",
      {
        targetGroupArn:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/my-target-group/50dc6c495c0c9188",
        loadBalancerArns:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/net/my-load-balancer/73e2d6bc24d8a067",
      },
    );

    const metric = targetGroup.metrics.custom("MetricName");

    // THEN
    expect(metric.namespace).toEqual("AWS/NetworkELB");
    expect(stack.resolve(metric.dimensions)).toEqual({
      LoadBalancer: "net/my-load-balancer/73e2d6bc24d8a067",
      TargetGroup: "targetgroup/my-target-group/50dc6c495c0c9188",
    });
  });

  test("imported targetGroup without load balancer cannot have metrics", () => {
    // GIVEN
    // WHEN
    const targetGroup = ec2.NetworkTargetGroup.fromTargetGroupAttributes(
      stack,
      "importedTg",
      {
        targetGroupArn:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/my-target-group/50dc6c495c0c9188",
      },
    );

    expect(() => targetGroup.metrics.custom("MetricName")).toThrow();
  });

  // test cases for crossZoneEnabled
  describe("crossZoneEnabled", () => {
    test.each([true, false])(
      "crossZoneEnabled can be %s",
      (crossZoneEnabled) => {
        // GIVEN
        const vpc = new ec2.Vpc(stack, "VPC", {});

        // WHEN
        new ec2.NetworkTargetGroup(stack, "LB", {
          crossZoneEnabled,
          vpc,
          port: 80,
        });

        Template.synth(stack).toHaveResourceWithProperties(
          tfLbTargetGroup.LbTargetGroup,
          {
            load_balancing_cross_zone_enabled: crossZoneEnabled.toString(),
          },
        );
      },
    );

    test("load_balancing.cross_zone.enabled is not set when crossZoneEnabled is not specified", () => {
      // GIVEN
      const vpc = new ec2.Vpc(stack, "VPC", {});

      // WHEN
      new ec2.NetworkTargetGroup(stack, "LB", {
        vpc,
        port: 80,
      });

      Template.synth(stack).not.toHaveResourceWithProperties(
        tfLbTargetGroup.LbTargetGroup,
        {
          enable_cross_zone_load_balancing: expect.anything(),
        },
      );
    });
  });
});
