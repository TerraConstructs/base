// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-dynamodb/lib/table.ts

import {
  dynamodbContributorInsights,
  dynamodbKinesisStreamingDestination,
  dynamodbResourcePolicy,
  dynamodbTable,
} from "@cdktf/provider-aws";
import { Token, Lazy, Annotations } from "cdktf";
import { Construct } from "constructs";
import { DynamoDBMetrics } from "./dynamodb-canned-metrics.generated";
import * as perms from "./dynamodb-perms";
import {
  EnableScalingProps,
  IScalableTableAttribute,
} from "./scalable-attribute-api";
import { ScalableTableAttribute } from "./scalable-table-attribute";
import {
  Operation,
  OperationsMetricOptions,
  SystemErrorsForOperationsMetricOptions,
  Attribute,
  BillingMode,
  ProjectionType,
  ITable,
  SecondaryIndexProps,
  TableClass,
  LocalSecondaryIndexProps,
  TableEncryption,
  StreamViewType,
  PointInTimeRecoverySpecification,
} from "./shared";
import * as appscaling from "../compute";
import * as cloudwatch from "../cloudwatch";
import * as iam from "../iam";
import * as kinesis from "../notify";
import * as kms from "../encryption";
import * as storage from ".";
import { ArnFormat, AwsConstructBase, AwsConstructProps, AwsStack } from "..";
// Missing in Terraform DynamoDb Replica Configuration block
// https://registry.terraform.io/providers/hashicorp/aws/5.88.0/docs/resources/dynamodb_table#replica
// import { Duration } from "../../duration";

// TODO Adopt UnscopedValidationError, ValidationError when available:
// - https://github.com/aws/aws-cdk/pull/33382/
// - https://github.com/aws/aws-cdk/pull/33045
// import {
//   UnscopedValidationError,
//   ValidationError,
// } from "../../core/lib/errors";

const HASH_KEY_TYPE = "HASH";
const RANGE_KEY_TYPE = "RANGE";

const MAX_LOCAL_SECONDARY_INDEX_COUNT = 5;

/**
 * Represents the table schema attributes.
 */
export interface SchemaOptions {
  /**
   * Partition key attribute definition.
   */
  readonly partitionKey: Attribute;

  /**
   * Sort key attribute definition.
   *
   * @default no sort key
   */
  readonly sortKey?: Attribute;
}

/**
 * Type of compression to use for imported data.
 */
export enum InputCompressionType {
  /**
   * GZIP compression.
   */
  GZIP = "GZIP",

  /**
   * ZSTD compression.
   */
  ZSTD = "ZSTD",

  /**
   * No compression.
   */
  NONE = "NONE",
}

/**
 * The options for imported source files in CSV format.
 */
export interface CsvOptions {
  /**
   * The delimiter used for separating items in the CSV file being imported.
   *
   * Valid delimiters are as follows:
   * - comma (`,`)
   * - tab (`\t`)
   * - colon (`:`)
   * - semicolon (`;`)
   * - pipe (`|`)
   * - space (` `)
   *
   * @default - use comma as a delimiter.
   */
  readonly delimiter?: string;

  /**
   * List of the headers used to specify a common header for all source CSV files being imported.
   *
   * **NOTE**: If this field is specified then the first line of each CSV file is treated as data instead of the header.
   * If this field is not specified the the first line of each CSV file is treated as the header.
   *
   * @default - the first line of the CSV file is treated as the header
   */
  readonly headerList?: string[];
}

/**
 * The format of the source data.
 */
export abstract class InputFormat {
  /**
   * DynamoDB JSON format.
   */
  public static dynamoDBJson(): InputFormat {
    return new (class extends InputFormat {
      public _render(): Pick<
        dynamodbTable.DynamodbTableImportTable,
        "inputFormat" | "inputFormatOptions"
      > {
        return {
          inputFormat: "DYNAMODB_JSON",
        };
      }
    })();
  }

  /**
   * Amazon Ion format.
   */
  public static ion(): InputFormat {
    return new (class extends InputFormat {
      public _render(): Pick<
        dynamodbTable.DynamodbTableImportTable,
        "inputFormat" | "inputFormatOptions"
      > {
        return {
          inputFormat: "ION",
        };
      }
    })();
  }

  /**
   * CSV format.
   */
  public static csv(options?: CsvOptions): InputFormat {
    if (
      options?.delimiter &&
      (!this.validCsvDelimiters.includes(options.delimiter) ||
        options.delimiter.length !== 1)
    ) {
      // throw new UnscopedValidationError(
      throw new Error(
        [
          "Delimiter must be a single character and one of the following:",
          `${this.readableValidCsvDelimiters.join(", ")},`,
          `got '${options.delimiter}'`,
        ].join(" "),
      );
    }

    return new (class extends InputFormat {
      public _render(): Pick<
        dynamodbTable.DynamodbTableImportTable,
        "inputFormat" | "inputFormatOptions"
      > {
        return {
          inputFormat: "CSV",
          inputFormatOptions: options
            ? {
                csv: {
                  delimiter: options?.delimiter,
                  headerList: options?.headerList,
                },
              }
            : undefined,
        };
      }
    })();
  }

  private static validCsvDelimiters = [",", "\t", ":", ";", "|", " "];
  private static readableValidCsvDelimiters = [
    "comma (,)",
    "tab (\\t)",
    "colon (:)",
    "semicolon (;)",
    "pipe (|)",
    "space ( )",
  ];

  /**
   * @internal
   */
  public abstract _render(): Pick<
    dynamodbTable.DynamodbTableImportTable,
    "inputFormat" | "inputFormatOptions"
  >;
}

/**
 *  Properties for importing data from the S3.
 */
export interface ImportSourceSpecification {
  /**
   * The compression type of the imported data.
   *
   * @default InputCompressionType.NONE
   */
  readonly compressionType?: InputCompressionType;

  /**
   * The format of the imported data.
   */
  readonly inputFormat: InputFormat;

  /**
   * The S3 bucket that is being imported from.
   */
  readonly bucket: storage.IBucket;

  /**
   * The account number of the S3 bucket that is being imported from.
   *
   * @default - no value
   */
  readonly bucketOwner?: string;

  /**
   * The key prefix shared by all S3 Objects that are being imported.
   *
   * @default - no value
   */
  readonly keyPrefix?: string;
}

/**
 * The precision associated with the DynamoDB write timestamps that will be replicated to Kinesis.
 * The default setting for record timestamp precision is microseconds. You can change this setting at any time.
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-table-kinesisstreamspecification.html#aws-properties-dynamodb-table-kinesisstreamspecification-properties
 */
export enum ApproximateCreationDateTimePrecision {
  /**
   * Millisecond precision
   */
  MILLISECOND = "MILLISECOND",

  /**
   * Microsecond precision
   */
  MICROSECOND = "MICROSECOND",
}

