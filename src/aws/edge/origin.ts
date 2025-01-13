// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-cloudfront/lib/origin.ts

import { cloudfrontDistribution } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Duration } from "../../";
import { IBucket } from "../storage";

//TODO: Add support for failover configuration used for Origin Groups

/**
 * Represents the concept of a CloudFront Origin.
 * You provide one or more origins when creating a Distribution.
 */
export interface IOrigin {
  /**
   * The method called when a given Origin is added
   * (for the first time) to a Distribution.
   */
  render(id: string): cloudfrontDistribution.CloudfrontDistributionOrigin;
}

/**
 * Options to define an Origin.
 */
export interface OriginOptions {
  /**
   * The number of seconds that CloudFront waits when trying to establish a connection to the origin.
   * Valid values are 1-10 seconds, inclusive.
   *
   * @default Duration.seconds(10)
   */
  readonly connectionTimeout?: Duration;

  /**
   * The number of times that CloudFront attempts to connect to the origin; valid values are 1, 2, or 3 attempts.
   *
   * @default 3
   */
  readonly connectionAttempts?: number;

  /**
   * A list of HTTP header names and values that CloudFront adds to requests it sends to the origin.
   *
   * @default {}
   */
  readonly customHeaders?: Record<string, string>;
}

/**
 * Properties to define an Origin.
 */
export interface OriginProps extends OriginOptions {
  /**
   * An optional path that CloudFront appends to the origin domain name when CloudFront requests content from the origin.
   * Must begin, but not end, with '/' (e.g., '/production/images').
   *
   * @default '/'
   */
  readonly originPath?: string;
}

/**
 * Defines what protocols CloudFront will use to connect to an origin.
 */
export enum OriginProtocolPolicy {
  /** Connect on HTTP only */
  HTTP_ONLY = "http-only",
  /** Connect with the same protocol as the viewer */
  MATCH_VIEWER = "match-viewer",
  /** Connect on HTTPS only */
  HTTPS_ONLY = "https-only",
}

export enum OriginSslPolicy {
  SSL_V3 = "SSLv3",
  TLS_V1 = "TLSv1",
  TLS_V1_1 = "TLSv1.1",
  TLS_V1_2 = "TLSv1.2",
}

/**
 * Represents a distribution origin, that describes the Amazon S3 bucket, HTTP server (for example, a web server),
 * Amazon MediaStore, or other server from which CloudFront gets your files.
 */
export abstract class OriginBase implements IOrigin {
  private readonly domainName: string;
  private readonly originPath?: string;
  private readonly connectionTimeout?: Duration;
  private readonly connectionAttempts?: number;
  private readonly customHeaders?: Record<string, string>;
  protected constructor(domainName: string, props: OriginProps = {}) {
    validateIntInRangeOrUndefined(
      "connectionTimeout",
      1,
      10,
      props.connectionTimeout?.toSeconds(),
    );
    validateIntInRangeOrUndefined(
      "connectionAttempts",
      1,
      3,
      props.connectionAttempts,
      false,
    );
    validateCustomHeaders(props.customHeaders);

    this.domainName = domainName;
    this.originPath = this.validateOriginPath(props.originPath);
    this.connectionTimeout = props.connectionTimeout;
    this.connectionAttempts = props.connectionAttempts;
    this.customHeaders = props.customHeaders;
  }

  /**
   * Called internally by the Distribution to render the origin.
   */
  public render(
    originId: string,
  ): cloudfrontDistribution.CloudfrontDistributionOrigin {
    const s3OriginConfig = this.renderS3OriginConfig();
    const customOriginConfig = this.renderCustomOriginConfig();

    if (!s3OriginConfig && !customOriginConfig) {
      throw new Error(
        "Subclass must override and provide either s3OriginConfig or customOriginConfig",
      );
    }

    return {
      originId,
      domainName: this.domainName,
      originPath: this.originPath,
      connectionAttempts: this.connectionAttempts,
      connectionTimeout: this.connectionTimeout?.toSeconds(),
      customHeader: this.renderCustomHeaders(),
      s3OriginConfig,
      customOriginConfig,
    };
  }

  // Overridden by sub-classes to provide S3 origin config.
  protected renderS3OriginConfig():
    | cloudfrontDistribution.CloudfrontDistributionOriginS3OriginConfig
    | undefined {
    return undefined;
  }

