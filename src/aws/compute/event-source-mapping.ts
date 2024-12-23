import { lambdaEventSourceMapping } from "@cdktf/provider-aws";
import * as cdktf from "cdktf";
import { Construct } from "constructs";
import {
  AwsStack,
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
  ArnFormat,
} from "..";
import { IEventSourceDlq } from "./function";
import { IFunction } from "./function-base";
import { Duration } from "../..";
import { withResolved } from "../../token";
// TODO: re-add support for KMS
// import * as iam from "../iam"; // required to grant KMS permissions
// import { IKey } from "../encryption";

export interface EventSourceMappingOptions extends AwsConstructProps {
  /**
   * The Amazon Resource Name (ARN) of the event source. Any record added to
   * this stream can invoke the Lambda function.
   *
   * @default - not set if using a self managed Kafka cluster, throws an error otherwise
   */
  readonly eventSourceArn?: string;

  /**
   * The largest number of records that AWS Lambda will retrieve from your event
   * source at the time of invoking your function. Your function receives an
   * event with all the retrieved records.
   *
   * Valid Range: Minimum value of 1. Maximum value of 10000.
   *
   * @default - Amazon Kinesis, Amazon DynamoDB, and Amazon MSK is 100 records.
   * The default for Amazon SQS is 10 messages. For standard SQS queues, the maximum is 10,000. For FIFO SQS queues, the maximum is 10.
   */
  readonly batchSize?: number;

  /**
   * If the function returns an error, split the batch in two and retry.
   *
   * @default false
   */
  readonly bisectBatchOnError?: boolean;

  /**
   * An Amazon SQS queue or Amazon SNS topic destination for discarded records.
   *
   * @default discarded records are ignored
   */
  readonly onFailure?: IEventSourceDlq;

  /**
   * Set to false to disable the event source upon creation.
   *
   * @default true
   */
  readonly enabled?: boolean;

  /**
   * The position in the DynamoDB, Kinesis or MSK stream where AWS Lambda should
   * start reading.
   *
   * @see https://docs.aws.amazon.com/kinesis/latest/APIReference/API_GetShardIterator.html#Kinesis-GetShardIterator-request-ShardIteratorType
   *
   * @default - no starting position
   */
  readonly startingPosition?: StartingPosition;

  /**
   * The time from which to start reading, in Unix time seconds.
   *
   * @default - no timestamp
   */
  readonly startingPositionTimestamp?: number;

  /**
   * Allow functions to return partially successful responses for a batch of records.
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-batchfailurereporting
   *
   * @default false
   */
  readonly reportBatchItemFailures?: boolean;

  /**
   * The maximum amount of time to gather records before invoking the function.
   * Maximum of Duration.minutes(5)
   *
   * @default Duration.seconds(0)
   */
  readonly maxBatchingWindow?: Duration;

  /**
   * The maximum concurrency setting limits the number of concurrent instances of the function that an Amazon SQS event source can invoke.
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#events-sqs-max-concurrency
   *
   * Valid Range: Minimum value of 2. Maximum value of 1000.
   *
   * @default - No specific limit.
   */
  readonly maxConcurrency?: number;

  /**
   * The maximum age of a record that Lambda sends to a function for processing.
   * Valid Range:
   * * Minimum value of 60 seconds
   * * Maximum value of 7 days
   *
   * @default - infinite or until the record expires.
   */
  readonly maxRecordAge?: Duration;

  /**
   * The maximum number of times to retry when the function returns an error.
   * Set to `undefined` if you want lambda to keep retrying infinitely or until
   * the record expires.
   *
   * Valid Range:
   * * Minimum value of 0
   * * Maximum value of 10000
   *
   * @default - infinite or until the record expires.
   */
  readonly retryAttempts?: number;

  /**
   * The number of batches to process from each shard concurrently.
   * Valid Range:
   * * Minimum value of 1
   * * Maximum value of 10
   *
   * @default 1
   */
  readonly parallelizationFactor?: number;

  /**
   * The name of the Kafka topic.
   *
   * @default - no topic
   */
  readonly kafkaTopic?: string;

