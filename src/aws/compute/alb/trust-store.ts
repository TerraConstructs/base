// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/alb/trust-store.ts

import { lbTrustStore as tfTrustStore } from "@cdktf/provider-aws";
import { Fn, Token } from "cdktf";
import { Construct } from "constructs";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../../aws-construct";
import { AwsStack } from "../../aws-stack";
import { IBucket } from "../../storage";

/**
 * Represents a Trust Store
 */
export interface ITrustStore extends IAwsConstruct {
  /**
   * The name of the trust store
   * @attribute
   */
  readonly trustStoreName: string;

  /**
   * The ARN of the trust store
   * @attribute
   */
  readonly trustStoreArn: string;
}

/**
 * Properties used for the Trust Store
 */
export interface TrustStoreProps extends AwsConstructProps {
  /**
   * The name of the trust store
   *
   * @default - Auto generated
   */
  readonly trustStoreName?: string;

  /**
   * The bucket that the trust store is hosted in
   */
  readonly bucket: IBucket;

  /**
   * The key in S3 to look at for the trust store
   */
  readonly key: string;

  /**
   * The version of the S3 object that contains your truststore.
   * To specify a version, you must have versioning enabled for the S3 bucket.
   *
   * @default - latest version
   */
  readonly version?: string;
}

/**
 * A new Trust Store
 */
export class TrustStore extends AwsConstructBase implements ITrustStore {
  /**
   * Import from ARN
   */
  public static fromTrustStoreArn(
    scope: Construct,
    id: string,
    trustStoreArn: string,
  ): ITrustStore {
    const resourceParts = Fn.split("/", trustStoreArn);

    const trustStoreName = Fn.element(resourceParts, 0);

    class Import extends AwsConstructBase implements ITrustStore {
      public readonly trustStoreArn = trustStoreArn;
      public readonly trustStoreName = trustStoreName;
    }
    return new Import(scope, id);
  }

  /**
   * The name of the trust store
   *
   * @attribute
   */
  public readonly trustStoreName: string;

  // TODO: provider-aws doesn't have numberOfCaCertificates?
  // /**
  //  * The number of CA certificates in the trust store
  //  *
  //  * @attribute
  //  */
  // public readonly numberOfCaCertificates: number;

  // TODO: provider-aws doesn't have status?
  // /**
  //  * The status of the trust store
  //  *
  //  * @attribute
  //  */
  // public readonly status: string;

  /**
   * The ARN of the trust store
   *
   * @attribute
   */
  public readonly trustStoreArn: string;
  private physicalName: string;

  constructor(scope: Construct, id: string, props: TrustStoreProps) {
    super(scope, id, props);
    this.physicalName =
      props.trustStoreName ??
      AwsStack.uniqueResourceName(this, { maxLength: 32 });

    if (
      props.trustStoreName !== undefined &&
      !Token.isUnresolved(props.trustStoreName)
    ) {
      if (props.trustStoreName.length < 1 || props.trustStoreName.length > 32) {
        throw new Error(
          `trustStoreName '${props.trustStoreName}' must be 1-32 characters long.`,
        );
      }
      const validNameRegex = /^([a-zA-Z0-9]+-)*[a-zA-Z0-9]+$/;
      if (!validNameRegex.test(props.trustStoreName)) {
        throw new Error(
          `trustStoreName '${props.trustStoreName}' must contain only alphanumeric characters and hyphens, and cannot begin or end with a hyphen.`,
        );
      }
    }

    const resource = new tfTrustStore.LbTrustStore(this, "Resource", {
      name: this.physicalName,
      caCertificatesBundleS3Bucket: props.bucket.bucketName,
      caCertificatesBundleS3Key: props.key,
      caCertificatesBundleS3ObjectVersion: props.version,
    });

    this.trustStoreName = resource.name;
    this.trustStoreArn = resource.arn;
    // TODO: provider-aws doesn't have numberOfCaCertificates?
    // this.numberOfCaCertificates = resource.numberOfCaCertificates;
    // TODO: provider-aws doesn't have status?
    // this.status = resource.status;
  }
}
