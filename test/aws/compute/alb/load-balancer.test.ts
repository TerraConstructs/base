// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/load-balancer.test.ts

import {
  lb as tfLb,
  lbListener as tfListener,
  s3BucketPolicy as tfS3BucketPolicy,
  dataAwsIamPolicyDocument as tfDataAwsIamPolicyDocument,
  s3Bucket as tfS3Bucket,
  s3BucketServerSideEncryptionConfiguration,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../../src/aws";
import { Metric } from "../../../../src/aws/cloudwatch";
import * as compute from "../../../../src/aws/compute";
import { Key } from "../../../../src/aws/encryption";
import * as s3 from "../../../../src/aws/storage";
import { Duration } from "../../../../src/duration";
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
    new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      internal: false,
      subnets: [
        "${aws_subnet.Stack_PublicSubnet1_A539D629.id}",
        "${aws_subnet.Stack_PublicSubnet2_73639A20.id}",
        "${aws_subnet.Stack_PublicSubnet3_53275245.id}",
      ],
      load_balancer_type: "application",
    });
  });

  test("internet facing load balancer has dependency on IGW", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      depends_on: [
        "aws_route_table_association.Stack_PublicSubnet1_RouteTableAssociation_74F1C1B6",
        "aws_route.Stack_PublicSubnet1_DefaultRoute_16154E3D",
        "aws_route_table_association.Stack_PublicSubnet2_RouteTableAssociation_5E8F73F1",
        "aws_route.Stack_PublicSubnet2_DefaultRoute_0319539B",
        "aws_route_table_association.Stack_PublicSubnet3_RouteTableAssociation_D026A62D",
        "aws_route.Stack_PublicSubnet3_DefaultRoute_BC0DA152",
      ],
    });
  });

  test("Trivial construction: internal", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.ApplicationLoadBalancer(stack, "LB", { vpc });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      internal: true,
      subnets: [
        "${aws_subnet.Stack_PrivateSubnet1_530F2940.id}",
        "${aws_subnet.Stack_PrivateSubnet2_B7F3D25A.id}",
        "${aws_subnet.Stack_PrivateSubnet3_8917711B.id}",
      ],
      load_balancer_type: "application",
    });
  });

  test("Attributes", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      deletionProtection: true,
      http2Enabled: false,
      idleTimeout: Duration.seconds(1000),
      dropInvalidHeaderFields: true,
      clientKeepAlive: Duration.seconds(200),
      preserveHostHeader: true,
      xAmznTlsVersionAndCipherSuiteHeaders: true,
      preserveXffClientPort: true,
      xffHeaderProcessingMode: compute.XffHeaderProcessingMode.PRESERVE,
      wafFailOpen: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      enable_deletion_protection: true,
      enable_http2: false,
      idle_timeout: 1000,
      drop_invalid_header_fields: true,
      preserve_host_header: true,
      enable_tls_version_and_cipher_suite_headers: true,
      enable_xff_client_port: true,
      xff_header_processing_mode: "preserve",
      enable_waf_fail_open: true,
      client_keep_alive: 200,
    });
  });

  test.each([59, 604801])(
    "throw error for invalid clientKeepAlive in seconds",
    (duration) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // THEN
      expect(() => {
        new compute.ApplicationLoadBalancer(stack, "LB", {
          vpc,
          clientKeepAlive: Duration.seconds(duration),
        });
      }).toThrow(
        `\'clientKeepAlive\' must be between 60 and 604800 seconds. Got: ${duration} seconds`,
      );
    },
  );

  test("throw errer for invalid clientKeepAlive in milliseconds", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // THEN
    expect(() => {
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        clientKeepAlive: Duration.millis(100),
      });
    }).toThrow(
      "'clientKeepAlive' must be between 60 and 604800 seconds. Got: 100 milliseconds",
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
        new compute.ApplicationLoadBalancer(stack, "LB", {
          vpc,
          denyAllIgwTraffic: denyAllIgwTraffic,
          ipAddressType: ipAddressType,
        });
      }).toThrow(
        `'denyAllIgwTraffic' may only be set on load balancers with ${compute.IpAddressType.DUAL_STACK} addressing.`,
      );
    },
  );

  describe("Desync mitigation mode", () => {
    test("Defensive", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        desyncMitigationMode: compute.DesyncMitigationMode.DEFENSIVE,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        desync_mitigation_mode: "defensive",
      });
    });
    test("Monitor", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        desyncMitigationMode: compute.DesyncMitigationMode.MONITOR,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        desync_mitigation_mode: "monitor",
      });
    });
    test("Strictest", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        desyncMitigationMode: compute.DesyncMitigationMode.STRICTEST,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        desync_mitigation_mode: "strictest",
      });
    });
  });

  describe("http2Enabled", () => {
    test("http2Enabled is not set", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
      });

      // THEN
      Template.synth(stack).not.toHaveResourceWithProperties(tfLb.Lb, {
        enableHttp2: expect.any(Boolean),
      });
    });

    test.each([true, false])("http2Enabled is set to %s", (http2Enabled) => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");
      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        http2Enabled,
      });
      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        enable_http2: http2Enabled,
      });
    });
  });

  test("Deletion protection false", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      deletionProtection: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      enable_deletion_protection: false,
    });
  });

  test("Can add and list listeners for an owned ApplicationLoadBalancer", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    const loadBalancer = new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      internetFacing: true,
    });

    const listener = loadBalancer.addListener("listener", {
      protocol: compute.ApplicationProtocol.HTTP,
      defaultAction: compute.ListenerAction.fixedResponse(200),
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(tfListener.LbListener, 1);
    expect(loadBalancer.listeners).toContain(listener);
  });

  describe("logAccessLogs", () => {
    class ExtendedLB extends compute.ApplicationLoadBalancer {
      constructor(scope: Construct, id: string, vpc: compute.IVpc) {
        super(scope, id, { vpc });

        const accessLogsBucket = new s3.Bucket(this, "ALBAccessLogsBucket", {
          // TODO: re-add support for blockPublicAccess to s3 bucket
          // blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          versioned: true,

          // TODO: re-add support for serverAccessLogsBucket to s3 bucket
          /**
           * Optional log file prefix to use for the bucket's access logs.
           * If defined without "serverAccessLogsBucket", enables access logs to current bucket with this prefix.
           * @default - No log file prefix
           */
          // serverAccessLogsPrefix: "selflog/",
          enforceSSL: true,
        });

        this.logAccessLogs(accessLogsBucket);
      }
    }

    function loggingSetup(
      s: AwsStack,
      withEncryption: boolean = false,
    ): {
      // stack: AwsStack;
      bucket: s3.Bucket;
      lb: compute.ApplicationLoadBalancer;
    } {
      // const s = new cdk.Stack(app, undefined, {
      //   env: { region: "us-east-1" },
      // });
      const vpc = new compute.Vpc(s, "Vpc");
      let bucketProps = {};
      if (withEncryption) {
        const kmsKey = new Key(s, "TestKMSKey");
        bucketProps = {
          ...bucketProps,
          encryption: s3.BucketEncryption.KMS,
          encyptionKey: kmsKey,
        };
      }
      const bucket = new s3.Bucket(s, "AccessLogBucket", {
        ...bucketProps,
      });
      const lb = new compute.ApplicationLoadBalancer(s, "LB", { vpc });
      // return { stack: s, bucket, lb };
      return { bucket, lb };
    }

    test("sets load balancer attributes", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logAccessLogs(bucket);

      //THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        access_logs: {
          bucket: "${aws_s3_bucket.AccessLogBucket_DA470295.bucket}",
          enabled: true,
        },
      });
    });

    test("adds a dependency on the bucket", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logAccessLogs(bucket);

      // THEN
      // verify the ALB depends on the bucket policy
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        depends_on: ["aws_s3_bucket_policy.AccessLogBucket_Policy_F52D2D01"],
      });
    });

    test("logging bucket permissions", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logAccessLogs(bucket);

      // THEN
      // verify the bucket policy allows the ALB to put objects in the bucket
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfS3BucketPolicy.S3BucketPolicy, {
        policy:
          "${data.aws_iam_policy_document.AccessLogBucket_Policy_D52E1EE1.json}",
      });
      t.expect.toHaveDataSourceWithProperties(
        tfDataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
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
                "${aws_s3_bucket.AccessLogBucket_DA470295.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:PutObject"],
              condition: [
                {
                  test: "StringEquals",
                  values: ["bucket-owner-full-control"],
                  variable: "s3:x-amz-acl",
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: [
                "${aws_s3_bucket.AccessLogBucket_DA470295.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:GetBucketAcl"],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: ["${aws_s3_bucket.AccessLogBucket_DA470295.arn}"],
            },
          ],
        },
      );
    });

    test("access logging with prefix", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logAccessLogs(bucket, "prefix-of-access-logs");

      // THEN
      // verify that the LB attributes reference the bucket
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        access_logs: {
          bucket: "${aws_s3_bucket.AccessLogBucket_DA470295.bucket}",
          enabled: true,
          prefix: "prefix-of-access-logs",
        },
      });

      // verify the bucket policy allows the ALB to put objects in the bucket
      t.expect.toHaveResourceWithProperties(tfS3BucketPolicy.S3BucketPolicy, {
        policy:
          "${data.aws_iam_policy_document.AccessLogBucket_Policy_D52E1EE1.json}",
      });
      t.expect.toHaveDataSourceWithProperties(
        tfDataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
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
                "${aws_s3_bucket.AccessLogBucket_DA470295.arn}/prefix-of-access-logs/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:PutObject"],
              condition: [
                {
                  test: "StringEquals",
                  values: ["bucket-owner-full-control"],
                  variable: "s3:x-amz-acl",
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: [
                "${aws_s3_bucket.AccessLogBucket_DA470295.arn}/prefix-of-access-logs/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:GetBucketAcl"],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: ["${aws_s3_bucket.AccessLogBucket_DA470295.arn}"],
            },
          ],
        },
      );
    });

    // // TODO: re-add support for s3 encryption
    // test("bucket with KMS throws validation error", () => {
    //   //GIVEN
    //   const { bucket, lb } = loggingSetup(stack, true);

    //   // WHEN
    //   const logAccessLogFunctionTest = () => lb.logAccessLogs(bucket);

    //   // THEN
    //   // verify failure in case the access log bucket is encrypted with KMS
    //   expect(logAccessLogFunctionTest).toThrow(
    //     "Encryption key detected. Bucket encryption using KMS keys is unsupported",
    //   );
    // });

    test("access logging on imported bucket", () => {
      // GIVEN
      const { lb } = loggingSetup(stack);

      const bucket = s3.Bucket.fromBucketName(
        stack,
        "ImportedAccessLoggingBucket",
        "imported-bucket",
      );
      // Imported buckets have `autoCreatePolicy` disabled by default
      bucket.policy = new s3.BucketPolicy(
        stack,
        "ImportedAccessLoggingBucketPolicy",
        {
          bucket,
        },
      );

      // WHEN
      lb.logAccessLogs(bucket);

      // THEN
      // verify that the LB attributes reference the bucket
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        access_logs: {
          bucket: "imported-bucket",
          // bucket: "${data.aws_s3_bucket.imported-bucket.bucket}",
          enabled: true,
        },
      });

      // verify the bucket policy allows the ALB to put objects in the bucket
      t.expect.toHaveResourceWithProperties(tfS3BucketPolicy.S3BucketPolicy, {
        policy:
          "${data.aws_iam_policy_document.ImportedAccessLoggingBucketPolicy_73EC6E72.json}",
      });
      t.expect.toHaveDataSourceWithProperties(
        tfDataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
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
              condition: [
                {
                  test: "StringEquals",
                  values: ["bucket-owner-full-control"],
                  variable: "s3:x-amz-acl",
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
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
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
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

      // verify the ALB depends on the bucket policy
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        depends_on: [
          "aws_s3_bucket_policy.ImportedAccessLoggingBucketPolicy_97AE3371",
        ],
      });
    });

    test("does not add circular dependency on bucket with extended load balancer", () => {
      // GIVEN
      loggingSetup(stack);
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new ExtendedLB(stack, "ExtendedLB", vpc);

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        s3BucketServerSideEncryptionConfiguration.S3BucketServerSideEncryptionConfigurationA,
        {
          bucket:
            "${aws_s3_bucket.ExtendedLB_ALBAccessLogsBucket_91B858AC.bucket}",
          rule: [
            {
              apply_server_side_encryption_by_default: {
                sse_algorithm: "AES256",
              },
            },
          ],
        },
        // UpdateReplacePolicy: "Retain",
        // DeletionPolicy: "Retain",
        // DependsOn: Match.absent(),
      );
      // s3 bucket properties...
      // t.expect.toHaveResourceWithProperties(tfS3Bucket.S3Bucket, {
      //   AccessControl: "LogDeliveryWrite",
      //   LoggingConfiguration: {
      //     LogFilePrefix: "selflog/",
      //   },
      //   OwnershipControls: {
      //     Rules: [
      //       {
      //         ObjectOwnership: "ObjectWriter",
      //       },
      //     ],
      //   },
      //   PublicAccessBlockConfiguration: {
      //     BlockPublicAcls: true,
      //     BlockPublicPolicy: true,
      //     IgnorePublicAcls: true,
      //     RestrictPublicBuckets: true,
      //   },
      //   VersioningConfiguration: {
      //     Status: "Enabled",
      //   },
      //   // UpdateReplacePolicy: "Retain",
      //   // DeletionPolicy: "Retain",
      // });
    });
  });

  describe("logConnectionLogs", () => {
    class ExtendedLB extends compute.ApplicationLoadBalancer {
      constructor(scope: Construct, id: string, vpc: compute.IVpc) {
        super(scope, id, { vpc });

        const connectionLogsBucket = new s3.Bucket(
          this,
          "ALBConnectionLogsBucket",
          {
            // TODO: re-add support for blockPublicAccess to s3 bucket
            // blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            // TODO: re-add support for serverAccessLogsBucket to s3 bucket
            /**
             * Optional log file prefix to use for the bucket's access logs.
             * If defined without "serverAccessLogsBucket", enables access logs to current bucket with this prefix.
             * @default - No log file prefix
             */
            // serverAccessLogsPrefix: "selflog/",
            enforceSSL: true,
          },
        );

        this.logConnectionLogs(connectionLogsBucket);
      }
    }

    function loggingSetup(
      s: AwsStack,
      withEncryption: boolean = false,
    ): {
      bucket: s3.Bucket;
      lb: compute.ApplicationLoadBalancer;
    } {
      // const stack = new cdk.Stack(app, undefined, {
      //   env: { region: "us-east-1" },
      // });
      const vpc = new compute.Vpc(s, "Stack");
      let bucketProps = {};
      if (withEncryption) {
        const kmsKey = new Key(s, "TestKMSKey");
        bucketProps = {
          ...bucketProps,
          encryption: s3.BucketEncryption.KMS,
          encyptionKey: kmsKey,
        };
      }
      const bucket = new s3.Bucket(s, "ConnectionLogBucket", {
        ...bucketProps,
      });
      const lb = new compute.ApplicationLoadBalancer(s, "LB", { vpc });
      return { bucket, lb };
    }

    test("sets load balancer attributes", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logConnectionLogs(bucket);

      //THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        connection_logs: {
          bucket: "${aws_s3_bucket.ConnectionLogBucket_FDE8490A.bucket}",
          enabled: true,
          prefix: "",
        },
      });
    });

    test("adds a dependency on the bucket", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logConnectionLogs(bucket);

      // THEN
      // verify the ALB depends on the bucket policy
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        depends_on: [
          "aws_s3_bucket_policy.ConnectionLogBucket_Policy_F17C8635",
        ],
      });
    });

    test("logging bucket permissions", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logConnectionLogs(bucket);

      // THEN
      // verify the bucket policy allows the ALB to put objects in the bucket
      const t = new Template(stack);

      // verify the bucket policy allows the ALB to put objects in the bucket
      t.expect.toHaveResourceWithProperties(tfS3BucketPolicy.S3BucketPolicy, {
        policy:
          "${data.aws_iam_policy_document.ConnectionLogBucket_Policy_A3D7FB0E.json}",
      });
      t.expect.toHaveDataSourceWithProperties(
        tfDataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
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
                "${aws_s3_bucket.ConnectionLogBucket_FDE8490A.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:PutObject"],
              condition: [
                {
                  test: "StringEquals",
                  values: ["bucket-owner-full-control"],
                  variable: "s3:x-amz-acl",
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: [
                "${aws_s3_bucket.ConnectionLogBucket_FDE8490A.arn}/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:GetBucketAcl"],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: ["${aws_s3_bucket.ConnectionLogBucket_FDE8490A.arn}"],
            },
          ],
        },
      );
    });

    test("connection logging with prefix", () => {
      // GIVEN
      const { bucket, lb } = loggingSetup(stack);

      // WHEN
      lb.logConnectionLogs(bucket, "prefix-of-connection-logs");

      // THEN
      // verify that the LB attributes reference the bucket
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        connection_logs: {
          bucket: "${aws_s3_bucket.ConnectionLogBucket_FDE8490A.bucket}",
          enabled: true,
          prefix: "prefix-of-connection-logs",
        },
      });

      // verify the bucket policy allows the ALB to put objects in the bucket
      t.expect.toHaveResourceWithProperties(tfS3BucketPolicy.S3BucketPolicy, {
        policy:
          "${data.aws_iam_policy_document.ConnectionLogBucket_Policy_A3D7FB0E.json}",
      });
      t.expect.toHaveDataSourceWithProperties(
        tfDataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
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
                "${aws_s3_bucket.ConnectionLogBucket_FDE8490A.arn}/prefix-of-connection-logs/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:PutObject"],
              condition: [
                {
                  test: "StringEquals",
                  values: ["bucket-owner-full-control"],
                  variable: "s3:x-amz-acl",
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: [
                "${aws_s3_bucket.ConnectionLogBucket_FDE8490A.arn}/prefix-of-connection-logs/AWSLogs/${data.aws_caller_identity.CallerIdentity.account_id}/*",
              ],
            },
            {
              actions: ["s3:GetBucketAcl"],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
                },
              ],
              resources: ["${aws_s3_bucket.ConnectionLogBucket_FDE8490A.arn}"],
            },
          ],
        },
      );
    });

    // // TODO: Re-add S3 bucket Encryption
    test("bucket with KMS throws validation error", () => {
      //GIVEN
      const { bucket, lb } = loggingSetup(stack, true);

      // WHEN
      const logConnectionLogFunctionTest = () => lb.logConnectionLogs(bucket);

      // THEN
      // verify failure in case the connection log bucket is encrypted with KMS
      expect(logConnectionLogFunctionTest).toThrow(
        "Encryption key detected. Bucket encryption using KMS keys is unsupported",
      );
    });

    test("connection logging on imported bucket", () => {
      // GIVEN
      const { lb } = loggingSetup(stack);

      const bucket = s3.Bucket.fromBucketName(
        stack,
        "ImportedConnectionLoggingBucket",
        "imported-bucket",
      );
      // Imported buckets have `autoCreatePolicy` disabled by default
      bucket.policy = new s3.BucketPolicy(
        stack,
        "ImportedConnectionLoggingBucketPolicy",
        {
          bucket,
        },
      );

      // WHEN
      lb.logConnectionLogs(bucket);

      // THEN
      // verify that the LB attributes reference the bucket
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        connection_logs: {
          bucket: "imported-bucket",
          // bucket: "${data.aws_s3_bucket.imported-bucket.bucket}",
          enabled: true,
          prefix: "",
        },
      });

      // verify the bucket policy allows the ALB to put objects in the bucket
      t.expect.toHaveResourceWithProperties(tfS3BucketPolicy.S3BucketPolicy, {
        policy:
          "${data.aws_iam_policy_document.ImportedConnectionLoggingBucketPolicy_CE5B9410.json}",
      });
      t.expect.toHaveDataSourceWithProperties(
        tfDataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
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
              condition: [
                {
                  test: "StringEquals",
                  values: ["bucket-owner-full-control"],
                  variable: "s3:x-amz-acl",
                },
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
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
                  identifiers: [
                    "${data.aws_service_principal.aws_svcp_default_region_deliverylogsamazonawscom.name}",
                  ],
                  type: "Service",
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

      // verify the ALB depends on the bucket policy
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        depends_on: [
          "aws_s3_bucket_policy.ImportedConnectionLoggingBucketPolicy_548EEC12",
          "aws_s3_bucket_policy.ImportedConnectionLoggingBucketPolicy_548EEC12", // TODO: why is dependency doubled?
        ],
      });
    });

    test("does not add circular dependency on bucket with extended load balancer", () => {
      // GIVEN
      loggingSetup(stack);
      const vpc = new compute.Vpc(stack, "Vpc");

      // WHEN
      new ExtendedLB(stack, "ExtendedLB", vpc);

      // THEN
      const t = new Template(stack);
      // s3 bucket properties...
      t.expect.toHaveResourceWithProperties(
        s3BucketServerSideEncryptionConfiguration.S3BucketServerSideEncryptionConfigurationA,
        {
          bucket:
            "${aws_s3_bucket.ExtendedLB_ALBConnectionLogsBucket_AD5E546F.bucket}",
          rule: [
            {
              apply_server_side_encryption_by_default: {
                sse_algorithm: "AES256",
              },
            },
          ],
          // BucketEncryption: {
          //   ServerSideEncryptionConfiguration: [
          //     {
          //       ServerSideEncryptionByDefault: {
          //         SSEAlgorithm: "AES256",
          //       },
          //     },
          //   ],
          // },
        },
        // UpdateReplacePolicy: "Retain",
        // DeletionPolicy: "Retain",
        // DependsOn: Match.absent(),
      );
      // s3 bucket properties...
      // t.expect.toHaveResourceWithProperties(tfS3Bucket.S3Bucket, {
      //   AccessControl: "LogDeliveryWrite",
      //   LoggingConfiguration: {
      //     LogFilePrefix: "selflog/",
      //   },
      //   OwnershipControls: {
      //     Rules: [
      //       {
      //         ObjectOwnership: "ObjectWriter",
      //       },
      //     ],
      //   },
      //   PublicAccessBlockConfiguration: {
      //     BlockPublicAcls: true,
      //     BlockPublicPolicy: true,
      //     IgnorePublicAcls: true,
      //     RestrictPublicBuckets: true,
      //   },
      //   VersioningConfiguration: {
      //     Status: "Enabled",
      //   },
      //   // UpdateReplacePolicy: "Retain",
      //   // DeletionPolicy: "Retain",
      //   // DependsOn: Match.absent(),
      // });
      t.expect.not.toHaveResourceWithProperties(tfS3Bucket.S3Bucket, {
        DependsOn: expect.anything(),
      });
    });
  });

  test("Exercise metrics", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const metrics = new Array<Metric>();
    metrics.push(lb.metrics.activeConnectionCount());
    metrics.push(lb.metrics.clientTlsNegotiationErrorCount());
    metrics.push(lb.metrics.consumedLCUs());
    metrics.push(lb.metrics.elbAuthError());
    metrics.push(lb.metrics.elbAuthFailure());
    metrics.push(lb.metrics.elbAuthLatency());
    metrics.push(lb.metrics.elbAuthSuccess());
    metrics.push(lb.metrics.httpCodeElb(compute.HttpCodeElb.ELB_3XX_COUNT));
    metrics.push(
      lb.metrics.httpCodeTarget(compute.HttpCodeTarget.TARGET_3XX_COUNT),
    );
    metrics.push(lb.metrics.httpFixedResponseCount());
    metrics.push(lb.metrics.httpRedirectCount());
    metrics.push(lb.metrics.httpRedirectUrlLimitExceededCount());
    metrics.push(lb.metrics.ipv6ProcessedBytes());
    metrics.push(lb.metrics.ipv6RequestCount());
    metrics.push(lb.metrics.newConnectionCount());
    metrics.push(lb.metrics.processedBytes());
    metrics.push(lb.metrics.rejectedConnectionCount());
    metrics.push(lb.metrics.requestCount());
    metrics.push(lb.metrics.ruleEvaluations());
    metrics.push(lb.metrics.targetConnectionErrorCount());
    metrics.push(lb.metrics.targetResponseTime());
    metrics.push(lb.metrics.targetTLSNegotiationErrorCount());

    for (const metric of metrics) {
      expect(metric.namespace).toEqual("AWS/ApplicationELB");
      expect(stack.resolve(metric.dimensions)).toEqual({
        LoadBalancer:
          // { "Fn::GetAtt": ["LB8A12904C", "LoadBalancerFullName"] },
          '${element(split("/", element(split(":", aws_lb.LB_8A12904C.arn), 5)), 0)}',
      });
    }
  });

  test.each([
    compute.HttpCodeElb.ELB_500_COUNT,
    compute.HttpCodeElb.ELB_502_COUNT,
    compute.HttpCodeElb.ELB_503_COUNT,
    compute.HttpCodeElb.ELB_504_COUNT,
  ])("use specific load balancer generated 5XX metrics", (metricName) => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");
    const lb = new compute.ApplicationLoadBalancer(stack, "LB", { vpc });

    // WHEN
    const metric = lb.metrics.httpCodeElb(metricName);

    // THEN
    expect(metric.namespace).toEqual("AWS/ApplicationELB");
    expect(metric.statistic).toEqual("Sum");
    expect(metric.metricName).toEqual(metricName);
    expect(stack.resolve(metric.dimensions)).toEqual({
      // { "Fn::GetAtt": ["LB8A12904C", "LoadBalancerFullName"] },
      LoadBalancer:
        '${element(split("/", element(split(":", aws_lb.LB_8A12904C.arn), 5)), 0)}',
    });
  });

  test("loadBalancerName", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Stack");

    // WHEN
    new compute.ApplicationLoadBalancer(stack, "ALB", {
      loadBalancerName: "myLoadBalancer",
      vpc,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      name: "myLoadBalancer",
    });
  });

  test("imported load balancer with no vpc throws error when calling addTargets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const albArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const sg = new compute.SecurityGroup(stack, "sg", {
      vpc,
      securityGroupName: "mySg",
    });
    const alb =
      compute.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
        stack,
        "ALB",
        {
          loadBalancerArn: albArn,
          securityGroupId: sg.securityGroupId,
        },
      );

    // WHEN
    const listener = alb.addListener("Listener", { port: 80 });
    expect(() => listener.addTargets("Targets", { port: 8080 })).toThrow();
  });

  test("imported load balancer with vpc does not throw error when calling addTargets", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const albArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const sg = new compute.SecurityGroup(stack, "sg", {
      vpc,
      securityGroupName: "mySg",
    });
    const alb =
      compute.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
        stack,
        "ALB",
        {
          loadBalancerArn: albArn,
          securityGroupId: sg.securityGroupId,
          vpc,
        },
      );

    // WHEN
    const listener = alb.addListener("Listener", { port: 80 });
    expect(() => listener.addTargets("Targets", { port: 8080 })).not.toThrow();
  });

  test("imported load balancer with vpc can add but not list listeners", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const albArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const sg = new compute.SecurityGroup(stack, "sg", {
      vpc,
      securityGroupName: "mySg",
    });
    const alb =
      compute.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
        stack,
        "ALB",
        {
          loadBalancerArn: albArn,
          securityGroupId: sg.securityGroupId,
          vpc,
        },
      );

    // WHEN
    const listener = alb.addListener("Listener", { port: 80 });
    listener.addTargets("Targets", { port: 8080 });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(tfListener.LbListener, 1);
    expect(() => alb.listeners).toThrow();
  });

  test("imported load balancer knows its region", () => {
    // WHEN
    const albArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const alb =
      compute.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
        stack,
        "ALB",
        {
          loadBalancerArn: albArn,
          securityGroupId: "sg-1234",
        },
      );

    // THEN
    expect(alb.env.region).toEqual("us-west-2");
  });

  test("imported load balancer can produce metrics", () => {
    // WHEN
    const albArn =
      "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/my-load-balancer/50dc6c495c0c9188";
    const alb =
      compute.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
        stack,
        "ALB",
        {
          loadBalancerArn: albArn,
          securityGroupId: "sg-1234",
        },
      );

    // THEN
    const metric = alb.metrics.activeConnectionCount();
    expect(metric.namespace).toEqual("AWS/ApplicationELB");
    expect(stack.resolve(metric.dimensions)).toEqual({
      LoadBalancer: "app/my-load-balancer/50dc6c495c0c9188",
    });
    expect(alb.env.region).toEqual("us-west-2");
  });

  test("can add secondary security groups", () => {
    const vpc = new compute.Vpc(stack, "Stack");

    const alb = new compute.ApplicationLoadBalancer(stack, "LB", {
      vpc,
      securityGroup: new compute.SecurityGroup(stack, "SecurityGroup1", {
        vpc,
      }),
    });
    alb.addSecurityGroup(
      new compute.SecurityGroup(stack, "SecurityGroup2", { vpc }),
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
      security_groups: [
        "${aws_security_group.SecurityGroup1_F554B36F.id}",
        "${aws_security_group.SecurityGroup2_3BE86BB7.id}",
      ],
      load_balancer_type: "application",
    });
  });

  // test cases for crossZoneEnabled
  describe("crossZoneEnabled", () => {
    test("crossZoneEnabled can be true", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Vpc");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "alb", {
        vpc,
        crossZoneEnabled: true,
      });
      const t = new Template(stack);
      t.resourceCountIs(tfLb.Lb, 1);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        enable_cross_zone_load_balancing: true,
        enable_deletion_protection: false,
      });
    });
    test("crossZoneEnabled can be undefined", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Vpc");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "alb", {
        vpc,
      });
      const t = new Template(stack);
      t.resourceCountIs(tfLb.Lb, 1);
      t.expect.toHaveResourceWithProperties(tfLb.Lb, {
        enable_deletion_protection: false,
      });
    });
    test("crossZoneEnabled cannot be false", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Vpc");

      // expect the error
      expect(() => {
        new compute.ApplicationLoadBalancer(stack, "alb", {
          vpc,
          crossZoneEnabled: false,
        });
      }).toThrow(
        "crossZoneEnabled cannot be false with Application Load Balancers.",
      );
    });
  });

  // // TODO: Implement Grid Lookup
  // describe("lookup", () => {
  //   test("Can look up an ApplicationLoadBalancer", () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     const stack = new cdk.Stack(app, "stack", {
  //       env: {
  //         account: "123456789012",
  //         region: "us-west-2",
  //       },
  //     });

  //     // WHEN
  //     const loadBalancer = compute.ApplicationLoadBalancer.fromLookup(
  //       stack,
  //       "a",
  //       {
  //         loadBalancerTags: {
  //           some: "tag",
  //         },
  //       },
  //     );

  //     // THEN
  //     const t = new Template(stack);
  //     t.resourceCountIs(tfLb.Lb, 0);
  //     expect(loadBalancer.loadBalancerArn).toEqual(
  //       "arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/application/my-load-balancer/50dc6c495c0c9188",
  //     );
  //     expect(loadBalancer.loadBalancerCanonicalHostedZoneId).toEqual(
  //       "Z3DZXE0EXAMPLE",
  //     );
  //     expect(loadBalancer.loadBalancerDnsName).toEqual(
  //       "my-load-balancer-1234567890.us-west-2.elb.amazonaws.com",
  //     );
  //     expect(loadBalancer.ipAddressType).toEqual(
  //       compute.IpAddressType.DUAL_STACK,
  //     );
  //     expect(
  //       loadBalancer.connections.securityGroups[0].securityGroupId,
  //     ).toEqual("sg-12345678");
  //     expect(loadBalancer.env.region).toEqual("us-west-2");
  //   });

  //   test("Can add but not list listeners for a looked-up ApplicationLoadBalancer", () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     const stack = new cdk.Stack(app, "stack", {
  //       env: {
  //         account: "123456789012",
  //         region: "us-west-2",
  //       },
  //     });

  //     const loadBalancer = compute.ApplicationLoadBalancer.fromLookup(
  //       stack,
  //       "a",
  //       {
  //         loadBalancerTags: {
  //           some: "tag",
  //         },
  //       },
  //     );

  //     // WHEN
  //     loadBalancer.addListener("listener", {
  //       protocol: compute.ApplicationProtocol.HTTP,
  //       defaultAction: compute.ListenerAction.fixedResponse(200),
  //     });

  //     // THEN
  //     const t = new Template(stack);
  //     t.resourceCountIs(tfListener.LbListener, 1);
  //     expect(() => loadBalancer.listeners).toThrow();
  //   });

  //   test("Can create metrics for a looked-up ApplicationLoadBalancer", () => {
  //     // GIVEN
  //     const app = new cdk.App();
  //     const stack = new cdk.Stack(app, "stack", {
  //       env: {
  //         account: "123456789012",
  //         region: "us-west-2",
  //       },
  //     });

  //     const loadBalancer = compute.ApplicationLoadBalancer.fromLookup(
  //       stack,
  //       "a",
  //       {
  //         loadBalancerTags: {
  //           some: "tag",
  //         },
  //       },
  //     );

  //     // WHEN
  //     const metric = loadBalancer.metrics.activeConnectionCount();

  //     // THEN
  //     expect(metric.namespace).toEqual("AWS/ApplicationELB");
  //     expect(stack.resolve(metric.dimensions)).toEqual({
  //       LoadBalancer: "application/my-load-balancer/50dc6c495c0c9188",
  //     });
  //   });
  // });

  describe("dualstack", () => {
    test("Can create internet-facing dualstack ApplicationLoadBalancer", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        internetFacing: true,
        ipAddressType: compute.IpAddressType.DUAL_STACK,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        internal: false,
        ip_address_type: "dualstack",
        load_balancer_type: "application",
      });
    });

    test("Can create internet-facing dualstack ApplicationLoadBalancer with denyAllIgwTraffic set to false", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        denyAllIgwTraffic: false,
        internetFacing: true,
        ipAddressType: compute.IpAddressType.DUAL_STACK,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        internal: false,
        ip_address_type: "dualstack",
        load_balancer_type: "application",
      });
    });

    test("Can create internal dualstack ApplicationLoadBalancer", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        ipAddressType: compute.IpAddressType.DUAL_STACK,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        internal: true,
        ip_address_type: "dualstack",
        load_balancer_type: "application",
      });
    });

    test.each([undefined, false])(
      "Can create internal dualstack ApplicationLoadBalancer with denyAllIgwTraffic set to true",
      (internetFacing) => {
        // GIVEN
        const vpc = new compute.Vpc(stack, "Stack");

        // WHEN
        new compute.ApplicationLoadBalancer(stack, "LB", {
          vpc,
          denyAllIgwTraffic: true,
          internetFacing: internetFacing,
          ipAddressType: compute.IpAddressType.DUAL_STACK,
        });

        // THEN
        Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
          internal: true,
          ip_address_type: "dualstack",
          load_balancer_type: "application",
        });
      },
    );
  });

  describe("dualstack without public ipv4", () => {
    test("Can create internet-facing dualstack without public ipv4 ApplicationLoadBalancer", () => {
      // GIVEN
      const vpc = new compute.Vpc(stack, "Stack");

      // WHEN
      new compute.ApplicationLoadBalancer(stack, "LB", {
        vpc,
        internetFacing: true,
        ipAddressType: compute.IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(tfLb.Lb, {
        internal: false,
        ip_address_type: "dualstack-without-public-ipv4",
        load_balancer_type: "application",
      });
    });

    test("Cannot create internal dualstack without public ipv4 ApplicationLoadBalancer", () => {
      const vpc = new compute.Vpc(stack, "Stack");

      expect(() => {
        new compute.ApplicationLoadBalancer(stack, "LB", {
          vpc,
          internetFacing: false,
          ipAddressType: compute.IpAddressType.DUAL_STACK_WITHOUT_PUBLIC_IPV4,
        });
      }).toThrow(
        "dual-stack without public IPv4 address can only be used with internet-facing scheme.",
      );
    });
  });
});