  // Overridden by sub-classes to provide custom origin config.
  protected renderCustomOriginConfig():
    | cloudfrontDistribution.CloudfrontDistributionOriginCustomOriginConfig
    | undefined {
    return undefined;
  }

  private renderCustomHeaders():
    | cloudfrontDistribution.CloudfrontDistributionOriginCustomHeader[]
    | undefined {
    if (
      !this.customHeaders ||
      Object.entries(this.customHeaders).length === 0
    ) {
      return undefined;
    }
    return Object.entries(this.customHeaders).map(([name, value]) => {
      return { name, value };
    });
  }

  /**
   * If the path is defined, it must start with a '/' and not end with a '/'.
   * This method takes in the originPath, and returns it back (if undefined) or adds/removes the '/' as appropriate.
   */
  private validateOriginPath(originPath?: string): string | undefined {
    if (Token.isUnresolved(originPath)) {
      return originPath;
    }
    if (originPath === undefined) {
      return undefined;
    }
    let path = originPath;
    if (!path.startsWith("/")) {
      path = "/" + path;
    }
    if (path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    return path;
  }
}

/**
 * Throws an error if a value is defined and not an integer or not in a range.
 */
function validateIntInRangeOrUndefined(
  name: string,
  min: number,
  max: number,
  value?: number,
  isDuration: boolean = true,
) {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    const seconds = isDuration ? " seconds" : "";
    throw new Error(
      `${name}: Must be an int between ${min} and ${max}${seconds} (inclusive); received ${value}.`,
    );
  }
}

/**
 * Throws an error if custom header assignment is prohibited by CloudFront.
 * @link: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html#add-origin-custom-headers-denylist
 */
function validateCustomHeaders(customHeaders?: Record<string, string>) {
  if (!customHeaders || Object.entries(customHeaders).length === 0) {
    return;
  }
  const customHeaderKeys = Object.keys(customHeaders);
  const prohibitedHeaderKeys = [
    "Cache-Control",
    "Connection",
    "Content-Length",
    "Cookie",
    "Host",
    "If-Match",
    "If-Modified-Since",
    "If-None-Match",
    "If-Range",
    "If-Unmodified-Since",
    "Max-Forwards",
    "Pragma",
    "Proxy-Authorization",
    "Proxy-Connection",
    "Range",
    "Request-Range",
    "TE",
    "Trailer",
    "Transfer-Encoding",
    "Upgrade",
    "Via",
    "X-Real-Ip",
  ];
  const prohibitedHeaderKeyPrefixes = ["X-Amz-", "X-Edge-"];

  const prohibitedHeadersKeysMatches = customHeaderKeys.filter((customKey) => {
    return prohibitedHeaderKeys
      .map((prohibitedKey) => prohibitedKey.toLowerCase())
      .includes(customKey.toLowerCase());
  });
  const prohibitedHeaderPrefixMatches = customHeaderKeys.filter((customKey) => {
    return prohibitedHeaderKeyPrefixes.some((prohibitedKeyPrefix) =>
      customKey.toLowerCase().startsWith(prohibitedKeyPrefix.toLowerCase()),
    );
  });

  if (prohibitedHeadersKeysMatches.length !== 0) {
    throw new Error(
      `The following headers cannot be configured as custom origin headers: ${prohibitedHeadersKeysMatches.join(", ")}`,
    );
  }
  if (prohibitedHeaderPrefixMatches.length !== 0) {
    throw new Error(
      `The following headers cannot be used as prefixes for custom origin headers: ${prohibitedHeaderPrefixMatches.join(", ")}`,
    );
  }
}

// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-cloudfront-origins/lib/s3-origin.ts

/**
 * An Origin that is backed by an S3 bucket.
 *
 * If the bucket is configured for website hosting, this origin will be configured to use the bucket as an
 * HTTP server origin and will use the bucket's configured website redirects and error handling. Otherwise,
 * the origin is created as a bucket origin and will use CloudFront's redirect and error handling.
 */
export class S3Origin implements IOrigin {
  private readonly origin: IOrigin;

  constructor(bucket: IBucket, props: OriginProps = {}) {
    this.origin = bucket.isWebsite()
      ? new HttpOrigin(bucket.bucketOutputs.websiteUrl, {
          protocolPolicy: OriginProtocolPolicy.HTTP_ONLY, // S3 only supports HTTP for website buckets
          ...props,
        })
      : new S3BucketOrigin(bucket, props);
  }