export interface DynamodbTableReplica {
  /** (Optional) ARN of the CMK that should be used for the AWS KMS encryption. This argument should only be used if the key is different from the default KMS-managed DynamoDB key, `alias/aws/dynamodb`. **Note:** This attribute will _not_ be populated with the ARN of _default_ keys. */
  readonly encryptionKey?: kms.IKey;
  /** (Optional) Whether to enable Point In Time Recovery for the replica. Default is `false`. */
  readonly pointInTimeRecovery?: boolean;
  /** (Optional) Whether to propagate the global table's tags to a replica. Default is `false`. Changes to tags only move in one direction: from global (source) to replica. In other words, tag drift on a replica will not trigger an update. Tag or replica changes on the global table, whether from drift or configuration changes, are propagated to replicas. Changing from `true` to `false` on a subsequent `apply` means replica tags are left as they were, unmanaged, not deleted. */
  readonly propagateTags?: boolean;
  /** (Required) Region name of the replica. */
  readonly regionName: string;
}

/**
 * Properties of a DynamoDB Table
 *
 * Use `TableProps` for all table properties
 */
export interface TableOptions extends SchemaOptions {
  /**
   * The read capacity for the table. Careful if you add Global Secondary Indexes, as
   * those will share the table's provisioned throughput.
   *
   * Can only be provided if billingMode is Provisioned.
   *
   * @default 5
   */
  readonly readCapacity?: number;
  /**
   * The write capacity for the table. Careful if you add Global Secondary Indexes, as
   * those will share the table's provisioned throughput.
   *
   * Can only be provided if billingMode is Provisioned.
   *
   * @default 5
   */
  readonly writeCapacity?: number;

  /**
   * The maximum read request units for the table. Careful if you add Global Secondary Indexes, as
   * those will share the table's maximum on-demand throughput.
   *
   * Can only be provided if billingMode is PAY_PER_REQUEST.
   *
   * @default - on-demand throughput is disabled
   */
  readonly maxReadRequestUnits?: number;
  /**
   * The write request units for the table. Careful if you add Global Secondary Indexes, as
   * those will share the table's maximum on-demand throughput.
   *
   * Can only be provided if billingMode is PAY_PER_REQUEST.
   *
   * @default - on-demand throughput is disabled
   */
  readonly maxWriteRequestUnits?: number;

  /**
   * Specify how you are charged for read and write throughput and how you manage capacity.
   *
   * @default PROVISIONED if `replicationRegions` is not specified, PAY_PER_REQUEST otherwise
   */
  readonly billingMode?: BillingMode;

  // TODO: https://github.com/hashicorp/terraform-provider-aws/issues/43142
  // readonly warmThroughput?: WarmThroughput;

  /**
   * Whether point-in-time recovery is enabled.
   * @deprecated use `pointInTimeRecoverySpecification` instead
   * @default false - point in time recovery is not enabled.
   */
  readonly pointInTimeRecovery?: boolean;

  /**
   * Whether point-in-time recovery is enabled.
   *
   * @default - point in time recovery is not enabled.
   */
  readonly pointInTimeRecoverySpecification?: PointInTimeRecoverySpecification;

  /**
   * Whether server-side encryption with an AWS managed customer master key is enabled.
   *
   * This property cannot be set if `encryption` and/or `encryptionKey` is set.
   *
   * @default - The table is encrypted with an encryption key managed by DynamoDB, and you are not charged any fee for using it.
   *
   * @deprecated This property is deprecated. In order to obtain the same behavior as
   * enabling this, set the `encryption` property to `TableEncryption.AWS_MANAGED` instead.
   */
  readonly serverSideEncryption?: boolean;

  /**
   * Specify the table class.
   * @default STANDARD
   */
  readonly tableClass?: TableClass;

  /**
   * Whether server-side encryption with an AWS managed customer master key is enabled.
   *
   * This property cannot be set if `serverSideEncryption` is set.
   *
   * @default - The table is encrypted with an encryption key managed by DynamoDB, and you are not charged any fee for using it.
   */
  readonly encryption?: TableEncryption;

  /**
   * External KMS key to use for table encryption.
   *
   * This property can only be set if `encryption` is set to `TableEncryption.CUSTOMER_MANAGED`.
   *
   * @default - If `encryption` is set to `TableEncryption.CUSTOMER_MANAGED` and this
   * property is undefined, a new KMS key will be created and associated with this table.
   * If `encryption` and this property are both undefined, then the table is encrypted with
   * an encryption key managed by DynamoDB, and you are not charged any fee for using it.
   */
  readonly encryptionKey?: kms.IKey;

  /**
   * The name of TTL attribute.
   * @default - TTL is disabled
   */
  readonly timeToLiveAttribute?: string;

  /**
   * When an item in the table is modified, StreamViewType determines what information
   * is written to the stream for this table.
   *
   * @default - streams are disabled unless `replicationRegions` is specified
   */
  readonly stream?: StreamViewType;

  /**
   * Regions where replica tables will be created
   *
   * @deprecated use replicaSpecification instead
   * @default - no replica tables are created
   */
  readonly replicationRegions?: string[];

  /**
   * The specification for replica tables.
   */
  readonly replicaSpecification?: DynamodbTableReplica[];

  // readonly replicationTimeout?: Duration; // Not directly applicable to TF's replica block configuration

  /**
   * Whether CloudWatch contributor insights is enabled.
   *
   * @default false
   */
  readonly contributorInsightsEnabled?: boolean;

  /**
   * Enables deletion protection for the table.
   *
   * @default false
   */
  readonly deletionProtection?: boolean;

  /**
   * The properties of data being imported from the S3 bucket source to the table.
   *
   * @default - no data import from the S3 bucket
   */
  readonly importSource?: ImportSourceSpecification;

  /**
   * Resource policy to assign to table.
   * Note: `aws_dynamodb_table` does not directly support a resource policy property.
   * This policy would need to be managed and applied separately, e.g., via `aws_iam_policy` attached to principals.
   * @default - No resource policy statement
   */
  readonly resourcePolicy?: iam.PolicyDocument;
}

/**
 * Properties for a DynamoDB Table
 */
export interface TableProps extends TableOptions, AwsConstructProps {
  /**
   * Enforces a particular physical table name.
   * @default <generated>
   */
  readonly tableName?: string;

  /**
   * Kinesis Data Stream to capture item-level changes for the table.
   *
   * @default - no Kinesis Data Stream
   */
  readonly kinesisStream?: kinesis.IStream;

  /**
   * Kinesis Data Stream approximate creation timestamp precision
   *
   * @default ApproximateCreationDateTimePrecision.MICROSECOND
   */
  readonly kinesisPrecisionTimestamp?: ApproximateCreationDateTimePrecision;
}

/**
 * Properties for a global secondary index
 */
export interface GlobalSecondaryIndexProps
  extends SecondaryIndexProps,
    SchemaOptions {
  /**
   * The read capacity for the global secondary index.
   *
   * Can only be provided if table billingMode is Provisioned or undefined.
   *
   * @default 5
   */
  readonly readCapacity?: number;

  /**
   * The write capacity for the global secondary index.
   *
   * Can only be provided if table billingMode is Provisioned or undefined.
   *
   * @default 5
   */
  readonly writeCapacity?: number;

  /**
   * The maximum read request units for the global secondary index.
   *
   * Can only be provided if table billingMode is PAY_PER_REQUEST.
   *
   * @default - on-demand throughput is disabled
   */
  readonly maxReadRequestUnits?: number;

  /**
   * The maximum write request units for the global secondary index.
   *
   * Can only be provided if table billingMode is PAY_PER_REQUEST.
   *
   * @default - on-demand throughput is disabled
   */
  readonly maxWriteRequestUnits?: number;

  // TODO: https://github.com/hashicorp/terraform-provider-aws/issues/43142
  // readonly warmThroughput?: WarmThroughput;

  /**
   * Whether CloudWatch contributor insights is enabled for the specified global secondary index.
   *
   * @default false
   */
  readonly contributorInsightsEnabled?: boolean;
}

