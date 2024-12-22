// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-kms/lib/private/perms.ts

// https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html

export const ADMIN_ACTIONS = [
  "kms:Create*",
  "kms:Describe*",
  "kms:Enable*",
  "kms:List*",
  "kms:Put*",
  "kms:Update*",
  "kms:Revoke*",
  "kms:Disable*",
  "kms:Get*",
  "kms:Delete*",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:ScheduleKeyDeletion",
  "kms:CancelKeyDeletion",
];

export const ENCRYPT_ACTIONS = [
  "kms:Encrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
];

export const DECRYPT_ACTIONS = ["kms:Decrypt"];

export const GENERATE_HMAC_ACTIONS = ["kms:GenerateMac"];

export const VERIFY_HMAC_ACTIONS = ["kms:VerifyMac"];
