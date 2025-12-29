import { AppautoscalingPolicy } from "@cdktf/provider-aws/lib/appautoscaling-policy";
import { AppautoscalingTarget } from "@cdktf/provider-aws/lib/appautoscaling-target";
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document";
import { DynamodbContributorInsights } from "@cdktf/provider-aws/lib/dynamodb-contributor-insights";
import { DynamodbKinesisStreamingDestination } from "@cdktf/provider-aws/lib/dynamodb-kinesis-streaming-destination";
import { DynamodbResourcePolicy } from "@cdktf/provider-aws/lib/dynamodb-resource-policy";
import { DynamodbTable } from "@cdktf/provider-aws/lib/dynamodb-table";
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy";
import { IamUserPolicy } from "@cdktf/provider-aws/lib/iam-user-policy";
import { KmsKey } from "@cdktf/provider-aws/lib/kms-key";
import { App, Testing } from "cdktf";
// import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Tags } from "../../../src/aws/aws-tags";
import { Alarm } from "../../../src/aws/cloudwatch";
import { Schedule } from "../../../src/aws/compute";
import { Key } from "../../../src/aws/encryption";
import {
  IPrincipal,
  User,
  Role,
  ServicePrincipal,
  AnyPrincipal,
  PolicyDocument,
  PolicyStatement,
  ArnPrincipal,
} from "../../../src/aws/iam";
import { Stream } from "../../../src/aws/notify/kinesis-stream";
// import { AwsConstructBase } from "../../../src/aws/aws-construct";
import {
  Attribute,
  AttributeType,
  BillingMode,
  GlobalSecondaryIndexProps,
  LocalSecondaryIndexProps,
  ProjectionType,
  StreamViewType,
  Table,
  TableClass,
  TableEncryption,
  Operation,
  InputCompressionType,
  InputFormat,
  ApproximateCreationDateTimePrecision,
  IBucket,
  Bucket,
} from "../../../src/aws/storage";
import { Duration } from "../../../src/duration";
import { Annotations, Template } from "../../assertions";

const defaultAwsStackProps = {
  environmentName: "test",
  gridUUID: "test-uuid",
  providerConfig: { region: "us-east-1" },
};

const CONSTRUCT_NAME = "MyTable";
const TABLE_NAME = "MyTable";
const TABLE_PARTITION_KEY: Attribute = {
  name: "hashKey",
  type: AttributeType.STRING,
};
const TABLE_SORT_KEY: Attribute = {
  name: "sortKey",
  type: AttributeType.NUMBER,
};
const GSI_NAME = "MyGSI";
const GSI_PARTITION_KEY: Attribute = {
  name: "gsiHashKey",
  type: AttributeType.STRING,
};
const GSI_SORT_KEY: Attribute = {
  name: "gsiSortKey",
  type: AttributeType.BINARY,
};
const GSI_NON_KEY = "gsiNonKey";
function* GSI_GENERATOR(): Generator<GlobalSecondaryIndexProps, never> {
  let n = 0;
  while (true) {
    const globalSecondaryIndexProps: GlobalSecondaryIndexProps = {
      indexName: `${GSI_NAME}${n}`,
      partitionKey: {
        name: `${GSI_PARTITION_KEY.name}${n}`,
        type: GSI_PARTITION_KEY.type,
      },
    };
    yield globalSecondaryIndexProps;
    n++;
  }
}
function* NON_KEY_ATTRIBUTE_GENERATOR(
  nonKeyPrefix: string,
): Generator<string, never> {
  let n = 0;
  while (true) {
    yield `${nonKeyPrefix}${n}`;
    n++;
  }
}

// DynamoDB local secondary index parameters
const LSI_NAME = "MyLSI";
const LSI_SORT_KEY: Attribute = {
  name: "lsiSortKey",
  type: AttributeType.NUMBER,
};
const LSI_NON_KEY = "lsiNonKey";
function* LSI_GENERATOR(): Generator<LocalSecondaryIndexProps, never> {
  let n = 0;
  while (true) {
    const localSecondaryIndexProps: LocalSecondaryIndexProps = {
      indexName: `${LSI_NAME}${n}`,
      sortKey: { name: `${LSI_SORT_KEY.name}${n}`, type: LSI_SORT_KEY.type },
    };
    yield localSecondaryIndexProps;
    n++;
  }
}

describe("default properties", () => {
  let stack: AwsStack;
  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  });

  test("hash key only", () => {
    new Table(stack, CONSTRUCT_NAME, { partitionKey: TABLE_PARTITION_KEY });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      attribute: [{ name: "hashKey", type: "S" }],
      hash_key: "hashKey",
      read_capacity: 5,
      write_capacity: 5,
      // // TODO: Add concept of RemovalPolicy in TerraConstructs?
      // lifecycle: {
      //   prevent_destroy: true, // Default behavior for stateful resources
      // },
    });
  });

  // // TODO: Add concept of RemovalPolicy in TerraConstructs?
  // test("removalPolicy is DESTROY", () => {
  //   new Table(stack, CONSTRUCT_NAME, {
  //     partitionKey: TABLE_PARTITION_KEY,
  //     // removalPolicy: RemovalPolicy.DESTROY,
  //   });

  //   Template.synth(stack).toHaveResourceWithProperties(
  //     DynamodbTable,
  //     {
  //       lifecycle: {
  //         prevent_destroy: false,
  //       },
  //     },
  //   );
  // });

  test("hash + range key", () => {
    new Table(stack, CONSTRUCT_NAME, {
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      attribute: [
        { name: "hashKey", type: "S" },
        { name: "sortKey", type: "N" },
      ],
      hash_key: "hashKey",
      range_key: "sortKey",
      read_capacity: 5,
      write_capacity: 5,
    });
  });

  test("point-in-time recovery is not enabled by default", () => {
    new Table(stack, CONSTRUCT_NAME, {
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
      point_in_time_recovery: expect.anything(), // Default is not enabled
    });
  });

  test("point-in-time-recovery-specification enabled", () => {
    new Table(stack, CONSTRUCT_NAME, {
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: 5,
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      attribute: [
        { name: "hashKey", type: "S" },
        { name: "sortKey", type: "N" },
      ],
      hash_key: "hashKey",
      range_key: "sortKey",
      read_capacity: 5,
      write_capacity: 5,
      point_in_time_recovery: {
        enabled: true,
        recovery_period_in_days: 5,
      },
    });
  });

  test("both point-in-time-recovery-specification and point-in-time-recovery set", () => {
    expect(
      () =>
        new Table(stack, CONSTRUCT_NAME, {
          partitionKey: TABLE_PARTITION_KEY,
          sortKey: TABLE_SORT_KEY,
          pointInTimeRecovery: true,
          pointInTimeRecoverySpecification: {
            pointInTimeRecoveryEnabled: true,
            recoveryPeriodInDays: 5,
          },
        }),
    ).toThrow(
      "`pointInTimeRecoverySpecification` and `pointInTimeRecovery` are set. Use `pointInTimeRecoverySpecification` only.",
    );
  });

  test("recoveryPeriodInDays set out of bounds", () => {
    expect(() => {
      new Table(stack, "Table", {
        partitionKey: { name: "pk", type: AttributeType.STRING },
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
          recoveryPeriodInDays: 36,
        },
      });
    }).toThrow("`recoveryPeriodInDays` must be a value between `1` and `35`.");
  });

  test("recoveryPeriodInDays set but pitr disabled", () => {
    expect(() => {
      new Table(stack, "Table", {
        partitionKey: { name: "pk", type: AttributeType.STRING },
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: false,
          recoveryPeriodInDays: 35,
        },
      });
    }).toThrow(
      "Cannot set `recoveryPeriodInDays` while `pointInTimeRecoveryEnabled` is set to false.",
    );
  });

  test("server-side encryption is not enabled by default", () => {
    new Table(stack, CONSTRUCT_NAME, {
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });
    Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
      server_side_encryption: expect.anything(), // Default is not enabled
    });
  });

  test("stream is not enabled by default", () => {
    new Table(stack, CONSTRUCT_NAME, {
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });
    Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
      stream_enabled: expect.anything(), // Default is not enabled
      stream_view_type: expect.anything(), // Default is not enabled
    });
  });

  test("ttl is not enabled by default", () => {
    new Table(stack, CONSTRUCT_NAME, {
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });
    Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
      ttl: expect.anything(), // Default is not enabled
    });
  });

  test("can specify new and old images", () => {
    new Table(stack, CONSTRUCT_NAME, {
      tableName: TABLE_NAME,
      readCapacity: 42,
      writeCapacity: 1337,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      name: TABLE_NAME,
      read_capacity: 42,
      write_capacity: 1337,
      stream_enabled: true,
      stream_view_type: "NEW_AND_OLD_IMAGES",
      hash_key: TABLE_PARTITION_KEY.name,
      range_key: TABLE_SORT_KEY.name,
      attribute: [TABLE_PARTITION_KEY, TABLE_SORT_KEY],
    });
  });

  test("can specify new images only", () => {
    new Table(stack, CONSTRUCT_NAME, {
      tableName: TABLE_NAME,
      readCapacity: 42,
      writeCapacity: 1337,
      stream: StreamViewType.NEW_IMAGE,
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      name: TABLE_NAME,
      read_capacity: 42,
      write_capacity: 1337,
      stream_enabled: true,
      stream_view_type: "NEW_IMAGE",
    });
  });

  test("can specify old images only", () => {
    new Table(stack, CONSTRUCT_NAME, {
      tableName: TABLE_NAME,
      readCapacity: 42,
      writeCapacity: 1337,
      stream: StreamViewType.OLD_IMAGE,
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      name: TABLE_NAME,
      read_capacity: 42,
      write_capacity: 1337,
      stream_enabled: true,
      stream_view_type: "OLD_IMAGE",
    });
  });

  // test("can use undefined as the Table name (PhysicalName.GENERATE_IF_NEEDED)", () => {
  //   new Table(stack, CONSTRUCT_NAME, {
  //     // tableName: PhysicalName.GENERATE_IF_NEEDED, // In TerraConstructs, omitting tableName achieves this
  //     partitionKey: TABLE_PARTITION_KEY,
  //   });
  //   // TODO: Add PhysicalName.GENERATE_IF_NEEDED support in TerraConstructs
  // });
});

