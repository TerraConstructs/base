// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/validate-database-insights.ts

import type { Construct } from "constructs";
import type { DatabaseClusterProps } from "./cluster";
import {
  DBClusterStorageType,
  ClusterScailabilityType,
  ClusterScalabilityType,
  DatabaseCluster,
} from "./cluster";
import { DatabaseInsightsMode } from "./database-insights-mode";
import type { DatabaseInstanceProps } from "./instance";
import { DatabaseInstance } from "./instance";
import { PerformanceInsightRetention } from "./props";
import type { ValidationRule } from "../../../helpers-internal";
import { validateAllProps } from "../../../helpers-internal";

// Common validation rules for database insights
const databaseInsightsRules: ValidationRule<any>[] = [
  {
    condition: (props) =>
      props.enablePerformanceInsights === false &&
      (props.performanceInsightRetention !== undefined ||
        props.performanceInsightEncryptionKey !== undefined ||
        props.databaseInsightsMode === DatabaseInsightsMode.ADVANCED),
    message: () =>
      "`enablePerformanceInsights` disabled, but `performanceInsightRetention` or `performanceInsightEncryptionKey` was set, or `databaseInsightsMode` was set to '${DatabaseInsightsMode.ADVANCED}'",
  },
  {
    condition: (props) =>
      props.databaseInsightsMode === DatabaseInsightsMode.ADVANCED &&
      props.performanceInsightRetention !==
        PerformanceInsightRetention.MONTHS_15,
    message: () =>
      "`performanceInsightRetention` must be set to '${PerformanceInsightRetention.MONTHS_15}' when `databaseInsightsMode` is set to '${DatabaseInsightsMode.ADVANCED}'",
  },
];

// Cluster-specific validation rules
const clusterSpecificRules: ValidationRule<DatabaseClusterProps>[] = [
  {
    condition: (props) =>
      props.replicationSourceIdentifier !== undefined &&
      props.credentials !== undefined,
    message: () =>
      "Cannot specify both `replicationSourceIdentifier` and `credentials`. The value is inherited from the source DB cluster",
  },
];

// Rules for Aurora Limitless database
const limitlessDatabaseRules: ValidationRule<DatabaseClusterProps>[] = [
  {
    condition: (props) => !props.enablePerformanceInsights,
    message: () =>
      "Performance Insights must be enabled for Aurora Limitless Database",
  },
  {
    condition: (props) =>
      !props.performanceInsightRetention ||
      props.performanceInsightRetention < PerformanceInsightRetention.MONTHS_1,
    message: () =>
      "Performance Insights retention period must be set to at least 31 days for Aurora Limitless Database",
  },
  {
    condition: (props) =>
      !props.monitoringInterval || !props.enableClusterLevelEnhancedMonitoring,
    message: () =>
      "Cluster level enhanced monitoring must be set for Aurora Limitless Database. Please set 'monitoringInterval' and enable 'enableClusterLevelEnhancedMonitoring'",
  },
  {
    condition: (props) => !!(props.writer || props.readers),
    message: () =>
      "Aurora Limitless Database does not support reader or writer instances",
  },
  {
    condition: (props) =>
      !props.engine.engineVersion?.fullVersion?.endsWith("limitless"),
    message: (props) =>
      `Aurora Limitless Database requires an engine version that supports it, got: ${props.engine.engineVersion?.fullVersion}`,
  },
  {
    condition: (props) =>
      props.storageType !== DBClusterStorageType.AURORA_IOPT1,
    message: (props) =>
      `Aurora Limitless Database requires I/O optimized storage type, got: ${props.storageType}`,
  },
  {
    condition: (props) =>
      props.cloudwatchLogsExports === undefined ||
      props.cloudwatchLogsExports.length === 0,
    message: () =>
      "Aurora Limitless Database requires CloudWatch Logs exports to be set",
  },
];

// Validates database instance properties
export function validateDatabaseInstanceProps(
  scope: Construct,
  props: DatabaseInstanceProps,
): void {
  validateAllProps(
    scope,
    DatabaseInstance.name,
    props,
    databaseInsightsRules as ValidationRule<DatabaseInstanceProps>[],
  );
}

// Validates database cluster properties
export function validateDatabaseClusterProps(
  scope: Construct,
  props: DatabaseClusterProps,
): void {
  // TERRACONSTRUCTS DEVIATION: upstream (v2.263.0 validate-database-insights.ts:86) only inspects
  // the deprecated `clusterScailabilityType`, so a correctly-spelled `clusterScalabilityType:
  // LIMITLESS` skips the limitless rule set entirely there — an apparent upstream oversight given
  // `cluster.ts` accepts EITHER spelling when materializing the single `clusterScalabilityType` L1
  // argument (`props.clusterScalabilityType ?? props.clusterScailabilityType`, see
  // `newClusterProps.clusterScalabilityType` in `./cluster.ts`). Both spellings are honored here so
  // the limitless validation rules apply regardless of which one the caller used.
  const isLimitlessCluster =
    props.clusterScalabilityType === ClusterScalabilityType.LIMITLESS ||
    props.clusterScailabilityType === ClusterScailabilityType.LIMITLESS;
  const applicableRules = isLimitlessCluster
    ? [
        ...(databaseInsightsRules as ValidationRule<DatabaseClusterProps>[]),
        ...clusterSpecificRules,
        ...limitlessDatabaseRules,
      ]
    : [
        ...(databaseInsightsRules as ValidationRule<DatabaseClusterProps>[]),
        ...clusterSpecificRules,
      ];

  validateAllProps(scope, DatabaseCluster.name, props, applicableRules);
}
