// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/database-insights-mode.ts

/**
 * The database insights mode.
 */
export enum DatabaseInsightsMode {
  /**
   * Standard mode.
   */
  STANDARD = "standard",

  /**
   * Advanced mode.
   */
  ADVANCED = "advanced",
}