test("when specifying every property (billingMode PROVISIONED)", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const stream = new Stream(stack, "MyStream");
  const table = new Table(stack, CONSTRUCT_NAME, {
    tableName: TABLE_NAME,
    readCapacity: 42,
    writeCapacity: 1337,
    pointInTimeRecovery: true,
    // serverSideEncryption: true, // This is deprecated, use encryption
    encryption: TableEncryption.AWS_MANAGED, // Equivalent to serverSideEncryption: true
    billingMode: BillingMode.PROVISIONED,
    stream: StreamViewType.KEYS_ONLY,
    timeToLiveAttribute: "timeToLive",
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
    contributorInsightsSpecification: {
      enabled: true,
    },
    kinesisStream: stream,
  });
  Tags.of(table).add("Environment", "Production");

  const template = new Template(stack);
  template.expect.toHaveResourceWithProperties(DynamodbTable, {
    name: TABLE_NAME,
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    read_capacity: 42,
    write_capacity: 1337,
    billing_mode: "PROVISIONED",
    point_in_time_recovery: { enabled: true },
    server_side_encryption: {
      enabled: true,
    }, // AWS_MANAGED - kms_key_arn is not specified when using default
    stream_enabled: true,
    stream_view_type: "KEYS_ONLY",
    ttl: { attribute_name: "timeToLive", enabled: true },
    tags: expect.objectContaining({ Environment: "Production" }),
  });
  // Check if aws_dynamodb_contributor_insights is created if it's a separate resource
  template.resourceCountIs(DynamodbContributorInsights, 1);
  template.expect.toHaveResourceWithProperties(DynamodbContributorInsights, {
    table_name: stack.resolve(table.tableName),
  });
  template.expect.toHaveResourceWithProperties(
    DynamodbKinesisStreamingDestination,
    {
      table_name: stack.resolve(table.tableName),
      stream_arn: stack.resolve(stream.streamArn),
    },
  );
});

test("when specifying sse with customer managed CMK", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    tableName: TABLE_NAME,
    encryption: TableEncryption.CUSTOMER_MANAGED,
    partitionKey: TABLE_PARTITION_KEY,
  });
  Tags.of(table).add("Environment", "Production");

  const template = new Template(stack);
  template.expect.toHaveResourceWithProperties(DynamodbTable, {
    server_side_encryption: {
      enabled: true,
      kms_key_arn: stack.resolve(table.encryptionKey!.keyArn),
    },
    tags: expect.objectContaining({ Environment: "Production" }),
  });
  template.expect.toHaveResource(KmsKey);
});

test("when specifying only encryptionKey", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const encryptionKey = new Key(stack, "Key", {
    enableKeyRotation: true,
  });
  const table = new Table(stack, CONSTRUCT_NAME, {
    tableName: TABLE_NAME,
    encryptionKey,
    partitionKey: TABLE_PARTITION_KEY,
  });
  Tags.of(table).add("Environment", "Production");

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    server_side_encryption: {
      enabled: true,
      kms_key_arn: stack.resolve(encryptionKey.keyArn),
    },
    tags: expect.objectContaining({ Environment: "Production" }),
  });
});

test("when specifying sse with customer managed CMK with encryptionKey provided by user", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const encryptionKey = new Key(stack, "Key", {
    enableKeyRotation: true,
  });
  const table = new Table(stack, CONSTRUCT_NAME, {
    tableName: TABLE_NAME,
    encryption: TableEncryption.CUSTOMER_MANAGED,
    encryptionKey,
    partitionKey: TABLE_PARTITION_KEY,
  });
  Tags.of(table).add("Environment", "Production");

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    server_side_encryption: {
      enabled: true,
      kms_key_arn: stack.resolve(encryptionKey.keyArn),
    },
    tags: expect.objectContaining({ Environment: "Production" }),
  });
});

test("fails if encryption key is used with AWS managed CMK", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const encryptionKey = new Key(stack, "Key", {
    enableKeyRotation: true,
  });
  expect(
    () =>
      new Table(stack, "TableA", {
        tableName: TABLE_NAME,
        partitionKey: TABLE_PARTITION_KEY,
        encryption: TableEncryption.AWS_MANAGED,
        encryptionKey,
      }),
  ).toThrow(
    `encryptionKey cannot be specified unless encryption is set to TableEncryption.CUSTOMER_MANAGED (it was set to ${TableEncryption.AWS_MANAGED})`,
  );
});

test("fails if encryption key is used with default encryption", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const encryptionKey = new Key(stack, "Key", {
    enableKeyRotation: true,
  });
  expect(
    () =>
      new Table(stack, "TableA", {
        tableName: TABLE_NAME,
        partitionKey: TABLE_PARTITION_KEY,
        encryption: TableEncryption.DEFAULT,
        encryptionKey,
      }),
  ).toThrow(
    `encryptionKey cannot be specified unless encryption is set to TableEncryption.CUSTOMER_MANAGED (it was set to ${TableEncryption.DEFAULT})`,
  );
});

test("fails if encryption key is used with serverSideEncryption", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  const encryptionKey = new Key(stack, "Key", {
    enableKeyRotation: true,
  });
  expect(
    () =>
      new Table(stack, "Table A", {
        tableName: TABLE_NAME,
        partitionKey: TABLE_PARTITION_KEY,
        serverSideEncryption: true,
        encryptionKey,
      }),
  ).toThrow(
    /encryptionKey cannot be specified when serverSideEncryption is specified. Use encryption instead/,
  );
});

test("fails if both replication regions used with customer managed CMK", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  expect(
    () =>
      new Table(stack, "Table A", {
        tableName: TABLE_NAME,
        partitionKey: TABLE_PARTITION_KEY,
        replicationRegions: ["us-east-1", "us-east-2", "us-west-2"],
        encryption: TableEncryption.CUSTOMER_MANAGED,
      }),
  ).toThrow(
    "TableEncryption.CUSTOMER_MANAGED is not supported by DynamoDB Global Tables (where replicationRegions was set)",
  );
});

test("fails if replica specs with customer managed CMK lack encryption keys", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  expect(
    () =>
      new Table(stack, "Table A", {
        tableName: TABLE_NAME,
        partitionKey: TABLE_PARTITION_KEY,
        replicaSpecification: [
          {
            regionName: "us-east-2",
          },
        ],
        encryption: TableEncryption.CUSTOMER_MANAGED,
      }),
  ).toThrow(
    "When using replicaSpecification, each replica must specify an encryptionKey if TableEncryption.CUSTOMER_MANAGED is used",
  );
});

test("Replication regions can be used with customer managed CMK per region", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  const region1Key = Key.fromKeyArn(
    stack,
    "Region1Key",
    "arn:aws:kms:us-east-2:123456789012:key/alias/my-key",
  );
  const region2Key = Key.fromKeyArn(
    stack,
    "Region2Key",
    "arn:aws:kms:us-west-2:123456789012:key/alias/my-key",
  );
  new Table(stack, "Table A", {
    tableName: TABLE_NAME,
    partitionKey: TABLE_PARTITION_KEY,
    replicaSpecification: [
      {
        encryptionKey: region1Key,
        regionName: "us-east-2",
      },
      {
        encryptionKey: region2Key,
        regionName: "us-west-2",
      },
    ],
    encryption: TableEncryption.CUSTOMER_MANAGED,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    replica: [
      {
        region_name: "us-east-2",
        kms_key_arn: stack.resolve(region1Key.keyArn),
      },
      {
        region_name: "us-west-2",
        kms_key_arn: stack.resolve(region2Key.keyArn),
      },
    ],
  });
});

test("fails if replica customer managed CMK have incorrect region", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  const encryptionKey = Key.fromKeyArn(
    stack,
    "Region1Key",
    "arn:aws:kms:us-east-1:123456789012:key/alias/my-key",
  );
  expect(
    () =>
      new Table(stack, "Table A", {
        tableName: TABLE_NAME,
        partitionKey: TABLE_PARTITION_KEY,
        replicaSpecification: [
          {
            encryptionKey,
            regionName: "us-east-2",
          },
        ],
        encryption: TableEncryption.CUSTOMER_MANAGED,
      }),
  ).toThrow(
    "When using replicaSpecification, each replica's encryptionKey must be in the same region as its replica",
  );
});

test("if an encryption key is included, encrypt/decrypt permissions are added to the principal", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  const table = new Table(stack, "Table A", {
    tableName: TABLE_NAME,
    partitionKey: TABLE_PARTITION_KEY,
    encryption: TableEncryption.CUSTOMER_MANAGED,
  });
  const user = new User(stack, "MyUser");
  table.grantReadWriteData(user);

  Template.fromStack(stack).toMatchObject({
    data: {
      aws_iam_policy_document: {
        MyUser_DefaultPolicy_F49DB418: {
          statement: expect.arrayContaining([
            {
              actions: [
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              resources: ["${aws_kms_key.TableA_Key_07CC09EC.arn}"],
            },
          ]),
        },
      },
    },
  });
});

test("if an encryption key is included, encrypt/decrypt permissions are added to the principal for grantWriteData", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", defaultAwsStackProps);
  const table = new Table(stack, "Table A", {
    tableName: TABLE_NAME,
    partitionKey: TABLE_PARTITION_KEY,
    encryption: TableEncryption.CUSTOMER_MANAGED,
  });
  const user = new User(stack, "MyUser");
  table.grantWriteData(user);

  Template.fromStack(stack).toMatchObject({
    data: {
      aws_iam_policy_document: {
        MyUser_DefaultPolicy_F49DB418: {
          statement: expect.arrayContaining([
            {
              actions: [
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              resources: ["${aws_kms_key.TableA_Key_07CC09EC.arn}"],
            },
          ]),
        },
      },
    },
  });
});

test("when specifying STANDARD_INFREQUENT_ACCESS table class", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    tableClass: TableClass.STANDARD_INFREQUENT_ACCESS,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    table_class: "STANDARD_INFREQUENT_ACCESS",
  });
});

test("when specifying STANDARD table class", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    tableClass: TableClass.STANDARD,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    table_class: "STANDARD",
  });
});

test("when specifying no table class", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
  });

  Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
    table_class: expect.anything(), // No table class specified, so it defaults to STANDARD
  });
});

test("when specifying PAY_PER_REQUEST billing mode", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  new Table(stack, CONSTRUCT_NAME, {
    tableName: TABLE_NAME,
    billingMode: BillingMode.PAY_PER_REQUEST,
    partitionKey: TABLE_PARTITION_KEY,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    name: TABLE_NAME,
    billing_mode: "PAY_PER_REQUEST",
    hash_key: "hashKey",
    attribute: [{ name: "hashKey", type: "S" }],
  });
});

