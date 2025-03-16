// https://github.com/aws/aws-cdk/blob/18fbd6d5a1a3069b0fc1356d87e534a75239e668/packages/aws-cdk-lib/aws-kinesis/test/stream.test.ts

import {
  kinesisStream,
  kinesisResourcePolicy,
  kmsKey,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing, TerraformVariable, VariableType, Op } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as kms from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import {
  Stream,
  StreamEncryption,
  StreamMode,
} from "../../../src/aws/notify/kinesis-stream";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const streamTfResource = kinesisStream.KinesisStream.tfResourceType;

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridUUID2 = "123e4567-e89b-12d4";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

// Conditional to check if the region is in the list of unsupported regions
const AwsCdkKinesisEncryptedStreamsUnsupportedRegions = `\${contains(["cn-north-1", "cn-northwest-1"], "${providerConfig.region}")}`;

describe("Kinesis data streams", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("default stream", () => {
    new Stream(stack, "MyStream");

    const t = new Template(stack);
    t.toMatchObject({
      locals: {
        AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
      },
      resource: {
        [streamTfResource]: {
          MyStream_5C050E93: {
            encryption_type:
              '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "KMS"}',
            kms_key_id:
              '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "alias/aws/kinesis"}',
            retention_period: 24,
            shard_count: 1,
          },
        },
      },
    });
  }),
    test("multiple default streams only have one condition for encryption", () => {
      new Stream(stack, "MyStream");
      new Stream(stack, "MyOtherStream");

      const t = new Template(stack);
      t.toMatchObject({
        locals: {
          AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
        },
        resource: {
          [streamTfResource]: {
            MyStream_5C050E93: {
              encryption_type:
                '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "KMS"}',
              kms_key_id:
                '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "alias/aws/kinesis"}',
              retention_period: 24,
              shard_count: 1,
            },
            MyOtherStream_86FCC9CE: {
              encryption_type:
                '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "KMS"}',
              kms_key_id:
                '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "alias/aws/kinesis"}',
              retention_period: 24,
              shard_count: 1,
            },
          },
        },
      });
    }),
    test("stream from attributes", () => {
      const s = Stream.fromStreamAttributes(stack, "MyStream", {
        streamArn: "arn:aws:kinesis:region:account-id:stream/stream-name",
      });

      expect(s.streamArn).toEqual(
        "arn:aws:kinesis:region:account-id:stream/stream-name",
      );
    }),
    test("sets account for imported stream env by fromStreamAttributes", () => {
      const imported = Stream.fromStreamAttributes(stack, "Imported", {
        streamArn:
          "arn:aws:kinesis:us-west-2:999999999999:stream/imported-stream",
      });

      expect(imported.env.account).toEqual("999999999999");
    });

  test("sets region for imported stream env by fromStreamAttributes", () => {
    const imported = Stream.fromStreamAttributes(stack, "Imported", {
      streamArn:
        "arn:aws:kinesis:us-west-2:999999999999:stream/imported-stream",
    });

    expect(imported.env.region).toEqual("us-west-2");
  });

  test("sets account for imported stream env by fromStreamArn", () => {
    const imported = Stream.fromStreamArn(
      stack,
      "Imported",
      "arn:aws:kinesis:us-west-2:999999999999:stream/imported-stream",
    );

    expect(imported.env.account).toEqual("999999999999");
  });

  test("sets region for imported stream env by fromStreamArn", () => {
    const imported = Stream.fromStreamArn(
      stack,
      "Imported",
      "arn:aws:kinesis:us-west-2:123456789012:stream/imported-stream",
    );

    expect(imported.env.region).toEqual("us-west-2");
  });

  test("uses explicit shard count", () => {
    new Stream(stack, "MyStream", {
      shardCount: 2,
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
      shard_count: 2,
    });
  }),
    test("uses explicit retention period", () => {
      new Stream(stack, "MyStream", {
        retentionPeriod: Duration.hours(168),
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
        retention_period: 168,
      });
    }),
    test("retention period must be between 24 and 8760 hours", () => {
      expect(() => {
        new Stream(stack, "MyStream1", {
          retentionPeriod: Duration.hours(8761),
        });
      }).toThrow(
        /retentionPeriod must be between 24 and 8760 hours. Received 8761/,
      );

      expect(() => {
        new Stream(stack, "MyStream2", {
          retentionPeriod: Duration.hours(23),
        });
      }).toThrow(
        /retentionPeriod must be between 24 and 8760 hours. Received 23/,
      );
    }),
    test("uses Kinesis master key if MANAGED encryption type is provided", () => {
      // WHEN
      new Stream(stack, "MyStream", {
        encryption: StreamEncryption.MANAGED,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
        encryption_type: "KMS",
        kms_key_id: "alias/aws/kinesis",
        retention_period: 24,
        shard_count: 1,
      });
    }),
    test("encryption key cannot be supplied with UNENCRYPTED as the encryption type", () => {
      const key = new kms.Key(stack, "myKey");

      expect(() => {
        new Stream(stack, "MyStream", {
          encryptionKey: key,
          encryption: StreamEncryption.UNENCRYPTED,
        });
      }).toThrow(
        /encryptionKey is specified, so 'encryption' must be set to KMS/,
      );
    }),
    test("if a KMS key is supplied, infers KMS as the encryption type", () => {
      // GIVEN
      const key = new kms.Key(stack, "myKey");

      // WHEN
      new Stream(stack, "myStream", {
        encryptionKey: key,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
        encryption_type: "KMS",
        kms_key_id: "${aws_kms_key.myKey_441A1E73.arn}",
      });
    }),
    test("auto-creates KMS key if encryption type is KMS but no key is provided", () => {
      const stream = new Stream(stack, "MyStream", {
        encryption: StreamEncryption.KMS,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(kmsKey.KmsKey, {
        description: "Created by MyStack/MyStream",
      });

      t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
        encryption_type: "KMS",
        kms_key_id: stack.resolve(stream.encryptionKey?.keyArn),
      });
    }),
    test("uses explicit KMS key if encryption type is KMS and a key is provided", () => {
      const explicitKey = new kms.Key(stack, "ExplicitKey", {
        description: "Explicit Key",
      });
      new Stream(stack, "MyStream", {
        encryption: StreamEncryption.KMS,
        encryptionKey: explicitKey,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(kmsKey.KmsKey, {
        description: "Explicit Key",
      });

      t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
        encryption_type: "KMS",
        kms_key_id: stack.resolve(explicitKey.keyArn),
      });
    }),
    test("uses explicit provisioned streamMode", () => {
      new Stream(stack, "MyStream", {
        streamMode: StreamMode.PROVISIONED,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
        stream_mode_details: {
          stream_mode: StreamMode.PROVISIONED,
        },
      });
    });

  test("uses explicit on-demand streamMode", () => {
    new Stream(stack, "MyStream", {
      streamMode: StreamMode.ON_DEMAND,
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
      stream_mode_details: {
        stream_mode: StreamMode.ON_DEMAND,
      },
    });
  });

  test("throws when using shardCount with on-demand streamMode", () => {
    expect(() => {
      new Stream(stack, "MyStream", {
        shardCount: 2,
        streamMode: StreamMode.ON_DEMAND,
      });
    }).toThrow(
      `streamMode must be set to ${StreamMode.PROVISIONED} (default) when specifying shardCount`,
    );
  });

  test("grantRead creates and attaches a policy with read only access to the principal", () => {
    const stream = new Stream(stack, "MyStream", {
      encryption: StreamEncryption.KMS,
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountPrincipal("000000000000"),
    });
    stream.grantRead(role);

    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: ["kms:Decrypt"],
            effect: "Allow",
            // ensure the Role gets kms Read permissions on the encryptionKey ARN
            resources: [stack.resolve(stream.encryptionKey?.keyArn)],
          },
        ]),
      },
    );

    t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
      kms_key_id: stack.resolve(stream.encryptionKey?.keyArn),
    });
  });

  test("grantReadWrite creates and attaches a policy to the principal", () => {
    const stream = new Stream(stack, "MyStream", {
      encryption: StreamEncryption.KMS,
    });
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountPrincipal("000000000000"),
    });
    stream.grantReadWrite(role);

    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          {
            actions: [
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
            ],
            effect: "Allow",
            // ensure the Role gets kms ReadWrite permissions on the encryptionKey ARN
            resources: [stack.resolve(stream.encryptionKey?.keyArn)],
          },
        ]),
      },
    );

    t.expect.toHaveResourceWithProperties(kinesisStream.KinesisStream, {
      kms_key_id: stack.resolve(stream.encryptionKey?.keyArn),
    });
  });

  test("grantRead creates and associates a policy with read only access to Stream", () => {
    const stream = new Stream(stack, "MyStream");
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountPrincipal("000000000000"),
    });
    stream.grantRead(role);

    const t = new Template(stack);
    t.toMatchObject({
      data: {
        aws_iam_policy_document: {
          Role_AssumeRolePolicy_B27E8126: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "arn:${data.aws_partition.Partitition.partition}:iam::000000000000:root",
                    ],
                    type: "AWS",
                  },
                ],
              },
            ],
          },
          Role_DefaultPolicy_2E5E5E0B: {
            statement: [
              {
                actions: [
                  "kinesis:DescribeStreamSummary",
                  "kinesis:GetRecords",
                  "kinesis:GetShardIterator",
                  "kinesis:ListShards",
                  "kinesis:SubscribeToShard",
                  "kinesis:DescribeStream",
                  "kinesis:ListStreams",
                  "kinesis:DescribeStreamConsumer",
                ],
                effect: "Allow",
                resources: ["${aws_kinesis_stream.MyStream_5C050E93.arn}"],
              },
            ],
          },
        },
      },
      locals: {
        AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
      },
      resource: {
        aws_iam_role: {
          Role_1ABCC5F0: {
            assume_role_policy:
              "${data.aws_iam_policy_document.Role_AssumeRolePolicy_B27E8126.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackRole",
          },
        },
        aws_iam_role_policy: {
          Role_DefaultPolicy_ResourceRoles0_50D8AFFD: {
            name: "MyStackRoleDefaultPolicy86F304AD",
            policy:
              "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
            role: "${aws_iam_role.Role_1ABCC5F0.name}",
          },
        },
        [streamTfResource]: {
          MyStream_5C050E93: {
            retention_period: 24,
            shard_count: 1,
          },
        },
      },
    });
  }),
    test("grantWrite creates and attaches a policy with write only access to Stream", () => {
      const stream = new Stream(stack, "MyStream");
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });
      stream.grantWrite(role);

      const t = new Template(stack);
      t.toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: [
                    "kinesis:ListShards",
                    "kinesis:PutRecord",
                    "kinesis:PutRecords",
                  ],
                  effect: "Allow",
                  resources: ["${aws_kinesis_stream.MyStream_5C050E93.arn}"],
                },
              ],
            },
          },
        },
        locals: {
          AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
        },
        resource: {
          aws_iam_role: {
            Role_1ABCC5F0: {
              assume_role_policy:
                "${data.aws_iam_policy_document.Role_AssumeRolePolicy_B27E8126.json}",
              name_prefix: "123e4567-e89b-12d3-MyStackRole",
            },
          },
          aws_iam_role_policy: {
            Role_DefaultPolicy_ResourceRoles0_50D8AFFD: {
              name: "MyStackRoleDefaultPolicy86F304AD",
              policy:
                "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
              role: "${aws_iam_role.Role_1ABCC5F0.name}",
            },
          },
          [streamTfResource]: {
            MyStream_5C050E93: {
              retention_period: 24,
              shard_count: 1,
            },
          },
        },
      });
    }),
    test("grantReadWrite creates and attaches a policy with write only access to Stream", () => {
      const stream = new Stream(stack, "MyStream");
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });
      stream.grantReadWrite(role);

      const t = new Template(stack);
      t.toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: [
                    "kinesis:DescribeStreamSummary",
                    "kinesis:GetRecords",
                    "kinesis:GetShardIterator",
                    "kinesis:ListShards",
                    "kinesis:SubscribeToShard",
                    "kinesis:DescribeStream",
                    "kinesis:ListStreams",
                    "kinesis:DescribeStreamConsumer",
                    "kinesis:PutRecord",
                    "kinesis:PutRecords",
                  ],
                  effect: "Allow",
                  resources: ["${aws_kinesis_stream.MyStream_5C050E93.arn}"],
                },
              ],
            },
          },
        },
        locals: {
          AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
        },
        resource: {
          aws_iam_role: {
            Role_1ABCC5F0: {
              assume_role_policy:
                "${data.aws_iam_policy_document.Role_AssumeRolePolicy_B27E8126.json}",
              name_prefix: "123e4567-e89b-12d3-MyStackRole",
            },
          },
          aws_iam_role_policy: {
            Role_DefaultPolicy_ResourceRoles0_50D8AFFD: {
              name: "MyStackRoleDefaultPolicy86F304AD",
              policy:
                "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
              role: "${aws_iam_role.Role_1ABCC5F0.name}",
            },
          },
          [streamTfResource]: {
            MyStream_5C050E93: {
              retention_period: 24,
              shard_count: 1,
            },
          },
        },
      });
    }),
    test("grant creates and attaches a policy to Stream which includes supplied permissions", () => {
      const stream = new Stream(stack, "MyStream");
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });
      stream.grant(role, "kinesis:DescribeStream");

      const t = new Template(stack);
      t.toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: ["kinesis:DescribeStream"],
                  effect: "Allow",
                  resources: ["${aws_kinesis_stream.MyStream_5C050E93.arn}"],
                },
              ],
            },
          },
        },
        locals: {
          AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
        },
        resource: {
          aws_iam_role: {
            Role_1ABCC5F0: {
              assume_role_policy:
                "${data.aws_iam_policy_document.Role_AssumeRolePolicy_B27E8126.json}",
              name_prefix: "123e4567-e89b-12d3-MyStackRole",
            },
          },
          aws_iam_role_policy: {
            Role_DefaultPolicy_ResourceRoles0_50D8AFFD: {
              name: "MyStackRoleDefaultPolicy86F304AD",
              policy:
                "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
              role: "${aws_iam_role.Role_1ABCC5F0.name}",
            },
          },
          [streamTfResource]: {
            MyStream_5C050E93: {
              retention_period: 24,
              shard_count: 1,
            },
          },
        },
      });
    }),
    test("cross-stack permissions - no encryption", () => {
      const streamFromStackA = new Stream(stack, "MyStream");

      const stackB = new AwsStack(app, "stackB", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig,
        gridBackendConfig,
      });
      const role = new iam.Role(stackB, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });
      streamFromStackA.grantRead(role);

      const t = new Template(stackB);
      t.toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: [
                    "kinesis:DescribeStreamSummary",
                    "kinesis:GetRecords",
                    "kinesis:GetShardIterator",
                    "kinesis:ListShards",
                    "kinesis:SubscribeToShard",
                    "kinesis:DescribeStream",
                    "kinesis:ListStreams",
                    "kinesis:DescribeStreamConsumer",
                  ],
                  effect: "Allow",
                  resources: [
                    "${data.terraform_remote_state.cross-stack-reference-input-MyStack.outputs.cross-stack-output-aws_kinesis_streamMyStream_5C050E93arn}",
                  ],
                },
              ],
            },
          },
        },
      });
    }),
    test("cross stack permissions - with encryption", () => {
      const streamFromStackA = new Stream(stack, "MyStream", {
        encryption: StreamEncryption.KMS,
      });

      const stackB = new AwsStack(app, "stackB", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig,
        gridBackendConfig,
      });
      const role = new iam.Role(stackB, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });
      streamFromStackA.grantRead(role);

      const t = new Template(stackB);
      t.toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: [
                    "kinesis:DescribeStreamSummary",
                    "kinesis:GetRecords",
                    "kinesis:GetShardIterator",
                    "kinesis:ListShards",
                    "kinesis:SubscribeToShard",
                    "kinesis:DescribeStream",
                    "kinesis:ListStreams",
                    "kinesis:DescribeStreamConsumer",
                  ],
                  effect: "Allow",
                  resources: [
                    "${data.terraform_remote_state.cross-stack-reference-input-MyStack.outputs.cross-stack-output-aws_kinesis_streamMyStream_5C050E93arn}",
                  ],
                },
                {
                  actions: ["kms:Decrypt"],
                  effect: "Allow",
                  // TODO: WRONG? - Cross Stack Dependency cycle prevention?
                  resources: ["*"],
                },
              ],
            },
          },
        },
      });
    });

  test("accepts if retentionPeriodHours is a Token", () => {
    const retentionPeriodVar = new TerraformVariable(
      stack,
      "my-retention-period",
      {
        type: VariableType.NUMBER,
        default: 48,
        // minValue: 24,
        // maxValue: 8760,
      },
    );
    // Just for fun..
    retentionPeriodVar.addValidation({
      condition: Op.gte(retentionPeriodVar.fqn, 24),
      errorMessage: "retentionPeriod must be greater than or equal to 24",
    });
    retentionPeriodVar.addValidation({
      condition: Op.lte(retentionPeriodVar.fqn, 8760),
      errorMessage: "retentionPeriod must be less then or equal to 8760",
    });

    new Stream(stack, "MyStream", {
      retentionPeriod: Duration.hours(retentionPeriodVar.numberValue),
    });

    const t = new Template(stack);
    t.toMatchObject({
      variable: {
        "my-retention-period": {
          default: 48,
          type: "number",
          validation: [
            {
              condition: "${(var.my-retention-period >= 24)}",
              error_message:
                "retentionPeriod must be greater than or equal to 24",
            },
            {
              condition: "${(var.my-retention-period <= 8760)}",
              error_message:
                "retentionPeriod must be less then or equal to 8760",
            },
          ],
        },
      },
      locals: {
        AwsCdkKinesisEncryptedStreamsUnsupportedRegions,
      },
      resource: {
        aws_kinesis_stream: {
          MyStream_5C050E93: {
            encryption_type:
              '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "KMS"}',
            kms_key_id:
              '${local.AwsCdkKinesisEncryptedStreamsUnsupportedRegions ? null : "alias/aws/kinesis"}',
            name: "123e4567-e89b-12d3MyStackMyStream974B6778",
            retention_period: "${var.my-retention-period}",
            shard_count: 1,
          },
        },
      },
    });
  });

  test("basic stream-level metrics (StreamName dimension only)", () => {
    // GIVEN
    const fiveMinutes = {
      amount: 5,
      unit: {
        label: "minutes",
        isoLabel: "M",
        inMillis: 60000,
      },
    };

    // WHEN
    const stream = new Stream(stack, "MyStream");

    // THEN
    // should resolve the basic metrics (source https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html#kinesis-metrics-stream)
    expect(stack.resolve(stream.metricGetRecordsBytes())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.Bytes",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(
      stack.resolve(stream.metricGetRecordsIteratorAgeMilliseconds()),
    ).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.IteratorAgeMilliseconds",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Maximum",
    });

    expect(stack.resolve(stream.metricGetRecordsLatency())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.Latency",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricGetRecords())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.Records",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricGetRecordsSuccess())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.Success",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricIncomingBytes())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "IncomingBytes",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricIncomingRecords())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "IncomingRecords",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsBytes())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.Bytes",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsLatency())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.Latency",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsSuccess())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.Success",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsTotalRecords())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.TotalRecords",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsSuccessfulRecords())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.SuccessfulRecords",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsFailedRecords())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.FailedRecords",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(stack.resolve(stream.metricPutRecordsThrottledRecords())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "PutRecords.ThrottledRecords",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(
      stack.resolve(stream.metricReadProvisionedThroughputExceeded()),
    ).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "ReadProvisionedThroughputExceeded",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(
      stack.resolve(stream.metricWriteProvisionedThroughputExceeded()),
    ).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "WriteProvisionedThroughputExceeded",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });
  });

  test("allow to overide metric options", () => {
    // GIVEN
    const fiveMinutes = {
      amount: 5,
      unit: {
        label: "minutes",
        isoLabel: "M",
        inMillis: 60000,
      },
    };

    // WHEN
    const stream = new Stream(stack, "MyStream");

    // THEN
    expect(stack.resolve(stream.metricGetRecordsBytes())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.Bytes",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(
      stack.resolve(
        stream.metricGetRecordsBytes({
          period: Duration.minutes(1),
          statistic: "Maximum",
        }),
      ),
    ).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "GetRecords.Bytes",
      period: { ...fiveMinutes, amount: 1 },
      region: "us-east-1",
      statistic: "Maximum",
    });

    expect(stack.resolve(stream.metricIncomingBytes())).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "IncomingBytes",
      period: fiveMinutes,
      region: "us-east-1",
      statistic: "Average",
    });

    expect(
      stack.resolve(
        stream.metricIncomingBytes({
          period: Duration.minutes(1),
          statistic: "Sum",
        }),
      ),
    ).toEqual({
      dimensions: {
        StreamName: "${aws_kinesis_stream.MyStream_5C050E93.name}",
      },
      namespace: "AWS/Kinesis",
      metricName: "IncomingBytes",
      period: { ...fiveMinutes, amount: 1 },
      region: "us-east-1",
      statistic: "Sum",
    });
  });

  // // TODO: Ensure Terraform MetaData constructor props are set
  // test("with default removal policy", () => {
  //   // WHEN
  //   new Stream(stack, "Stream");

  //   // THEN
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   // refer to full snapshot for debug
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResource("AWS::Kinesis::Stream", {
  //   //   DeletionPolicy: CfnDeletionPolicy.RETAIN,
  //   // });
  // });

  // test("with removal policy as DESTROY", () => {
  //   // WHEN
  //   new Stream(stack, "Stream", {
  //     removalPolicy: RemovalPolicy.DESTROY,
  //   });

  //   // THEN
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   // refer to full snapshot for debug
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResource("AWS::Kinesis::Stream", {
  //   //   DeletionPolicy: CfnDeletionPolicy.DELETE,
  //   // });
  // });

  test("addToResourcePolicy will automatically create a policy for this stream", () => {
    // GIVEN
    const stream = new Stream(stack, "Stream", {});

    // WHEN
    stream.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["kinesis:GetRecords"],
        principals: [new iam.AnyPrincipal()],
        resources: [stream.streamArn],
      }),
    );

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kinesis:GetRecords"],
            effect: "Allow",
            principals: [
              {
                identifiers: ["*"],
                type: "AWS",
              },
            ],
            resources: [stack.resolve(stream.streamArn)],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(
      kinesisResourcePolicy.KinesisResourcePolicy,
      {
        policy: "${data.aws_iam_policy_document.Stream_Policy_42FDC357.json}",
        resource_arn: stack.resolve(stream.streamArn),
      },
    );
  });
});
