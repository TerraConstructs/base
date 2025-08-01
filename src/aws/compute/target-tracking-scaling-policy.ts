// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-applicationautoscaling/lib/target-tracking-scaling-policy.ts

import { appautoscalingPolicy } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IScalableTarget } from "./scalable-target";
import { Duration } from "../../duration";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import * as cloudwatch from "../cloudwatch";
// TODO Adupt ValidationError is available, otherwise use standard Error
// - https://github.com/aws/aws-cdk/pull/33382/
// - https://github.com/aws/aws-cdk/pull/33045
// import { ValidationError } from "../core/errors";

/**
 * Base interface for target tracking props
 *
 * Contains the attributes that are common to target tracking policies,
 * except the ones relating to the metric and to the scalable target.
 *
 * This interface is reused by more specific target tracking props objects
 * in other services.
 */
export interface BaseTargetTrackingProps {
  /**
   * A name for the scaling policy
   *
   * @default - Friendly name of the construct.
   */
  readonly policyName?: string;

  /**
   * Indicates whether scale in by the target tracking policy is disabled.
   *
   * If the value is true, scale in is disabled and the target tracking policy
   * won't remove capacity from the scalable resource. Otherwise, scale in is
   * enabled and the target tracking policy can remove capacity from the
   * scalable resource.
   *
   * @default false
   */
  readonly disableScaleIn?: boolean;

  /**
   * Period after a scale in activity completes before another scale in activity can start.
   *
   * @default Duration.seconds(300) for the following scalable targets: ECS services,
   * Spot Fleet requests, EMR clusters, AppStream 2.0 fleets, Aurora DB clusters,
   * Amazon SageMaker endpoint variants, Custom resources. For all other scalable
   * targets, the default value is Duration.seconds(0): DynamoDB tables, DynamoDB
   * global secondary indexes, Amazon Comprehend document classification endpoints,
   * Lambda provisioned concurrency
   */
  readonly scaleInCooldown?: Duration;

  /**
   * Period after a scale out activity completes before another scale out activity can start.
   *
   * @default Duration.seconds(300) for the following scalable targets: ECS services,
   * Spot Fleet requests, EMR clusters, AppStream 2.0 fleets, Aurora DB clusters,
   * Amazon SageMaker endpoint variants, Custom resources. For all other scalable
   * targets, the default value is Duration.seconds(0): DynamoDB tables, DynamoDB
   * global secondary indexes, Amazon Comprehend document classification endpoints,
   * Lambda provisioned concurrency
   */
  readonly scaleOutCooldown?: Duration;
}

/**
 * Properties for a Target Tracking policy that include the metric but exclude the target
 */
export interface BasicTargetTrackingScalingPolicyProps
  extends BaseTargetTrackingProps {
  /**
   * The target value for the metric.
   */
  readonly targetValue: number;

  /**
   * A predefined metric for application autoscaling
   *
   * The metric must track utilization. Scaling out will happen if the metric is higher than
   * the target value, scaling in will happen in the metric is lower than the target value.
   *
   * Exactly one of customMetric or predefinedMetric must be specified.:
      Object.entries(c.dimensions).map() as appautoscalingPolicy.AppautoscalingPolicyTargetTrackingScalingPolicyConfigurationCustomizedMetricSpecificationDimensions[],
   *
   * @default - No predefined metrics.
   */
  readonly predefinedMetric?: PredefinedMetric;

  /**
   * Identify the resource associated with the metric type.
   *
   * Only used for predefined metric ALBRequestCountPerTarget.
   *
   * Example value: `app/<load-balancer-name>/<load-balancer-id>/targetgroup/<target-group-name>/<target-group-id>`
   *
   * @default - No resource label.
   */
  readonly resourceLabel?: string;

  /**
   * A custom metric for application autoscaling
   *
   * The metric must track utilization. Scaling out will happen if the metric is higher than
   * the target value, scaling in will happen in the metric is lower than the target value.
   *
   * Exactly one of customMetric or predefinedMetric must be specified.
   *
   * @default - No custom metric.
   */
  readonly customMetric?: cloudwatch.IMetric;
}