  public render(
    originId: string,
  ): cloudfrontDistribution.CloudfrontDistributionOrigin {
    return this.origin.render(originId);
  }
}

/**
 * An Origin specific to a S3 bucket (not configured for website hosting).
 *
 * Contains additional logic around bucket permissions and origin access identities.
 */
class S3BucketOrigin extends OriginBase {
  constructor(
    private readonly bucket: IBucket,
    props: OriginProps,
  ) {
    super(bucket.bucketOutputs.regionalDomainName, props);
    if (!this.bucket.bucketOutputs.originAccessIdentity) {
      throw new Error(
        "The bucket must have an origin access identity to be used as a CloudFront origin.",
      );
    }
  }

  protected renderS3OriginConfig():
    | cloudfrontDistribution.CloudfrontDistributionOriginS3OriginConfig
    | undefined {
    return {
      // constructor throws if undefined, so this is safe?
      originAccessIdentity: this.bucket.bucketOutputs.originAccessIdentity!,
    };
  }
}

/**
 * Properties for an Origin backed by an S3 website-configured bucket, load balancer, or custom HTTP server.
 */
export interface HttpOriginProps extends OriginProps {
  /**
   * Specifies the protocol (HTTP or HTTPS) that CloudFront uses to connect to the origin.
   *
   * @default OriginProtocolPolicy.HTTPS_ONLY
   */
  readonly protocolPolicy?: OriginProtocolPolicy;

  /**
   * The SSL versions to use when interacting with the origin.
   *
   * @default OriginSslPolicy.TLS_V1_2
   */
  readonly originSslProtocols?: OriginSslPolicy[];

  /**
   * The HTTP port that CloudFront uses to connect to the origin.
   *
   * @default 80
   */
  readonly httpPort?: number;

  /**
   * The HTTPS port that CloudFront uses to connect to the origin.
   *
   * @default 443
   */
  readonly httpsPort?: number;

  /**
   * Specifies how long, in seconds, CloudFront waits for a response from the origin, also known as the origin response timeout.
   * The valid range is from 1 to 180 seconds, inclusive.
   *
   * Note that values over 60 seconds are possible only after a limit increase request for the origin response timeout quota
   * has been approved in the target account; otherwise, values over 60 seconds will produce an error at deploy time.
   *
   * @default Duration.seconds(30)
   */
  readonly readTimeout?: Duration;

  /**
   * Specifies how long, in seconds, CloudFront persists its connection to the origin.
   * The valid range is from 1 to 180 seconds, inclusive.
   *
   * Note that values over 60 seconds are possible only after a limit increase request for the origin response timeout quota
   * has been approved in the target account; otherwise, values over 60 seconds will produce an error at deploy time.
   *
   * @default Duration.seconds(5)
   */
  readonly keepaliveTimeout?: Duration;
}

/**
 * An Origin for an HTTP server or S3 bucket configured for website hosting.
 */
export class HttpOrigin extends OriginBase {
  constructor(
    domainName: string,
    private readonly props: HttpOriginProps = {},
  ) {
    super(domainName, props);

    validateSecondsInRangeOrUndefined("readTimeout", 1, 180, props.readTimeout);
    validateSecondsInRangeOrUndefined(
      "keepaliveTimeout",
      1,
      180,
      props.keepaliveTimeout,
    );
  }

  protected renderCustomOriginConfig():
    | cloudfrontDistribution.CloudfrontDistributionOriginCustomOriginConfig
    | undefined {
    return {
      originSslProtocols: this.props.originSslProtocols ?? [
        OriginSslPolicy.TLS_V1_2,
      ],
      originProtocolPolicy:
        this.props.protocolPolicy ?? OriginProtocolPolicy.HTTPS_ONLY,
      httpPort: this.props.httpPort ?? 80,
      httpsPort: this.props.httpsPort ?? 443,
      originReadTimeout: this.props.readTimeout?.toSeconds(),
      originKeepaliveTimeout: this.props.keepaliveTimeout?.toSeconds(),
    };
  }
}

/**
 * Throws an error if a duration is defined and not an integer number of seconds within a range.
 */
function validateSecondsInRangeOrUndefined(
  name: string,
  min: number,
  max: number,
  duration?: Duration,
) {
  if (duration === undefined) {
    return;
  }
  const value = duration.toSeconds();
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${name}: Must be an int between ${min} and ${max} seconds (inclusive); received ${value}.`,
    );
  }
}
