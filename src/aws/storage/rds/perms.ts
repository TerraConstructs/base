// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/perms.ts

// minimal set of permissions based on https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html#data-api.access
export const DATA_API_ACTIONS = [
  "rds-data:BatchExecuteStatement",
  "rds-data:BeginTransaction",
  "rds-data:CommitTransaction",
  "rds-data:ExecuteStatement",
  "rds-data:RollbackTransaction",
];