/**
 * Properties for a concrete TargetTrackingPolicy
 *
 * Adds the scalingTarget.
 */
export interface TargetTrackingScalingPolicyProps
  extends BasicTargetTrackingScalingPolicyProps,
    AwsConstructProps {
  /*
   * The scalable target
   */
  readonly scalingTarget: IScalableTarget;
}

/**
 * Defines a target tracking scaling policy for Application Auto Scaling.
 */
export class TargetTrackingScalingPolicy extends AwsConstructBase {
  /**
   * ARN of the scaling policy
   */
  public readonly scalingPolicyArn: string;

  private readonly resource: appautoscalingPolicy.AppautoscalingPolicy;

  public get outputs(): Record<string, any> {
    return {
      scalingPolicyArn: this.scalingPolicyArn,
    };
  }

  constructor(
    scope: Construct,
    id: string,
    props: TargetTrackingScalingPolicyProps,
  ) {
    super(scope, id, props);

    if (
      (props.customMetric === undefined) ===
      (props.predefinedMetric === undefined)
    ) {
      // Assuming ValidationError is available, otherwise use standard Error
      throw new Error(
        "Exactly one of 'customMetric' or 'predefinedMetric' must be specified.",
      );
    }

    if (props.customMetric && !props.customMetric.toMetricConfig().metricStat) {
      // Assuming ValidationError is available, otherwise use standard Error
      throw new Error(
        "Only direct metrics are supported for Target Tracking. Use Step Scaling or supply a Metric object.",
      );
    }

    // replace dummy value in DYNAMODB_WRITE_CAPACITY_UTILIZATION due to a jsii bug (https://github.com/aws/jsii/issues/2782)
    const predefinedMetricValue =
      props.predefinedMetric ===
      PredefinedMetric.DYNAMODB_WRITE_CAPACITY_UTILIZATION
        ? PredefinedMetric.DYANMODB_WRITE_CAPACITY_UTILIZATION
        : props.predefinedMetric;

    const policyName = props.policyName ?? this.friendlyName;

    this.resource = new appautoscalingPolicy.AppautoscalingPolicy(
      this,
      "Resource",
      {
        name: policyName,
        policyType: "TargetTrackingScaling",
        resourceId: props.scalingTarget.resourceId,
        scalableDimension: props.scalingTarget.scalableDimension,
        serviceNamespace: props.scalingTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          customizedMetricSpecification: renderCustomMetric(props.customMetric),
          disableScaleIn: props.disableScaleIn,
          predefinedMetricSpecification:
            predefinedMetricValue !== undefined
              ? {
                  predefinedMetricType: predefinedMetricValue,
                  resourceLabel: props.resourceLabel,
                }
              : undefined,
          scaleInCooldown: props.scaleInCooldown?.toSeconds(),
          scaleOutCooldown: props.scaleOutCooldown?.toSeconds(),
          targetValue: props.targetValue,
        },
      },
    );

    this.scalingPolicyArn = this.resource.arn;
  }
}

function renderCustomMetric(
  metric?: cloudwatch.IMetric,
):
  | appautoscalingPolicy.AppautoscalingPolicyTargetTrackingScalingPolicyConfigurationCustomizedMetricSpecification
  | undefined {
  if (!metric) {
    return undefined;
  }
  const metricConfig = metric.toMetricConfig();

  // Target tracking only supports metrics with a single metric stat
  if (!metricConfig.metricStat) {
    // Assuming ValidationError is available, otherwise use standard Error
    throw new Error(
      "Target tracking custom metric must be a single metric stat.",
    );
  }
  const c = metricConfig.metricStat;

  if (c.statistic.startsWith("p")) {
    // Assuming ValidationError is available, otherwise use standard Error
    throw new Error(
      `Cannot use statistic '${c.statistic}' for Target Tracking: only 'Average', 'Minimum', 'Maximum', 'SampleCount', and 'Sum' are supported.`,
    );
  }

  const dimensions: appautoscalingPolicy.AppautoscalingPolicyTargetTrackingScalingPolicyConfigurationCustomizedMetricSpecificationDimensions[] =
    Object.entries(c.dimensions ?? {}).map(([name, value]) => ({
      name,
      value,
    }));

  return {
    dimensions,
    metricName: c.metricName,
    namespace: c.namespace,
    statistic: c.statistic,
    unit: c.unitFilter,
  };
}

