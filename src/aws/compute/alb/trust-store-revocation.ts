// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/alb/trust-store-revocation.ts

import { lbTrustStoreRevocation as tfTrustStoreRevocation } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { ITrustStore } from "./trust-store";
import { AwsConstructBase } from "../../aws-construct";
import { IBucket } from "../../storage";

/**
 * Properties for the trust store revocation
 */
export interface TrustStoreRevocationProps {
  /**
   * The trust store
   */
  readonly trustStore: ITrustStore;

  /**
   * The revocation file to add
   */
  readonly revocationContents: RevocationContent[];
}

/**
 * Information about a revocation file
 */
export interface RevocationContent {
  /**
   * The type of revocation file
   *
   * @default RevocationType.CRL
   */
  readonly revocationType?: RevocationType;

  /**
   * The Amazon S3 bucket for the revocation file
   */
  readonly bucket: IBucket;

  /**
   * The Amazon S3 path for the revocation file
   */
  readonly key: string;

  /**
   * The Amazon S3 object version of the revocation file
   *
   * @default - latest version
   */
  readonly version?: string;
}

/**
 * The type of revocation file
 */
export enum RevocationType {
  /**
   * A signed list of revoked certificates
   */
  CRL = "CRL", // Only supported value
}

/**
 * A new Trust Store Revocation
 */
export class TrustStoreRevocation extends AwsConstructBase {
  public get outputs(): Record<string, any> {
    return {
      revocationIds: this.revocations.map((r) => r.revocationId),
    };
  }
  private readonly revocations =
    new Array<tfTrustStoreRevocation.LbTrustStoreRevocation>();
  constructor(scope: Construct, id: string, props: TrustStoreRevocationProps) {
    super(scope, id);
    props.revocationContents?.map((content) => {
      this.revocations.push(
        new tfTrustStoreRevocation.LbTrustStoreRevocation(this, "Resource", {
          trustStoreArn: props.trustStore.trustStoreArn,
          // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-truststorerevocation-revocationcontent.html
          // revocationType: content.revocationType,
          revocationsS3Bucket: content.bucket.bucketName,
          revocationsS3Key: content.key,
          revocationsS3ObjectVersion: content.version,
        }),
      );
    });
  }
}
