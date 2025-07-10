// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/nlb/load-balancer.test.ts

import {
  lb as tfLoadBalancer,
  securityGroup as tfSecurityGroup,
  route53Record,
  s3BucketPolicy,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import {
  App,
  // TerraformElement,
  Testing,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as edge from "../../../../src/aws/edge";
import * as storage from "../../../../src/aws/storage";
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

  test("Trivial construction: internet facing", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: false,
      subnets: [
        "${aws_subnet.Stack_PublicSubnet1_A539D629.id}",
        "${aws_subnet.Stack_PublicSubnet2_73639A20.id}",
        "${aws_subnet.Stack_PublicSubnet3_53275245.id}",
      ],
      load_balancer_type: "network",
    });
  });

  test("Trivial construction: internal", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", { vpc });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: true,
      subnets: [
        "${aws_subnet.Stack_PrivateSubnet1_530F2940.id}",
        "${aws_subnet.Stack_PrivateSubnet2_B7F3D25A.id}",
        "${aws_subnet.Stack_PrivateSubnet3_8917711B.id}",
      ],
      load_balancer_type: "network",
    });
  });

  test("VpcEndpointService with Domain Name imported from public hosted zone", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const nlb = new compute.NetworkLoadBalancer(stack, "Nlb", { vpc });
    const importedPHZ = edge.DnsZone.fromZoneId(stack, "MyPHZ", "sampleid");
    // const endpointService =
    new compute.VpcEndpointService(stack, "EndpointService", {
      vpcEndpointServiceLoadBalancers: [nlb],
      privateDnsName: "MyDomain", // create private Dns name for load balancer
      dnsZone: importedPHZ,
    });

    // WHEN
    // // NOTE: Terraform does not use a custom resource for DomainName configuration
    // // the VpcEndPointService has a property for the domain name
    // const importedPHZ = route53.PublicHostedZone.fromPublicHostedZoneAttributes(stack, 'MyPHZ', {
    //   hostedZoneId: 'sampleid',
    //   zoneName: 'MyZone',
    // });
    // new edge.VpcEndpointServiceDomainName(stack, "EndpointServiceDomainName", {
    //   endpointService,
    //   domainName: "MyDomain",
    //   publicHostedZone: importedPHZ,
    // });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      route53Record.Route53Record,
      {
        zone_id: "sampleid",
      },
    );
  });

  test("Attributes", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      crossZoneEnabled: true,
      clientRoutingPolicy:
        compute.ClientRoutingPolicy.PARTIAL_AVAILABILITY_ZONE_AFFINITY,
      zonalShift: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      enable_cross_zone_load_balancing: true,
      dns_record_client_routing_policy: "partial_availability_zone_affinity",
      enable_zonal_shift: true,
    });
  });

  test("Access logging", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const bucket = new storage.Bucket(stack, "AccessLoggingBucket");
    const lb = new compute.NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.logAccessLogs(bucket);

    // THEN

    // verify that the LB attributes reference the bucket
    Template.resources(stack, s3BucketPolicy.S3BucketPolicy).toHaveLength(1);
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      access_logs: {
        enabled: true,
        bucket: stack.resolve(bucket.bucketName),
      },
      // verify the NLB depends on the bucket policy
      depends_on: [
        "aws_s3_bucket_policy.AccessLoggingBucket_Policy_700D7CC6",
        "aws_s3_bucket_policy.AccessLoggingBucket_Policy_700D7CC6", // TODO: Why is it double
      ],
    });

    // verify the bucket policy allows the NLB to put objects in the bucket
    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["s3:PutObject"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::127311923021:root",
                ],
                type: "AWS",
              },
            ],
            resources: [
              "${aws_s3_bucket.AccessLoggingBucket_A6D88F29.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
            ],
          },
          {
            actions: ["s3:PutObject"],
            effect: "Allow",
            condition: [
              {
                test: "StringEquals",
                variable: "s3:x-amz-acl",
                values: ["bucket-owner-full-control"],
              },
            ],
            principals: [
              {
                type: "Service",
                // identifier: "delivery.logs.amazonaws.com",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                ],
              },
            ],
            resources: [
              "${aws_s3_bucket.AccessLoggingBucket_A6D88F29.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
            ],
          },
          {
            actions: ["s3:GetBucketAcl"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                // identifier: "delivery.logs.amazonaws.com",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                ],
              },
            ],
            resources: ["${aws_s3_bucket.AccessLoggingBucket_A6D88F29.arn}"],
          },
        ],
      },
    );
  });

  test("access logging with prefix", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const bucket = new storage.Bucket(stack, "AccessLoggingBucket");
    const lb = new compute.NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.logAccessLogs(bucket, "prefix-of-access-logs");

    // THEN
    // verify that the LB attributes reference the bucket
    Template.resources(stack, s3BucketPolicy.S3BucketPolicy).toHaveLength(1);
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      access_logs: {
        enabled: true,
        bucket: stack.resolve(bucket.bucketName),
        prefix: "prefix-of-access-logs",
      },
    });

    // verify the bucket policy allows the NLB to put objects in the bucket
    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["s3:PutObject"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::127311923021:root",
                ],
                type: "AWS",
              },
            ],
            resources: [
              "${aws_s3_bucket.AccessLoggingBucket_A6D88F29.arn}/prefix-of-access-logs/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
            ],
          },
          {
            actions: ["s3:PutObject"],
            effect: "Allow",
            condition: [
              {
                test: "StringEquals",
                variable: "s3:x-amz-acl",
                values: ["bucket-owner-full-control"],
              },
            ],
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                ],
              },
            ],
            resources: [
              "${aws_s3_bucket.AccessLoggingBucket_A6D88F29.arn}/prefix-of-access-logs/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
            ],
          },
          {
            actions: ["s3:GetBucketAcl"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                ],
              },
            ],
            resources: ["${aws_s3_bucket.AccessLoggingBucket_A6D88F29.arn}"],
          },
        ],
      },
    );
  });

  test("Access logging on imported bucket", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const bucket = storage.Bucket.fromBucketName(
      stack,
      "ImportedAccessLoggingBucket",
      "imported-bucket",
    );
    // Imported buckets have `autoCreatePolicy` disabled by default
    bucket.policy = new storage.BucketPolicy(
      stack,
      "ImportedAccessLoggingBucketPolicy",
      {
        bucket,
      },
    );
    const lb = new compute.NetworkLoadBalancer(stack, "LB", { vpc });

    // WHEN
    lb.logAccessLogs(bucket);

    // THEN

    // verify that the LB attributes reference the bucket
    Template.resources(stack, s3BucketPolicy.S3BucketPolicy).toHaveLength(1);
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      access_logs: {
        enabled: true,
        bucket: stack.resolve(bucket.bucketName),
      },
      // verify the NLB depends on the bucket policy
      depends_on: [
        "aws_s3_bucket_policy.ImportedAccessLoggingBucketPolicy_97AE3371",
        "aws_s3_bucket_policy.ImportedAccessLoggingBucketPolicy_97AE3371", // TODO: Why is it double?
      ],
    });

    // verify the bucket policy allows the NLB to put objects in the bucket
    template.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["s3:PutObject"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::127311923021:root",
                ],
                type: "AWS",
              },
            ],
            resources: [
              // "${data.aws_s3_bucket.imported-bucket.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              "arn:${data.aws_partition.Partitition.partition}:s3:::imported-bucket/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
            ],
          },
          {
            actions: ["s3:PutObject"],
            effect: "Allow",
            condition: [
              {
                test: "StringEquals",
                variable: "s3:x-amz-acl",
                values: ["bucket-owner-full-control"],
              },
            ],
            principals: [
              {
                type: "Service",
                // identifier: "delivery.logs.amazonaws.com",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                ],
              },
            ],
            resources: [
              // "${data.aws_s3_bucket.imported-bucket.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              "arn:${data.aws_partition.Partitition.partition}:s3:::imported-bucket/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
            ],
          },
          {
            actions: ["s3:GetBucketAcl"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                ],
              },
            ],
            resources: [
              // "${data.aws_s3_bucket.imported-bucket.arn}"
              "arn:${data.aws_partition.Partitition.partition}:s3:::imported-bucket",
            ],
          },
        ],
      },
    );
  });

  test("loadBalancerName", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "myLoadBalancer",
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      name: "myLoadBalancer",
    });
  });

  test("can set EnforceSecurityGroupInboundRulesOnPrivateLinkTraffic on", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "myLoadBalancer",
      enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: true,
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      name: "myLoadBalancer",
      enforce_security_group_inbound_rules_on_private_link_traffic: "on",
    });
  });

  test("can set EnforceSecurityGroupInboundRulesOnPrivateLinkTraffic off", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "myLoadBalancer",
      enforceSecurityGroupInboundRulesOnPrivateLinkTraffic: false,
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      name: "myLoadBalancer",
      enforce_security_group_inbound_rules_on_private_link_traffic: "off",
    });
  });

  test("loadBalancerName unallowed: more than 32 characters", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "a".repeat(33),
      vpc,
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Load balancer name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" can have a maximum of 32 characters.',
    );
  });

  test('loadBalancerName unallowed: starts with "internal-"', () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "internal-myLoadBalancer",
      vpc,
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Load balancer name: "internal-myLoadBalancer" must not begin with "internal-".',
    );
  });

  test("loadBalancerName unallowed: starts with hyphen", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "-myLoadBalancer",
      vpc,
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Load balancer name: "-myLoadBalancer" must not begin or end with a hyphen.',
    );
  });

  test("loadBalancerName unallowed: ends with hyphen", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "myLoadBalancer-",
      vpc,
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Load balancer name: "myLoadBalancer-" must not begin or end with a hyphen.',
    );
  });

  test("loadBalancerName unallowed: unallowed characters", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "NLB", {
      loadBalancerName: "my load balancer",
      vpc,
    });

    // THEN
    expect(() => {
      app.synth();
    }).toThrow(
      'Load balancer name: "my load balancer" must contain only alphanumeric characters or hyphens.',
    );
  });

  test.each([
    [false, undefined],
    [true, undefined],
    [false, compute.IpAddressType.IPV4],
    [true, compute.IpAddressType.IPV4],
  ])(
    "throw error for denyAllIgwTraffic set to %s for Ipv4 (default) addressing.",
    (denyAllIgwTraffic, ipAddressType) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // THEN
      expect(() => {
        new compute.NetworkLoadBalancer(stack, "NLB", {
          vpc,
          denyAllIgwTraffic: denyAllIgwTraffic,
          ipAddressType: ipAddressType,
        });
      }).toThrow(
        `'denyAllIgwTraffic' may only be set on load balancers with ${compute.IpAddressType.DUAL_STACK} addressing.`,
      );
    },
  );

  test("imported network load balancer with no vpc specified throws error when calling addTargets", () => {
    // GIVEN
    const nlbArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const nlb = compute.NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(
      stack,
      "NLB",
      {
        loadBalancerArn: nlbArn,
      },
    );
    // WHEN
    const listener = nlb.addListener("Listener", { port: 80 });
    expect(() => listener.addTargets("targetgroup", { port: 8080 })).toThrow();
  });

  test("imported network load balancer with vpc does not throw error when calling addTargets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const nlbArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const nlb = compute.NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(
      stack,
      "NLB",
      {
        loadBalancerArn: nlbArn,
        vpc,
      },
    );
    // WHEN
    const listener = nlb.addListener("Listener", { port: 80 });
    expect(() =>
      listener.addTargets("targetgroup", { port: 8080 }),
    ).not.toThrow();
  });

  test("imported load balancer knows its region", () => {
    // WHEN
    const albArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const alb = compute.NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(
      stack,
      "NLB",
      {
        loadBalancerArn: albArn,
      },
    );

    // THEN
    expect(alb.env.region).toEqual("us-west-2");
  });

  test("imported load balancer can have metrics", () => {
    // WHEN
    const arn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/network/my-load-balancer/50dc6c495c0c9188";
    const nlb = compute.NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(
      stack,
      "NLB",
      {
        loadBalancerArn: arn,
      },
    );

    const metric = nlb.metrics.custom("MetricName");

    // THEN
    expect(metric.namespace).toEqual("AWS/NetworkELB");
    expect(stack.resolve(metric.dimensions)).toEqual({
      LoadBalancer: "network/my-load-balancer/50dc6c495c0c9188",
    });
  });

  test("Trivial construction: internal with Isolated subnets only", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {
      subnetConfiguration: [
        {
          cidrMask: 20,
          name: "Isolated",
          subnetType: compute.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: true,
      load_balancer_type: "network",
      subnets: [
        "${aws_subnet.VPC_IsolatedSubnet1_878DBDC3.id}",
        "${aws_subnet.VPC_IsolatedSubnet2_44717885.id}",
        "${aws_subnet.VPC_IsolatedSubnet3_73305576.id}",
      ],
    });
  });
  test("Internal with Public, Private, and Isolated subnets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: compute.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: "Isolated",
          subnetType: compute.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: true,
      load_balancer_type: "network",
      subnets: [
        "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id}",
        "${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id}",
        "${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
      ],
    });
  });
  test("Internet-facing with Public, Private, and Isolated subnets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: compute.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: "Isolated",
          subnetType: compute.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: false,
      load_balancer_type: "network",
      subnets: [
        "${aws_subnet.VPC_PublicSubnet1_0D1B5E48.id}",
        "${aws_subnet.VPC_PublicSubnet2_E52FD57B.id}",
        "${aws_subnet.VPC_PublicSubnet3_7031327B.id}",
      ],
    });
  });
  test("Internal load balancer supplying public subnets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: compute.SubnetType.PUBLIC },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: true,
      load_balancer_type: "network",
      subnets: [
        "${aws_subnet.VPC_PublicSubnet1_0D1B5E48.id}",
        "${aws_subnet.VPC_PublicSubnet2_E52FD57B.id}",
        "${aws_subnet.VPC_PublicSubnet3_7031327B.id}",
      ],
    });
  });
  test("Internal load balancer supplying isolated subnets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: compute.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: "Isolated",
          subnetType: compute.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // WHEN
    new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: compute.SubnetType.PRIVATE_ISOLATED },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: true,
      load_balancer_type: "network",
      subnets: [
        "${aws_subnet.VPC_IsolatedSubnet1_878DBDC3.id}",
        "${aws_subnet.VPC_IsolatedSubnet2_44717885.id}",
        "${aws_subnet.VPC_IsolatedSubnet3_73305576.id}",
      ],
    });
  });

  test("Trivial construction: security groups", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const sg1 = new compute.SecurityGroup(stack, "SG1", { vpc });
    const sg2 = new compute.SecurityGroup(stack, "SG2", { vpc });

    // WHEN
    const nlb = new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
      securityGroups: [sg1],
    });
    nlb.connections.allowFromAnyIpv4(compute.Port.tcp(80));
    nlb.addSecurityGroup(sg2);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: false,
      subnets: [
        "${aws_subnet.Stack_PublicSubnet1_A539D629.id}",
        "${aws_subnet.Stack_PublicSubnet2_73639A20.id}",
        "${aws_subnet.Stack_PublicSubnet3_53275245.id}",
      ],
      security_groups: [
        stack.resolve(sg1.securityGroupId),
        stack.resolve(sg2.securityGroupId),
      ],
      load_balancer_type: "network",
    });
    template.resourceTypeArrayContaining(
      tfSecurityGroup.SecurityGroup,
      // expect both security groups to have the same ingress rule
      Array(2).fill(
        expect.objectContaining({
          ingress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "from 0.0.0.0/0:80",
              from_port: 80,
              protocol: "tcp",
              to_port: 80,
            }),
          ],
        }),
      ),
    );
  });

  test("Trivial construction: no security groups", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    const nlb = new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });
    nlb.connections.allowFromAnyIpv4(compute.Port.tcp(80));

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: false,
      subnets: [
        "${aws_subnet.Stack_PublicSubnet1_A539D629.id}",
        "${aws_subnet.Stack_PublicSubnet2_73639A20.id}",
        "${aws_subnet.Stack_PublicSubnet3_53275245.id}",
      ],
    });
    // no LoadBalancer has security groups
    template.resourceTypeArrayNotContaining(tfLoadBalancer.Lb, [
      {
        security_groups: expect.anything(),
      },
    ]);
    template.expectResources(tfSecurityGroup.SecurityGroup).toHaveLength(0);
    expect(nlb.securityGroups).toBeUndefined();
  });

  test("Trivial construction: empty security groups", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    const nlb = new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
      securityGroups: [],
    });
    nlb.connections.allowFromAnyIpv4(compute.Port.tcp(80));

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: false,
      subnets: [
        "${aws_subnet.Stack_PublicSubnet1_A539D629.id}",
        "${aws_subnet.Stack_PublicSubnet2_73639A20.id}",
        "${aws_subnet.Stack_PublicSubnet3_53275245.id}",
      ],
      security_groups: [],
    });
    template.expectResources(tfSecurityGroup.SecurityGroup).toHaveLength(0);
    expect(nlb.securityGroups).toStrictEqual([]);
  });

  test("Can add a security groups from no security groups", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const sg1 = new compute.SecurityGroup(stack, "SG1", { vpc });
    const sg2 = new compute.SecurityGroup(stack, "SG2", { vpc });

    // WHEN
    const nlb = new compute.NetworkLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });
    nlb.addSecurityGroup(sg1);
    nlb.connections.allowFromAnyIpv4(compute.Port.tcp(80));
    nlb.addSecurityGroup(sg2);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
      internal: false,
      subnets: [
        "${aws_subnet.Stack_PublicSubnet1_A539D629.id}",
        "${aws_subnet.Stack_PublicSubnet2_73639A20.id}",
        "${aws_subnet.Stack_PublicSubnet3_53275245.id}",
      ],
      security_groups: [
        stack.resolve(sg1.securityGroupId),
        stack.resolve(sg2.securityGroupId),
      ],
      load_balancer_type: "network",
    });
    template.resourceTypeArrayContaining(
      tfSecurityGroup.SecurityGroup,
      // expect both security groups to have ingres rule
      Array(2).fill(
        expect.objectContaining({
          ingress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "from 0.0.0.0/0:80",
              from_port: 80,
              protocol: "tcp",
              to_port: 80,
            }),
          ],
        }),
      ),
    );
  });

  // // TODO: Add Grid Context Provider for lookups
  // describe("lookup", () => {
  //   test("Can look up a NetworkLoadBalancer", () => {
  //     // GIVEN
  //     // TODO: For non-agnostic Stack:
  //     // env: {
  //     //   account: "123456789012",
  //     //   region: "us-west-2",
  //     // },
  //     // WHEN
  //     const loadBalancer = compute.NetworkLoadBalancer.fromLookup(stack, "a", {
  //       loadBalancerTags: {
  //         some: "tag",
  //       },
  //     });

  //     // THEN
  //     Template.fromStack(stack).resourceCountIs(
  //       "AWS::ElasticLoadBalancingV2::NetworkLoadBalancer",
  //       0,
  //     );
  //     expect(loadBalancer.loadBalancerArn).toEqual(
  //       "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/network/my-load-balancer/50dc6c495c0c9188",
  //     );
  //     expect(loadBalancer.loadBalancerCanonicalHostedZoneId).toEqual(
  //       "Z3DZXE0EXAMPLE",
  //     );
  //     expect(loadBalancer.loadBalancerDnsName).toEqual(
  //       "my-load-balancer-1234567890.us-west-2.elb.amazonaws.com",
  //     );
  //     expect(loadBalancer.env.region).toEqual("us-west-2");
  //   });

  //   test("Can add listeners to a looked-up NetworkLoadBalancer", () => {
  //     // GIVEN
  //     // TODO: For non-agnostic Stack:
  //     // env: {
  //     //   account: "123456789012",
  //     //   region: "us-west-2",
  //     // },
  //     const loadBalancer = compute.NetworkLoadBalancer.fromLookup(stack, "a", {
  //       loadBalancerTags: {
  //         some: "tag",
  //       },
  //     });

  //     const targetGroup = new compute.NetworkTargetGroup(stack, "tg", {
  //       vpc: loadBalancer.vpc,
  //       port: 3000,
  //     });

  //     // WHEN
  //     loadBalancer.addListener("listener", {
  //       protocol: compute.Protocol.TCP,
  //       port: 3000,
  //       defaultAction: compute.NetworkListenerAction.forward([targetGroup]),
  //     });

  //     // THEN
  //     Template.fromStack(stack).resourceCountIs(
  //       "AWS::ElasticLoadBalancingV2::NetworkLoadBalancer",
  //       0,
  //     );
  //     Template.fromStack(stack).resourceCountIs(
  //       "AWS::ElasticLoadBalancingV2::Listener",
  //       1,
  //     );
  //   });
  //   test("Can create metrics from a looked-up NetworkLoadBalancer", () => {
  //     // GIVEN
  //     // TODO: For non-agnostic Stack:
  //     // env: {
  //     //   account: "123456789012",
  //     //   region: "us-west-2",
  //     // },

  //     const loadBalancer = compute.NetworkLoadBalancer.fromLookup(stack, "a", {
  //       loadBalancerTags: {
  //         some: "tag",
  //       },
  //     });

  //     // WHEN
  //     const metric = loadBalancer.metrics.custom("MetricName");

  //     // THEN
  //     expect(metric.namespace).toEqual("AWS/NetworkELB");
  //     expect(stack.resolve(metric.dimensions)).toEqual({
  //       LoadBalancer: "network/my-load-balancer/50dc6c495c0c9188",
  //     });
  //   });

  //   test("can look up security groups", () => {
  //     // GIVEN
  //     // TODO: For non-agnostic Stack:
  //     // env: {
  //     //   account: "123456789012",
  //     //   region: "us-west-2",
  //     // },

  //     // WHEN
  //     const nlb = compute.NetworkLoadBalancer.fromLookup(stack, "LB", {
  //       loadBalancerTags: {
  //         some: "tag",
  //       },
  //     });
  //     nlb.connections.allowFromAnyIpv4(compute.Port.tcp(80));

  //     // THEN
  //     Template.fromStack(stack).toHaveResourceWithProperties(
  //       "AWS::EC2::SecurityGroupIngress",
  //       {
  //         CidrIp: "0.0.0.0/0",
  //         Description: "from 0.0.0.0/0:80",
  //         FromPort: 80,
  //         // ID of looked-up security group is dummy value (defined by ec2.SecurityGroup.fromLookupAttributes)
  //         GroupId: "sg-12345678",
  //         IpProtocol: "tcp",
  //         ToPort: 80,
  //       },
  //     );
  //     // IDs of looked-up nlb security groups are dummy values (defined by elbv2.BaseLoadBalancer._queryContextProvider)
  //     expect(nlb.securityGroups).toEqual(["sg-1234"]);
  //   });
  // });

  // test cases for crossZoneEnabled
  describe("crossZoneEnabled", () => {
    test("crossZoneEnabled can be true", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Vpc");

      // WHEN
      new compute.NetworkLoadBalancer(stack, "nlb", {
        vpc,
        crossZoneEnabled: true,
      });
      const t = new Template(stack);
      t.expectResources(tfLoadBalancer.Lb).toHaveLength(1);
      t.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
        enable_deletion_protection: false,
        enable_cross_zone_load_balancing: true,
      });
    });
    test("crossZoneEnabled can be false", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Vpc");

      // WHEN
      new compute.NetworkLoadBalancer(stack, "nlb", {
        vpc,
        crossZoneEnabled: false,
      });
      const t = new Template(stack);
      t.expectResources(tfLoadBalancer.Lb).toHaveLength(1);
      t.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
        enable_deletion_protection: false,
        enable_cross_zone_load_balancing: false,
      });
    });
    test("crossZoneEnabled can be undefined", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Vpc");

      // WHEN
      new compute.NetworkLoadBalancer(stack, "nlb", {
        vpc,
      });
      const t = new Template(stack);
      t.expectResources(tfLoadBalancer.Lb).toHaveLength(1);
      t.expect.toHaveResourceWithProperties(tfLoadBalancer.Lb, {
        enable_deletion_protection: false,
      });
    });
  });
  describe("dualstack", () => {
    test("Can create internet-facing dualstack NetworkLoadBalancer", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.NetworkLoadBalancer(stack, "LB", {
        vpc,
        internetFacing: true,
        ipAddressType: compute.IpAddressType.DUAL_STACK,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
        internal: false,
        ip_address_type: "dualstack",
        load_balancer_type: "network",
      });
    });

    test("Can create internet-facing dualstack NetworkLoadBalancer with denyAllIgwTraffic set to false", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.NetworkLoadBalancer(stack, "LB", {
        vpc,
        denyAllIgwTraffic: false,
        internetFacing: true,
        ipAddressType: compute.IpAddressType.DUAL_STACK,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
        internal: false,
        ip_address_type: "dualstack",
        load_balancer_type: "network",
      });
    });

    test.each([undefined, false])(
      "Can create internal dualstack NetworkLoadBalancer with denyAllIgwTraffic set to true",
      (internetFacing) => {
        // GIVEN
        const vpc = new compute.Vpc(stack, "Stack");

        // WHEN
        new compute.NetworkLoadBalancer(stack, "LB", {
          vpc,
          denyAllIgwTraffic: true,
          internetFacing: internetFacing,
          ipAddressType: compute.IpAddressType.DUAL_STACK,
        });

        // THEN
        Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
          internal: true,
          ip_address_type: "dualstack",
          load_balancer_type: "network",
        });
      },
    );
  });

  // TODO: Missing in provider-aws
  // https://github.com/hashicorp/terraform-provider-aws/issues/40379
  // describe("enable prefix for ipv6 source nat", () => {
  //   test.each([
  //     { config: true, value: "on" },
  //     { config: false, value: "off" },
  //   ])("specify EnablePrefixForIpv6SourceNat", ({ config, value }) => {
  //     // GIVEN
  //     const vpc = new compute.Vpc(stack, "Stack");

  //     // WHEN
  //     new compute.NetworkLoadBalancer(stack, "Lb", {
  //       vpc,
  //       enablePrefixForIpv6SourceNat: config,
  //       ipAddressType: compute.IpAddressType.DUAL_STACK,
  //     });

  //     // THEN
  //     Template.synth(stack).toHaveResourceWithProperties(tfLoadBalancer.Lb, {
  //       internal: true,
  //       type: "network",
  //       ip_address_type: "dualstack",
  //       enable_prefix_for_ipv6_source_nat: value,
  //     });
  //   });

  //   test.each([false, undefined])(
  //     "throw error for disabling `enablePrefixForIpv6SourceNat` and add UDP listener",
  //     (enablePrefixForIpv6SourceNat) => {
  //       // GIVEN
  //       const vpc = new compute.Vpc(stack, "Stack");
  //       const lb = new compute.NetworkLoadBalancer(stack, "Lb", {
  //         vpc,
  //         ipAddressType: compute.IpAddressType.DUAL_STACK,
  //         enablePrefixForIpv6SourceNat,
  //       });

  //       // THEN
  //       expect(() => {
  //         lb.addListener("Listener", {
  //           port: 80,
  //           protocol: compute.LbProtocol.UDP,
  //           defaultTargetGroups: [
  //             new compute.NetworkTargetGroup(stack, "Group", { vpc, port: 80 }),
  //           ],
  //         });
  //       }).toThrow(
  //         "To add a listener with UDP protocol to a dual stack NLB, 'enablePrefixForIpv6SourceNat' must be set to true.",
  //       );
  //     },
  //   );
  // });

  describe("dualstack without public ipv4", () => {
    test("Throws when creating a dualstack without public ipv4 and a NetworkLoadBalancer", () => {
      const vpc = new compute.Vpc(stack, "Stack");

      expect(() => {
        new compute.NetworkLoadBalancer(stack, "LB", {
          vpc,
          internetFacing: true,
          ipAddressType: compute.IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4,
        });
      }).toThrow(
        "'ipAddressType' DUAL_STACK_WITHOUT_PUBLIC_IPV4 can only be used with Application Load Balancer, got network",
      );
    });
  });
});