  /**
   * The size of the tumbling windows to group records sent to DynamoDB or Kinesis
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-windows
   *
   * Valid Range: 0 - 15 minutes
   *
   * @default - None
   */
  readonly tumblingWindow?: Duration;

  /**
   * A list of host and port pairs that are the addresses of the Kafka brokers in a self managed "bootstrap" Kafka cluster
   * that a Kafka client connects to initially to bootstrap itself.
   * They are in the format `abc.example.com:9096`.
   *
   * @default - none
   */
  readonly kafkaBootstrapServers?: string[];

  /**
   * The identifier for the Kafka consumer group to join. The consumer group ID must be unique among all your Kafka event sources. After creating a Kafka event source mapping with the consumer group ID specified, you cannot update this value. The value must have a lenght between 1 and 200 and full the pattern '[a-zA-Z0-9-\/*:_+=.@-]*'. For more information, see [Customizable consumer group ID](https://docs.aws.amazon.com/lambda/latest/dg/with-msk.html#services-msk-consumer-group-id).
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-eventsourcemapping-amazonmanagedkafkaeventsourceconfig.html
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-eventsourcemapping-selfmanagedkafkaeventsourceconfig.html
   *
   * @default - none
   */
  readonly kafkaConsumerGroupId?: string;

  /**
   * Specific settings like the authentication protocol or the VPC components to secure access to your event source.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-eventsourcemapping-sourceaccessconfiguration.html
   *
   * @default - none
   */
  readonly sourceAccessConfigurations?: SourceAccessConfiguration[];

  /**
   * Add filter criteria to Event Source.
   *
   * A set of up to 5 filter. If an event satisfies at least one, Lambda sends the event to the function or adds it to the next batch.
   * @see https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html
   *
   * @default - none
   */
  readonly filters?: Array<{ [key: string]: any }>;

  // TODO: re-add KMS support
  // /**
  //  * Add Customer managed KMS key to encrypt Filter Criteria.
  //  * @see https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html
  //  * By default, Lambda will encrypt Filter Criteria using AWS managed keys
  //  * @see https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#aws-managed-cmk
  //  *
  //  * @default - none
  //  */
  // readonly filterEncryption?: IKey;

  /**
   * Check if support S3 onfailure destination(ODF). Currently only MSK and self managed kafka event support S3 ODF
   *
   * @default false
   */
  readonly supportS3OnFailureDestination?: boolean;
}

/**
 * Properties for declaring a new event source mapping.
 */
export interface EventSourceMappingProps extends EventSourceMappingOptions {
  /**
   * The target AWS Lambda function.
   */
  readonly target: IFunction;
}

/**
 * Outputs to expose via the grid.
 */
export interface EventSourceMappingOutputs {
  /**
   * The identifier for the EventSourceMapping.
   */
  readonly uuid: string;
}

/**
 * Represents an event source mapping for a lambda function.
 * @see https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html
 */
export interface IEventSourceMapping extends IAwsConstruct {
  /**
   * strongly typed outputs
   */
  readonly eventSourceMappingOutputs: EventSourceMappingOutputs;

  /**
   * The identifier for this EventSourceMapping
   * @attribute
   */
  readonly eventSourceMappingId: string;

  /**
   * The ARN of the event source mapping (i.e. arn:aws:lambda:region:account-id:event-source-mapping/event-source-mapping-id)
   */
  readonly eventSourceMappingArn: string;
}

/**
 * Defines a Lambda EventSourceMapping resource.
 *
 * Usually, you won't need to define the mapping yourself. This will usually be done by
 * event sources. For example, to add an SQS event source to a function:
 *
 * ```ts
 * import { notify, compute } from 'terraconstructs';
 *
 * declare const handler: compute.Function;
 * declare const queue: notify.Queue;
 *
 * handler.addEventSource(new compute.eventsources.SqsEventSource(queue));
 * ```
 *
 * The `SqsEventSource` class will automatically create the mapping, and will also
 * modify the Lambda's execution role so it can consume messages from the queue.
 */
