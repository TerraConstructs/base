// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-dynamodb/lib/table.ts

import {
  dynamodbContributorInsights,
  dynamodbKinesisStreamingDestination,
  dynamodbResourcePolicy,
  dynamodbTable,
} from "@cdktf/provider-aws";
import { Token, Lazy } from "cdktf";
import { Construct } from "constructs";
import * as storage from ".";
import { ArnFormat, AwsConstructBase, AwsConstructProps, AwsStack } from "..";
import { DynamoDBMetrics } from "./dynamodb-canned-metrics.generated";
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
  WarmThroughput,
  ContributorInsightsSpecification,
  validateContributorInsights,
} from "./shared";
import { StreamGrants } from "./stream-grants";
import { TableGrants } from "./table-grants";
import { UnscopedValidationError, ValidationError } from "../../errors";
import * as cloudwatch from "../cloudwatch";
import * as appscaling from "../compute";
import * as kms from "../encryption";
import * as iam from "../iam";
import * as kinesis from "../notify";

const HASH_KEY_TYPE = "HASH";
const RANGE_KEY_TYPE = "RANGE";

// https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Limits.html#limits-secondary-indexes
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
    // We are using the .length property to check the length of the delimiter.
    // Note that .length may not return the expected result for multi-codepoint characters like full-width characters or emojis,
    // but such characters are not expected to be used as delimiters in this context.
    if (
      options?.delimiter &&
      (!this.validCsvDelimiters.includes(options.delimiter) ||
        options.delimiter.length !== 1)
    ) {
      throw new UnscopedValidationError(
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

  /**
   * Valid CSV delimiters.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-table-csv.html#cfn-dynamodb-table-csv-delimiter
   */
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
   * Render the input format and options.
   *
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

/**
 * Common interface for types that can configure contributor insights
 * @internal
 */
interface IContributorInsightsConfigurable {
  /**
   * Whether CloudWatch contributor insights is enabled.
   * @deprecated use `contributorInsightsSpecification` instead
   */
  readonly contributorInsightsEnabled?: boolean;

  /**
   * Whether CloudWatch contributor insights is enabled and what mode is selected
   */
  readonly contributorInsightsSpecification?: ContributorInsightsSpecification;
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

  /**
   * Specify values to pre-warm you DynamoDB Table
   * Warm Throughput feature is not available for Global Table replicas using the `Table` construct. To enable Warm Throughput, use the `TableV2` construct instead.
   * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-dynamodb-table.html#cfn-dynamodb-table-warmthroughput
   * @default - warm throughput is not configured
   */
  readonly warmThroughput?: WarmThroughput;

  /**
   * Whether point-in-time recovery is enabled.
   * @deprecated use `pointInTimeRecoverySpecification` instead
   * @default false - point in time recovery is not enabled.
   */
  readonly pointInTimeRecovery?: boolean;

  /**
   * Whether point-in-time recovery is enabled
   * and recoveryPeriodInDays is set.
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
   * @deprecated use `contributorInsightsSpecification instead
   * @default false
   */
  readonly contributorInsightsEnabled?: boolean;

  /**
   * Whether CloudWatch contributor insights is enabled and what mode is selected
   * @default - contributor insights is not enabled
   */
  readonly contributorInsightsSpecification?: ContributorInsightsSpecification;

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

  /**
   * The warm throughput configuration for the global secondary index.
   *
   * @default - no warm throughput is configured
   */
  readonly warmThroughput?: WarmThroughput;

  /**
   * Whether CloudWatch contributor insights is enabled and what mode is selected
   * @default - contributor insights is not enabled
   */
  readonly contributorInsightsSpecification?: ContributorInsightsSpecification;
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

  /**
   * KMS encryption key, if this table uses a customer-managed encryption key.
   */
  public abstract readonly encryptionKey?: kms.IKey;

  /**
   * Resource policy to assign to table.
   */
  public abstract resourcePolicy?: iam.PolicyDocument;

  /**
   * Additional regions other than the main one that this table is replicated to
   *
   */
  public abstract readonly regions?: string[];

  /**
   * @deprecated This member is still filled but it is not read
   */
  protected readonly regionalArns = new Array<string>();

  public grantOnKey(
    grantee: iam.IGrantable,
    ...actions: string[]
  ): iam.GrantOnKeyResult {
    return {
      grant: this.encryptionKey?.grant(grantee, ...actions),
    };
  }

  public get outputs(): Record<string, any> {
    return {
      tableArn: this.tableArn,
      tableName: this.tableName,
      tableStreamArn: this.tableStreamArn,
    };
  }

  /**
   * Grant a predefined set of permissions on this Table.
   */
  public get grants(): TableGrants {
    return new TableGrants({
      table: this,
      encryptedResource: this,
      policyResource: this,
      regions: this.regions,
      hasIndex: this.hasIndex,
    });
  }

  /**
   * Grant a predefined set of permissions on this Table's Stream, if present.
   *
   * Will throw if the Table has not been configured for streaming.
   */
  public get streamGrants(): StreamGrants {
    if (!this.tableStreamArn) {
      throw new ValidationError(
        `DynamoDB Streams must be enabled on the table ${this.node.path}`,
        this,
      );
    }
    return new StreamGrants({
      table: this,
      tableStreamArn: this.tableStreamArn,
      encryptionKey: this.encryptionKey,
    });
  }

  /**
   * Adds a statement to the resource policy associated with this table.
   */
  public abstract addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * Adds an IAM policy statement associated with this table to an IAM
   * principal's policy.
   *
   * If `encryptionKey` is present, appropriate grants to the key needs to be added
   * separately using the `table.encryptionKey.grant*` methods.
   *
   * @param grantee The principal (no-op if undefined)
   * @param actions The set of actions to allow (i.e. "dynamodb:PutItem", "dynamodb:GetItem", ...)
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    return this.grants.actions(grantee, ...actions);
  }
  /**
   * Adds an IAM policy statement associated with this table's stream to an
   * IAM principal's policy.
   *
   * If `encryptionKey` is present, appropriate grants to the key needs to be added
   * separately using the `table.encryptionKey.grant*` methods.
   *
   * @param grantee The principal (no-op if undefined)
   * @param actions The set of actions to allow (i.e. "dynamodb:DescribeStream", "dynamodb:GetRecords", ...)
   */
  public grantStream(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    return this.streamGrants.actions(grantee, ...actions);
  }

  /**
   * Permits an IAM principal all data read operations from this table:
   * BatchGetItem, GetRecords, GetShardIterator, Query, GetItem, Scan, DescribeTable.
   *
   * Appropriate grants will also be added to the customer-managed KMS key
   * if one was configured.
   *
   * @param grantee The principal to grant access to
   */
  public grantReadData(grantee: iam.IGrantable): iam.Grant {
    return this.grants.readData(grantee);
  }

  /**
   * Permits an IAM Principal to list streams attached to current dynamodb table.
   *
   * @param grantee The principal (no-op if undefined)
   */
  public grantTableListStreams(grantee: iam.IGrantable): iam.Grant {
    return this.streamGrants.list(grantee);
  }

  /**
   * Permits an IAM principal all stream data read operations for this
   * table's stream:
   * DescribeStream, GetRecords, GetShardIterator, ListStreams.
   *
   * Appropriate grants will also be added to the customer-managed KMS key
   * if one was configured.
   *
   * @param grantee The principal to grant access to
   */
  public grantStreamRead(grantee: iam.IGrantable): iam.Grant {
    return this.streamGrants.read(grantee);
  }

  /**
   * Permits an IAM principal all data write operations to this table:
   * BatchWriteItem, PutItem, UpdateItem, DeleteItem, DescribeTable.
   *
   * Appropriate grants will also be added to the customer-managed KMS key
   * if one was configured.
   *
   * @param grantee The principal to grant access to
   */
  public grantWriteData(grantee: iam.IGrantable): iam.Grant {
    return this.grants.writeData(grantee);
  }

  /**
   * Permits an IAM principal to all data read/write operations to this table.
   * BatchGetItem, GetRecords, GetShardIterator, Query, GetItem, Scan,
   * BatchWriteItem, PutItem, UpdateItem, DeleteItem, DescribeTable
   *
   * Appropriate grants will also be added to the customer-managed KMS key
   * if one was configured.
   *
   * @param grantee The principal to grant access to
   */
  public grantReadWriteData(grantee: iam.IGrantable): iam.Grant {
    return this.grants.readWriteData(grantee);
  }

  /**
   * Permits all DynamoDB operations ("dynamodb:*") to an IAM principal.
   *
   * Appropriate grants will also be added to the customer-managed KMS key
   * if one was configured.
   *
   * @param grantee The principal to grant access to
   */
  public grantFullAccess(grantee: iam.IGrantable) {
    return this.grants.fullAccess(grantee);
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

  /**
   * Metric for the consumed read capacity units this table
   *
   * By default, the metric will be calculated as a sum over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
  public metricConsumedReadCapacityUnits(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(
      DynamoDBMetrics.consumedReadCapacityUnitsSum,
      props,
    );
  }

  /**
   * Metric for the consumed write capacity units this table
   *
   * By default, the metric will be calculated as a sum over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
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
      throw new ValidationError(
        "'Operation' dimension must be passed for the 'SystemErrors' metric.",
        this,
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

  /**
   * Metric for the user errors. Note that this metric reports user errors across all
   * the tables in the account and region the table resides in.
   *
   * By default, the metric will be calculated as a sum over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
  public metricUserErrors(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    if (props?.dimensionsMap) {
      throw new ValidationError(
        "'dimensionsMap' is not supported for the 'UserErrors' metric",
        this,
      );
    }

    // overriding 'dimensions' here because this metric is an account metric.
    // see 'UserErrors' in https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html
    return this.metric("UserErrors", {
      statistic: "sum",
      ...props,
      dimensionsMap: {},
    });
  }

  /**
   * Metric for the conditional check failed requests this table
   *
   * By default, the metric will be calculated as a sum over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
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

  /**
   * Metric for the successful request latency this table.
   *
   * By default, the metric will be calculated as an average over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
  public metricSuccessfulRequestLatency(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    if (!props?.dimensionsMap?.Operation) {
      throw new ValidationError(
        "'Operation' dimension must be passed for the 'SuccessfulRequestLatency' metric.",
        this,
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

  /**
   * How many requests are throttled on this table, for the given operation
   *
   * Default: sum over 5 minutes
   */
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

  /**
   * How many requests are throttled on this table.
   *
   * This will sum errors across all possible operations.
   * Note that by default, each individual metric will be calculated as a sum over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
  public metricThrottledRequestsForOperations(
    props?: OperationsMetricOptions,
  ): cloudwatch.IMetric {
    return this.sumMetricsForOperations(
      "ThrottledRequests",
      "Sum of throttled requests across all operations",
      props,
    );
  }

  /**
   * Metric for the system errors this table.
   *
   * This will sum errors across all possible operations.
   * Note that by default, each individual metric will be calculated as a sum over a period of 5 minutes.
   * You can customize this by using the `statistic` and `period` properties.
   */
  public metricSystemErrorsForOperations(
    props?: SystemErrorsForOperationsMetricOptions,
  ): cloudwatch.IMetric {
    return this.sumMetricsForOperations(
      "SystemErrors",
      "Sum of errors across all operations",
      props,
    );
  }

  /**
   * Create a math expression for operations.
   *
   * @param metricName The metric name.
   * @param expressionLabel Label for expression
   * @param props operation list
   */
  private sumMetricsForOperations(
    metricName: string,
    expressionLabel: string,
    props?: OperationsMetricOptions,
  ): cloudwatch.IMetric {
    if (props?.dimensionsMap?.Operation) {
      throw new ValidationError(
        "The Operation dimension is not supported. Use the 'operations' property.",
        this,
      );
    }

    const operations = props?.operations ?? Object.values(Operation);

    const values = this.createMetricsForOperations(metricName, operations, {
      statistic: "sum",
      ...props,
    });

    const sum = new cloudwatch.MathExpression({
      expression: `${Object.keys(values).join(" + ")}`,
      usingMetrics: { ...values },
      color: props?.color,
      label: expressionLabel,
      period: props?.period,
    });

    return sum;
  }

  /**
   * Create a map of metrics that can be used in a math expression.
   *
   * Using the return value of this function as the `usingMetrics` property in `cloudwatch.MathExpression` allows you to
   * use the keys of this map as metric names inside you expression.
   *
   * @param metricName The metric name.
   * @param operations The list of operations to create metrics for.
   * @param props Properties for the individual metrics.
   * @param metricNameMapper Mapper function to allow controlling the individual metric name per operation.
   */
  private createMetricsForOperations(
    metricName: string,
    operations: Operation[],
    props?: cloudwatch.MetricOptions,
    metricNameMapper?: (op: Operation) => string,
  ): Record<string, cloudwatch.IMetric> {
    const metrics: Record<string, cloudwatch.IMetric> = {};

    const mapper = metricNameMapper ?? ((op) => op.toLowerCase());

    if (props?.dimensionsMap?.Operation) {
      throw new ValidationError(
        "Invalid properties. Operation dimension is not supported when calculating operational metrics",
        this,
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
        throw new ValidationError(
          `Mapper generated an illegal operation metric name: ${operationMetricName}. Must start with a lowercase letter`,
          this,
        );
      }

      metrics[operationMetricName] = metric;
    }

    return metrics;
  }

  protected abstract get hasIndex(): boolean;

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
      public readonly regions = [];

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

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        // Imported tables cannot have resource policies modified
        return { statementAdded: false };
      }
    }

    let name: string;
    let arn: string;
    const stack = AwsStack.ofAwsConstruct(scope);
    if (!attrs.tableName) {
      if (!attrs.tableArn) {
        throw new ValidationError(
          "One of tableName or tableArn is required!",
          scope,
        );
      }

      arn = attrs.tableArn;
      const maybeTableName = stack.splitArn(
        attrs.tableArn,
        ArnFormat.SLASH_RESOURCE_NAME,
      ).resourceName;
      if (!maybeTableName) {
        throw new ValidationError(
          "ARN for DynamoDB table must be in the form: arn:<partition>:dynamodb:<region>:<account>:table/<table-name>",
          scope,
        );
      }
      name = maybeTableName;
    } else {
      if (attrs.tableArn) {
        throw new ValidationError(
          "Only one of tableArn or tableName can be provided",
          scope,
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
  private readonly globalSecondaryIndexesInternal = new Array<
    dynamodbTable.DynamodbTableGlobalSecondaryIndex & {
      contributorInsightsSpecification?: ContributorInsightsSpecification;
    }
  >();
  private readonly localSecondaryIndexesInternal =
    new Array<dynamodbTable.DynamodbTableLocalSecondaryIndex>();

  private readonly secondaryIndexSchemas = new Map<string, SchemaOptions>();
  private readonly nonKeyAttributes = new Set<string>();

  private readonly tablePartitionKey: Attribute;
  private readonly tableSortKey?: Attribute;

  private readonly billingMode: BillingMode;
  private readonly tableScaling: ScalableAttributePair = {};
  private readonly indexScaling = new Map<string, ScalableAttributePair>();
  // Commenting out scalingRole as Terraform auto-creates service-linked roles
  // Unlike AWS CDK CloudFormation, Terraform AWS provider's roleArn is optional
  // and defaults to appropriate service-linked roles when omitted
  // private readonly scalingRole: iam.IRole;

  private readonly _resource: dynamodbTable.DynamodbTable;
  private readonly _replicas: dynamodbTable.DynamodbTableReplica[] | undefined;

  public readonly regions? = new Array<string>();

  constructor(scope: Construct, id: string, props: TableProps) {
    super(scope, id, props);

    const physicalTableName =
      props.tableName ?? this.stack.uniqueResourceName(this);

    const { sseSpecification, encryptionKey } = this.parseEncryption(props);
    this.encryptionKey = encryptionKey;

    const pointInTimeRecovery = this.renderPointInTimeRecovery(props);

    // error if both replicationRegions and replicaSpecification are specified
    if (props.replicationRegions && props.replicaSpecification) {
      throw new ValidationError(
        "You cannot specify both `replicationRegions` and `replicaSpecification`",
        this,
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
        throw new ValidationError(
          "`stream` must be set to `NEW_AND_OLD_IMAGES` when specifying `replicationRegions`",
          this,
        );
      }
      streamSpecification = {
        streamEnabled: true,
        streamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
      };

      this.billingMode = props.billingMode ?? BillingMode.PAY_PER_REQUEST;
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
      this._replicas.forEach((r) => {
        // Save regional arns for grantXxx() methods
        this.regions?.push(r.regionName);
        this.regionalArns.push(
          this.stack.formatArn({
            region: r.regionName,
            service: "dynamodb",
            resource: "table",
            resourceName: physicalTableName,
          }),
        );
      });
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
      warmThroughput: props.warmThroughput,
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

    const contributorInsightsSpecification =
      this.renderContributorInsights(props);
    if (contributorInsightsSpecification?.enabled) {
      new dynamodbContributorInsights.DynamodbContributorInsights(
        this,
        "ContributorInsights",
        {
          tableName: this.tableName,
          mode: contributorInsightsSpecification.mode,
        },
      );
    }

    // Commenting out scalingRole initialization - let Terraform auto-create service-linked role
    // this.scalingRole = this.makeScalingRole();

    this.node.addValidation({ validate: () => this.validateTable() });
  }

  /**
   * Adds a statement to the resource policy associated with this table.
   * A resource policy will be automatically created upon the first call to `addToResourcePolicy`.
   *
   * Note that this does not work with imported tables.
   *
   * @param statement The policy statement to add
   */
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
      contributorInsightsSpecification: props.contributorInsightsSpecification, // Not in TF GSI block
      warmThroughput: props.warmThroughput,
    });

    this.secondaryIndexSchemas.set(props.indexName, {
      partitionKey: props.partitionKey,
      sortKey: props.sortKey,
    });
    this.indexScaling.set(props.indexName, {});
  }

  /**
   * Add a local secondary index of table.
   *
   * @param props the property of local secondary index
   */
  public addLocalSecondaryIndex(props: LocalSecondaryIndexProps) {
    // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Limits.html#limits-secondary-indexes
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
      throw new ValidationError(
        "Table partition key must be defined before adding local secondary index",
        this,
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

  /**
   * Enable read capacity scaling for this table
   *
   * @returns An object to configure additional AutoScaling settings
   */
  public autoScaleReadCapacity(
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.tableScaling.scalableReadAttribute) {
      throw new ValidationError(
        "Read AutoScaling already enabled for this table",
        this,
      );
    }
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      throw new ValidationError(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        this,
      );
    }

    return (this.tableScaling.scalableReadAttribute =
      new ScalableTableAttribute(this, "ReadScaling", {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}`,
        dimension: "dynamodb:table:ReadCapacityUnits",
        // role: this.scalingRole, // Commenting out - let Terraform use service-linked role
        ...props,
      }));
  }

  /**
   * Enable write capacity scaling for this table
   *
   * @returns An object to configure additional AutoScaling settings for this attribute
   */
  public autoScaleWriteCapacity(
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.tableScaling.scalableWriteAttribute) {
      throw new ValidationError(
        "Write AutoScaling already enabled for this table",
        this,
      );
    }
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      throw new ValidationError(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        this,
      );
    }

    this.tableScaling.scalableWriteAttribute = new ScalableTableAttribute(
      this,
      "WriteScaling",
      {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}`,
        dimension: "dynamodb:table:WriteCapacityUnits",
        // role: this.scalingRole, // Commenting out - let Terraform use service-linked role
        ...props,
      },
    );
    // If there are replicas, they depend on the write scaling policy of the main table.
    // This is not explicitly modeled in TF but was handled by CustomResource dependencies in CDK.
    // For TF, this dependency is implicit if the provider handles it, or might need explicit dependsOn if issues arise.
    return this.tableScaling.scalableWriteAttribute;
  }

  /**
   * Enable read capacity scaling for the given GSI
   *
   * @returns An object to configure additional AutoScaling settings for this attribute
   */
  public autoScaleGlobalSecondaryIndexReadCapacity(
    indexName: string,
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      throw new ValidationError(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        this,
      );
    }
    const attributePair = this.indexScaling.get(indexName);
    if (!attributePair) {
      throw new ValidationError(
        `No global secondary index with name ${indexName}`,
        this,
      );
    }
    if (attributePair.scalableReadAttribute) {
      throw new ValidationError(
        "Read AutoScaling already enabled for this index",
        this,
      );
    }

    return (attributePair.scalableReadAttribute = new ScalableTableAttribute(
      this,
      `${indexName}ReadScaling`,
      {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}/index/${indexName}`,
        dimension: "dynamodb:index:ReadCapacityUnits",
        // role: this.scalingRole, // Commenting out - let Terraform use service-linked role
        ...props,
      },
    ));
  }

  /**
   * Enable write capacity scaling for the given GSI
   *
   * @returns An object to configure additional AutoScaling settings for this attribute
   */
  public autoScaleGlobalSecondaryIndexWriteCapacity(
    indexName: string,
    props: EnableScalingProps,
  ): IScalableTableAttribute {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      throw new ValidationError(
        "AutoScaling is not available for tables with PAY_PER_REQUEST billing mode",
        this,
      );
    }
    const attributePair = this.indexScaling.get(indexName);
    if (!attributePair) {
      throw new ValidationError(
        `No global secondary index with name ${indexName}`,
        this,
      );
    }
    if (attributePair.scalableWriteAttribute) {
      throw new ValidationError(
        "Write AutoScaling already enabled for this index",
        this,
      );
    }

    return (attributePair.scalableWriteAttribute = new ScalableTableAttribute(
      this,
      `${indexName}WriteScaling`,
      {
        serviceNamespace: appscaling.ServiceNamespace.DYNAMODB,
        resourceId: `table/${this.tableName}/index/${indexName}`,
        dimension: "dynamodb:index:WriteCapacityUnits",
        // role: this.scalingRole, // Commenting out - let Terraform use service-linked role
        ...props,
      },
    ));
  }

  /**
   * Get schema attributes of table or index.
   *
   * @returns Schema of table or index.
   */
  public schema(indexName?: string): SchemaOptions {
    if (!indexName) {
      return {
        partitionKey: this.tablePartitionKey,
        sortKey: this.tableSortKey,
      };
    }
    const schema = this.secondaryIndexSchemas.get(indexName);
    if (!schema) {
      throw new ValidationError(
        `Cannot find schema for index: ${indexName}. Use 'addGlobalSecondaryIndex' or 'addLocalSecondaryIndex' to add index`,
        this,
      );
    }

    return schema;
  }

  /**
   * Validate the table construct.
   *
   * @returns an array of validation error message
   */
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

  /**
   * Validate read and write capacity are not specified for on-demand tables (billing mode PAY_PER_REQUEST).
   *
   * @param props read and write capacity properties
   */
  private validateProvisioning(props: {
    readCapacity?: number;
    writeCapacity?: number;
  }) {
    if (this.billingMode === BillingMode.PAY_PER_REQUEST) {
      if (
        props.readCapacity !== undefined ||
        props.writeCapacity !== undefined
      ) {
        throw new ValidationError(
          "You cannot provision read and write capacity for a table with PAY_PER_REQUEST billing mode",
          this,
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
        throw new ValidationError(
          "You cannot provision read and write capacity for a GSI with PAY_PER_REQUEST billing mode on the table",
          this,
        );
      }
    }
  }

  /**
   * Validate index name to check if a duplicate name already exists.
   *
   * @param indexName a name of global or local secondary index
   */
  private validateIndexName(indexName: string) {
    if (this.secondaryIndexSchemas.has(indexName)) {
      throw new ValidationError(
        `A duplicate index name, ${indexName}, is not allowed`,
        this,
      );
    }
  }

  /**
   * Validate non-key attributes by checking limits within secondary index, which may vary in future.
   *
   * @param nonKeyAttributes a list of non-key attribute names
   */
  private validateNonKeyAttributes(nonKeyAttributes: string[]) {
    if (this.nonKeyAttributes.size + nonKeyAttributes.length > 100) {
      // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Limits.html#limits-secondary-indexes
      throw new RangeError(
        "A maximum number of nonKeyAttributes across all of secondary indexes is 100",
      );
    }

    // store all non-key attributes
    nonKeyAttributes.forEach((att) => this.nonKeyAttributes.add(att));
  }

  private renderPointInTimeRecovery(
    props: TableProps,
  ): dynamodbTable.DynamodbTablePointInTimeRecovery | undefined {
    if (
      props.pointInTimeRecoverySpecification !== undefined &&
      props.pointInTimeRecovery !== undefined
    ) {
      throw new ValidationError(
        "`pointInTimeRecoverySpecification` and `pointInTimeRecovery` are set. Use `pointInTimeRecoverySpecification` only.",
        this,
      );
    }

    const spec = props.pointInTimeRecoverySpecification;
    const recoveryPeriodInDays = spec?.recoveryPeriodInDays;
    if (!spec?.pointInTimeRecoveryEnabled && recoveryPeriodInDays) {
      throw new ValidationError(
        "Cannot set `recoveryPeriodInDays` while `pointInTimeRecoveryEnabled` is set to false.",
        this,
      );
    }

    if (
      recoveryPeriodInDays !== undefined &&
      (recoveryPeriodInDays < 1 || recoveryPeriodInDays > 35)
    ) {
      throw new ValidationError(
        "`recoveryPeriodInDays` must be a value between `1` and `35`.",
        this,
      );
    }

    const enabled =
      spec?.pointInTimeRecoveryEnabled ?? props.pointInTimeRecovery;
    if (enabled === undefined) return undefined;
    return { enabled, recoveryPeriodInDays };
  }

  private renderContributorInsights(
    props: IContributorInsightsConfigurable,
  ): ContributorInsightsSpecification | undefined {
    return validateContributorInsights(
      props.contributorInsightsEnabled,
      props.contributorInsightsSpecification,
      "contributorInsightsEnabled",
      this,
    );
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
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-dynamodb-projectionobject.html
      throw new ValidationError(
        `Non-key attributes should be specified when using ${ProjectionType.INCLUDE} projection type`,
        this,
      );
    }

    if (
      props.projectionType !== ProjectionType.INCLUDE &&
      props.nonKeyAttributes
    ) {
      throw new ValidationError(
        `Non-key attributes should not be specified when not using ${ProjectionType.INCLUDE} projection type`,
        this,
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
      throw new ValidationError(
        `Unable to specify ${attribute.name} as ${attribute.type} because it was already defined as ${existingAttr.type}`,
        this,
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

  /**
   * Register the key attribute of table or secondary index to assemble attribute definitions of TableResourceProps.
   *
   * @param attribute the key attribute of table or secondary index
   */
  private registerAttribute(attribute: Attribute) {
    const existingDef = this.attributeDefinitionsInternal.find(
      (def) => def.name === attribute.name,
    );
    if (existingDef && existingDef.type !== attribute.type) {
      throw new ValidationError(
        `Unable to specify ${attribute.name} as ${attribute.type} because it was already defined as ${existingDef.type}`,
        this,
      );
    }
    if (!existingDef) {
      this.attributeDefinitionsInternal.push({
        name: attribute.name,
        type: attribute.type,
      });
    }
  }

  // Commenting out makeScalingRole method - Terraform handles service-linked roles automatically
  // Unlike AWS CDK CloudFormation implementation, Terraform AWS provider creates appropriate
  // service-linked roles when roleArn is omitted from aws_appautoscaling_target resource
  // private makeScalingRole(): iam.IRole {
  //   // Use a Service Linked Role.
  //   // https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-service-linked-roles.html
  //   return iam.Role.fromRoleArn(
  //     this,
  //     "ScalingRole",
  //     this.stack.formatArn({
  //       service: "iam",
  //       region: "", // SLRs are global
  //       resource:
  //         "role/aws-service-role/dynamodb.application-autoscaling.amazonaws.com",
  //       resourceName: "AWSServiceRoleForApplicationAutoScaling_DynamoDBTable",
  //       // TODO: Is this needed?
  //       // arnFormat: ArnFormat.SLASH_RESOURCE_SLASH_RESOURCE_NAME, // Special format for SLRs
  //     }),
  //   );
  // }

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
        throw new ValidationError(
          "`replicaSpecification` cannot include the region where this stack is deployed.",
          this,
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
      throw new ValidationError(
        "`replicationRegions` cannot include the region where this stack is deployed.",
        this,
      );
    }

    return [...new Set(regions)].map((region) => ({
      regionName: region,
    }));
  }

  /**
   * Whether this table has indexes
   */
  protected get hasIndex(): boolean {
    return (
      this.globalSecondaryIndexesInternal.length +
        this.localSecondaryIndexesInternal.length >
      0
    );
  }

  /**
   * Set up key properties and return the Table encryption property from the
   * user's configuration.
   */
  private parseEncryption(props: TableProps): {
    sseSpecification?: dynamodbTable.DynamodbTableServerSideEncryption;
    encryptionKey?: kms.IKey;
  } {
    let encryptionType = props.encryption;

    if (encryptionType != null && props.serverSideEncryption != null) {
      throw new ValidationError(
        "Only one of encryption and serverSideEncryption can be specified, but both were provided",
        this,
      );
    }

    if (props.serverSideEncryption && props.encryptionKey) {
      throw new ValidationError(
        "encryptionKey cannot be specified when serverSideEncryption is specified. Use encryption instead",
        this,
      );
    }

    if (encryptionType === undefined) {
      encryptionType =
        props.encryptionKey != null
          ? // If there is a configured encryptionKey, the encryption is implicitly CUSTOMER_MANAGED
            TableEncryption.CUSTOMER_MANAGED
          : // Otherwise, if severSideEncryption is enabled, it's AWS_MANAGED; else undefined (do not set anything)
            props.serverSideEncryption
            ? TableEncryption.AWS_MANAGED
            : undefined;
    }

    if (
      encryptionType !== TableEncryption.CUSTOMER_MANAGED &&
      props.encryptionKey
    ) {
      throw new ValidationError(
        `encryptionKey cannot be specified unless encryption is set to TableEncryption.CUSTOMER_MANAGED (it was set to ${encryptionType})`,
        this,
      );
    }

    // in this case, each replica should specify a Customer KMS key.
    if (
      encryptionType === TableEncryption.CUSTOMER_MANAGED &&
      props.replicationRegions
    ) {
      throw new ValidationError(
        "TableEncryption.CUSTOMER_MANAGED is not supported by DynamoDB Global Tables (where replicationRegions was set)",
        this,
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
        throw new ValidationError(
          "When using replicaSpecification, each replica must specify an encryptionKey if TableEncryption.CUSTOMER_MANAGED is used",
          this,
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
        throw new ValidationError(
          "When using replicaSpecification, each replica's encryptionKey must be in the same region as its replica",
          this,
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
        throw new ValidationError(
          `Unexpected 'encryptionType': ${encryptionType}`,
          this,
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

  /**
   * Adds resource to the Terraform JSON output at Synth time.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    /**
     * A preparing resolve might add new resources to the stack
     */
    for (const gsi of this.globalSecondaryIndexesInternal) {
      if (gsi.contributorInsightsSpecification?.enabled) {
        new dynamodbContributorInsights.DynamodbContributorInsights(
          this,
          "ContributorInsights",
          {
            tableName: this.tableName,
            indexName: gsi.name,
            mode: gsi.contributorInsightsSpecification?.mode,
          },
        );
        delete gsi.contributorInsightsSpecification;
      }
    }
    return {};
  }
}

/**
 * Just a convenient way to keep track of both attributes
 */
interface ScalableAttributePair {
  scalableReadAttribute?: ScalableTableAttribute;
  scalableWriteAttribute?: ScalableTableAttribute;
}
