// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/test/test-utils.ts

/**
 * If the given array is 1-length, return the element in it.
 * Useful for IAM policies/actions
 */
export const singletonOrArr = (array: string[]) =>
  array.length === 1 ? array[0] : array;
