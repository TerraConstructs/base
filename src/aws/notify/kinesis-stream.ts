import { kinesisStream } from "@cdktf/provider-aws";
import { Fn, Token, TerraformLocal } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat } from "../arn";
import { IAwsBeacon, AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { AwsSpec } from "../spec";
import { KinesisMetrics } from "./kinesis-fixed-canned-metrics";
import { ResourcePolicy } from "./resource-policy";
import { Duration } from "../../duration";
import * as cloudwatch from "../cloudwatch";
import * as kms from "../encryption";
import * as iam from "../iam";

const READ_OPERATIONS = [
  "kinesis:DescribeStreamSummary",
  "kinesis:GetRecords",
  "kinesis:GetShardIterator",
  "kinesis:ListShards",
  "kinesis:SubscribeToShard",
  "kinesis:DescribeStream",
  "kinesis:ListStreams",
  "kinesis:DescribeStreamConsumer",
];

const WRITE_OPERATIONS = [
  "kinesis:ListShards",
  "kinesis:PutRecord",
  "kinesis:PutRecords",
];

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface StreamOutputs {
  /**
   * The ARN of the stream.
   *
   * @attribute
   */
  readonly streamArn: string;

  /**
   * The name of the stream
   *
   * @attribute
   */
  readonly streamName: string;
}

/**
 * A Kinesis Stream
 */
export interface IStream extends IAwsBeacon {
  /** Strongly typed outputs */
  readonly streamOutputs: StreamOutputs;
  /**
   * The ARN of the stream.
   *
   * @attribute
   */
  readonly streamArn: string;

  /**
   * The name of the stream
   *
   * @attribute
   */
  readonly streamName: string;

  /**
   * Optional KMS encryption key associated with this stream.
   */
  readonly encryptionKey?: kms.IKey;

  /**
   * Adds a statement to the IAM resource policy associated with this stream.
   *
   * If this stream was created in this stack (`new Stream`), a resource policy
   * will be automatically created upon the first call to `addToResourcePolicy`. If
   * the stream is imported (`Stream.import`), then this is a no-op.
   */
  addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * Grant read permissions for this stream and its contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to ues the key to decrypt the
   * contents of the stream will also be granted.
   */
  grantRead(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant write permissions for this stream and its contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to ues the key to encrypt the
   * contents of the stream will also be granted.
   */
  grantWrite(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grants read/write permissions for this stream and its contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to use the key for
   * encrypt/decrypt will also be granted.
   */
  grantReadWrite(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant the indicated permissions on this stream to the provided IAM principal.
   */
  grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant;

  /**
   * Return stream metric based from its metric name
   *
   * @param metricName name of the stream metric
   * @param props properties of the metric
   */
  metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The number of bytes retrieved from the Kinesis stream, measured over the specified time period. Minimum, Maximum,
   * and Average statistics represent the bytes in a single GetRecords operation for the stream in the specified time
   * period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricGetRecordsBytes(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The age of the last record in all GetRecords calls made against a Kinesis stream, measured over the specified time
   * period. Age is the difference between the current time and when the last record of the GetRecords call was written
   * to the stream. The Minimum and Maximum statistics can be used to track the progress of Kinesis consumer
   * applications. A value of zero indicates that the records being read are completely caught up with the stream.
   *
   * The metric defaults to maximum over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricGetRecordsIteratorAgeMilliseconds(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The time taken per GetRecords operation, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricGetRecordsLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of records retrieved from the shard, measured over the specified time period. Minimum, Maximum, and
   * Average statistics represent the records in a single GetRecords operation for the stream in the specified time
   * period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricGetRecords(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of successful GetRecords operations per stream, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricGetRecordsSuccess(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of bytes successfully put to the Kinesis stream over the specified time period. This metric includes
   * bytes from PutRecord and PutRecords operations. Minimum, Maximum, and Average statistics represent the bytes in a
   * single put operation for the stream in the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricIncomingBytes(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of records successfully put to the Kinesis stream over the specified time period. This metric includes
   * record counts from PutRecord and PutRecords operations. Minimum, Maximum, and Average statistics represent the
   * records in a single put operation for the stream in the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricIncomingRecords(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of bytes put to the Kinesis stream using the PutRecord operation over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordBytes(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The time taken per PutRecord operation, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of successful PutRecord operations per Kinesis stream, measured over the specified time period. Average
   * reflects the percentage of successful writes to a stream.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordSuccess(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of bytes put to the Kinesis stream using the PutRecords operation over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsBytes(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The time taken per PutRecords operation, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsLatency(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   *  The number of PutRecords operations where at least one record succeeded, per Kinesis stream, measured over the
   *  specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsSuccess(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The total number of records sent in a PutRecords operation per Kinesis data stream, measured over the specified
   * time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsTotalRecords(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The number of successful records in a PutRecords operation per Kinesis data stream, measured over the specified
   * time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsSuccessfulRecords(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The number of records rejected due to internal failures in a PutRecords operation per Kinesis data stream,
   * measured over the specified time period. Occasional internal failures are to be expected and should be retried.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsFailedRecords(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The number of records rejected due to throttling in a PutRecords operation per Kinesis data stream, measured over
   * the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordsThrottledRecords(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The number of GetRecords calls throttled for the stream over the specified time period. The most commonly used
   * statistic for this metric is Average.
   *
   * When the Minimum statistic has a value of 1, all records were throttled for the stream during the specified time
   * period.
   *
   * When the Maximum statistic has a value of 0 (zero), no records were throttled for the stream during the specified
   * time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties
   *
   * @param props properties of the metric
   *
   */
  metricReadProvisionedThroughputExceeded(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;

  /**
   * The number of records rejected due to throttling for the stream over the specified time period. This metric
   * includes throttling from PutRecord and PutRecords operations.
   *
   * When the Minimum statistic has a non-zero value, records were being throttled for the stream during the specified
   * time period.
   *
   * When the Maximum statistic has a value of 0 (zero), no records were being throttled for the stream during the
   * specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricWriteProvisionedThroughputExceeded(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric;
}

/**
 * A reference to a stream. The easiest way to instantiate is to call
 * `stream.export()`. Then, the consumer can use `Stream.import(this, ref)` and
 * get a `Stream`.
 */
export interface StreamAttributes {
  /**
   * The ARN of the stream.
   */
  readonly streamArn: string;

  /**
   * The KMS key securing the contents of the stream if encryption is enabled.
   *
   * @default - No encryption
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Represents a Kinesis Stream.
 */
abstract class StreamBase extends AwsBeaconBase implements IStream {
  /**
   * The ARN of the stream.
   */
  public abstract readonly streamArn: string;

  /**
   * The name of the stream
   */
  public abstract readonly streamName: string;

  public get streamOutputs(): StreamOutputs {
    return {
      streamArn: this.streamArn,
      streamName: this.streamName,
    };
  }
  public get outputs(): Record<string, any> {
    return this.streamOutputs;
  }

  /**
   * Optional KMS encryption key associated with this stream.
   */
  public abstract readonly encryptionKey?: kms.IKey;

  /**
   * Indicates if a stream resource policy should automatically be created upon
   * the first call to `addToResourcePolicy`.
   *
   * Set by subclasses.
   */
  protected abstract readonly autoCreatePolicy: boolean;

  private resourcePolicy?: ResourcePolicy;

  constructor(scope: Construct, id: string, props: AwsBeaconProps = {}) {
    super(scope, id, props);

    this.node.addValidation({
      validate: () =>
        this.resourcePolicy?.document.validateForResourcePolicy() ?? [],
    });
  }

  /**
   * Adds a statement to the IAM resource policy associated with this stream.
   *
   * If this stream was created in this stack (`new Strem`), a resource policy
   * will be automatically created upon the first call to `addToResourcePolicy`. If
   * the stream is imported (`Stream.import`), then this is a no-op.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.resourcePolicy && this.autoCreatePolicy) {
      this.resourcePolicy = new ResourcePolicy(this, "Policy", {
        stream: this,
      });
    }

    if (this.resourcePolicy) {
      this.resourcePolicy.document.addStatements(statement);
      return { statementAdded: true, policyDependable: this.resourcePolicy };
    }
    return { statementAdded: false };
  }

  /**
   * Grant read permissions for this stream and its contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to ues the key to decrypt the
   * contents of the stream will also be granted.
   */
  public grantRead(grantee: iam.IGrantable) {
    const ret = this.grant(grantee, ...READ_OPERATIONS);

    if (this.encryptionKey) {
      this.encryptionKey.grantDecrypt(grantee);
    }

    return ret;
  }

  /**
   * Grant write permissions for this stream and its contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to ues the key to encrypt the
   * contents of the stream will also be granted.
   */
  public grantWrite(grantee: iam.IGrantable) {
    const ret = this.grant(grantee, ...WRITE_OPERATIONS);
    // this.encryptionKey?.grantEncrypt(grantee);

    return ret;
  }

  /**
   * Grants read/write permissions for this stream and its contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to use the key for
   * encrypt/decrypt will also be granted.
   */
  public grantReadWrite(grantee: iam.IGrantable) {
    const ret = this.grant(
      grantee,
      ...Array.from(new Set([...READ_OPERATIONS, ...WRITE_OPERATIONS])),
    );
    this.encryptionKey?.grantEncryptDecrypt(grantee);

    return ret;
  }

  /**
   * Grant the indicated permissions on this stream to the given IAM principal (Role/Group/User).
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]) {
    return iam.Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [this.streamArn],
      scope: this,
    });
  }

  /**
   * Return stream metric based from its metric name
   *
   * @param metricName name of the stream metric
   * @param props properties of the metric
   */
  public metric(metricName: string, props?: cloudwatch.MetricOptions) {
    return new cloudwatch.Metric({
      namespace: "AWS/Kinesis",
      metricName,
      dimensionsMap: {
        StreamName: this.streamName,
      },
      ...props,
    }).attachTo(this);
  }

  /**
   * The number of bytes retrieved from the Kinesis stream, measured over the specified time period. Minimum, Maximum,
   * and Average statistics represent the bytes in a single GetRecords operation for the stream in the specified time
   * period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricGetRecordsBytes(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.getRecordsBytesAverage,
      props,
    );
  }

  /**
   * The age of the last record in all GetRecords calls made against a Kinesis stream, measured over the specified time
   * period. Age is the difference between the current time and when the last record of the GetRecords call was written
   * to the stream. The Minimum and Maximum statistics can be used to track the progress of Kinesis consumer
   * applications. A value of zero indicates that the records being read are completely caught up with the stream.
   *
   * The metric defaults to maximum over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricGetRecordsIteratorAgeMilliseconds(
    props?: cloudwatch.MetricOptions,
  ) {
    return this.metricFromCannedFunction(
      KinesisMetrics.getRecordsIteratorAgeMillisecondsMaximum,
      props,
    );
  }

  /**
   * The number of successful GetRecords operations per stream, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricGetRecordsSuccess(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.getRecordsSuccessAverage,
      props,
    );
  }

  /**
   * The number of records retrieved from the shard, measured over the specified time period. Minimum, Maximum, and
   * Average statistics represent the records in a single GetRecords operation for the stream in the specified time
   * period.
   *
   * average
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricGetRecords(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.getRecordsRecordsAverage,
      props,
    );
  }

  /**
   * The number of successful GetRecords operations per stream, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricGetRecordsLatency(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.getRecordsLatencyAverage,
      props,
    );
  }

  /**
   * The number of bytes put to the Kinesis stream using the PutRecord operation over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordBytes(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordBytesAverage,
      props,
    );
  }

  /**
   * The time taken per PutRecord operation, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  metricPutRecordLatency(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordLatencyAverage,
      props,
    );
  }

  /**
   * The number of successful PutRecord operations per Kinesis stream, measured over the specified time period. Average
   * reflects the percentage of successful writes to a stream.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordSuccess(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordSuccessAverage,
      props,
    );
  }

  /**
   * The number of bytes put to the Kinesis stream using the PutRecords operation over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsBytes(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsBytesAverage,
      props,
    );
  }

  /**
   * The time taken per PutRecords operation, measured over the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsLatency(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsLatencyAverage,
      props,
    );
  }

  /**
   *  The number of PutRecords operations where at least one record succeeded, per Kinesis stream, measured over the
   *  specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsSuccess(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsSuccessAverage,
      props,
    );
  }

  /**
   * The total number of records sent in a PutRecords operation per Kinesis data stream, measured over the specified
   * time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsTotalRecords(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsTotalRecordsAverage,
      props,
    );
  }

  /**
   * The number of successful records in a PutRecords operation per Kinesis data stream, measured over the specified
   * time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsSuccessfulRecords(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsSuccessfulRecordsAverage,
      props,
    );
  }

  /**
   * The number of records rejected due to internal failures in a PutRecords operation per Kinesis data stream,
   * measured over the specified time period. Occasional internal failures are to be expected and should be retried.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsFailedRecords(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsFailedRecordsAverage,
      props,
    );
  }

  /**
   * The number of records rejected due to throttling in a PutRecords operation per Kinesis data stream, measured over
   * the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricPutRecordsThrottledRecords(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.putRecordsThrottledRecordsAverage,
      props,
    );
  }

  /**
   * The number of bytes successfully put to the Kinesis stream over the specified time period. This metric includes
   * bytes from PutRecord and PutRecords operations. Minimum, Maximum, and Average statistics represent the bytes in a
   * single put operation for the stream in the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricIncomingBytes(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.incomingBytesAverage,
      props,
    );
  }

  /**
   * The number of records successfully put to the Kinesis stream over the specified time period. This metric includes
   * record counts from PutRecord and PutRecords operations. Minimum, Maximum, and Average statistics represent the
   * records in a single put operation for the stream in the specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricIncomingRecords(props?: cloudwatch.MetricOptions) {
    return this.metricFromCannedFunction(
      KinesisMetrics.incomingRecordsAverage,
      props,
    );
  }

  /**
   * The number of GetRecords calls throttled for the stream over the specified time period. The most commonly used
   * statistic for this metric is Average.
   *
   * When the Minimum statistic has a value of 1, all records were throttled for the stream during the specified time
   * period.
   *
   * When the Maximum statistic has a value of 0 (zero), no records were throttled for the stream during the specified
   * time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties
   *
   * @param props properties of the metric
   *
   */
  public metricReadProvisionedThroughputExceeded(
    props?: cloudwatch.MetricOptions,
  ) {
    return this.metricFromCannedFunction(
      KinesisMetrics.readProvisionedThroughputExceededAverage,
      props,
    );
  }

  /**
   * The number of records rejected due to throttling for the stream over the specified time period. This metric
   * includes throttling from PutRecord and PutRecords operations.
   *
   * When the Minimum statistic has a non-zero value, records were being throttled for the stream during the specified
   * time period.
   *
   * When the Maximum statistic has a value of 0 (zero), no records were being throttled for the stream during the
   * specified time period.
   *
   * The metric defaults to average over 5 minutes, it can be changed by passing `statistic` and `period` properties.
   *
   * @param props properties of the metric
   */
  public metricWriteProvisionedThroughputExceeded(
    props?: cloudwatch.MetricOptions,
  ) {
    return this.metricFromCannedFunction(
      KinesisMetrics.writeProvisionedThroughputExceededAverage,
      props,
    );
  }

  // create metrics based on generated KinesisMetrics static methods
  private metricFromCannedFunction(
    createCannedProps: (dimensions: {
      StreamName: string;
    }) => cloudwatch.MetricProps,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...createCannedProps({ StreamName: this.streamName }),
      ...props,
    }).attachTo(this);
  }
}

/**
 * Properties for a Kinesis Stream
 */
export interface StreamProps extends AwsBeaconProps {
  /**
   * Enforces a particular physical stream name.
   * @default <generated>
   */
  readonly streamName?: string;

  /**
   * The number of hours for the data records that are stored in shards to remain accessible.
   * @default Duration.hours(24)
   */
  readonly retentionPeriod?: Duration;

  /**
   * The number of shards for the stream.
   *
   * Can only be provided if streamMode is Provisioned.
   *
   * @default 1
   */
  readonly shardCount?: number;

  /**
   * The kind of server-side encryption to apply to this stream.
   *
   * If you choose KMS, you can specify a KMS key via `encryptionKey`. If
   * encryption key is not specified, a key will automatically be created.
   *
   * @default - StreamEncryption.KMS if encrypted Streams are supported in the region
   *   or StreamEncryption.UNENCRYPTED otherwise.
   *   StreamEncryption.KMS if an encryption key is supplied through the encryptionKey property
   */
  readonly encryption?: StreamEncryption;

  /**
   * External KMS key to use for stream encryption.
   *
   * The 'encryption' property must be set to "Kms".
   *
   * @default - Kinesis Data Streams master key ('/alias/aws/kinesis').
   *   If encryption is set to StreamEncryption.KMS and this property is undefined, a new KMS key
   *   will be created and associated with this stream.
   */
  readonly encryptionKey?: kms.IKey;

  /**
   * The capacity mode of this stream.
   *
   * @default StreamMode.PROVISIONED
   */
  readonly streamMode?: StreamMode;
}

/**
 * A Kinesis stream. Can be encrypted with a KMS key.
 *
 * @resource aws_kinesis_stream
 */
export class Stream extends StreamBase {
  /**
   * Import an existing Kinesis Stream provided an ARN
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name
   * @param streamArn Stream ARN (i.e. arn:aws:kinesis:<region>:<account-id>:stream/Foo)
   */
  public static fromStreamArn(
    scope: Construct,
    id: string,
    streamArn: string,
  ): IStream {
    return Stream.fromStreamAttributes(scope, id, { streamArn });
  }

  /**
   * Creates a Stream construct that represents an external stream.
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name.
   * @param attrs Stream import properties
   */
  public static fromStreamAttributes(
    scope: Construct,
    id: string,
    attrs: StreamAttributes,
  ): IStream {
    class Import extends StreamBase {
      public readonly streamArn = attrs.streamArn;
      public readonly streamName = AwsSpec.ofAwsBeacon(scope).splitArn(
        attrs.streamArn,
        ArnFormat.SLASH_RESOURCE_NAME,
      ).resourceName!;
      public readonly encryptionKey = attrs.encryptionKey;

      protected readonly autoCreatePolicy = false;
    }

    return new Import(scope, id, {
      environmentFromArn: attrs.streamArn,
    });
  }

  public readonly streamArn: string;
  public readonly streamName: string;
  public readonly encryptionKey?: kms.IKey;

  public readonly resource: kinesisStream.KinesisStream;

  protected readonly autoCreatePolicy = true;

  constructor(scope: Construct, id: string, props: StreamProps = {}) {
    super(scope, id, props);
    const name =
      props.streamName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    let shardCount = props.shardCount;
    const streamMode = props.streamMode;

    if (streamMode === StreamMode.ON_DEMAND && shardCount !== undefined) {
      throw new Error(
        `streamMode must be set to ${StreamMode.PROVISIONED} (default) when specifying shardCount`,
      );
    }
    if (
      (streamMode === StreamMode.PROVISIONED || streamMode === undefined) &&
      shardCount === undefined
    ) {
      shardCount = 1;
    }

    const retentionPeriodHours = props.retentionPeriod?.toHours() ?? 24;
    if (!Token.isUnresolved(retentionPeriodHours)) {
      if (retentionPeriodHours < 24 || retentionPeriodHours > 8760) {
        throw new Error(
          `retentionPeriod must be between 24 and 8760 hours. Received ${retentionPeriodHours}`,
        );
      }
    }

    const { streamEncryption, encryptionKey } = this.parseEncryption(props);
    this.resource = new kinesisStream.KinesisStream(this, "Resource", {
      name,
      retentionPeriod: retentionPeriodHours,
      shardCount,
      ...streamEncryption,
      ...(props.streamMode !== undefined
        ? {
            streamModeDetails: { streamMode: props.streamMode },
          }
        : undefined),
    });

    this.streamArn = this.resource.arn;
    this.streamName = this.resource.name;

    this.encryptionKey = encryptionKey;
  }

  /**
   * Set up key properties and return the Stream encryption property from the
   * user's configuration.
   */
  private parseEncryption(props: StreamProps): {
    streamEncryption?: StreamEncryptionProperty;
    encryptionKey?: kms.IKey;
  } {
    // if encryption properties are not set, default to KMS in regions where KMS is available
    if (!props.encryption && !props.encryptionKey) {
      const conditionName = "AwsCdkKinesisEncryptedStreamsUnsupportedRegions";
      let unsupportedRegionCondition = this.stack.node.tryFindChild(
        conditionName,
      ) as TerraformLocal;

      const unsupportedRegions = ["cn-north-1", "cn-northwest-1"];

      // create a single condition for the Stack
      if (!unsupportedRegionCondition) {
        unsupportedRegionCondition = new TerraformLocal(
          this.stack,
          conditionName,
          Fn.contains(unsupportedRegions, this.stack.region),
        );
      }

      return {
        streamEncryption: {
          encryptionType: conditionalString(
            unsupportedRegionCondition.expression,
            "KMS",
          ),
          kmsKeyId: conditionalString(
            unsupportedRegionCondition.expression,
            "alias/aws/kinesis",
          ),
        },
      };
    }

    // default based on whether encryption key is specified
    const encryptionType =
      props.encryption ??
      (props.encryptionKey
        ? StreamEncryption.KMS
        : StreamEncryption.UNENCRYPTED);

    // if encryption key is set, encryption must be set to KMS.
    if (encryptionType !== StreamEncryption.KMS && props.encryptionKey) {
      throw new Error(
        `encryptionKey is specified, so 'encryption' must be set to KMS (value: ${encryptionType})`,
      );
    }

    if (encryptionType === StreamEncryption.UNENCRYPTED) {
      return {};
    }

    if (encryptionType === StreamEncryption.MANAGED) {
      const encryption = {
        encryptionType: "KMS",
        kmsKeyId: "alias/aws/kinesis",
      };
      return { streamEncryption: encryption };
    }

    if (encryptionType === StreamEncryption.KMS) {
      const encryptionKey =
        props.encryptionKey ||
        new kms.Key(this, "Key", {
          description: `Created by ${this.node.path}`,
        });

      const streamEncryption: StreamEncryptionProperty = {
        encryptionType: "KMS",
        kmsKeyId: encryptionKey.keyArn,
      };
      return { encryptionKey, streamEncryption };
    }

    throw new Error(`Unexpected 'encryptionType': ${encryptionType}`);
  }
}

/**
 * Enables or updates server-side encryption using an AWS KMS key for a specified stream.
 *
 * > When invoking this API, you must use either the `StreamARN` or the `StreamName` parameter, or both. It is recommended that you use the `StreamARN` input parameter when you invoke this API.
 *
 * Starting encryption is an asynchronous operation. Upon receiving the request, Kinesis Data Streams returns immediately and sets the status of the stream to `UPDATING` . After the update is complete, Kinesis Data Streams sets the status of the stream back to `ACTIVE` . Updating or applying encryption normally takes a few seconds to complete, but it can take minutes. You can continue to read and write data to your stream while its status is `UPDATING` . Once the status of the stream is `ACTIVE` , encryption begins for records written to the stream.
 *
 * API Limits: You can successfully apply a new AWS KMS key for server-side encryption 25 times in a rolling 24-hour period.
 *
 * Note: It can take up to 5 seconds after the stream is in an `ACTIVE` status before all records written to the stream are encrypted. After you enable encryption, you can verify that encryption is applied by inspecting the API response from `PutRecord` or `PutRecords` .
 *
 * @struct
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-kinesis-stream-streamencryption.html
 */
export interface StreamEncryptionProperty {
  /**
   * The encryption type to use.
   *
   * The only valid value is `KMS` .
   *
   * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-kinesis-stream-streamencryption.html#cfn-kinesis-stream-streamencryption-encryptiontype
   */
  readonly encryptionType: string;

  /**
   * The GUID for the customer-managed AWS KMS key to use for encryption.
   *
   * This value can be a globally unique identifier, a fully specified Amazon Resource Name (ARN) to either an alias or a key, or an alias name prefixed by "alias/".You can also use a master key owned by Kinesis Data Streams by specifying the alias `aws/kinesis` .
   *
   * - Key ARN example: `arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012`
   * - Alias ARN example: `arn:aws:kms:us-east-1:123456789012:alias/MyAliasName`
   * - Globally unique key ID example: `12345678-1234-1234-1234-123456789012`
   * - Alias name example: `alias/MyAliasName`
   * - Master key owned by Kinesis Data Streams: `alias/aws/kinesis`
   *
   * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-kinesis-stream-streamencryption.html#cfn-kinesis-stream-streamencryption-keyid
   */
  readonly kmsKeyId: string;
}

/**
 * What kind of server-side encryption to apply to this stream
 */
export enum StreamEncryption {
  /**
   * Records in the stream are not encrypted.
   */
  UNENCRYPTED = "NONE",

  /**
   * Server-side encryption with a KMS key managed by the user.
   * If `encryptionKey` is specified, this key will be used, otherwise, one will be defined.
   */
  KMS = "KMS",

  /**
   * Server-side encryption with a master key managed by Amazon Kinesis
   */
  MANAGED = "MANAGED",
}

/**
 * Specifies the capacity mode to apply to this stream.
 */
export enum StreamMode {
  /**
   * Specify the provisioned capacity mode. The stream will have `shardCount` shards unless
   * modified and will be billed according to the provisioned capacity.
   */
  PROVISIONED = "PROVISIONED",

  /**
   * Specify the on-demand capacity mode. The stream will autoscale and be billed according to the
   * volume of data ingested and retrieved.
   */
  ON_DEMAND = "ON_DEMAND",
}

/**
 * Set string based on expression
 *
 * @param expression expression to evaluate
 * @param value value to return if expression is true, otherwise null
 */
function conditionalString(expression: any, value: string): string {
  return Token.asString(Fn.conditional(expression, Token.nullValue(), value));
}