describe("when billing mode is PAY_PER_REQUEST", () => {
  let stack: AwsStack;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  });

  test("creating the Table fails when readCapacity is specified", () => {
    expect(
      () =>
        new Table(stack, "TableA", {
          tableName: TABLE_NAME,
          partitionKey: TABLE_PARTITION_KEY,
          billingMode: BillingMode.PAY_PER_REQUEST,
          readCapacity: 1,
        }),
    ).toThrow(/PAY_PER_REQUEST/);
  });

  test("creating the Table fails when writeCapacity is specified", () => {
    expect(
      () =>
        new Table(stack, "TableB", {
          tableName: TABLE_NAME,
          partitionKey: TABLE_PARTITION_KEY,
          billingMode: BillingMode.PAY_PER_REQUEST,
          writeCapacity: 1,
        }),
    ).toThrow(/PAY_PER_REQUEST/);
  });

  test("creating the Table fails when both readCapacity and writeCapacity are specified", () => {
    expect(
      () =>
        new Table(stack, "TableC", {
          tableName: TABLE_NAME,
          partitionKey: TABLE_PARTITION_KEY,
          billingMode: BillingMode.PAY_PER_REQUEST,
          readCapacity: 1,
          writeCapacity: 1,
        }),
    ).toThrow(/PAY_PER_REQUEST/);
  });

  test("when specifying maximum throughput for on-demand", () => {
    new Table(stack, CONSTRUCT_NAME, {
      tableName: TABLE_NAME,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: TABLE_PARTITION_KEY,
      maxReadRequestUnits: 10,
      maxWriteRequestUnits: 5,
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      name: TABLE_NAME,
      billing_mode: "PAY_PER_REQUEST",
      on_demand_throughput: {
        max_read_request_units: 10,
        max_write_request_units: 5,
      },
    });
  });

  test("when specifying maximum throughput for on-demand-indexes", () => {
    const table = new Table(stack, CONSTRUCT_NAME, {
      tableName: TABLE_NAME,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: TABLE_PARTITION_KEY,
      maxReadRequestUnits: 10,
      maxWriteRequestUnits: 5,
    });
    table.addGlobalSecondaryIndex({
      maxReadRequestUnits: 10,
      maxWriteRequestUnits: 20,
      indexName: "gsi1",
      partitionKey: { name: "pk", type: AttributeType.STRING },
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      name: TABLE_NAME,
      billing_mode: "PAY_PER_REQUEST",
      on_demand_throughput: {
        max_read_request_units: 10,
        max_write_request_units: 5,
      },
      global_secondary_index: [
        {
          name: "gsi1",
          hash_key: "pk",
          projection_type: "ALL",
          on_demand_throughput: {
            max_read_request_units: 10,
            max_write_request_units: 20,
          },
        },
      ],
    });
  });
});

describe("schema details", () => {
  let stack: AwsStack;
  let table: Table;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    table = new Table(stack, "Table A", {
      tableName: TABLE_NAME,
      partitionKey: TABLE_PARTITION_KEY,
    });
  });

  test("get schema for table with hash key only", () => {
    expect(table.schema()).toEqual({
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: undefined,
    });
  });

  test("get schema for table with hash key + range key", () => {
    table = new Table(stack, "TableB", {
      tableName: TABLE_NAME,
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    expect(table.schema()).toEqual({
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });
  });

  test("get schema for GSI with hash key", () => {
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
    });

    expect(table.schema(GSI_NAME)).toEqual({
      partitionKey: GSI_PARTITION_KEY,
      sortKey: undefined,
    });
  });

  test("get schema for GSI with hash key + range key", () => {
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
    });

    expect(table.schema(GSI_NAME)).toEqual({
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
    });
  });

  test("get schema for LSI", () => {
    table.addLocalSecondaryIndex({
      indexName: LSI_NAME,
      sortKey: LSI_SORT_KEY,
    });

    expect(table.schema(LSI_NAME)).toEqual({
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: LSI_SORT_KEY,
    });
  });

  test("get schema for multiple secondary indexes", () => {
    table.addLocalSecondaryIndex({
      indexName: LSI_NAME,
      sortKey: LSI_SORT_KEY,
    });

    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
    });

    expect(table.schema(LSI_NAME)).toEqual({
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: LSI_SORT_KEY,
    });

    expect(table.schema(GSI_NAME)).toEqual({
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
    });
  });

  test("get schema for unknown secondary index", () => {
    expect(() => table.schema(GSI_NAME)).toThrow(
      /Cannot find schema for index: MyGSI. Use 'addGlobalSecondaryIndex' or 'addLocalSecondaryIndex' to add index/,
    );
  });
});

test("when adding a global secondary index with hash key only", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });

  table.addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
    readCapacity: 42,
    writeCapacity: 1337,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: expect.arrayContaining([
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey", type: "S" },
    ]),
    global_secondary_index: [
      {
        name: GSI_NAME,
        hash_key: GSI_PARTITION_KEY.name,
        projection_type: "ALL",
        read_capacity: 42,
        write_capacity: 1337,
      },
    ],
  });
});

test("when adding a global secondary index with hash + range key", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });

  table.addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
    sortKey: GSI_SORT_KEY,
    projectionType: ProjectionType.ALL,
    readCapacity: 42,
    writeCapacity: 1337,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey", type: "S" },
      { name: "gsiSortKey", type: "B" },
    ],
    hash_key: TABLE_PARTITION_KEY.name,
    range_key: TABLE_SORT_KEY.name,
    // ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    global_secondary_index: [
      {
        name: GSI_NAME,
        hash_key: GSI_PARTITION_KEY.name,
        range_key: GSI_SORT_KEY.name,
        projection_type: "ALL",
        read_capacity: 42,
        write_capacity: 1337,
      },
    ],
  });
});

test("when adding a global secondary index with projection type KEYS_ONLY", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });

  table.addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
    sortKey: GSI_SORT_KEY,
    projectionType: ProjectionType.KEYS_ONLY,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey", type: "S" },
      { name: "gsiSortKey", type: "B" },
    ],
    hash_key: TABLE_PARTITION_KEY.name,
    range_key: TABLE_SORT_KEY.name,
    // ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    global_secondary_index: [
      {
        name: GSI_NAME,
        hash_key: GSI_PARTITION_KEY.name,
        range_key: GSI_SORT_KEY.name,
        projection_type: "KEYS_ONLY",
        read_capacity: 5,
        write_capacity: 5,
      },
    ],
  });
});

test("when adding a global secondary index with projection type INCLUDE", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const gsiNonKeyAttributeGenerator = NON_KEY_ATTRIBUTE_GENERATOR(GSI_NON_KEY);
  table.addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
    sortKey: GSI_SORT_KEY,
    projectionType: ProjectionType.INCLUDE,
    nonKeyAttributes: [
      gsiNonKeyAttributeGenerator.next().value,
      gsiNonKeyAttributeGenerator.next().value,
    ],
    readCapacity: 42,
    writeCapacity: 1337,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey", type: "S" },
      { name: "gsiSortKey", type: "B" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    name: expect.any(String),
    read_capacity: 5,
    write_capacity: 5,
    global_secondary_index: [
      {
        name: "MyGSI",
        hash_key: "gsiHashKey",
        range_key: "gsiSortKey",
        non_key_attributes: ["gsiNonKey0", "gsiNonKey1"],
        projection_type: "INCLUDE",
        read_capacity: 42,
        write_capacity: 1337,
      },
    ],
  });
});

test("when adding a global secondary index on a table with PAY_PER_REQUEST billing mode", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  new Table(stack, CONSTRUCT_NAME, {
    billingMode: BillingMode.PAY_PER_REQUEST,
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  }).addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey", type: "S" },
    ],
    billing_mode: "PAY_PER_REQUEST",
    hash_key: "hashKey",
    range_key: "sortKey",
    global_secondary_index: [
      {
        name: "MyGSI",
        hash_key: "gsiHashKey",
        projection_type: "ALL",
      },
    ],
  });
});

test("error when adding a global secondary index with projection type INCLUDE, but without specifying non-key attributes", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
      projectionType: ProjectionType.INCLUDE,
    }),
  ).toThrow(
    /Non-key attributes should be specified when using INCLUDE projection type/,
  );
});

test("error when adding a global secondary index with projection type ALL, but with non-key attributes", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const gsiNonKeyAttributeGenerator = NON_KEY_ATTRIBUTE_GENERATOR(GSI_NON_KEY);

  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      nonKeyAttributes: [gsiNonKeyAttributeGenerator.next().value],
    }),
  ).toThrow(
    /Non-key attributes should not be specified when not using INCLUDE projection type/,
  );
});

test("error when adding a global secondary index with projection type KEYS_ONLY, but with non-key attributes", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const gsiNonKeyAttributeGenerator = NON_KEY_ATTRIBUTE_GENERATOR(GSI_NON_KEY);

  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      projectionType: ProjectionType.KEYS_ONLY,
      nonKeyAttributes: [gsiNonKeyAttributeGenerator.next().value],
    }),
  ).toThrow(
    /Non-key attributes should not be specified when not using INCLUDE projection type/,
  );
});

test("error when adding a global secondary index with projection type INCLUDE, but with more than 100 non-key attributes", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const gsiNonKeyAttributeGenerator = NON_KEY_ATTRIBUTE_GENERATOR(GSI_NON_KEY);
  const gsiNonKeyAttributes: string[] = [];
  for (let i = 0; i < 101; i++) {
    gsiNonKeyAttributes.push(gsiNonKeyAttributeGenerator.next().value);
  }

  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: gsiNonKeyAttributes,
    }),
  ).toThrow(
    /A maximum number of nonKeyAttributes across all of secondary indexes is 100/,
  );
});

test("error when adding a global secondary index with read or write capacity on a PAY_PER_REQUEST table", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    billingMode: BillingMode.PAY_PER_REQUEST,
  });

  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
      readCapacity: 1,
    }),
  ).toThrow(/PAY_PER_REQUEST/);
  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
      writeCapacity: 1,
    }),
  ).toThrow(/PAY_PER_REQUEST/);
  expect(() =>
    table.addGlobalSecondaryIndex({
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
      sortKey: GSI_SORT_KEY,
      readCapacity: 1,
      writeCapacity: 1,
    }),
  ).toThrow(/PAY_PER_REQUEST/);
});

test("when adding multiple global secondary indexes", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const gsiGenerator = GSI_GENERATOR();
  for (let i = 0; i < 5; i++) {
    table.addGlobalSecondaryIndex(gsiGenerator.next().value);
  }

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey0", type: "S" },
      { name: "gsiHashKey1", type: "S" },
      { name: "gsiHashKey2", type: "S" },
      { name: "gsiHashKey3", type: "S" },
      { name: "gsiHashKey4", type: "S" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    read_capacity: 5,
    write_capacity: 5,
    global_secondary_index: [
      {
        name: "MyGSI0",
        hash_key: "gsiHashKey0",
        projection_type: "ALL",
        read_capacity: 5,
        write_capacity: 5,
      },
      {
        name: "MyGSI1",
        hash_key: "gsiHashKey1",
        projection_type: "ALL",
        read_capacity: 5,
        write_capacity: 5,
      },
      {
        name: "MyGSI2",
        hash_key: "gsiHashKey2",
        projection_type: "ALL",
        read_capacity: 5,
        write_capacity: 5,
      },
      {
        name: "MyGSI3",
        hash_key: "gsiHashKey3",
        projection_type: "ALL",
        read_capacity: 5,
        write_capacity: 5,
      },
      {
        name: "MyGSI4",
        hash_key: "gsiHashKey4",
        projection_type: "ALL",
        read_capacity: 5,
        write_capacity: 5,
      },
    ],
  });
});

test("when adding a global secondary index without specifying read and write capacity", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });

  table.addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "gsiHashKey", type: "S" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    read_capacity: 5,
    write_capacity: 5,
    global_secondary_index: [
      {
        name: "MyGSI",
        hash_key: "gsiHashKey",
        projection_type: "ALL",
        read_capacity: 5,
        write_capacity: 5,
      },
    ],
  });
});

