// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/target-group.test.ts

import { lbTargetGroup as tfTargetGroup } from "@cdktf/provider-aws";
import { App, TerraformOutput, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { Duration } from "../../../../src/duration";
import { Fn } from "../../../../src/terra-func";
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
  test("Empty target Group without type still requires a VPC", () => {
    // GIVEN

    // WHEN
    new compute.ApplicationTargetGroup(stack, "LB", {});

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(/'vpc' is required for a non-Lambda TargetGroup/);
  });

  test("Lambda target should not have stickiness.enabled set", () => {
    new compute.ApplicationTargetGroup(stack, "TG", {
      targetType: compute.TargetType.LAMBDA,
    });

    const tg = new compute.ApplicationTargetGroup(stack, "TG2");
    tg.addTarget({
      attachToApplicationTargetGroup(
        _targetGroup: compute.IApplicationTargetGroup,
      ): compute.LoadBalancerTargetProps {
        return {
          targetType: compute.TargetType.LAMBDA,
          targetJson: {
            targetId: "arn:aws:lambda:eu-west-1:123456789012:function:myFn",
          },
        };
      },
    });

    const t = new Template(stack);
    // expect(Object.keys(matches).length).toBe(0);
    t.resourceTypeArrayNotContaining(tfTargetGroup.LbTargetGroup, [
      {
        stickeness: expect.anything(),
      },
    ]);
  });

  test("Lambda target should not have port set", () => {
    const tg = new compute.ApplicationTargetGroup(stack, "TG2", {
      protocol: compute.ApplicationProtocol.HTTPS,
    });
    tg.addTarget({
      attachToApplicationTargetGroup(
        _targetGroup: compute.IApplicationTargetGroup,
      ): compute.LoadBalancerTargetProps {
        return {
          targetType: compute.TargetType.LAMBDA,
          targetJson: {
            targetId: "arn:aws:lambda:eu-west-1:123456789012:function:myFn",
          },
        };
      },
    });
    expect(() => app.synth()).toThrow(
      /port\/protocol should not be specified for Lambda targets/,
    );
  });

  test("Lambda target should not have protocol set", () => {
    new compute.ApplicationTargetGroup(stack, "TG", {
      port: 443,
      targetType: compute.TargetType.LAMBDA,
    });
    expect(() => app.synth()).toThrow(
      /port\/protocol should not be specified for Lambda targets/,
    );
  });

  test("Can add self-registering target to imported TargetGroup", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");

    // WHEN
    const tg = compute.ApplicationTargetGroup.fromTargetGroupAttributes(
      stack,
      "TG",
      {
        targetGroupArn:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/myAlbTargetGroup/73e2d6bc24d8a067",
      },
    );
    tg.addTarget(new FakeSelfRegisteringTarget(stack, "Target", vpc));
  });

  // Deprecated
  test("Cannot add direct target to imported TargetGroup", () => {
    // GIVEN
    const tg = compute.ApplicationTargetGroup.fromTargetGroupAttributes(
      stack,
      "TG",
      {
        targetGroupArn:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/myAlbTargetGroup/73e2d6bc24d8a067",
      },
    );

    // WHEN
    expect(() => {
      tg.addTarget(new compute.InstanceTarget("i-1234"));
    }).toThrow(
      /Cannot add a non-self registering target to an imported TargetGroup/,
    );
  });

  // Deprecated
  test("HealthCheck fields set if provided", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});
    const alb = new compute.ApplicationLoadBalancer(stack, "ALB", { vpc });
    const listener = new compute.ApplicationListener(stack, "Listener", {
      port: 80,
      loadBalancer: alb,
      open: false,
    });

    // WHEN
    const ipTarget = new compute.IpTarget("10.10.12.12");
    listener.addTargets("TargetGroup", {
      targets: [ipTarget],
      port: 80,
      healthCheck: {
        enabled: true,
        healthyHttpCodes: "255",
        interval: Duration.seconds(255),
        timeout: Duration.seconds(192),
        healthyThresholdCount: 29,
        unhealthyThresholdCount: 27,
        path: "/arbitrary",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        protocol: "HTTP",
        health_check: {
          enabled: true,
          healthy_threshold: 29,
          interval: 255,
          matcher: "255",
          path: "/arbitrary",
          timeout: 192,
          unhealthy_threshold: 27,
        },
        port: 80,
      },
    );
  });

  test.each([
    compute.TargetGroupIpAddressType.IPV4,
    compute.TargetGroupIpAddressType.IPV6,
  ])("configure IP address type %s", (ipAddressType) => {
    const vpc = new compute.Vpc(stack, "Vpc");

    new compute.ApplicationTargetGroup(stack, "Group", {
      vpc,
      ipAddressType,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        ip_address_type: ipAddressType,
      },
    );
  });

  test("Load balancer duration cookie stickiness", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // WHEN
    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
      stickinessCookieDuration: Duration.minutes(5),
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        stickiness: {
          cookie_duration: 300,
          enabled: true,
          type: "lb_cookie",
        },
      },
    );
  });

  test("Load balancer app cookie stickiness", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // WHEN
    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
      stickinessCookieDuration: Duration.minutes(5),
      stickinessCookieName: "MyDeliciousCookie",
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        stickiness: {
          cookie_duration: 300,
          cookie_name: "MyDeliciousCookie",
          enabled: true,
          type: "app_cookie",
        },
      },
    );
  });

  test("Custom Load balancer algorithm type", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // WHEN
    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
      loadBalancingAlgorithmType:
        compute.TargetGroupLoadBalancingAlgorithmType
          .LEAST_OUTSTANDING_REQUESTS,
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        load_balancing_algorithm_type: "least_outstanding_requests",
      },
    );
  });

  test("Can set a protocol version", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // WHEN
    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
      protocolVersion: compute.ApplicationProtocolVersion.GRPC,
      healthCheck: {
        enabled: true,
        healthyGrpcCodes: "0-99",
        interval: Duration.seconds(255),
        timeout: Duration.seconds(192),
        healthyThresholdCount: 29,
        unhealthyThresholdCount: 27,
        path: "/arbitrary",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        protocol_version: "GRPC",
        health_check: {
          enabled: true,
          healthy_threshold: 29,
          interval: 255,
          matcher: "0-99",
          path: "/arbitrary",
          timeout: 192,
          unhealthy_threshold: 27,
        },
      },
    );
  });

  test("Bad stickiness cookie names", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});
    const errMessage =
      "App cookie names that start with the following prefixes are not allowed: AWSALB, AWSALBAPP, and AWSALBTG; they're reserved for use by the load balancer";

    // THEN
    [
      "AWSALBCookieName",
      "AWSALBstickinessCookieName",
      "AWSALBTGCookieName",
    ].forEach((badCookieName, i) => {
      expect(() => {
        new compute.ApplicationTargetGroup(stack, `TargetGroup${i}`, {
          stickinessCookieDuration: Duration.minutes(5),
          stickinessCookieName: badCookieName,
          vpc,
        });
      }).toThrow(errMessage);
    });
  });

  test("Empty stickiness cookie name", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // THEN
    expect(() => {
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        stickinessCookieDuration: Duration.minutes(5),
        stickinessCookieName: "",
        vpc,
      });
    }).toThrow(/App cookie name cannot be an empty string./);
  });

  test("Bad stickiness duration value", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // THEN
    expect(() => {
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        stickinessCookieDuration: Duration.days(8),
        vpc,
      });
    }).toThrow(
      /Stickiness cookie duration value must be between 1 second and 7 days \(604800 seconds\)./,
    );
  });

  test("Bad slow start duration value", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});

    // THEN
    [Duration.minutes(16), Duration.seconds(29)].forEach((badDuration, i) => {
      expect(() => {
        new compute.ApplicationTargetGroup(stack, `TargetGroup${i}`, {
          slowStart: badDuration,
          vpc,
        });
      }).toThrow(
        /Slow start duration value must be between 30 and 900 seconds, or 0 to disable slow start./,
      );
    });
  });

  test("Disable slow start by setting to 0 seconds", () => {
    const vpc = new compute.Vpc(stack, "VPC", {});

    // WHEN
    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
      slowStart: Duration.seconds(0),
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfTargetGroup.LbTargetGroup,
      {
        slow_start: 0,
      },
    );
  });

  test.each([
    compute.LbProtocol.UDP,
    compute.LbProtocol.TCP_UDP,
    compute.LbProtocol.TLS,
  ])(
    "Throws validation error, when `healthCheck` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
        healthCheck: {
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        `Health check protocol '${protocol}' is not supported. Must be one of [HTTP, HTTPS]`,
      );
    },
  );

  test.each([
    compute.LbProtocol.UDP,
    compute.LbProtocol.TCP_UDP,
    compute.LbProtocol.TLS,
  ])(
    "Throws validation error, when `configureHealthCheck()` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});
      const tg = new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
      });

      // WHEN
      tg.configureHealthCheck({
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        `Health check protocol '${protocol}' is not supported. Must be one of [HTTP, HTTPS]`,
      );
    },
  );

  test.each([compute.LbProtocol.HTTP, compute.LbProtocol.HTTPS])(
    "Does not throw validation error, when `healthCheck` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
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

  test.each([compute.LbProtocol.HTTP, compute.LbProtocol.HTTPS])(
    "Does not throw validation error, when `configureHealthCheck()` has `protocol` set to %s",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});
      const tg = new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
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

  test.each([compute.LbProtocol.HTTP, compute.LbProtocol.HTTPS])(
    "Throws validation error, when `healthCheck` has `protocol` set to %s and `interval` is equal to `timeout`",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
        healthCheck: {
          interval: Duration.seconds(60),
          timeout: Duration.seconds(60),
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        "Healthcheck interval 1 minute must be greater than the timeout 1 minute",
      );
    },
  );

  test.each([compute.LbProtocol.HTTP, compute.LbProtocol.HTTPS])(
    "Throws validation error, when `healthCheck` has `protocol` set to %s and `interval` is smaller than `timeout`",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
        healthCheck: {
          interval: Duration.seconds(60),
          timeout: Duration.seconds(120),
          protocol: protocol,
        },
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        "Healthcheck interval 1 minute must be greater than the timeout 2 minutes",
      );
    },
  );

  test.each([compute.LbProtocol.HTTP, compute.LbProtocol.HTTPS])(
    "Throws validation error, when `configureHealthCheck()` has `protocol` set to %s and `interval` is equal to `timeout`",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});
      const tg = new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
      });

      // WHEN
      tg.configureHealthCheck({
        interval: Duration.seconds(60),
        timeout: Duration.seconds(60),
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        "Healthcheck interval 1 minute must be greater than the timeout 1 minute",
      );
    },
  );

  test.each([compute.LbProtocol.HTTP, compute.LbProtocol.HTTPS])(
    "Throws validation error, when `configureHealthCheck()` has `protocol` set to %s and `interval` is smaller than `timeout`",
    (protocol) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});
      const tg = new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        vpc,
      });

      // WHEN
      tg.configureHealthCheck({
        interval: Duration.seconds(60),
        timeout: Duration.seconds(120),
        protocol: protocol,
      });

      // THEN
      expect(() => {
        app.synth();
      }).toThrow(
        "Healthcheck interval 1 minute must be greater than the timeout 2 minutes",
      );
    },
  );

  test("Throws validation error, when `configureHealthCheck()`protocol is undefined and `interval` is smaller than `timeout`", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {});
    const tg = new compute.ApplicationTargetGroup(stack, "TargetGroup", {
      vpc,
    });

    // WHEN
    tg.configureHealthCheck({
      interval: Duration.seconds(60),
      timeout: Duration.seconds(120),
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      "Healthcheck interval 1 minute must be greater than the timeout 2 minute",
    );
  });

  test("Throws error for health check interval less than timeout", () => {
    const vpc = new compute.Vpc(stack, "Vpc");

    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
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

  // for backwards compatibility these can be equal, see discussion in https://github.com/aws/aws-cdk/pull/26031
  test("Throws error for health check interval less than timeout", () => {
    const vpc = new compute.Vpc(stack, "Vpc");

    new compute.ApplicationTargetGroup(stack, "TargetGroup", {
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

  test("imported targetGroup has targetGroupName", () => {
    // GIVEN

    // WHEN
    const importedTg = compute.ApplicationTargetGroup.fromTargetGroupAttributes(
      stack,
      "importedTg",
      {
        targetGroupArn:
          "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/myAlbTargetGroup/73e2d6bc24d8a067",
      },
    );

    // THEN
    expect(importedTg.targetGroupName).toEqual("myAlbTargetGroup");
  });

  test("imported targetGroup with imported ARN has targetGroupName", () => {
    // GIVEN

    // WHEN
    const importedTgArn = Fn.importValue(stack, "ImportTargetGroupArn");
    const importedTg = compute.ApplicationTargetGroup.fromTargetGroupAttributes(
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
    const t = new Template(stack);
    expect(t.outputByName("TargetGroupOutput")).toEqual({
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
    const targetGroup =
      compute.ApplicationTargetGroup.fromTargetGroupAttributes(
        stack,
        "importedTg",
        {
          targetGroupArn:
            "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/my-target-group/50dc6c495c0c9188",
          loadBalancerArns:
            "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/73e2d6bc24d8a067",
        },
      );

    const metric = targetGroup.metrics.custom("MetricName");

    // THEN
    expect(metric.namespace).toEqual("AWS/ApplicationELB");
    expect(stack.resolve(metric.dimensions)).toEqual({
      LoadBalancer: "app/my-load-balancer/73e2d6bc24d8a067",
      TargetGroup: "targetgroup/my-target-group/50dc6c495c0c9188",
    });
  });

  test("imported targetGroup without load balancer cannot have metrics", () => {
    // GIVEN

    // WHEN
    const targetGroup =
      compute.ApplicationTargetGroup.fromTargetGroupAttributes(
        stack,
        "importedTg",
        {
          targetGroupArn:
            "arn:aws:elasticloadbalancing:us-west-2:123456789012:targetgroup/my-target-group/50dc6c495c0c9188",
        },
      );

    expect(() => targetGroup.metrics.custom("MetricName")).toThrow();
  });

  describe("weighted_random algorithm test", () => {
    test("weight_random algorithm and anomaly mitigation is enabled", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        loadBalancingAlgorithmType:
          compute.TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM,
        vpc,
        enableAnomalyMitigation: true,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfTargetGroup.LbTargetGroup,
        {
          load_balancing_algorithm_type: "weighted_random",
          load_balancing_anomaly_mitigation: "on",
        },
      );
    });

    test("weight_random algorithm and anomaly mitigation is disabled", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "TargetGroup", {
        loadBalancingAlgorithmType:
          compute.TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM,
        vpc,
        enableAnomalyMitigation: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfTargetGroup.LbTargetGroup,
        {
          load_balancing_algorithm_type: "weighted_random",
          load_balancing_anomaly_mitigation: "off",
        },
      );
    });

    test("Throws an error when weight_random algorithm is set with slow start setting", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      expect(
        () =>
          new compute.ApplicationTargetGroup(stack, "TargetGroup", {
            loadBalancingAlgorithmType:
              compute.TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM,
            slowStart: Duration.seconds(60),
            vpc,
          }),
      ).toThrow(
        "The weighted random routing algorithm can not be used with slow start mode.",
      );
    });

    test("Throws an error when anomaly mitigation is enabled with an algorithm other than weight_random", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      expect(
        () =>
          new compute.ApplicationTargetGroup(stack, "TargetGroup", {
            loadBalancingAlgorithmType:
              compute.TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN,
            enableAnomalyMitigation: true,
            vpc,
          }),
      ).toThrow(
        "Anomaly mitigation is only available when `loadBalancingAlgorithmType` is `TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM`.",
      );
    });
  });

  // test cases for crossZoneEnabled
  describe("crossZoneEnabled", () => {
    test.each([true, false])(
      "crossZoneEnabled can be %s",
      (crossZoneEnabled) => {
        // GIVEN
        const vpc = new compute.Vpc(stack, "VPC", {});

        // WHEN
        new compute.ApplicationTargetGroup(stack, "LB", {
          crossZoneEnabled,
          vpc,
        });

        Template.synth(stack).toHaveResourceWithProperties(
          tfTargetGroup.LbTargetGroup,
          {
            load_balancing_cross_zone_enabled: crossZoneEnabled.toString(),
          },
        );
      },
    );

    test("load_balancing.cross_zone.enabled is not set when crossZoneEnabled is not specified", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "VPC", {});

      // WHEN
      new compute.ApplicationTargetGroup(stack, "LB", {
        vpc,
        targetType: compute.TargetType.LAMBDA,
      });

      Template.synth(stack).not.toHaveResourceWithProperties(
        tfTargetGroup.LbTargetGroup,
        {
          enable_cross_zone_load_balancing: expect.anything(),
        },
      );
    });
  });
});