/**
 * Reference to a dynamodb table.
 */
export interface TableAttributes {
  /**
   * The ARN of the dynamodb table.
   * One of this, or `tableName`, is required.
   *
   * @default - no table arn
   */
  readonly tableArn?: string;

  /**
   * The table name of the dynamodb table.
   * One of this, or `tableArn`, is required.
   *
   * @default - no table name
   */
  readonly tableName?: string;

  /**
   * The ARN of the table's stream.
   *
   * @default - no table stream
   */
  readonly tableStreamArn?: string;

  /**
   * KMS encryption key, if this table uses a customer-managed encryption key.
   *
   * @default - no key
   */
  readonly encryptionKey?: kms.IKey;

  /**
   * The name of the global indexes set for this Table.
   * Note that you need to set either this property,
   * or `localIndexes`,
   * if you want methods like grantReadData()
   * to grant permissions for indexes as well as the table itself.
   *
   * @default - no global indexes
   */
  readonly globalIndexes?: string[];

  /**
   * The name of the local indexes set for this Table.
   * Note that you need to set either this property,
   * or `globalIndexes`,
   * if you want methods like grantReadData()
   * to grant permissions for indexes as well as the table itself.
   *
   * @default - no local indexes
   */
  readonly localIndexes?: string[];

  /**
   * If set to true, grant methods always grant permissions for all indexes.
   * If false is provided, grant methods grant the permissions
   * only when `globalIndexes` or `localIndexes` is specified.
   *
   * @default - false
   */
  readonly grantIndexPermissions?: boolean;
}

