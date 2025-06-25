export const READ_DATA_ACTIONS = [
  "dynamodb:BatchGetItem",
  "dynamodb:GetRecords",
  "dynamodb:GetShardIterator",
  "dynamodb:Query",
  "dynamodb:GetItem",
  "dynamodb:Scan",
  "dynamodb:ConditionCheckItem",
];

// Table-safe actions that can be used in DynamoDB resource policies
// Excludes stream-specific actions that are not valid for table resource policies
export const READ_DATA_ACTIONS_TABLE_SAFE = [
  "dynamodb:BatchGetItem",
  "dynamodb:Query",
  "dynamodb:GetItem",
  "dynamodb:Scan",
  "dynamodb:ConditionCheckItem",
];

// Stream-specific actions that should only be used with stream ARNs
export const READ_DATA_ACTIONS_STREAM_ONLY = [
  "dynamodb:GetRecords",
  "dynamodb:GetShardIterator",
];

export const KEY_READ_ACTIONS = ["kms:Decrypt", "kms:DescribeKey"];

export const WRITE_DATA_ACTIONS = [
  "dynamodb:BatchWriteItem",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
];
export const KEY_WRITE_ACTIONS = [
  "kms:Encrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
];

export const READ_STREAM_DATA_ACTIONS = [
  "dynamodb:DescribeStream",
  "dynamodb:GetRecords",
  "dynamodb:GetShardIterator",
];

export const DESCRIBE_TABLE = "dynamodb:DescribeTable";