test.each([true, false])(
  "when adding a global secondary index with contributorInsights enabled %s",
  (enabled: boolean) => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, CONSTRUCT_NAME, {
      tableName: TABLE_NAME,
      partitionKey: TABLE_PARTITION_KEY,
      sortKey: TABLE_SORT_KEY,
    });

    table.addGlobalSecondaryIndex({
      contributorInsightsSpecification: {
        enabled,
      },
      indexName: GSI_NAME,
      partitionKey: GSI_PARTITION_KEY,
    });

    const synthesized = Template.synth(stack);
    synthesized.toHaveResourceWithProperties(DynamodbTable, {
      name: "MyTable",
      attribute: [
        { name: "hashKey", type: "S" },
        { name: "sortKey", type: "N" },
        { name: "gsiHashKey", type: "S" },
      ],
      hash_key: "hashKey",
      range_key: "sortKey",
      read_capacity: 5,
      write_capacity: 5,
      global_secondary_index: [
        {
          name: "MyGSI",
          hash_key: "gsiHashKey",
          projection_type: "ALL",
          read_capacity: 5,
          write_capacity: 5,
        },
      ],
    });
    if (enabled) {
      synthesized.toHaveResourceWithProperties(DynamodbContributorInsights, {
        table_name: stack.resolve(table.tableName),
        index_name: "MyGSI",
      });
    } else {
      synthesized.not.toHaveResource(DynamodbContributorInsights);
    }
  },
);

test("when adding a local secondary index with hash + range key", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });

  table.addLocalSecondaryIndex({
    indexName: LSI_NAME,
    sortKey: LSI_SORT_KEY,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "lsiSortKey", type: "N" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    read_capacity: 5,
    write_capacity: 5,
    local_secondary_index: [
      {
        name: "MyLSI",
        range_key: "lsiSortKey",
        projection_type: "ALL",
      },
    ],
  });
});

test("when adding a local secondary index with projection type KEYS_ONLY", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  table.addLocalSecondaryIndex({
    indexName: LSI_NAME,
    sortKey: LSI_SORT_KEY,
    projectionType: ProjectionType.KEYS_ONLY,
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "lsiSortKey", type: "N" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    read_capacity: 5,
    write_capacity: 5,
    local_secondary_index: [
      {
        name: "MyLSI",
        range_key: "lsiSortKey",
        projection_type: "KEYS_ONLY",
      },
    ],
  });
});

test("when adding a local secondary index with projection type INCLUDE", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const lsiNonKeyAttributeGenerator = NON_KEY_ATTRIBUTE_GENERATOR(LSI_NON_KEY);
  table.addLocalSecondaryIndex({
    indexName: LSI_NAME,
    sortKey: LSI_SORT_KEY,
    projectionType: ProjectionType.INCLUDE,
    nonKeyAttributes: [
      lsiNonKeyAttributeGenerator.next().value,
      lsiNonKeyAttributeGenerator.next().value,
    ],
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    attribute: [
      { name: "hashKey", type: "S" },
      { name: "sortKey", type: "N" },
      { name: "lsiSortKey", type: "N" },
    ],
    hash_key: "hashKey",
    range_key: "sortKey",
    read_capacity: 5,
    write_capacity: 5,
    local_secondary_index: [
      {
        name: "MyLSI",
        range_key: "lsiSortKey",
        projection_type: "INCLUDE",
        non_key_attributes: ["lsiNonKey0", "lsiNonKey1"],
      },
    ],
  });
});

test("error when adding more than 5 local secondary indexes", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  const lsiGenerator = LSI_GENERATOR();
  for (let i = 0; i < 5; i++) {
    table.addLocalSecondaryIndex(lsiGenerator.next().value);
  }

  expect(() => table.addLocalSecondaryIndex(lsiGenerator.next().value)).toThrow(
    /A maximum number of local secondary index per table is 5/,
  );
});

test("error when adding a local secondary index with the name of a global secondary index", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
    sortKey: TABLE_SORT_KEY,
  });
  table.addGlobalSecondaryIndex({
    indexName: "SecondaryIndex",
    partitionKey: GSI_PARTITION_KEY,
  });

  expect(() =>
    table.addLocalSecondaryIndex({
      indexName: "SecondaryIndex",
      sortKey: LSI_SORT_KEY,
    }),
  ).toThrow(/A duplicate index name, SecondaryIndex, is not allowed/);
});

test("error when validating construct if a local secondary index exists without a sort key of the table", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    partitionKey: TABLE_PARTITION_KEY,
  });

  table.addLocalSecondaryIndex({
    indexName: LSI_NAME,
    sortKey: LSI_SORT_KEY,
  });

  const errors = table.node.validate();

  expect(errors.length).toBe(1);
  expect(errors[0]).toBe(
    "A sort key of the table must be specified to add local secondary indexes",
  );
});

test("can enable Read AutoScaling", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: TABLE_PARTITION_KEY,
  });

  // WHEN
  table
    .autoScaleReadCapacity({ minCapacity: 50, maxCapacity: 500 })
    .scaleOnUtilization({ targetUtilizationPercent: 75 });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(AppautoscalingTarget, {
    max_capacity: 500,
    min_capacity: 50,
    scalable_dimension: "dynamodb:table:ReadCapacityUnits",
    service_namespace: "dynamodb",
  });
  Template.synth(stack).toHaveResourceWithProperties(AppautoscalingPolicy, {
    policy_type: "TargetTrackingScaling",
    target_tracking_scaling_policy_configuration: {
      predefined_metric_specification: {
        predefined_metric_type: "DynamoDBReadCapacityUtilization",
      },
      target_value: 75,
    },
  });
});

test("can enable Write AutoScaling", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: TABLE_PARTITION_KEY,
  });

  // WHEN
  table
    .autoScaleWriteCapacity({ minCapacity: 50, maxCapacity: 500 })
    .scaleOnUtilization({ targetUtilizationPercent: 75 });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(AppautoscalingTarget, {
    max_capacity: 500,
    min_capacity: 50,
    scalable_dimension: "dynamodb:table:WriteCapacityUnits",
    service_namespace: "dynamodb",
  });
  Template.synth(stack).toHaveResourceWithProperties(AppautoscalingPolicy, {
    policy_type: "TargetTrackingScaling",
    target_tracking_scaling_policy_configuration: {
      predefined_metric_specification: {
        predefined_metric_type: "DynamoDBWriteCapacityUtilization",
      },
      target_value: 75,
    },
  });
});

test("cannot enable AutoScaling twice on the same property", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: TABLE_PARTITION_KEY,
  });
  table
    .autoScaleReadCapacity({ minCapacity: 50, maxCapacity: 500 })
    .scaleOnUtilization({ targetUtilizationPercent: 75 });

  // WHEN
  expect(() => {
    table.autoScaleReadCapacity({ minCapacity: 50, maxCapacity: 500 });
  }).toThrow(/Read AutoScaling already enabled for this table/);
});

test("error when enabling AutoScaling on the PAY_PER_REQUEST table", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    billingMode: BillingMode.PAY_PER_REQUEST,
    partitionKey: TABLE_PARTITION_KEY,
  });
  table.addGlobalSecondaryIndex({
    indexName: GSI_NAME,
    partitionKey: GSI_PARTITION_KEY,
  });

  // WHEN
  expect(() => {
    table.autoScaleReadCapacity({ minCapacity: 50, maxCapacity: 500 });
  }).toThrow(/PAY_PER_REQUEST/);
  expect(() => {
    table.autoScaleWriteCapacity({ minCapacity: 50, maxCapacity: 500 });
  }).toThrow(/PAY_PER_REQUEST/);
  expect(() =>
    table.autoScaleGlobalSecondaryIndexReadCapacity(GSI_NAME, {
      minCapacity: 1,
      maxCapacity: 5,
    }),
  ).toThrow(/PAY_PER_REQUEST/);
});

test("error when specifying Read Auto Scaling with invalid scalingTargetValue < 10", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: TABLE_PARTITION_KEY,
  });

  // THEN
  expect(() => {
    table
      .autoScaleReadCapacity({ minCapacity: 50, maxCapacity: 500 })
      .scaleOnUtilization({ targetUtilizationPercent: 5 });
  }).toThrow(
    /targetUtilizationPercent for DynamoDB scaling must be between 10 and 90 percent, got: 5/,
  );
});

test("error when specifying Read Auto Scaling with invalid minimumCapacity", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: TABLE_PARTITION_KEY,
  });

  // THEN
  expect(() =>
    table.autoScaleReadCapacity({ minCapacity: 10, maxCapacity: 5 }),
  ).toThrow(/minCapacity \(10\) should be lower than maxCapacity \(5\)/);
});

test("can autoscale on a schedule", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: { name: "Hash", type: AttributeType.STRING },
  });

  // WHEN
  const scaling = table.autoScaleReadCapacity({
    minCapacity: 1,
    maxCapacity: 100,
  });
  scaling.scaleOnSchedule("SaveMoneyByNotScalingUp", {
    schedule: Schedule.cron({}),
    maxCapacity: 10,
  });

  // THEN
  // TODO: Should be ScheduledActions - ScalableTargetAction with Schedule (cron string) and name "SaveMoneyByNotScalingUp"
  Template.synth(stack).toHaveResourceWithProperties(AppautoscalingTarget, {
    max_capacity: 100,
    min_capacity: 1,
    scalable_dimension: "dynamodb:table:ReadCapacityUnits",
    service_namespace: "dynamodb",
  });
});

test("scheduled scaling shows warning when minute is not defined in cron", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: { name: "Hash", type: AttributeType.STRING },
  });

  // WHEN
  const scaling = table.autoScaleReadCapacity({
    minCapacity: 1,
    maxCapacity: 100,
  });
  scaling.scaleOnSchedule("SaveMoneyByNotScalingUp", {
    schedule: Schedule.cron({}),
    maxCapacity: 10,
  });

  // THEN
  Annotations.fromStack(stack).hasWarnings({
    constructPath: "TestStack/MyTable/ReadScaling/Target",
    message:
      "cron: If you don't pass 'minute', by default the event runs every minute. Pass 'minute: '*'' if that's what you intend, or 'minute: 0' to run once per hour instead.",
  });
});

test("scheduled scaling shows no warning when minute is * in cron", () => {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, CONSTRUCT_NAME, {
    readCapacity: 42,
    writeCapacity: 1337,
    partitionKey: { name: "Hash", type: AttributeType.STRING },
  });

  // WHEN
  const scaling = table.autoScaleReadCapacity({
    minCapacity: 1,
    maxCapacity: 100,
  });
  scaling.scaleOnSchedule("SaveMoneyByNotScalingUp", {
    schedule: Schedule.cron({ minute: "*" }),
    maxCapacity: 10,
  });

  // THEN
  expect(Annotations.fromStack(stack).warnings).toHaveLength(0);
});

