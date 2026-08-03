// Canned metrics for the `ECS/ContainerInsights` namespace.
//
// Hand-written, following the same pattern as
// src/aws/notify/kinesis-fixed-canned-metrics.ts: the generated canned metrics do not
// cover what the service actually emits.
//
// The generator (https://github.com/cdklabs/awscdk-service-spec/blob/main/sources/CloudWatchConsoleServiceDirectory)
// maps one namespace per CloudFormation service, so `ECSMetrics` in
// ecs-canned-metrics.generated.ts only ever emits the `AWS/ECS` namespace. Container
// Insights has no CloudFormation resource behind it and is therefore never emitted —
// aws-cdk has the same gap.
//
// Container Insights metrics reference:
// https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Container-Insights-metrics-ECS.html
import { MetricWithDims } from "./ecs-canned-metrics.generated";

/**
 * Canned metrics for the `ECS/ContainerInsights` namespace.
 *
 * These complement `ECSMetrics`, which only covers `AWS/ECS`. The two namespaces are not
 * interchangeable: `AWS/ECS` reports utilization as a *percentage of the task's
 * reservation*, whereas Container Insights reports absolute CPU units and MiB. Only the
 * latter can be compared against a container's hard memory limit, which is what you need
 * to detect a container approaching an OOM kill.
 *
 * Requires Container Insights to be enabled on the cluster.
 */
export class ContainerInsightsMetrics {
  /**
   * Memory used by the service's tasks, in MiB.
   */
  public static memoryUtilizedMaximum(dimensions: {
    ClusterName: string;
    ServiceName: string;
  }): MetricWithDims<{ ClusterName: string; ServiceName: string }>;
  public static memoryUtilizedMaximum(dimensions: {
    ClusterName: string;
  }): MetricWithDims<{ ClusterName: string }>;
  public static memoryUtilizedMaximum(dimensions: any): MetricWithDims<any> {
    return {
      namespace: "ECS/ContainerInsights",
      metricName: "MemoryUtilized",
      dimensionsMap: dimensions,
      statistic: "Maximum",
    };
  }

  /**
   * Memory reserved by the service's tasks, in MiB.
   */
  public static memoryReservedMaximum(dimensions: {
    ClusterName: string;
    ServiceName: string;
  }): MetricWithDims<{ ClusterName: string; ServiceName: string }>;
  public static memoryReservedMaximum(dimensions: {
    ClusterName: string;
  }): MetricWithDims<{ ClusterName: string }>;
  public static memoryReservedMaximum(dimensions: any): MetricWithDims<any> {
    return {
      namespace: "ECS/ContainerInsights",
      metricName: "MemoryReserved",
      dimensionsMap: dimensions,
      statistic: "Maximum",
    };
  }

  /**
   * CPU units used by the service's tasks.
   */
  public static cpuUtilizedMaximum(dimensions: {
    ClusterName: string;
    ServiceName: string;
  }): MetricWithDims<{ ClusterName: string; ServiceName: string }>;
  public static cpuUtilizedMaximum(dimensions: {
    ClusterName: string;
  }): MetricWithDims<{ ClusterName: string }>;
  public static cpuUtilizedMaximum(dimensions: any): MetricWithDims<any> {
    return {
      namespace: "ECS/ContainerInsights",
      metricName: "CpuUtilized",
      dimensionsMap: dimensions,
      statistic: "Maximum",
    };
  }

  /**
   * CPU units reserved by the service's tasks.
   */
  public static cpuReservedMaximum(dimensions: {
    ClusterName: string;
    ServiceName: string;
  }): MetricWithDims<{ ClusterName: string; ServiceName: string }>;
  public static cpuReservedMaximum(dimensions: {
    ClusterName: string;
  }): MetricWithDims<{ ClusterName: string }>;
  public static cpuReservedMaximum(dimensions: any): MetricWithDims<any> {
    return {
      namespace: "ECS/ContainerInsights",
      metricName: "CpuReserved",
      dimensionsMap: dimensions,
      statistic: "Maximum",
    };
  }

  /**
   * Number of tasks running for the service.
   */
  public static runningTaskCountAverage(dimensions: {
    ClusterName: string;
    ServiceName: string;
  }): MetricWithDims<{ ClusterName: string; ServiceName: string }>;
  public static runningTaskCountAverage(dimensions: {
    ClusterName: string;
  }): MetricWithDims<{ ClusterName: string }>;
  public static runningTaskCountAverage(dimensions: any): MetricWithDims<any> {
    return {
      namespace: "ECS/ContainerInsights",
      metricName: "RunningTaskCount",
      dimensionsMap: dimensions,
      statistic: "Average",
    };
  }
}
