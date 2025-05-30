// https://github.com/aws/aws-cdk/blob/v2.199.0/packages/aws-cdk-lib/aws-route53-targets/test/load-balancer-target.test.ts

import "cdktf/lib/testing/adapters/jest";
import { edge, AwsStack, compute } from "../../../src/aws";
import { Template } from "../../assertions";
import { route53Record } from "@cdktf/provider-aws";
import { Testing } from "cdktf";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("Load-Balancers", () => {
  test("use ALB as record target", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });
    const zone = new edge.DnsZone(stack, "HostedZone", {
      zoneName: "test.public",
    });

    // WHEN
    const record = new edge.ARecord(stack, "LoadBalancerAlias", {
      zone,
      recordName: "_foo",
      target: edge.RecordTarget.fromAlias(new edge.LoadBalancerTarget(lb)),
    });

    Template.synth(stack).toHaveResourceWithProperties(
      route53Record.Route53Record,
      {
        alias: {
          evaluate_target_health: true,
          name: `dualstack.${stack.resolve(lb.loadBalancerDnsName)}`,
          zone_id: stack.resolve(lb.loadBalancerCanonicalHostedZoneId),
        },
      },
    );
  });

  //   .hasResourceProperties('AWS::Route53::RecordSet', {
  //     AliasTarget: {
  //       DNSName: { 'Fn::Join': ['', ['dualstack.', { 'Fn::GetAtt': ['LB8A12904C', 'DNSName'] }]] },
  //       HostedZoneId: { 'Fn::GetAtt': ['LB8A12904C', 'CanonicalHostedZoneID'] },
  //     },
  //   });
  // }

  test("use ALB as record target with health check", () => {
    // GIVEN
    const stack = getAwsStack();
    const vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });
    const zone = new edge.DnsZone(stack, "HostedZone", {
      zoneName: "test.public",
    });

    // WHEN
    new edge.ARecord(stack, "LoadBalancerAlias", {
      zone,
      recordName: "_foo",
      target: edge.RecordTarget.fromAlias(new edge.LoadBalancerTarget(lb)),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      route53Record.Route53Record,
      {
        alias: {
          evaluate_target_health: true,
          name: `dualstack.${stack.resolve(lb.loadBalancerDnsName)}`,
          zone_id: stack.resolve(lb.loadBalancerCanonicalHostedZoneId),
        },
      },
    );
  });

  // .hasResourceProperties('AWS::Route53::RecordSet', {
  //   AliasTarget: {
  //     EvaluateTargetHealth: true,
  //   },
  // });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