describe("metrics", () => {
  test("Can use metricConsumedReadCapacityUnits on a Dynamodb Table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    // THEN
    expect(stack.resolve(table.metricConsumedReadCapacityUnits())).toEqual({
      period: Duration.minutes(5),
      dimensions: { TableName: stack.resolve(table.tableName) },
      namespace: "AWS/DynamoDB",
      metricName: "ConsumedReadCapacityUnits",
      statistic: "Sum",
      region: "us-east-1",
    });
  });

  test("Can use metricConsumedWriteCapacityUnits on a Dynamodb Table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    // THEN
    expect(stack.resolve(table.metricConsumedWriteCapacityUnits())).toEqual({
      period: Duration.minutes(5),
      dimensions: { TableName: stack.resolve(table.tableName) },
      namespace: "AWS/DynamoDB",
      metricName: "ConsumedWriteCapacityUnits",
      statistic: "Sum",
      region: "us-east-1",
    });
  });

  test("Using metricSystemErrorsForOperations with no operations will default to all", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    expect(
      Object.keys(
        table.metricSystemErrorsForOperations().toMetricConfig().mathExpression!
          .usingMetrics,
      ),
    ).toEqual([
      "getitem",
      "batchgetitem",
      "scan",
      "query",
      "getrecords",
      "putitem",
      "deleteitem",
      "updateitem",
      "batchwriteitem",
      "transactwriteitems",
      "transactgetitems",
      "executetransaction",
      "batchexecutestatement",
      "executestatement",
    ]);
  });

  // testDeprecated(
  //   "Can use metricSystemErrors without the TableName dimension",
  //   () => {
  //     const app = Testing.app();
  //     const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  //     const table = new Table(stack, "Table", {
  //       partitionKey: { name: "id", type: AttributeType.STRING },
  //     });

  //     expect(
  //       table.metricSystemErrors({ dimensions: { Operation: "GetItem" } })
  //         .dimensions,
  //     ).toEqual({
  //       TableName: table.tableName,
  //       Operation: "GetItem",
  //     });
  //   },
  // );

  // testDeprecated(
  //   "Using metricSystemErrors without the Operation dimension will fail",
  //   () => {
  //     const app = Testing.app();
  //     const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  //     const table = new Table(stack, "Table", {
  //       partitionKey: { name: "id", type: AttributeType.STRING },
  //     });

  //     expect(() =>
  //       table.metricSystemErrors({
  //         dimensions: { TableName: table.tableName },
  //       }),
  //     ).toThrow(
  //       /'Operation' dimension must be passed for the 'SystemErrors' metric./,
  //     );
  //   },
  // );

  test("Can use metricSystemErrorsForOperations on a Dynamodb Table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    // THEN
    expect(
      stack.resolve(
        table.metricSystemErrorsForOperations({
          operations: [Operation.GET_ITEM, Operation.PUT_ITEM],
        }),
      ),
    ).toEqual({
      expression: "getitem + putitem",
      label: "Sum of errors across all operations",
      period: Duration.minutes(5),
      usingMetrics: {
        getitem: {
          dimensions: {
            Operation: "GetItem",
            TableName: stack.resolve(table.tableName),
          },
          metricName: "SystemErrors",
          namespace: "AWS/DynamoDB",
          period: Duration.minutes(5),
          region: "us-east-1",
          statistic: "Sum",
        },
        putitem: {
          dimensions: {
            Operation: "PutItem",
            TableName: stack.resolve(table.tableName),
          },
          metricName: "SystemErrors",
          namespace: "AWS/DynamoDB",
          period: Duration.minutes(5),
          region: "us-east-1",
          statistic: "Sum",
        },
      },
    });
  });

  // testDeprecated("Can use metricSystemErrors on a Dynamodb Table", () => {
  //   // GIVEN

  //   const app = Testing.app();
  //   const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  //   const table = new Table(stack, "Table", {
  //     partitionKey: { name: "id", type: AttributeType.STRING },
  //   });

  //   // THEN
  //   expect(
  //     stack.resolve(
  //       table.metricSystemErrors({
  //         dimensionsMap: { TableName: table.tableName, Operation: "GetItem" },
  //       }),
  //     ),
  //   ).toEqual({
  //     period: Duration.minutes(5),
  //     dimensions: { TableName: { Ref: "TableCD117FA1" }, Operation: "GetItem" },
  //     namespace: "AWS/DynamoDB",
  //     metricName: "SystemErrors",
  //     statistic: "Sum",
  //   });
  // });

  test("Using metricUserErrors with dimensions will fail", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    expect(() =>
      table.metricUserErrors({ dimensionsMap: { TableName: table.tableName } }),
    ).toThrow(/'dimensionsMap' is not supported for the 'UserErrors' metric/);
  });

  test("Can use metricUserErrors on a Dynamodb Table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    // THEN
    expect(stack.resolve(table.metricUserErrors())).toEqual({
      period: Duration.minutes(5),
      dimensions: {},
      namespace: "AWS/DynamoDB",
      metricName: "UserErrors",
      statistic: "Sum",
      region: "us-east-1",
    });
  });

  test("Can use metricConditionalCheckFailedRequests on a Dynamodb Table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    // THEN
    expect(stack.resolve(table.metricConditionalCheckFailedRequests())).toEqual(
      {
        period: Duration.minutes(5),
        dimensions: { TableName: stack.resolve(table.tableName) },
        namespace: "AWS/DynamoDB",
        metricName: "ConditionalCheckFailedRequests",
        statistic: "Sum",
        region: "us-east-1",
      },
    );
  });

  test("Can use metricSuccessfulRequestLatency without the TableName dimension", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    expect(
      table.metricSuccessfulRequestLatency({
        dimensionsMap: { Operation: "GetItem" },
      }).dimensions,
    ).toEqual({
      TableName: table.tableName,
      Operation: "GetItem",
    });
  });

  test("Using metricSuccessfulRequestLatency without the Operation dimension will fail", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    expect(() =>
      table.metricSuccessfulRequestLatency({
        dimensionsMap: { TableName: table.tableName },
      }),
    ).toThrow(
      /'Operation' dimension must be passed for the 'SuccessfulRequestLatency' metric./,
    );
  });

  test("Can use metricSuccessfulRequestLatency on a Dynamodb Table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
    });

    // THEN
    expect(
      stack.resolve(
        table.metricSuccessfulRequestLatency({
          dimensionsMap: {
            TableName: table.tableName,
            Operation: "GetItem",
          },
        }),
      ),
    ).toEqual({
      period: Duration.minutes(5),
      dimensions: {
        TableName: stack.resolve(table.tableName),
        Operation: "GetItem",
      },
      namespace: "AWS/DynamoDB",
      metricName: "SuccessfulRequestLatency",
      statistic: "Average",
      region: "us-east-1",
    });
  });
});

describe("grants", () => {
  test('"grant" allows adding arbitrary actions associated with this table resource', () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "my-table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });
    const user = new User(stack, "user");

    // WHEN
    table.grant(user, "dynamodb:action1", "dynamodb:action2");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
      statement: [
        {
          actions: ["dynamodb:action1", "dynamodb:action2"],
          effect: "Allow",
          resources: [stack.resolve(table.tableArn)],
        },
      ],
    });
    template.expect.toHaveResourceWithProperties(IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
    });
  });

  test('"grant" allows adding arbitrary actions associated with this table resource (via testGrant)', () => {
    testGrant([["action1", "action2"]], (p, t) =>
      t.grant(p, "dynamodb:action1", "dynamodb:action2"),
    );
  });

  test('"grantReadData" allows the principal to read data from the table', () => {
    testGrant(
      [
        [
          "BatchGetItem",
          "Query",
          "GetItem",
          "Scan",
          "ConditionCheckItem",
          "DescribeTable",
        ],
        ["GetRecords", "GetShardIterator"],
      ],
      (p, t) => t.grantReadData(p),
    );
  });

  test('"grantWriteData" allows the principal to write data to the table', () => {
    testGrant(
      [
        [
          "BatchWriteItem",
          "PutItem",
          "UpdateItem",
          "DeleteItem",
          "DescribeTable",
        ],
      ],
      (p, t) => t.grantWriteData(p),
    );
  });

  test('"grantReadWriteData" allows the principal to read/write data', () => {
    testGrant(
      [
        [
          "BatchGetItem",
          "Query",
          "GetItem",
          "Scan",
          "ConditionCheckItem",
          "BatchWriteItem",
          "PutItem",
          "UpdateItem",
          "DeleteItem",
          "DescribeTable",
        ],
        ["GetRecords", "GetShardIterator"],
      ],
      (p, t) => t.grantReadWriteData(p),
    );
  });

  test('"grantFullAccess" allows the principal to perform any action on the table ("*")', () => {
    testGrant([["*"]], (p, t) => t.grantFullAccess(p));
  });

  // testDeprecated(
  test('"Table.grantListStreams" allows principal to list all streams', () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const user = new User(stack, "user");

    // WHEN
    Table.grantListStreams(user);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
      statement: [
        {
          actions: ["dynamodb:ListStreams"],
          effect: "Allow",
          resources: ["*"],
        },
      ],
    });
    template.expect.toHaveResourceWithProperties(IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
    });
  });

  test('"grantTableListStreams" should fail if streaming is not enabled on table"', () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "my-table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });
    const user = new User(stack, "user");

    // WHEN
    expect(() => table.grantTableListStreams(user)).toThrow(
      /DynamoDB Streams must be enabled on the table/,
    );
  });

  test('"grantTableListStreams" allows principal to list all streams for this table', () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "my-table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      stream: StreamViewType.NEW_IMAGE,
    });
    const user = new User(stack, "user");

    // WHEN
    table.grantTableListStreams(user);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
      statement: [
        {
          actions: ["dynamodb:ListStreams"],
          effect: "Allow",
          resources: ["*"],
        },
      ],
    });
    template.expect.toHaveResourceWithProperties(IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
    });
  });

  test('"grantStreamRead" should fail if streaming is not enabled on table"', () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "my-table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });
    const user = new User(stack, "user");

    // WHEN
    expect(() => table.grantStreamRead(user)).toThrow(
      /DynamoDB Streams must be enabled on the table/,
    );
  });

  test('"grantStreamRead" allows principal to read and describe the table stream"', () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "my-table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      stream: StreamViewType.NEW_IMAGE,
    });
    const user = new User(stack, "user");

    // WHEN
    table.grantStreamRead(user);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
      statement: [
        {
          actions: ["dynamodb:ListStreams"],
          effect: "Allow",
          resources: ["*"],
        },
        {
          actions: [
            "dynamodb:DescribeStream",
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
          ],
          effect: "Allow",
          resources: [stack.resolve(table.tableStreamArn)],
        },
      ],
    });
    template.expect.toHaveResourceWithProperties(IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
    });
  });

  test("if table has an index grant gives access to the index", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    const table = new Table(stack, "my-table", {
      partitionKey: { name: "ID", type: AttributeType.STRING },
    });
    table.addGlobalSecondaryIndex({
      indexName: "MyIndex",
      partitionKey: { name: "Age", type: AttributeType.NUMBER },
    });
    const user = new User(stack, "user");

    // WHEN
    table.grantReadData(user);

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
      statement: [
        {
          actions: [
            "dynamodb:BatchGetItem",
            "dynamodb:Query",
            "dynamodb:GetItem",
            "dynamodb:Scan",
            "dynamodb:ConditionCheckItem",
            "dynamodb:DescribeTable",
          ],
          effect: "Allow",
          resources: [
            stack.resolve(table.tableArn),
            `${stack.resolve(table.tableArn)}/index/*`,
          ],
        },
        {
          actions: ["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
          effect: "Allow",
          resources: [
            stack.resolve(table.tableArn),
            `${stack.resolve(table.tableArn)}/index/*`,
          ],
        },
      ],
    });
    template.expect.toHaveResourceWithProperties(IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
    });
  });

  test("grant for an imported table", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = Table.fromTableName(stack, "MyTable", "my-table");
    const user = new User(stack, "user");

    // WHEN
    table.grant(user, "dynamodb:*");

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
      statement: [
        {
          actions: ["dynamodb:*"],
          effect: "Allow",
          resources: [
            "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/my-table",
          ],
        },
      ],
    });
    template.expect.toHaveResourceWithProperties(IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
    });
  });
});