export abstract class TableBase
  extends AwsConstructBase
  implements ITable, iam.IAwsConstructWithPolicy
{
  public abstract readonly tableArn: string;
  public abstract readonly tableName: string;
  public abstract readonly tableStreamArn?: string;
  public abstract readonly encryptionKey?: kms.IKey;
  public abstract resourcePolicy?: iam.PolicyDocument;

  protected readonly regionalArns = new Array<string>();

  public get outputs(): Record<string, any> {
    return {
      tableArn: this.tableArn,
      tableName: this.tableName,
      tableStreamArn: this.tableStreamArn,
    };
  }

  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    const resources = [
      this.tableArn,
      Lazy.stringValue({
        produce: () =>
          this.hasIndex
            ? `${this.tableArn}/index/*`
            : Token.asString(Token.nullValue()),
      }),
      ...this.regionalArns,
      ...this.regionalArns.map((arn) =>
        Lazy.stringValue({
          produce: () =>
            this.hasIndex
              ? `${arn}/index/*`
              : Token.asString(Token.nullValue()),
        }),
      ),
    ];

    return iam.Grant.addToPrincipalOrResource({
      grantee,
      actions,
      resourceArns: resources.filter(
        (r) => r !== Token.asString(Token.nullValue()),
      ),
      resource: this, // Grant will take the principal from the grantee
    });
  }

  public grantStream(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    if (!this.tableStreamArn) {
      // throw new ValidationError(
      throw new Error(
        `DynamoDB Streams must be enabled on the table ${this.node.path}`,
        // this,
      );
    }

    return iam.Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [this.tableStreamArn],
      scope: this,
    });
  }

  public grantReadData(grantee: iam.IGrantable): iam.Grant {
    const tableActions = perms.READ_DATA_ACTIONS.concat(perms.DESCRIBE_TABLE);
    return this.combinedGrant(grantee, {
      keyActions: perms.KEY_READ_ACTIONS,
      tableActions,
    });
  }

  public grantTableListStreams(grantee: iam.IGrantable): iam.Grant {
    if (!this.tableStreamArn) {
      // throw new ValidationError(
      throw new Error(
        `DynamoDB Streams must be enabled on the table ${this.node.path}`,
        // this,
      );
    }

    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["dynamodb:ListStreams"],
      resourceArns: ["*"],
    });
  }

  public grantStreamRead(grantee: iam.IGrantable): iam.Grant {
    this.grantTableListStreams(grantee);
    return this.combinedGrant(grantee, {
      keyActions: perms.KEY_READ_ACTIONS,
      streamActions: perms.READ_STREAM_DATA_ACTIONS,
    });
  }

  public grantWriteData(grantee: iam.IGrantable): iam.Grant {
    const tableActions = perms.WRITE_DATA_ACTIONS.concat(perms.DESCRIBE_TABLE);
    const keyActions = perms.KEY_READ_ACTIONS.concat(perms.KEY_WRITE_ACTIONS);
    return this.combinedGrant(grantee, { keyActions, tableActions });
  }

  public grantReadWriteData(grantee: iam.IGrantable): iam.Grant {
    const tableActions = perms.READ_DATA_ACTIONS.concat(
      perms.WRITE_DATA_ACTIONS,
    ).concat(perms.DESCRIBE_TABLE);
    const keyActions = perms.KEY_READ_ACTIONS.concat(perms.KEY_WRITE_ACTIONS);
    return this.combinedGrant(grantee, { keyActions, tableActions });
  }

  public grantFullAccess(grantee: iam.IGrantable) {
    const keyActions = perms.KEY_READ_ACTIONS.concat(perms.KEY_WRITE_ACTIONS);
    return this.combinedGrant(grantee, {
      keyActions,
      tableActions: ["dynamodb:*"],
    });
  }

  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.resourcePolicy) {
      // ensure a policy exists and is associated with the table
      this.resourcePolicy = new iam.PolicyDocument(this, "Policy", {
        statement: [],
      });
      new dynamodbResourcePolicy.DynamodbResourcePolicy(
        this,
        "PolicyAttachment",
        {
          policy: this.resourcePolicy.json,
          resourceArn: this.tableArn,
        },
      );
    }
    this.resourcePolicy.addStatements(statement);
    return {
      statementAdded: true,
      policyDependable: this,
    };
  }

  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/DynamoDB",
      metricName,
      dimensionsMap: {
        TableName: this.tableName,
      },
      ...props,
    }).attachTo(this);
  }

  public metricConsumedReadCapacityUnits(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(
      DynamoDBMetrics.consumedReadCapacityUnitsSum,
      props,
    );
  }

  public metricConsumedWriteCapacityUnits(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(
      DynamoDBMetrics.consumedWriteCapacityUnitsSum,
      props,
    );
  }

  /** @deprecated use `metricSystemErrorsForOperations`. */
  public metricSystemErrors(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    if (!props?.dimensionsMap?.Operation) {
      // 'Operation' must be passed because its an operational metric.
      // throw new ValidationError(
      throw new Error(
        "'Operation' dimension must be passed for the 'SystemErrors' metric.",
        // this,
      );
    }

    const dimensionsMap = {
      TableName: this.tableName,
      ...props?.dimensionsMap,
    };

    return this.metric("SystemErrors", {
      statistic: "sum",
      ...props,
      dimensionsMap,
    });
  }

  public metricUserErrors(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    if (props?.dimensionsMap) {
      // throw new ValidationError(
      throw new Error(
        "'dimensionsMap' is not supported for the 'UserErrors' metric",
        // this,
      );
    }
    return this.metric("UserErrors", {
      statistic: "sum",
      ...props,
      dimensionsMap: {},
    });
  }

  public metricConditionalCheckFailedRequests(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.metric("ConditionalCheckFailedRequests", {
      statistic: "sum",
      ...props,
    });
  }

  /** @deprecated Do not use this function. It returns an invalid metric. Use `metricThrottledRequestsForOperation` instead. */
  public metricThrottledRequests(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.metric("ThrottledRequests", { statistic: "sum", ...props });
  }

  public metricSuccessfulRequestLatency(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    if (!props?.dimensionsMap?.Operation) {
      // throw new ValidationError(
      throw new Error(
        "'Operation' dimension must be passed for the 'SuccessfulRequestLatency' metric.",
        // this,
      );
    }

    const dimensionsMap = {
      TableName: this.tableName,
      Operation: props.dimensionsMap.Operation,
    };

    return new cloudwatch.Metric({
      ...DynamoDBMetrics.successfulRequestLatencyAverage(dimensionsMap),
      ...props,
      dimensionsMap,
    }).attachTo(this);
  }

  public metricThrottledRequestsForOperation(
    operation: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...DynamoDBMetrics.throttledRequestsSum({
        Operation: operation,
        TableName: this.tableName,
      }),
      ...props,
    }).attachTo(this);
  }

  public metricThrottledRequestsForOperations(
    props?: OperationsMetricOptions,
  ): cloudwatch.IMetric {
    return this.sumMetricsForOperations(
      "ThrottledRequests",
      "Sum of throttled requests across all operations",
      props,
    );
  }

  public metricSystemErrorsForOperations(
    props?: SystemErrorsForOperationsMetricOptions,
  ): cloudwatch.IMetric {
    return this.sumMetricsForOperations(
      "SystemErrors",
      "Sum of errors across all operations",
      props,
    );
  }

  private sumMetricsForOperations(
    metricName: string,
    expressionLabel: string,
    props?: OperationsMetricOptions,
  ): cloudwatch.IMetric {
    if (props?.dimensionsMap?.Operation) {
      // throw new ValidationError(
      throw new Error(
        "The Operation dimension is not supported. Use the 'operations' property.",
        // this,
      );
    }

    const operations = props?.operations ?? Object.values(Operation);
    const values = this.createMetricsForOperations(metricName, operations, {
      statistic: "sum",
      ...props,
    });

    return new cloudwatch.MathExpression({
      expression: `${Object.keys(values).join(" + ")}`,
      usingMetrics: { ...values },
      color: props?.color,
      label: expressionLabel,
      period: props?.period,
    });
  }

  private createMetricsForOperations(
    metricName: string,
    operations: Operation[],
    props?: cloudwatch.MetricOptions,
    metricNameMapper?: (op: Operation) => string,
  ): Record<string, cloudwatch.IMetric> {
    const metrics: Record<string, cloudwatch.IMetric> = {};
    const mapper = metricNameMapper ?? ((op) => op.toLowerCase());

    if (props?.dimensionsMap?.Operation) {
      // throw new ValidationError(
      throw new Error(
        "Invalid properties. Operation dimension is not supported when calculating operational metrics",
        // this,
      );
    }

    for (const operation of operations) {
      const metric = this.metric(metricName, {
        ...props,
        dimensionsMap: {
          TableName: this.tableName,
          Operation: operation,
          ...props?.dimensionsMap,
        },
      });

      const operationMetricName = mapper(operation);
      const firstChar = operationMetricName.charAt(0);

      if (firstChar === firstChar.toUpperCase()) {
        // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/using-metric-math.html#metric-math-syntax
        // throw new ValidationError(
        throw new Error(
          `Mapper generated an illegal operation metric name: ${operationMetricName}. Must start with a lowercase letter`,
          // this,
        );
      }
      metrics[operationMetricName] = metric;
    }
    return metrics;
  }

  protected abstract get hasIndex(): boolean;

  private combinedGrant(
    grantee: iam.IGrantable,
    opts: {
      keyActions?: string[];
      tableActions?: string[];
      streamActions?: string[];
    },
  ): iam.Grant {
    if (this.encryptionKey && opts.keyActions) {
      this.encryptionKey.grant(grantee, ...opts.keyActions);
    }
    if (opts.tableActions) {
      const resources = [
        this.tableArn,
        Lazy.stringValue({
          produce: () =>
            this.hasIndex
              ? `${this.tableArn}/index/*`
              : Token.asString(Token.nullValue()),
        }),
        ...this.regionalArns,
        ...this.regionalArns.map((arn) =>
          Lazy.stringValue({
            produce: () =>
              this.hasIndex
                ? `${arn}/index/*`
                : Token.asString(Token.nullValue()),
          }),
        ),
      ];
      const ret = iam.Grant.addToPrincipalOrResource({
        grantee,
        actions: opts.tableActions,
        resourceArns: resources.filter(
          (r) => r !== Token.asString(Token.nullValue()),
        ),
        resource: this,
      });
      return ret;
    }

    if (opts.streamActions) {
      if (!this.tableStreamArn) {
        // throw new ValidationError(
        throw new Error(
          `DynamoDB Streams must be enabled on the table ${this.node.path}`,
          // this,
        );
      }
      const ret = iam.Grant.addToPrincipalOrResource({
        grantee,
        actions: opts.streamActions,
        resourceArns: [this.tableStreamArn],
        resource: this,
      });
      return ret;
    }
    // throw new ValidationError(
    throw new Error(
      `Unexpected grant combination, actions must be provided for table or stream.`,
      // this,
    );
  }

  private cannedMetric(
    fn: (dims: { TableName: string }) => cloudwatch.MetricProps,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...fn({ TableName: this.tableName }),
      ...props,
    }).attachTo(this);
  }
}

/**
 * Provides a DynamoDB table.
 */
