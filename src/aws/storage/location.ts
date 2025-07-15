// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-s3/lib/location.ts

/**
 * An interface that represents the location of a specific object in an S3 Bucket.
 */
export interface S3Location {
  /**
   * The name of the S3 Bucket the object is in.
   */
  readonly bucketName: string;

  /**
   * The path inside the Bucket where the object is located at.
   */
  readonly objectKey: string;

  /**
   * The S3 object version.
   */
  readonly objectVersion?: string;
}