describe("secondary indexes", () => {
  // See https://github.com/aws/aws-cdk/issues/4398
  test("attribute can be used as key attribute in one index, and non-key in another", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: { name: "pkey", type: AttributeType.NUMBER },
    });

    // WHEN
    table.addGlobalSecondaryIndex({
      indexName: "IndexA",
      partitionKey: { name: "foo", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ["bar"],
    });

    // THEN
    expect(() =>
      table.addGlobalSecondaryIndex({
        indexName: "IndexB",
        partitionKey: { name: "baz", type: AttributeType.STRING },
        sortKey: { name: "bar", type: AttributeType.STRING },
        projectionType: ProjectionType.INCLUDE,
        nonKeyAttributes: ["blah"],
      }),
    ).not.toThrow();
  });
});

describe("import", () => {
  test("report error when importing an external/existing table from invalid arn missing resource name", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    const tableArn = "arn:aws:dynamodb:us-east-1::table/";
    // WHEN
    expect(() => Table.fromTableArn(stack, "ImportedTable", tableArn)).toThrow(
      /ARN for DynamoDB table must be in the form: .../,
    );
  });

  test("static fromTableArn(arn) allows importing an external/existing table from arn", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    const tableArn = "arn:aws:dynamodb:us-east-1:11111111:table/MyTable";
    const table = Table.fromTableArn(stack, "ImportedTable", tableArn);

    const role = new Role(stack, "NewRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    table.grantReadData(role);

    // it is possible to obtain a permission statement for a ref
    const template = new Template(stack);
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          NewRole_DefaultPolicy_1C6E6512: {
            statement: expect.arrayContaining([
              {
                actions: [
                  "dynamodb:BatchGetItem",
                  "dynamodb:Query",
                  "dynamodb:GetItem",
                  "dynamodb:Scan",
                  "dynamodb:ConditionCheckItem",
                  "dynamodb:DescribeTable",
                ],
                effect: "Allow",
                // TODO: is this ok to have "null" in the resources array?
                resources: expect.arrayContaining([tableArn]),
              },
            ]),
          },
        },
      },
    });
    template.expect.toHaveResourceWithProperties(IamRolePolicy, {
      role: stack.resolve(role.roleName),
      policy:
        "${data.aws_iam_policy_document.NewRole_DefaultPolicy_1C6E6512.json}",
    });

    expect(table.tableArn).toBe(tableArn);
    expect(stack.resolve(table.tableName)).toBe("MyTable");
  });

  test("static fromTableName(name) allows importing an external/existing table from table name", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    const tableName = "MyTable";
    const table = Table.fromTableName(stack, "ImportedTable", tableName);

    const role = new Role(stack, "NewRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    table.grantReadWriteData(role);

    // it is possible to obtain a permission statement for a ref
    const template = new Template(stack);
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          NewRole_DefaultPolicy_1C6E6512: {
            statement: expect.arrayContaining([
              {
                actions: [
                  "dynamodb:BatchGetItem",
                  "dynamodb:Query",
                  "dynamodb:GetItem",
                  "dynamodb:Scan",
                  "dynamodb:ConditionCheckItem",
                  "dynamodb:BatchWriteItem",
                  "dynamodb:PutItem",
                  "dynamodb:UpdateItem",
                  "dynamodb:DeleteItem",
                  "dynamodb:DescribeTable",
                ],
                effect: "Allow",
                resources: expect.arrayContaining([
                  "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTable",
                ]),
              },
              {
                actions: ["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
                effect: "Allow",
                resources: expect.arrayContaining([
                  "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTable",
                ]),
              },
            ]),
          },
        },
      },
    });
    template.expect.toHaveResourceWithProperties(IamRolePolicy, {
      role: stack.resolve(role.roleName),
      policy:
        "${data.aws_iam_policy_document.NewRole_DefaultPolicy_1C6E6512.json}",
    });

    expect(stack.resolve(table.tableArn)).toBe(
      `arn:\${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:\${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTable`,
    );
    expect(stack.resolve(table.tableName)).toBe(tableName);
  });

  describe("stream permissions on imported tables", () => {
    test("throw if no tableStreamArn is specified", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

      const tableName = "MyTable";
      const table = Table.fromTableAttributes(stack, "ImportedTable", {
        tableName,
      });

      const role = new Role(stack, "NewRole", {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      });

      expect(() => table.grantTableListStreams(role)).toThrow(
        /DynamoDB Streams must be enabled on the table/,
      );
      expect(() => table.grantStreamRead(role)).toThrow(
        /DynamoDB Streams must be enabled on the table/,
      );
    });

    test("creates the correct list streams grant", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

      const tableName = "MyTable";
      const tableStreamArn = "arn:foo:bar:baz:TrustMeThisIsATableStream";
      const table = Table.fromTableAttributes(stack, "ImportedTable", {
        tableName,
        tableStreamArn,
      });

      const role = new Role(stack, "NewRole", {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      });

      expect(table.grantTableListStreams(role)).toBeDefined();

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
        statement: [
          {
            actions: ["dynamodb:ListStreams"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      });
      template.expect.toHaveResourceWithProperties(IamRolePolicy, {
        role: stack.resolve(role.roleName),
        policy:
          "${data.aws_iam_policy_document.NewRole_DefaultPolicy_1C6E6512.json}",
      });
    });

    test("creates the correct stream read grant", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

      const tableName = "MyTable";
      const tableStreamArn = "arn:foo:bar:baz:TrustMeThisIsATableStream";
      const table = Table.fromTableAttributes(stack, "ImportedTable", {
        tableName,
        tableStreamArn,
      });

      const role = new Role(stack, "NewRole", {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      });

      expect(table.grantStreamRead(role)).toBeDefined();

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
        statement: [
          {
            actions: ["dynamodb:ListStreams"],
            effect: "Allow",
            resources: ["*"],
          },
          {
            actions: [
              "dynamodb:DescribeStream",
              "dynamodb:GetRecords",
              "dynamodb:GetShardIterator",
            ],
            effect: "Allow",
            resources: [tableStreamArn],
          },
        ],
      });
      template.expect.toHaveResourceWithProperties(IamRolePolicy, {
        role: stack.resolve(role.roleName),
        policy:
          "${data.aws_iam_policy_document.NewRole_DefaultPolicy_1C6E6512.json}",
      });
    });

    test("if an encryption key is included, encrypt/decrypt permissions are added to the principal for grantStreamRead", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

      const tableName = "MyTable";
      const tableStreamArn = "arn:foo:bar:baz:TrustMeThisIsATableStream";
      const encryptionKey = new Key(stack, "Key", {
        enableKeyRotation: true,
      });

      const table = Table.fromTableAttributes(stack, "ImportedTable", {
        tableName,
        tableStreamArn,
        encryptionKey,
      });

      const role = new Role(stack, "NewRole", {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      });

      expect(table.grantStreamRead(role)).toBeDefined();

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
        statement: [
          {
            actions: ["dynamodb:ListStreams"],
            effect: "Allow",
            resources: ["*"],
          },
          {
            actions: ["kms:Decrypt", "kms:DescribeKey"],
            effect: "Allow",
            resources: [stack.resolve(encryptionKey.keyArn)],
          },
          {
            actions: [
              "dynamodb:DescribeStream",
              "dynamodb:GetRecords",
              "dynamodb:GetShardIterator",
            ],
            effect: "Allow",
            resources: [tableStreamArn],
          },
        ],
      });
      template.expect.toHaveResourceWithProperties(IamRolePolicy, {
        role: stack.resolve(role.roleName),
        policy:
          "${data.aws_iam_policy_document.NewRole_DefaultPolicy_1C6E6512.json}",
      });
    });

    test("creates the correct index grant if indexes have been provided when importing", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

      const table = Table.fromTableAttributes(stack, "ImportedTable", {
        tableName: "MyTableName",
        globalIndexes: ["global"],
        localIndexes: ["local"],
      });

      const role = new Role(stack, "Role", {
        assumedBy: new AnyPrincipal(),
      });

      table.grantReadData(role);

      // THEN
      const template = new Template(stack);
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: expect.arrayContaining([
                {
                  actions: [
                    "dynamodb:BatchGetItem",
                    "dynamodb:Query",
                    "dynamodb:GetItem",
                    "dynamodb:Scan",
                    "dynamodb:ConditionCheckItem",
                    "dynamodb:DescribeTable",
                  ],
                  effect: "Allow",
                  resources: [
                    "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTableName",
                    "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTableName/index/*",
                  ],
                },
              ]),
            },
          },
        },
      });
      template.expect.toHaveResourceWithProperties(IamRolePolicy, {
        role: stack.resolve(role.roleName),
        policy:
          "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
      });
    });

    test("creates the index permissions if grantIndexPermissions is provided", () => {
      const app = Testing.app();
      const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

      const table = Table.fromTableAttributes(stack, "ImportedTable", {
        tableName: "MyTableName",
        grantIndexPermissions: true,
      });

      const role = new Role(stack, "Role", {
        assumedBy: new AnyPrincipal(),
      });

      table.grantReadData(role);

      // THEN
      const template = new Template(stack);
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            Role_DefaultPolicy_2E5E5E0B: {
              statement: expect.arrayContaining([
                {
                  actions: [
                    "dynamodb:BatchGetItem",
                    "dynamodb:Query",
                    "dynamodb:GetItem",
                    "dynamodb:Scan",
                    "dynamodb:ConditionCheckItem",
                    "dynamodb:DescribeTable",
                  ],
                  effect: "Allow",
                  resources: [
                    "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTableName",
                    "arn:${data.aws_partition.Partitition.partition}:dynamodb:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/MyTableName/index/*",
                  ],
                },
              ]),
            },
          },
        },
      });
      template.expect.toHaveResourceWithProperties(IamRolePolicy, {
        role: stack.resolve(role.roleName),
        policy:
          "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
      });
    });
  });
});