export class Table extends TableBase {
  /**
   * Permits an IAM Principal to list all DynamoDB Streams.
   * @deprecated Use `#grantTableListStreams` for more granular permission
   * @param grantee The principal (no-op if undefined)
   */
  public static grantListStreams(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["dynamodb:ListStreams"],
      resourceArns: ["*"],
    });
  }

  /**
   * Creates a Table construct that represents an external table via table name.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param tableName The table's name.
   */
  public static fromTableName(
    scope: Construct,
    id: string,
    tableName: string,
  ): ITable {
    return Table.fromTableAttributes(scope, id, { tableName });
  }

  /**
   * Creates a Table construct that represents an external table via table arn.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param tableArn The table's ARN.
   */
  public static fromTableArn(
    scope: Construct,
    id: string,
    tableArn: string,
  ): ITable {
    return Table.fromTableAttributes(scope, id, { tableArn });
  }

  /**
   * Creates a Table construct that represents an external table.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param attrs A `TableAttributes` object.
   */
  public static fromTableAttributes(
    scope: Construct,
    id: string,
    attrs: TableAttributes,
  ): ITable {
    class Import extends TableBase {
      public readonly tableName: string;
      public readonly tableArn: string;
      public readonly tableStreamArn?: string;
      public readonly encryptionKey?: kms.IKey;
      public resourcePolicy?: iam.PolicyDocument;
      protected readonly hasIndex =
        (attrs.grantIndexPermissions ?? false) ||
        (attrs.globalIndexes ?? []).length > 0 ||
        (attrs.localIndexes ?? []).length > 0;

      constructor(
        props: AwsConstructProps,
        _tableArn: string,
        tableName: string,
        tableStreamArn?: string,
      ) {
        super(scope, id, props);
        this.tableArn = _tableArn;
        this.tableName = tableName;
        this.tableStreamArn = tableStreamArn;
        this.encryptionKey = attrs.encryptionKey;
      }
    }

    let name: string;
    let arn: string;
    const stack = AwsStack.ofAwsConstruct(scope);
    if (!attrs.tableName) {
      if (!attrs.tableArn) {
        // throw new ValidationError(
        throw new Error(
          "One of tableName or tableArn is required!",
          // scope,
        );
      }
      arn = attrs.tableArn;
      const maybeTableName = stack.splitArn(
        attrs.tableArn,
        ArnFormat.SLASH_RESOURCE_NAME,
      ).resourceName;
      if (!maybeTableName) {
        // throw new ValidationError(
        throw new Error(
          "ARN for DynamoDB table must be in the form: arn:<partition>:dynamodb:<region>:<account>:table/<table-name>",
          // scope,
        );
      }
      name = maybeTableName;
    } else {
      if (attrs.tableArn) {
        // throw new ValidationError(
        throw new Error(
          "Only one of tableArn or tableName can be provided",
          // scope,
        );
      }
      name = attrs.tableName;
      arn = stack.formatArn({
        service: "dynamodb",
        resource: "table",
        resourceName: attrs.tableName,
      });
    }

    return new Import(
      { environmentFromArn: arn },
      arn,
      name,
      attrs.tableStreamArn,
    );
  }

  public readonly encryptionKey?: kms.IKey;

  /**
   * Resource policy to assign to DynamoDB Table.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-table-resourcepolicy.html
   * @default - No resource policy statements are added to the created table.
   */
  public resourcePolicy?: iam.PolicyDocument;
  public readonly tableArn: string;
  public readonly tableName: string;
  public readonly tableStreamArn: string | undefined;

  private readonly attributeDefinitionsInternal =
    new Array<dynamodbTable.DynamodbTableAttribute>();
  private readonly globalSecondaryIndexesInternal =
    new Array<dynamodbTable.DynamodbTableGlobalSecondaryIndex>();
  private readonly localSecondaryIndexesInternal =
    new Array<dynamodbTable.DynamodbTableLocalSecondaryIndex>();

  private readonly secondaryIndexSchemas = new Map<string, SchemaOptions>();
  private readonly nonKeyAttributes = new Set<string>();

  private readonly tablePartitionKey: Attribute;
  private readonly tableSortKey?: Attribute;

  private readonly billingMode: BillingMode;
  private readonly tableScaling: ScalableAttributePair = {};
  private readonly indexScaling = new Map<string, ScalableAttributePair>();
  private readonly scalingRole: iam.IRole;

  private readonly _resource: dynamodbTable.DynamodbTable;
  private readonly _replicas: dynamodbTable.DynamodbTableReplica[] | undefined;

  constructor(scope: Construct, id: string, props: TableProps) {
    super(scope, id, props);

    const physicalTableName =
      props.tableName ?? this.stack.uniqueResourceName(this);

    const { sseSpecification, encryptionKey } = this.parseEncryption(props);
    this.encryptionKey = encryptionKey;

    const pointInTimeRecovery = this.renderPointInTimeRecovery(props);

    // error if both replicationRegions and replicaSpecification are specified
    if (props.replicationRegions && props.replicaSpecification) {
      // throw new ValidationError(
      throw new Error(
        "You cannot specify both `replicationRegions` and `replicaSpecification`",
        // this,
      );
    }

    let streamSpecification:
      | {
          streamEnabled: boolean;
          streamViewType?: StreamViewType;
        }
      | undefined;
    if (
      (props.replicationRegions && props.replicationRegions.length > 0) ||
      (props.replicaSpecification && props.replicaSpecification.length > 0)
    ) {
      if (props.stream && props.stream !== StreamViewType.NEW_AND_OLD_IMAGES) {
        // throw new ValidationError(
        throw new Error(
          "`stream` must be set to `NEW_AND_OLD_IMAGES` when specifying `replicationRegions`",
          // this,
        );
      }
      this.billingMode = props.billingMode ?? BillingMode.PAY_PER_REQUEST;
      streamSpecification = {
        streamEnabled: true,
        streamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
      };
    } else {
      this.billingMode = props.billingMode ?? BillingMode.PROVISIONED;
      if (props.stream) {
        streamSpecification = {
          streamEnabled: true,
          streamViewType: props.stream,
        };
      }
    }
    this.validateProvisioning(props);
    this.addKey(props.partitionKey, HASH_KEY_TYPE);
    this.tablePartitionKey = props.partitionKey;
    if (props.sortKey) {
      this.addKey(props.sortKey, RANGE_KEY_TYPE);
      this.tableSortKey = props.sortKey;
    }

    this._replicas = this.renderReplicas(
      props.replicationRegions,
      props.replicaSpecification,
    );
    if (this._replicas && this._replicas.length > 0) {
      this._replicas.forEach((r) =>
        // Save regional arns for grantXxx() methods
        this.regionalArns.push(
          this.stack.formatArn({
            region: r.regionName,
            service: "dynamodb",
            resource: "table",
            resourceName: physicalTableName,
          }),
        ),
      );
    }

    this._resource = new dynamodbTable.DynamodbTable(this, "Resource", {
      name: physicalTableName,
      hashKey: this.tablePartitionKey.name,
      rangeKey: this.tableSortKey?.name,
      attribute: this.attributeDefinitionsInternal,
      globalSecondaryIndex: Lazy.anyValue(
        {
          produce: () =>
            this.globalSecondaryIndexesInternal.map(
              dynamodbTable.dynamodbTableGlobalSecondaryIndexToTerraform,
            ),
        },
        { omitEmptyArray: true },
      ),
      localSecondaryIndex: Lazy.anyValue(
        {
          produce: () =>
            this.localSecondaryIndexesInternal.map(
              dynamodbTable.dynamodbTableLocalSecondaryIndexToTerraform,
            ),
        },
        { omitEmptyArray: true },
      ),
      pointInTimeRecovery,
      billingMode: this.billingMode,
      readCapacity:
        this.billingMode === BillingMode.PROVISIONED
          ? (props.readCapacity ?? 5)
          : undefined,
      writeCapacity:
        this.billingMode === BillingMode.PROVISIONED
          ? (props.writeCapacity ?? 5)
          : undefined,
      onDemandThroughput:
        this.billingMode === BillingMode.PAY_PER_REQUEST &&
        (props.maxReadRequestUnits || props.maxWriteRequestUnits)
          ? {
              maxReadRequestUnits: props.maxReadRequestUnits,
              maxWriteRequestUnits: props.maxWriteRequestUnits,
            }
          : undefined,
      serverSideEncryption: sseSpecification,
      streamEnabled: streamSpecification?.streamEnabled,
      streamViewType: streamSpecification?.streamViewType,
      tableClass: props.tableClass,
      ttl: props.timeToLiveAttribute
        ? { attributeName: props.timeToLiveAttribute, enabled: true }
        : undefined,
      deletionProtectionEnabled: props.deletionProtection,
      importTable: this.renderImportSourceSpecification(props.importSource),
      replica: this._replicas,
      // resourcePolicy: props.resourcePolicy ? { policyDocument: this.stack.toJsonString(props.resourcePolicy.toJSON()) } : undefined, // Not in TF resource
      // TODO: https://github.com/hashicorp/terraform-provider-aws/issues/43142
      // warmThroughput: props.warmThroughput ?? undefined, // Not in TF resource
    });

    this.tableArn = this._resource.arn;
    this.tableName = this._resource.name;
    this.tableStreamArn = streamSpecification?.streamEnabled
      ? this._resource.streamArn
      : undefined;
    this.resourcePolicy = props.resourcePolicy;
    if (this.resourcePolicy) {
      new dynamodbResourcePolicy.DynamodbResourcePolicy(
        this,
        "ResourcePolicy",
        {
          policy: this.resourcePolicy.json,
          resourceArn: this.tableArn,
        },
      );
    }

    if (props.kinesisStream) {
      new dynamodbKinesisStreamingDestination.DynamodbKinesisStreamingDestination(
        this,
        "KinesisStreamingDestination",
        {
          tableName: this.tableName,
          streamArn: props.kinesisStream.streamArn,
          ...(props.kinesisPrecisionTimestamp && {
            approximateCreationDateTimePrecision:
              props.kinesisPrecisionTimestamp,
          }),
        },
      );
    }

    if (props.contributorInsightsEnabled) {
      // TODO: Generate conntributor insights per Global Secondary Index
      // this.globalSecondaryIndexesInternal
      new dynamodbContributorInsights.DynamodbContributorInsights(
        this,
        "ContributorInsights",
        {
          tableName: this.tableName,
          // TODO: use for each on gli iterator
          // indexName: iterator.value,
        },
      );
    }

    this.scalingRole = this.makeScalingRole();

    this.node.addValidation({ validate: () => this.validateTable() });
  }

  public addGlobalSecondaryIndex(props: GlobalSecondaryIndexProps) {
    this.validateProvisioningGSI(props);
    this.validateIndexName(props.indexName);

    const gsiProjection = this.buildIndexProjection(props);
    this.registerAttribute(props.partitionKey);
    if (props.sortKey) {
      this.registerAttribute(props.sortKey);
    }

    this.globalSecondaryIndexesInternal.push({
      name: props.indexName,
      hashKey: props.partitionKey.name,
      rangeKey: props.sortKey?.name,
      projectionType: gsiProjection.projectionType,
      nonKeyAttributes: gsiProjection.nonKeyAttributes,
      readCapacity:
        this.billingMode === BillingMode.PROVISIONED
          ? (props.readCapacity ?? 5)
          : undefined,
      writeCapacity:
        this.billingMode === BillingMode.PROVISIONED
          ? (props.writeCapacity ?? 5)
          : undefined,
      onDemandThroughput:
        this.billingMode === BillingMode.PAY_PER_REQUEST &&
        (props.maxReadRequestUnits || props.maxWriteRequestUnits)
          ? {
              maxReadRequestUnits: props.maxReadRequestUnits,
              maxWriteRequestUnits: props.maxWriteRequestUnits,
            }
          : undefined,
      // contributorInsightsEnabled: props.contributorInsightsEnabled, // Not in TF GSI block
      // warmThroughput: props.warmThroughput, // Not in TF GSI block
    });

    this.secondaryIndexSchemas.set(props.indexName, {
      partitionKey: props.partitionKey,
      sortKey: props.sortKey,
    });
    this.indexScaling.set(props.indexName, {});
  }

  public addLocalSecondaryIndex(props: LocalSecondaryIndexProps) {
    if (
      this.localSecondaryIndexesInternal.length >=
      MAX_LOCAL_SECONDARY_INDEX_COUNT
    ) {
      throw new RangeError(
        `A maximum number of local secondary index per table is ${MAX_LOCAL_SECONDARY_INDEX_COUNT}`,
      );
    }
    this.validateIndexName(props.indexName);

    if (!this.tablePartitionKey) {
      // throw new ValidationError(
      throw new Error(
        "Table partition key must be defined before adding local secondary index",
        // this,
      );
    }
    this.registerAttribute(this.tablePartitionKey);
    this.registerAttribute(props.sortKey);

    const lsiProjection = this.buildIndexProjection(props);

    this.localSecondaryIndexesInternal.push({
      name: props.indexName,
      rangeKey: props.sortKey.name,
      projectionType: lsiProjection.projectionType,
      nonKeyAttributes: lsiProjection.nonKeyAttributes,
    });

    this.secondaryIndexSchemas.set(props.indexName, {
      partitionKey: this.tablePartitionKey,
      sortKey: props.sortKey,
    });
  }

  public autoScaleReadCapacity(
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.tableScaling.scalableReadAttribute) {
      // throw new ValidationError(
      throw new Error(
        "Read AutoScaling already enabled for this table",
        // this,
      );
    }
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      // throw new ValidationError(
      throw new Error(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        // this,
      );
    }

    return (this.tableScaling.scalableReadAttribute =
      new ScalableTableAttribute(this, "ReadScaling", {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}`,
        dimension: "dynamodb:table:ReadCapacityUnits",
        role: this.scalingRole,
        ...props,
      }));
  }

  public autoScaleWriteCapacity(
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.tableScaling.scalableWriteAttribute) {
      // throw new ValidationError(
      throw new Error(
        "Write AutoScaling already enabled for this table",
        // this,
      );
    }
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      // throw new ValidationError(
      throw new Error(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        // this,
      );
    }

    this.tableScaling.scalableWriteAttribute = new ScalableTableAttribute(
      this,
      "WriteScaling",
      {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}`,
        dimension: "dynamodb:table:WriteCapacityUnits",
        role: this.scalingRole,
        ...props,
      },
    );
    // If there are replicas, they depend on the write scaling policy of the main table.
    // This is not explicitly modeled in TF but was handled by CustomResource dependencies in CDK.
    // For TF, this dependency is implicit if the provider handles it, or might need explicit dependsOn if issues arise.
    return this.tableScaling.scalableWriteAttribute;
  }

  public autoScaleGlobalSecondaryIndexReadCapacity(
    indexName: string,
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      // throw new ValidationError(
      throw new Error(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        // this,
      );
    }
    const attributePair = this.indexScaling.get(indexName);
    if (!attributePair) {
      // throw new ValidationError(
      throw new Error(
        `No global secondary index with name ${indexName}`,
        // this,
      );
    }
    if (attributePair.scalableReadAttribute) {
      // throw new ValidationError(
      throw new Error(
        "Read AutoScaling already enabled for this index",
        // this,
      );
    }

    return (attributePair.scalableReadAttribute = new ScalableTableAttribute(
      this,
      `${indexName}ReadScaling`,
      {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}/index/${indexName}`,
        dimension: "dynamodb:index:ReadCapacityUnits",
        role: this.scalingRole,
        ...props,
      },
    ));
  }

  public autoScaleGlobalSecondaryIndexWriteCapacity(
    indexName: string,
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      // throw new ValidationError(
      throw new Error(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        // this,
      );
    }
    const attributePair = this.indexScaling.get(indexName);
    if (!attributePair) {
      // throw new ValidationError(
      throw new Error(
        `No global secondary index with name ${indexName}`,
        // this,
      );
    }
    if (attributePair.scalableWriteAttribute) {
      // throw new ValidationError(
      throw new Error(
        "Write AutoScaling already enabled for this index",
        // this,
      );
    }

    return (attributePair.scalableWriteAttribute = new ScalableTableAttribute(
      this,
      `${indexName}WriteScaling`,
      {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}/index/${indexName}`,
        dimension: "dynamodb:index:WriteCapacityUnits",
        role: this.scalingRole,
        ...props,
      },
    ));
  }

  public schema(indexName?: string): SchemaOptions {
    if (!indexName) {
      return {
        partitionKey: this.tablePartitionKey,
        sortKey: this.tableSortKey,
      };
    }
    const schema = this.secondaryIndexSchemas.get(indexName);
    if (!schema) {
      // throw new ValidationError(
      throw new Error(
        `Cannot find schema for index: ${indexName}. Use 'addGlobalSecondaryIndex' or 'addLocalSecondaryIndex' to add index`,
        // this,
      );
    }
    return schema;
  }

  private validateTable(): string[] {
    const errors = new Array<string>();
    if (!this.tablePartitionKey) {
      errors.push("A partition key must be specified");
    }
    if (this.localSecondaryIndexesInternal.length > 0 && !this.tableSortKey) {
      errors.push(
        "A sort key of the table must be specified to add local secondary indexes",
      );
    }
    if (
      this._replicas &&
      this._replicas.length > 0 &&
      this.billingMode === BillingMode.PROVISIONED
    ) {
      const writeAutoScaleAttribute = this.tableScaling.scalableWriteAttribute;
      if (!writeAutoScaleAttribute) {
        errors.push(
          "A global Table that uses PROVISIONED as the billing mode needs auto-scaled write capacity. " +
            "Use the autoScaleWriteCapacity() method to enable it.",
        );
      } else if (!writeAutoScaleAttribute._scalingPolicyCreated) {
        errors.push(
          "A global Table that uses PROVISIONED as the billing mode needs auto-scaled write capacity with a policy. " +
            "Call one of the scaleOn*() methods of the object returned from autoScaleWriteCapacity()",
        );
      }
    }
    return errors;
  }

  private validateProvisioning(props: {
    readCapacity?: number;
    writeCapacity?: number;
  }) {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      if (
        props.readCapacity !== undefined ||
        props.writeCapacity !== undefined
      ) {
        // throw new ValidationError(
        throw new Error(
          "You cannot provision read and write capacity for a table with PAY_PER_REQUEST billing mode",
          // this,
        );
      }
    }
  }

  private validateProvisioningGSI(props: GlobalSecondaryIndexProps) {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      if (
        props.readCapacity !== undefined ||
        props.writeCapacity !== undefined
      ) {
        // throw new ValidationError(
        throw new Error(
          "You cannot provision read and write capacity for a GSI with PAY_PER_REQUEST billing mode on the table",
          // this,
        );
      }
    }
  }

  private validateIndexName(indexName: string) {
    if (this.secondaryIndexSchemas.has(indexName)) {
      // throw new ValidationError(
      throw new Error(
        `A duplicate index name, ${indexName}, is not allowed`,
        // this,
      );
    }
  }

  private validateNonKeyAttributes(nonKeyAttributes: string[]) {
    if (this.nonKeyAttributes.size + nonKeyAttributes.length > 100) {
      throw new RangeError(
        "A maximum number of nonKeyAttributes across all of secondary indexes is 100",
      );
    }
    nonKeyAttributes.forEach((att) => this.nonKeyAttributes.add(att));
  }

  private renderPointInTimeRecovery(
    props: TableProps,
  ): dynamodbTable.DynamodbTablePointInTimeRecovery | undefined {
    if (
      props.pointInTimeRecoverySpecification !== undefined &&
      props.pointInTimeRecovery !== undefined
    ) {
      // throw new ValidationError(
      throw new Error(
        "`pointInTimeRecoverySpecification` and `pointInTimeRecovery` are set. Use `pointInTimeRecoverySpecification` only.",
        // this,
      );
    }

    const spec = props.pointInTimeRecoverySpecification;
    if (spec?.recoveryPeriodInDays) {
      // TODO: Upgrade provider to 5.98.0 to support recoveryPeriodInDays
      Annotations.of(this).addWarning(
        "Warning: recoveryPeriodInDays is not supported until provider aws is upgraded to 5.98.0 and will be ignored.",
      );
    }

    const enabled =
      spec?.pointInTimeRecoveryEnabled ?? props.pointInTimeRecovery;
    if (enabled === undefined) return undefined;
    return { enabled };
  }

  private buildIndexProjection(
    props: SecondaryIndexProps,
  ): Pick<
    dynamodbTable.DynamodbTableGlobalSecondaryIndex,
    "projectionType" | "nonKeyAttributes"
  > {
    if (
      props.projectionType === ProjectionType.INCLUDE &&
      !props.nonKeyAttributes
    ) {
      // throw new ValidationError(
      throw new Error(
        `Non-key attributes should be specified when using ${ProjectionType.INCLUDE} projection type`,
        // this,
      );
    }
    if (
      props.projectionType !== ProjectionType.INCLUDE &&
      props.nonKeyAttributes
    ) {
      // throw new ValidationError(
      throw new Error(
        `Non-key attributes should not be specified when not using ${ProjectionType.INCLUDE} projection type`,
        // this,
      );
    }
    if (props.nonKeyAttributes) {
      this.validateNonKeyAttributes(props.nonKeyAttributes);
    }
    return {
      projectionType: props.projectionType ?? ProjectionType.ALL,
      nonKeyAttributes: props.nonKeyAttributes,
    };
  }

  // TODO: keyType is unused
  private addKey(attribute: Attribute, _keyType: string) {
    const existingAttr = this.attributeDefinitionsInternal.find(
      (def) => def.name === attribute.name,
    );
    if (existingAttr && existingAttr.type !== attribute.type) {
      // throw new ValidationError(
      throw new Error(
        `Unable to specify ${attribute.name} as ${attribute.type} because it was already defined as ${existingAttr.type}`,
        // this,
      );
    }
    if (!existingAttr) {
      this.attributeDefinitionsInternal.push({
        name: attribute.name,
        type: attribute.type,
      });
    }
    // For the main table, hashKey and rangeKey are set directly on the resource.
    // For GSIs/LSIs, they are part of their respective blocks.
  }

  private registerAttribute(attribute: Attribute) {
    const existingDef = this.attributeDefinitionsInternal.find(
      (def) => def.name === attribute.name,
    );
    if (existingDef && existingDef.type !== attribute.type) {
      // throw new ValidationError(
      throw new Error(
        `Unable to specify ${attribute.name} as ${attribute.type} because it was already defined as ${existingDef.type}`,
        // this,
      );
    }
    if (!existingDef) {
      this.attributeDefinitionsInternal.push({
        name: attribute.name,
        type: attribute.type,
      });
    }
  }

  private makeScalingRole(): iam.IRole {
    // Use a Service Linked Role.
    // https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-service-linked-roles.html
    return iam.Role.fromRoleArn(
      this,
      "ScalingRole",
      this.stack.formatArn({
        service: "iam",
        region: "", // SLRs are global
        account: "aws", // SLRs are AWS-managed in terms of account for ARN construction
        resource:
          "role/aws-service-role/dynamodb.application-autoscaling.amazonaws.com",
        resourceName: "AWSServiceRoleForApplicationAutoScaling_DynamoDBTable",
        // TODO: Is this needed?
        // arnFormat: ArnFormat.SLASH_RESOURCE_SLASH_RESOURCE_NAME, // Special format for SLRs
      }),
    );
  }

  /**
   * Creates replica tables
   *
   * @param regions regions where to create tables
   */
  private renderReplicas(
    regions?: string[],
    replicaSpecification?: DynamodbTableReplica[],
  ): dynamodbTable.DynamodbTableReplica[] | undefined {
    if (replicaSpecification && replicaSpecification.length > 0) {
      if (
        !Token.isUnresolved(this.stack.region) &&
        replicaSpecification.some(
          (replica) => replica.regionName === this.stack.region,
        )
      ) {
        // throw new ValidationError(
        throw new Error(
          "`replicaSpecification` cannot include the region where this stack is deployed.",
          // this,
        );
      }
      return replicaSpecification.map((replica) => ({
        regionName: replica.regionName,
        kmsKeyArn: replica.encryptionKey?.keyArn,
        pointInTimeRecovery: replica.pointInTimeRecovery,
        propagateTags: replica.propagateTags,
      }));
    }
    if (!regions || regions.length === 0) return undefined;

    if (
      !Token.isUnresolved(this.stack.region) &&
      regions.includes(this.stack.region)
    ) {
      // throw new ValidationError(
      throw new Error(
        "`replicationRegions` cannot include the region where this stack is deployed.",
        // this,
      );
    }

    return [...new Set(regions)].map((region) => ({
      regionName: region,
    }));
  }

  protected get hasIndex(): boolean {
    return (
      this.globalSecondaryIndexesInternal.length +
        this.localSecondaryIndexesInternal.length >
      0
    );
  }

  private parseEncryption(props: TableProps): {
    sseSpecification?: dynamodbTable.DynamodbTableServerSideEncryption;
    encryptionKey?: kms.IKey;
  } {
    let encryptionType = props.encryption;
    if (encryptionType != null && props.serverSideEncryption != null) {
      // throw new ValidationError(
      throw new Error(
        "Only one of encryption and serverSideEncryption can be specified, but both were provided",
        // this,
      );
    }
    if (props.serverSideEncryption && props.encryptionKey) {
      // throw new ValidationError(
      throw new Error(
        "encryptionKey cannot be specified when serverSideEncryption is specified. Use encryption instead",
        // this,
      );
    }

    if (encryptionType === undefined) {
      encryptionType =
        props.encryptionKey != null
          ? TableEncryption.CUSTOMER_MANAGED
          : props.serverSideEncryption
            ? TableEncryption.AWS_MANAGED
            : undefined;
    }

    if (
      encryptionType !== TableEncryption.CUSTOMER_MANAGED &&
      props.encryptionKey
    ) {
      // throw new ValidationError(
      throw new Error(
        `encryptionKey cannot be specified unless encryption is set to TableEncryption.CUSTOMER_MANAGED (it was set to ${encryptionType})`,
        // this,
      );
    }

    // in this case, each replica should specify a Customer KMS key.
    if (
      encryptionType === TableEncryption.CUSTOMER_MANAGED &&
      props.replicationRegions
    ) {
      // throw new ValidationError(
      throw new Error(
        "TableEncryption.CUSTOMER_MANAGED is not supported by DynamoDB Global Tables (where replicationRegions was set)",
        // this,
      );
    }

    if (
      props.replicaSpecification &&
      props.replicaSpecification.length > 0 &&
      encryptionType === TableEncryption.CUSTOMER_MANAGED
    ) {
      if (
        props.replicaSpecification.some(
          (replica) => !replica.encryptionKey, // Check if any replica is missing an encryption key
        )
      ) {
        // throw new ValidationError(
        throw new Error(
          "When using replicaSpecification, each replica must specify an encryptionKey if TableEncryption.CUSTOMER_MANAGED is used",
          // this,
        );
      }

      //Validate that the keys belong to the correct regions
      if (
        props.replicaSpecification.some(
          (replica) =>
            replica.encryptionKey &&
            replica.encryptionKey.env.region !== replica.regionName,
        )
      ) {
        // throw new ValidationError(
        throw new Error(
          "When using replicaSpecification, each replica's encryptionKey must be in the same region as its replica",
          // this,
        );
      }
    }

    switch (encryptionType) {
      case TableEncryption.CUSTOMER_MANAGED:
        const key =
          props.encryptionKey ??
          new kms.Key(this, "Key", {
            description: `Customer-managed key auto-created for encrypting DynamoDB table at ${this.node.path}`,
            enableKeyRotation: true,
          });
        return {
          sseSpecification: { enabled: true, kmsKeyArn: key.keyArn },
          encryptionKey: key,
        };
      case TableEncryption.AWS_MANAGED:
        return { sseSpecification: { enabled: true } }; // Uses alias/aws/dynamodb by default
      case TableEncryption.DEFAULT:
        return { sseSpecification: { enabled: false } }; // AWS-owned key
      case undefined:
        return { sseSpecification: undefined }; // Defaults to AWS-owned key
      default:
        // throw new ValidationError(
        throw new Error(
          `Unexpected 'encryptionType': ${encryptionType}`,
          // this,
        );
    }
  }

  private renderImportSourceSpecification(
    importSource?: ImportSourceSpecification,
  ): dynamodbTable.DynamodbTableImportTable | undefined {
    if (!importSource) return undefined;
    const renderedInputFormat = importSource.inputFormat._render();
    return {
      inputFormat: renderedInputFormat.inputFormat,
      inputFormatOptions: renderedInputFormat.inputFormatOptions,
      inputCompressionType: importSource.compressionType,
      s3BucketSource: {
        bucket: importSource.bucket.bucketName,
        bucketOwner: importSource.bucketOwner,
        keyPrefix: importSource.keyPrefix,
      },
    };
  }
}

interface ScalableAttributePair {
  scalableReadAttribute?: ScalableTableAttribute;
  scalableWriteAttribute?: ScalableTableAttribute;
}
