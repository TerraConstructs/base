/* eslint-disable @stylistic/max-len, eol-last */
export interface MetricWithDims<D> {
  readonly namespace: string;

  readonly metricName: string;

  readonly statistic: string;

  readonly dimensionsMap: D;
}

export class RDSMetrics {
  public static cpuUtilizationAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static cpuUtilizationAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static cpuUtilizationAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "CPUUtilization",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static readLatencyAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static readLatencyAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static readLatencyAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "ReadLatency",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static databaseConnectionsSum(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static databaseConnectionsSum(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static databaseConnectionsSum(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "DatabaseConnections",
      dimensionsMap: dimensions,
      statistic: "Sum"
    };
  }

  public static freeStorageSpaceAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static freeStorageSpaceAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static freeStorageSpaceAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "FreeStorageSpace",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static freeableMemoryAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static freeableMemoryAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static freeableMemoryAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "FreeableMemory",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static readThroughputAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static readThroughputAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static readThroughputAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "ReadThroughput",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static readIopsAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static readIopsAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static readIopsAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "ReadIOPS",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static writeLatencyAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static writeLatencyAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static writeLatencyAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "WriteLatency",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static writeThroughputAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static writeThroughputAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static writeThroughputAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "WriteThroughput",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static writeIopsAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }>;

  public static writeIopsAverage(this: void, dimensions: { DBClusterIdentifier: string; }): MetricWithDims<{ DBClusterIdentifier: string; }>;

  public static writeIopsAverage(this: void, dimensions: any): MetricWithDims<any> {
    return {
      namespace: "AWS/RDS",
      metricName: "WriteIOPS",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }

  public static serverlessDatabaseCapacityAverage(this: void, dimensions: { DBInstanceIdentifier: string; }): MetricWithDims<{ DBInstanceIdentifier: string; }> {
    return {
      namespace: "AWS/RDS",
      metricName: "ServerlessDatabaseCapacity",
      dimensionsMap: dimensions,
      statistic: "Average"
    };
  }
}