describe("global", () => {
  test("create replicas", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      replica: [
        {
          region_name: "eu-west-2",
        },
        {
          region_name: "eu-central-1",
        },
      ],
      // Region is never a token, so we don't need a condition here
      // Condition: "TableStackRegionNotEqualseuwest2A03859E7",
    });
  });

  // test("create replicas without waiting to finish replication", () => {
  //   // GIVEN

  //   const app = Testing.app();
  //   const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

  //   // WHEN
  //   new Table(stack, "Table", {
  //     partitionKey: {
  //       name: "id",
  //       type: AttributeType.STRING,
  //     },
  //     replicationRegions: ["eu-west-2", "eu-central-1"],
  //     waitForReplicationToFinish: false,
  //   });

  //   // THEN
  //   Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
  //     replica: [
  //       {
  //         region_name: "eu-west-2",
  //         skip_replication_completed_wait: "true",
  //       },
  //       {
  //         region_name: "eu-west-2",
  //         skip_replication_completed_wait: "true",
  //       },
  //     ],
  //     // Region is never a token, so we don't need a condition here
  //     // Condition: "TableStackRegionNotEqualseuwest2A03859E7",
  //   });
  // });

  test("grantReadData", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    const table = new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
    });
    table.addGlobalSecondaryIndex({
      indexName: "my-index",
      partitionKey: {
        name: "key",
        type: AttributeType.STRING,
      },
    });
    const user = new User(stack, "User");

    // WHEN
    table.grantReadData(user);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "dynamodb:BatchGetItem",
              "dynamodb:Query",
              "dynamodb:GetItem",
              "dynamodb:Scan",
              "dynamodb:ConditionCheckItem",
              "dynamodb:DescribeTable",
            ],
            effect: "Allow",
            resources: [
              stack.resolve(table.tableArn),
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-west-2:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}",
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-central-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}",
              `${stack.resolve(table.tableArn)}/index/*`,
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-west-2:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}/index/*",
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-central-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}/index/*",
            ],
          },
          {
            actions: ["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
            effect: "Allow",
            resources: [
              stack.resolve(table.tableArn),
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-west-2:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}",
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-central-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}",
              `${stack.resolve(table.tableArn)}/index/*`,
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-west-2:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}/index/*",
              "arn:${data.aws_partition.Partitition.partition}:dynamodb:eu-central-1:${data.aws_caller_identity.CallerIdentity.account_id}:table/${aws_dynamodb_table.Table_CD117FA1.name}/index/*",
            ],
          },
        ],
      },
    );
  });

  test("grantReadData across regions", () => {
    // GIVEN
    const app = new App();
    const stack1 = new AwsStack(app, "Stack1", {
      ...defaultAwsStackProps,
      providerConfig: { region: "us-east-1" },
    });
    const table = new Table(stack1, "Table", {
      tableName: "my-table",
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
    });
    table.addGlobalSecondaryIndex({
      indexName: "my-index",
      partitionKey: {
        name: "key",
        type: AttributeType.STRING,
      },
    });
    const stack2 = new AwsStack(app, "Stack2", {
      ...defaultAwsStackProps,
      providerConfig: { region: "eu-west-2" },
    });
    const user = new User(stack2, "User");

    // WHEN
    table.grantReadData(user);

    // THEN
    const remoteTableRef =
      "${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1arn}";
    Template.synth(stack2).toHaveDataSourceWithProperties(
      DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "dynamodb:BatchGetItem",
              "dynamodb:Query",
              "dynamodb:GetItem",
              "dynamodb:Scan",
              "dynamodb:ConditionCheckItem",
              "dynamodb:DescribeTable",
            ],
            effect: "Allow",
            resources: [
              remoteTableRef,
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-west-2:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}",
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-central-1:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}",
              `${remoteTableRef}/index/*`,
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-west-2:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}/index/*",
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-central-1:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}/index/*",
            ],
          },
          {
            actions: ["dynamodb:GetRecords", "dynamodb:GetShardIterator"],
            effect: "Allow",
            resources: [
              remoteTableRef,
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-west-2:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}",
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-central-1:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}",
              `${remoteTableRef}/index/*`,
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-west-2:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}/index/*",
              "arn:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_partitionPartititionpartition}:dynamodb:eu-central-1:${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-dataaws_caller_identityCallerIdentityaccount_id}:table/${data.terraform_remote_state.cross-stack-reference-input-Stack1.outputs.cross-stack-output-aws_dynamodb_tableTable_CD117FA1name}/index/*",
            ],
          },
        ],
      },
    );
  });

  test("grantTableListStreams across regions", () => {
    // GIVEN
    const app = new App();
    const stack1 = new AwsStack(app, "Stack1", {
      ...defaultAwsStackProps,
      providerConfig: { region: "us-east-1" },
    });
    const table = new Table(stack1, "Table", {
      tableName: "my-table",
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
    });
    const stack2 = new AwsStack(app, "Stack2", {
      ...defaultAwsStackProps,
      providerConfig: { region: "eu-west-2" },
    });
    const user = new User(stack2, "User");

    // WHEN
    table.grantTableListStreams(user);

    // THEN
    Template.synth(stack2).toHaveDataSourceWithProperties(
      DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["dynamodb:ListStreams"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
  });

  test("throws when PROVISIONED billing mode is used without auto-scaled writes", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
      billingMode: BillingMode.PROVISIONED,
    });

    // THEN
    expect(() => {
      Template.fromStack(stack, { runValidations: true });
    }).toThrow(
      /A global Table that uses PROVISIONED as the billing mode needs auto-scaled write capacity/,
    );
  });

  test("throws when PROVISIONED billing mode is used with auto-scaled writes, but without a policy", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // WHEN
    const table = new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
      billingMode: BillingMode.PROVISIONED,
    });
    table.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    });

    // THEN
    expect(() => {
      Template.fromStack(stack, { runValidations: true });
    }).toThrow(
      /A global Table that uses PROVISIONED as the billing mode needs auto-scaled write capacity with a policy/,
    );
  });

  test("allows PROVISIONED billing mode when auto-scaled writes with a policy are specified", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // WHEN
    const table = new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      replicationRegions: ["eu-west-2", "eu-central-1"],
      billingMode: BillingMode.PROVISIONED,
    });
    table
      .autoScaleWriteCapacity({
        minCapacity: 1,
        maxCapacity: 10,
      })
      .scaleOnUtilization({ targetUtilizationPercent: 75 });

    // AWSCDK expects the billing_mode to be omitted...
    // Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
    //   billing_mode: expect.anything(), // PROVISIONED is the default
    // });
    // TODO: Is it ok to actually the billing mode?
    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      billing_mode: "PROVISIONED",
    });
  });

  test("throws when stream is set and not set to NEW_AND_OLD_IMAGES", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // THEN
    expect(
      () =>
        new Table(stack, "Table", {
          partitionKey: {
            name: "id",
            type: AttributeType.STRING,
          },
          replicationRegions: ["eu-west-2", "eu-central-1"],
          stream: StreamViewType.OLD_IMAGE,
        }),
    ).toThrow(/`NEW_AND_OLD_IMAGES`/);
  });

  test("throws with replica in same region as stack", () => {
    // GIVEN
    const app = new App();
    const stack = new AwsStack(app, "Stack", {
      ...defaultAwsStackProps,
      providerConfig: { region: "us-east-1" },
    });

    // THEN
    expect(
      () =>
        new Table(stack, "Table", {
          partitionKey: {
            name: "id",
            type: AttributeType.STRING,
          },
          replicationRegions: ["eu-west-1", "us-east-1", "eu-west-2"],
        }),
    ).toThrow(
      /`replicationRegions` cannot include the region where this stack is deployed/,
    );
  });

  // // TerraConstructs never has conditions anyway
  // test("no conditions when region is known", () => {
  //   // GIVEN
  //   const app = new App();
  //   const stack = new AwsStack(app, "Stack", {
  //     ...defaultAwsStackProps,
  //     providerConfig: { region: "eu-west-1" },
  //   });

  //   // WHEN
  //   new Table(stack, "Table", {
  //     partitionKey: {
  //       name: "id",
  //       type: AttributeType.STRING,
  //     },
  //     replicationRegions: ["eu-west-2", "eu-central-1"],
  //   });

  //   // THEN
  //   const conditions = Template.fromStack(stack).findConditions("*");
  //   expect(Object.keys(conditions).length).toEqual(0);
  // });

  // // no replication timeout in terraform provider replicas
  // test("can configure timeout", () => {
  //   // GIVEN

  //   const app = Testing.app();
  //   const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

  //   // WHEN
  //   new Table(stack, "Table", {
  //     partitionKey: {
  //       name: "id",
  //       type: AttributeType.STRING,
  //     },
  //     replicationRegions: ["eu-central-1"],
  //     replicationTimeout: Duration.hours(1),
  //   });

  //   // THEN
  //   expect(cr.Provider).toHaveBeenCalledWith(
  //     expect.anything(),
  //     expect.any(String),
  //     expect.objectContaining({
  //       totalTimeout: Duration.hours(1),
  //     }),
  //   );
  // });
});

// // TODO: removalPolicy + @cdktf/provider-aws dynamodb table does not throw
// test("L1 inside L2 expects removalpolicy to have been set", () => {
//   // Check that the "stateful L1 validation generation" works. Do it here
//   // because we know DDB tables are stateful.
//   const app = new App();
//   const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

//   class FakeTableL2 extends AwsConstructBase {
//     public get outputs(): { [key: string]: string } {
//       return {};
//     }
//     constructor(scope: Construct, id: string) {
//       super(scope, id);

//       new DynamodbTable(this, "Resource", {
//         name: "my-table",
//         hashKey: "hash",
//         attribute: [{ name: "hash", type: AttributeType.STRING }],
//       });
//     }
//   }

//   new FakeTableL2(stack, "Table");

//   expect(() => {
//     Template.fromStack(stack);
//   }).toThrow(/is a stateful resource type/);
// });

test("System errors metrics", () => {
  // GIVEN
  const app = new App();
  const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

  // WHEN
  const table = new Table(stack, "Table", {
    partitionKey: { name: "metric", type: AttributeType.STRING },
  });
  const metricTableThrottled = table.metricSystemErrorsForOperations({
    operations: [Operation.SCAN],
    period: Duration.minutes(1),
  });
  new Alarm(stack, "TableErrorAlarm", {
    metric: metricTableThrottled,
    evaluationPeriods: 1,
    threshold: 1,
  });

  // THEN
  // toMatchObject gives nicer diff output
  Template.fromStack(stack).toMatchObject({
    resource: {
      aws_cloudwatch_metric_alarm: {
        TableErrorAlarm_12A4E2F3: {
          metric_query: expect.arrayContaining([
            expect.objectContaining({
              expression: "scan",
              id: "expr_1",
              label: "Sum of errors across all operations",
            }),
            expect.objectContaining({
              id: "scan",
              metric: expect.objectContaining({
                dimensions: {
                  Operation: "Scan",
                  TableName: expect.any(String),
                },
                metric_name: "SystemErrors",
                namespace: "AWS/DynamoDB",
                period: 60,
                stat: "Sum",
              }),
              return_data: false,
            }),
          ]),
        },
      },
    },
  });
});

test("Throttled requests metrics", () => {
  // GIVEN
  const app = new App();
  const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

  // WHEN
  const table = new Table(stack, "Table", {
    partitionKey: { name: "metric", type: AttributeType.STRING },
  });
  const metricTableThrottled = table.metricThrottledRequestsForOperations({
    operations: [Operation.PUT_ITEM],
    period: Duration.minutes(1),
  });
  new Alarm(stack, "TableThrottleAlarm", {
    metric: metricTableThrottled,
    evaluationPeriods: 1,
    threshold: 1,
  });

  // THEN
  // toMatchObject gives nicer diff output
  Template.fromStack(stack).toMatchObject({
    resource: {
      aws_cloudwatch_metric_alarm: {
        TableThrottleAlarm_606592BC: {
          metric_query: expect.arrayContaining([
            expect.objectContaining({
              expression: "putitem",
            }),
            expect.objectContaining({
              metric: expect.objectContaining({
                dimensions: {
                  Operation: "PutItem",
                  TableName: expect.any(String),
                },
                metric_name: "ThrottledRequests",
                namespace: "AWS/DynamoDB",
              }),
            }),
          ]),
        },
      },
    },
  });
});

function testGrant(
  expectedActions: string[][],
  invocation: (user: IPrincipal, table: Table) => void,
) {
  // GIVEN

  const app = Testing.app();
  const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
  const table = new Table(stack, "my-table", {
    partitionKey: { name: "ID", type: AttributeType.STRING },
  });
  const user = new User(stack, "user");

  // WHEN
  invocation(user, table);

  // THEN
  const statement = expectedActions.map((actions) => ({
    actions: actions.map((a) => `dynamodb:${a}`),
    effect: "Allow",
    resources: [stack.resolve(table.tableArn)],
  }));
  const template = Template.synth(stack);
  template.toHaveDataSourceWithProperties(DataAwsIamPolicyDocument, {
    statement,
  });
  template.toHaveResourceWithProperties(IamUserPolicy, {
    name: "TestStackuserDefaultPolicy428F7825",
    user: "${aws_iam_user.user_2C2B57AE.name}",
    policy: "${data.aws_iam_policy_document.user_DefaultPolicy_17137D9B.json}",
  });
}

describe("deletionProtectionEnabled", () => {
  test.each([[true], [false]])("gets passed to table", (state) => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      deletionProtection: state,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      deletion_protection_enabled: state,
    });
  });

  test("is not passed when not set", () => {
    // GIVEN

    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", defaultAwsStackProps);

    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });

    // THEN
    Template.synth(stack).not.toHaveResourceWithProperties(
      DynamodbTable,
      expect.objectContaining({
        deletion_protection_enabled: expect.anything(),
      }),
    );
  });
});

describe("import source", () => {
  let app: App;
  let stack: AwsStack;
  let bucket: IBucket;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", defaultAwsStackProps);
    bucket = new Bucket(stack, "Bucket");
  });

  test("by default ImportSource property is not set", () => {
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });

    Template.synth(stack).not.toHaveResourceWithProperties(DynamodbTable, {
      import_table: expect.anything(),
    });
  });

  test("import DynamoDBJson format", () => {
    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      importSource: {
        compressionType: InputCompressionType.GZIP,
        inputFormat: InputFormat.dynamoDBJson(),
        bucket,
        bucketOwner: "111111111111",
        keyPrefix: "prefix",
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      import_table: {
        input_compression_type: "GZIP",
        input_format: "DYNAMODB_JSON",
        s3_bucket_source: {
          bucket: stack.resolve(bucket.bucketName),
          bucket_owner: "111111111111",
          key_prefix: "prefix",
        },
      },
    });
  });

  test("import Amazon ION format", () => {
    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      importSource: {
        compressionType: InputCompressionType.ZSTD,
        inputFormat: InputFormat.ion(),
        bucket,
        bucketOwner: "111111111111",
        keyPrefix: "prefix",
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      import_table: {
        input_compression_type: "ZSTD",
        input_format: "ION",
        s3_bucket_source: {
          bucket: stack.resolve(bucket.bucketName),
          bucket_owner: "111111111111",
          key_prefix: "prefix",
        },
      },
    });
  });

  test("import CSV format", () => {
    // WHEN
    new Table(stack, "Table", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      importSource: {
        compressionType: InputCompressionType.NONE,
        inputFormat: InputFormat.csv({
          delimiter: ",",
          headerList: ["id", "name"],
        }),
        bucket,
        bucketOwner: "111111111111",
        keyPrefix: "prefix",
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
      import_table: {
        input_compression_type: "NONE",
        input_format: "CSV",
        input_format_options: {
          csv: {
            delimiter: ",",
            header_list: ["id", "name"],
          },
        },
        s3_bucket_source: {
          bucket: stack.resolve(bucket.bucketName),
          bucket_owner: "111111111111",
          key_prefix: "prefix",
        },
      },
    });
  });

  test.each([[",,"], ["a"], ["1"], ["/"], ["+"], ["!"], ["@"]])(
    "throw error when invalid delimiter is specified",
    (delimiter) => {
      expect(() => {
        new Table(stack, "Table", {
          partitionKey: {
            name: "id",
            type: AttributeType.STRING,
          },
          importSource: {
            compressionType: InputCompressionType.NONE,
            inputFormat: InputFormat.csv({
              delimiter,
              headerList: ["id", "name"],
            }),
            bucket,
            bucketOwner: "111111111111",
            keyPrefix: "prefix",
          },
        });
      }).toThrow(
        `Delimiter must be a single character and one of the following: comma (,), tab (\\t), colon (:), semicolon (;), pipe (|), space ( ), got '${delimiter}'`,
      );
    },
  );
});

test("Resource policy test", () => {
  // GIVEN
  const app = new App();
  const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

  const doc = new PolicyDocument(stack, "Doc", {
    statement: [
      new PolicyStatement({
        actions: ["dynamodb:GetItem"],
        principals: [new ArnPrincipal("arn:aws:iam::111122223333:user/foobar")],
        resources: ["*"],
      }),
    ],
  });

  // WHEN
  const table = new Table(stack, "Table", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    resourcePolicy: doc,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    hash_key: "id",
    attribute: [{ name: "id", type: AttributeType.STRING }],
  });

  Template.synth(stack).toHaveResourceWithProperties(DynamodbResourcePolicy, {
    resource_arn: stack.resolve(table.tableArn),
    policy: "${data.aws_iam_policy_document.Doc_036E3112.json}",
  });
  Template.synth(stack).toHaveDataSourceWithProperties(
    DataAwsIamPolicyDocument,
    {
      statement: [
        {
          principals: [
            {
              identifiers: ["arn:aws:iam::111122223333:user/foobar"],
              type: "AWS",
            },
          ],
          effect: "Allow",
          actions: ["dynamodb:GetItem"],
          resources: ["*"],
        },
      ],
    },
  );
});

test("Warm Throughput test on-demand", () => {
  // GIVEN
  const app = new App();
  const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

  // WHEN
  const table = new Table(stack, "Table", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    warmThroughput: {
      readUnitsPerSecond: 13000,
      writeUnitsPerSecond: 5000,
    },
  });

  table.addGlobalSecondaryIndex({
    indexName: "my-index-1",
    partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
    warmThroughput: {
      readUnitsPerSecond: 15000,
      writeUnitsPerSecond: 6000,
    },
  });

  table.addGlobalSecondaryIndex({
    indexName: "my-index-2",
    partitionKey: { name: "gsi2pk", type: AttributeType.STRING },
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    hash_key: "id",
    attribute: [
      { name: "id", type: AttributeType.STRING },
      { name: "gsi1pk", type: AttributeType.STRING },
      { name: "gsi2pk", type: AttributeType.STRING },
    ],
    billing_mode: "PAY_PER_REQUEST",
    warm_throughput: {
      read_units_per_second: 13000,
      write_units_per_second: 5000,
    },
    global_secondary_index: [
      {
        name: "my-index-1",
        hash_key: "gsi1pk",
        projection_type: "ALL",
        warm_throughput: {
          read_units_per_second: 15000,
          write_units_per_second: 6000,
        },
      },
      {
        name: "my-index-2",
        hash_key: "gsi2pk",
        projection_type: "ALL",
      },
    ],
  });
});

test("Warm Throughput test provisioned", () => {
  // GIVEN
  const app = new App();
  const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

  // WHEN
  const table = new Table(stack, "Table", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    billingMode: BillingMode.PROVISIONED,
    readCapacity: 5,
    writeCapacity: 6,
    warmThroughput: {
      readUnitsPerSecond: 2000,
      writeUnitsPerSecond: 1000,
    },
  });

  table.addGlobalSecondaryIndex({
    indexName: "my-index-1",
    partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
    readCapacity: 7,
    writeCapacity: 8,
    warmThroughput: {
      readUnitsPerSecond: 3000,
      writeUnitsPerSecond: 4000,
    },
  });

  table.addGlobalSecondaryIndex({
    indexName: "my-index-2",
    partitionKey: { name: "gsi2pk", type: AttributeType.STRING },
    readCapacity: 9,
    writeCapacity: 10,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(DynamodbTable, {
    hash_key: "id",
    attribute: [
      { name: "id", type: AttributeType.STRING },
      { name: "gsi1pk", type: AttributeType.STRING },
      { name: "gsi2pk", type: AttributeType.STRING },
    ],
    billing_mode: "PROVISIONED",
    read_capacity: 5,
    write_capacity: 6,
    warm_throughput: {
      read_units_per_second: 2000,
      write_units_per_second: 1000,
    },
    global_secondary_index: [
      {
        name: "my-index-1",
        hash_key: "gsi1pk",
        projection_type: "ALL",
        warm_throughput: {
          read_units_per_second: 3000,
          write_units_per_second: 4000,
        },
        read_capacity: 7,
        write_capacity: 8,
      },
      {
        name: "my-index-2",
        hash_key: "gsi2pk",
        projection_type: "ALL",
        read_capacity: 9,
        write_capacity: 10,
      },
    ],
  });
});

test("Kinesis Stream - precision timestamp", () => {
  // GIVEN
  const app = new App();
  const stack = new AwsStack(app, "Stack", defaultAwsStackProps);

  const stream = new Stream(stack, "Stream");

  // WHEN
  const table = new Table(stack, "Table", {
    partitionKey: { name: "id", type: AttributeType.STRING },
    kinesisStream: stream,
    kinesisPrecisionTimestamp: ApproximateCreationDateTimePrecision.MILLISECOND,
  });

  // THEN
  const template = new Template(stack);
  template.expect.toHaveResourceWithProperties(DynamodbTable, {
    hash_key: "id",
    attribute: [{ name: "id", type: AttributeType.STRING }],
  });
  template.expect.toHaveResourceWithProperties(
    DynamodbKinesisStreamingDestination,
    {
      table_name: stack.resolve(table.tableName),
      stream_arn: stack.resolve(stream.streamArn),
      approximate_creation_date_time_precision: "MILLISECOND",
    },
  );
});