/**
 * One of the predefined autoscaling metrics
 */
export enum PredefinedMetric {
  /**
   * Average percentage of instances in an AppStream fleet that are being used.
   */
  APPSTREAM_AVERAGE_CAPACITY_UTILIZATION = "AppStreamAverageCapacityUtilization",
  /**
   * Percentage of provisioned read capacity units utilized by a Keyspaces table.
   */
  CASSANDRA_READ_CAPACITY_UTILIZATION = "CassandraReadCapacityUtilization",
  /**
   * Percentage of provisioned write capacity units utilized by a Keyspaces table.
   */
  CASSANDRA_WRITE_CAPACITY_UTILIZATION = "CassandraWriteCapacityUtilization",
  /**
   * Percentage of provisioned inference units utilized by a Comprehend endpoint.
   */
  COMPREHEND_INFERENCE_UTILIZATION = "ComprehendInferenceUtilization",
  /**
   * Average CPU Utilization of read replica instances in a Neptune DB cluster.
   */
  NEPTURE_READER_AVERAGE_CPU_UTILIZATION = "NeptuneReaderAverageCPUUtilization",
  /**
   * Percentage of provisioned read capacity units consumed by a DynamoDB table.
   */
  DYNAMODB_READ_CAPACITY_UTILIZATION = "DynamoDBReadCapacityUtilization",
  /**
   * Percentage of provisioned write capacity units consumed by a DynamoDB table.
   *
   * Suffix `dummy` is necessary due to jsii bug (https://github.com/aws/jsii/issues/2782).
   * Duplicate values will be dropped, so this suffix is added as a workaround.
   * The value will be replaced when this enum is used.
   *
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  DYNAMODB_WRITE_CAPACITY_UTILIZATION = "DynamoDBWriteCapacityUtilization-dummy",
  /**
   * DYANMODB_WRITE_CAPACITY_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   * @deprecated use `PredefinedMetric.DYNAMODB_WRITE_CAPACITY_UTILIZATION`
   */
  DYANMODB_WRITE_CAPACITY_UTILIZATION = "DynamoDBWriteCapacityUtilization",
  /**
   * ALB_REQUEST_COUNT_PER_TARGET
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ALB_REQUEST_COUNT_PER_TARGET = "ALBRequestCountPerTarget",
  /**
   * RDS_READER_AVERAGE_CPU_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  RDS_READER_AVERAGE_CPU_UTILIZATION = "RDSReaderAverageCPUUtilization",
  /**
   * RDS_READER_AVERAGE_DATABASE_CONNECTIONS
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  RDS_READER_AVERAGE_DATABASE_CONNECTIONS = "RDSReaderAverageDatabaseConnections",
  /**
   * EC2_SPOT_FLEET_REQUEST_AVERAGE_CPU_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  EC2_SPOT_FLEET_REQUEST_AVERAGE_CPU_UTILIZATION = "EC2SpotFleetRequestAverageCPUUtilization",
  /**
   * EC2_SPOT_FLEET_REQUEST_AVERAGE_NETWORK_IN
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  EC2_SPOT_FLEET_REQUEST_AVERAGE_NETWORK_IN = "EC2SpotFleetRequestAverageNetworkIn",
  /**
   * EC2_SPOT_FLEET_REQUEST_AVERAGE_NETWORK_OUT
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  EC2_SPOT_FLEET_REQUEST_AVERAGE_NETWORK_OUT = "EC2SpotFleetRequestAverageNetworkOut",
  /**
   * SAGEMAKER_VARIANT_INVOCATIONS_PER_INSTANCE
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  SAGEMAKER_VARIANT_INVOCATIONS_PER_INSTANCE = "SageMakerVariantInvocationsPerInstance",
  /**
   * SAGEMAKER_VARIANT_PROVISIONED_CONCURRENCY_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  SAGEMAKER_VARIANT_PROVISIONED_CONCURRENCY_UTILIZATION = "SageMakerVariantProvisionedConcurrencyUtilization",
  /**
   * SAGEMAKER_INFERENCE_COMPONENT_INVOCATIONS_PER_COPY
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  SAGEMAKER_INFERENCE_COMPONENT_INVOCATIONS_PER_COPY = "SageMakerInferenceComponentInvocationsPerCopy",
  /**
   * ECS_SERVICE_AVERAGE_CPU_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ECS_SERVICE_AVERAGE_CPU_UTILIZATION = "ECSServiceAverageCPUUtilization",
  /**
   * ECS_SERVICE_AVERAGE_MEMORY_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ECS_SERVICE_AVERAGE_MEMORY_UTILIZATION = "ECSServiceAverageMemoryUtilization",
  /**
   * LAMBDA_PROVISIONED_CONCURRENCY_UTILIZATION
   * @see https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics.html#monitoring-metrics-concurrency
   */
  LAMBDA_PROVISIONED_CONCURRENCY_UTILIZATION = "LambdaProvisionedConcurrencyUtilization",
  /**
   * KAFKA_BROKER_STORAGE_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  KAFKA_BROKER_STORAGE_UTILIZATION = "KafkaBrokerStorageUtilization",
  /**
   * ELASTICACHE_PRIMARY_ENGINE_CPU_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ELASTICACHE_PRIMARY_ENGINE_CPU_UTILIZATION = "ElastiCachePrimaryEngineCPUUtilization",
  /**
   * ELASTICACHE_REPLICA_ENGINE_CPU_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ELASTICACHE_REPLICA_ENGINE_CPU_UTILIZATION = "ElastiCacheReplicaEngineCPUUtilization",
  /**
   * ELASTICACHE_DATABASE_MEMORY_USAGE_COUNTED_FOR_EVICT_PERCENTAGE
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ELASTICACHE_DATABASE_MEMORY_USAGE_COUNTED_FOR_EVICT_PERCENTAGE = "ElastiCacheDatabaseMemoryUsageCountedForEvictPercentage",
  /**
   * ELASTICACHE_DATABASE_CAPACITY_USAGE_COUNTED_FOR_EVICT_PERCENTAGE
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  ELASTICACHE_DATABASE_CAPACITY_USAGE_COUNTED_FOR_EVICT_PERCENTAGE = "ElastiCacheDatabaseCapacityUsageCountedForEvictPercentage",
  /**
   * SAGEMAKER_INFERENCE_COMPONENT_CONCURRENT_REQUESTS_PER_COPY_HIGH_RESOLUTION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  SAGEMAKER_INFERENCE_COMPONENT_CONCURRENT_REQUESTS_PER_COPY_HIGH_RESOLUTION = "SageMakerInferenceComponentConcurrentRequestsPerCopyHighResolution",
  /**
   * SAGEMAKER_VARIANT_CONCURRENT_REQUESTS_PER_MODEL_HIGH_RESOLUTION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  SAGEMAKER_VARIANT_CONCURRENT_REQUESTS_PER_MODEL_HIGH_RESOLUTION = "SageMakerVariantConcurrentRequestsPerModelHighResolution",
  /**
   * WORKSPACES_AVERAGE_USER_SESSIONS_CAPACITY_UTILIZATION
   * @see https://docs.aws.amazon.com/autoscaling/application/APIReference/API_PredefinedMetricSpecification.html
   */
  WORKSPACES_AVERAGE_USER_SESSIONS_CAPACITY_UTILIZATION = "WorkSpacesAverageUserSessionsCapacityUtilization",
}