export class EventSourceMapping
  extends AwsConstructBase
  implements IEventSourceMapping
{
  /**
   * Import an event source into this stack from its event source id.
   */
  public static fromEventSourceMappingId(
    scope: Construct,
    id: string,
    eventSourceMappingId: string,
  ): IEventSourceMapping {
    const eventSourceMappingArn = EventSourceMapping.formatArn(
      scope,
      eventSourceMappingId,
    );

    class Import extends AwsConstructBase implements IEventSourceMapping {
      public readonly eventSourceMappingId = eventSourceMappingId;
      public readonly eventSourceMappingArn = eventSourceMappingArn;
      public readonly eventSourceMappingOutputs = {
        uuid: eventSourceMappingId,
      };
      public get outputs() {
        return this.eventSourceMappingOutputs;
      }
    }
    return new Import(scope, id);
  }

  private static formatArn(
    scope: Construct,
    eventSourceMappingId: string,
  ): string {
    return AwsStack.ofAwsConstruct(scope).formatArn({
      service: "lambda",
      resource: "event-source-mapping",
      resourceName: eventSourceMappingId,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
  }

  public readonly eventSourceMappingId: string;
  public readonly eventSourceMappingArn: string;
  public readonly eventSourceMappingOutputs: EventSourceMappingOutputs;
  public get outputs(): Record<string, any> {
    return this.eventSourceMappingOutputs;
  }

  constructor(scope: Construct, id: string, props: EventSourceMappingProps) {
    super(scope, id);

    if (
      props.eventSourceArn == undefined &&
      props.kafkaBootstrapServers == undefined
    ) {
      throw new Error(
        "Either eventSourceArn or kafkaBootstrapServers must be set",
      );
    }

    if (
      props.eventSourceArn !== undefined &&
      props.kafkaBootstrapServers !== undefined
    ) {
      throw new Error(
        "eventSourceArn and kafkaBootstrapServers are mutually exclusive",
      );
    }

    if (
      props.kafkaBootstrapServers &&
      props.kafkaBootstrapServers?.length < 1
    ) {
      throw new Error("kafkaBootStrapServers must not be empty if set");
    }

    if (props.maxBatchingWindow && props.maxBatchingWindow.toSeconds() > 300) {
      throw new Error(
        `maxBatchingWindow cannot be over 300 seconds, got ${props.maxBatchingWindow.toSeconds()}`,
      );
    }

    if (
      props.maxConcurrency &&
      !cdktf.Token.isUnresolved(props.maxConcurrency) &&
      (props.maxConcurrency < 2 || props.maxConcurrency > 1000)
    ) {
      throw new Error(
        "maxConcurrency must be between 2 and 1000 concurrent instances",
      );
    }

    if (
      props.maxRecordAge &&
      (props.maxRecordAge.toSeconds() < 60 ||
        props.maxRecordAge.toDays({ integral: false }) > 7)
    ) {
      throw new Error(
        "maxRecordAge must be between 60 seconds and 7 days inclusive",
      );
    }

    props.retryAttempts !== undefined &&
      withResolved(props.retryAttempts, (attempts) => {
        if (attempts < 0 || attempts > 10000) {
          throw new Error(
            `retryAttempts must be between 0 and 10000 inclusive, got ${attempts}`,
          );
        }
      });

    props.parallelizationFactor !== undefined &&
      withResolved(props.parallelizationFactor, (factor) => {
        if (factor < 1 || factor > 10) {
          throw new Error(
            `parallelizationFactor must be between 1 and 10 inclusive, got ${factor}`,
          );
        }
      });

    if (
      props.tumblingWindow &&
      !cdktf.Token.isUnresolved(props.tumblingWindow) &&
      props.tumblingWindow.toSeconds() > 900
    ) {
      throw new Error(
        `tumblingWindow cannot be over 900 seconds, got ${props.tumblingWindow.toSeconds()}`,
      );
    }

    if (
      props.startingPosition === StartingPosition.AT_TIMESTAMP &&
      !props.startingPositionTimestamp
    ) {
      throw new Error(
        "startingPositionTimestamp must be provided when startingPosition is AT_TIMESTAMP",
      );
    }

    if (
      props.startingPosition !== StartingPosition.AT_TIMESTAMP &&
      props.startingPositionTimestamp
    ) {
      throw new Error(
        "startingPositionTimestamp can only be used when startingPosition is AT_TIMESTAMP",
      );
    }

    if (props.kafkaConsumerGroupId) {
      this.validateKafkaConsumerGroupIdOrThrow(props.kafkaConsumerGroupId);
    }

    // TODO: re-add KMS support
    // if (props.filterEncryption !== undefined && props.filters == undefined) {
    //   throw new Error(
    //     "filter criteria must be provided to enable setting filter criteria encryption",
    //   );
    // }
    //
    // /**
    //  * Grants the Lambda function permission to decrypt data using the specified KMS key.
    //  * This step is necessary for setting up encrypted filter criteria.
    //  *
    //  * If the KMS key was created within this CloudFormation stack (via `new Key`), a Key policy
    //  * will be attached to the key to allow the Lambda function to access it. However, if the
    //  * Key is imported from an existing ARN (`Key.fromKeyArn`), no action will be taken.
    //  */
    // if (props.filterEncryption !== undefined) {
    //   const lambdaPrincipal = new iam.ServicePrincipal("lambda.amazonaws.com");
    //   props.filterEncryption.grantDecrypt(lambdaPrincipal);
    // }

    let destinationConfig: any;

    if (props.onFailure) {
      destinationConfig = {
        onFailure: props.onFailure.bind(this, props.target),
      };
    }

    let selfManagedEventSource:
      | lambdaEventSourceMapping.LambdaEventSourceMappingSelfManagedEventSource
      | undefined;
    if (props.kafkaBootstrapServers) {
      selfManagedEventSource = {
        endpoints: {
          KAFKA_BOOTSTRAP_SERVERS: props.kafkaBootstrapServers.join(","),
        },
      };
    }

    let consumerGroupConfig = props.kafkaConsumerGroupId
      ? { consumerGroupId: props.kafkaConsumerGroupId }
      : undefined;

    const resource = new lambdaEventSourceMapping.LambdaEventSourceMapping(
      this,
      "Resource",
      {
        batchSize: props.batchSize,
        bisectBatchOnFunctionError: props.bisectBatchOnError,
        destinationConfig,
        enabled: props.enabled,
        eventSourceArn: props.eventSourceArn,
        functionName: props.target.functionName,
        startingPosition: props.startingPosition,
        startingPositionTimestamp: props.startingPositionTimestamp
          ? new Date(props.startingPositionTimestamp * 1000).toISOString()
          : undefined,
        functionResponseTypes: props.reportBatchItemFailures
          ? ["ReportBatchItemFailures"]
          : undefined,
        maximumBatchingWindowInSeconds: props.maxBatchingWindow?.toSeconds(),
        maximumRecordAgeInSeconds: props.maxRecordAge?.toSeconds(),
        maximumRetryAttempts: props.retryAttempts,
        parallelizationFactor: props.parallelizationFactor,
        topics: props.kafkaTopic !== undefined ? [props.kafkaTopic] : undefined,
        tumblingWindowInSeconds: props.tumblingWindow?.toSeconds(),
        scalingConfig: props.maxConcurrency
          ? { maximumConcurrency: props.maxConcurrency }
          : undefined,
        sourceAccessConfiguration: props.sourceAccessConfigurations,
        selfManagedEventSource,
        filterCriteria: props.filters ? { filter: props.filters } : undefined,
        // kmsKeyArn: props.filterEncryption?.keyArn, // TODO: re-add KMS support
        selfManagedKafkaEventSourceConfig: props.kafkaBootstrapServers
          ? consumerGroupConfig
          : undefined,
        amazonManagedKafkaEventSourceConfig: props.eventSourceArn
          ? consumerGroupConfig
          : undefined,
      },
    );
    this.eventSourceMappingId = resource.uuid;
    this.eventSourceMappingArn = EventSourceMapping.formatArn(
      this,
      this.eventSourceMappingId,
    );

    this.eventSourceMappingOutputs = {
      uuid: this.eventSourceMappingId,
    };
  }

  private validateKafkaConsumerGroupIdOrThrow(kafkaConsumerGroupId: string) {
    if (cdktf.Token.isUnresolved(kafkaConsumerGroupId)) {
      return;
    }

    if (kafkaConsumerGroupId.length > 200 || kafkaConsumerGroupId.length < 1) {
      throw new Error(
        "kafkaConsumerGroupId must be a valid string between 1 and 200 characters",
      );
    }

    const regex = new RegExp(/[a-zA-Z0-9-\/*:_+=.@-]*/);
    const patternMatch = regex.exec(kafkaConsumerGroupId);
    if (patternMatch === null || patternMatch[0] !== kafkaConsumerGroupId) {
      throw new Error(
        'kafkaConsumerGroupId contains invalid characters. Allowed values are "[a-zA-Z0-9-/*:_+=.@-]"',
      );
    }
  }
}

/**
 * The type of authentication protocol or the VPC components for your event source's SourceAccessConfiguration
 * @see https://docs.aws.amazon.com/lambda/latest/dg/API_SourceAccessConfiguration.html#SSS-Type-SourceAccessConfiguration-Type
 */
export enum SourceAccessConfigurationType {
  /**
   * (MQ) The Secrets Manager secret that stores your broker credentials.
   */
  BASIC_AUTH = "BASIC_AUTH",

  /**
   * The subnets associated with your VPC. Lambda connects to these subnets to fetch data from your Self-Managed Apache Kafka cluster.
   */
  VPC_SUBNET = "VPC_SUBNET",

  /**
   * The VPC security group used to manage access to your Self-Managed Apache Kafka brokers.
   */
  VPC_SECURITY_GROUP = "VPC_SECURITY_GROUP",

  /**
   * The Secrets Manager ARN of your secret key used for SASL SCRAM-256 authentication of your Self-Managed Apache Kafka brokers.
   */
  SASL_SCRAM_256_AUTH = "SASL_SCRAM_256_AUTH",

  /**
   * The Secrets Manager ARN of your secret key used for SASL SCRAM-512 authentication of your Self-Managed Apache Kafka brokers.
   */
  SASL_SCRAM_512_AUTH = "SASL_SCRAM_512_AUTH",

  /**
   * The Secrets Manager ARN of your secret key containing the certificate chain (X.509 PEM), private key (PKCS#8 PEM),
   * and private key password (optional) used for mutual TLS authentication of your MSK/Apache Kafka brokers.
   */
  CLIENT_CERTIFICATE_TLS_AUTH = "CLIENT_CERTIFICATE_TLS_AUTH",

  /**
   * The Secrets Manager ARN of your secret key containing the root CA certificate (X.509 PEM) used for TLS encryption of your Apache Kafka brokers.
   */
  SERVER_ROOT_CA_CERTIFICATE = "SERVER_ROOT_CA_CERTIFICATE",
}

/**
 * Specific settings like the authentication protocol or the VPC components to secure access to your event source.
 */
export interface SourceAccessConfiguration {
  /**
   * The type of authentication protocol or the VPC components for your event source. For example: "SASL_SCRAM_512_AUTH".
   */
  readonly type: SourceAccessConfigurationType;
  /**
   * The value for your chosen configuration in type.
   * For example: "URI": "arn:aws:secretsmanager:us-east-1:01234567890:secret:MyBrokerSecretName".
   * The exact string depends on the type.
   * @see SourceAccessConfigurationType
   */
  readonly uri: string;
}
/**
 * The position in the DynamoDB, Kinesis or MSK stream where AWS Lambda should start
 * reading.
 */
export enum StartingPosition {
  /**
   * Start reading at the last untrimmed record in the shard in the system,
   * which is the oldest data record in the shard.
   */
  TRIM_HORIZON = "TRIM_HORIZON",

  /**
   * Start reading just after the most recent record in the shard, so that you
   * always read the most recent data in the shard
   */
  LATEST = "LATEST",

  /**
   * Start reading from a position defined by a time stamp.
   * Only supported for Amazon Kinesis streams, otherwise an error will occur.
   * If supplied, `startingPositionTimestamp` must also be set.
   */
  AT_TIMESTAMP = "AT_TIMESTAMP",
}
