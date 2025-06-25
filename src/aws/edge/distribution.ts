// https://github.com/aws/aws-cdk/blob/64a0e2cf5bb07f6debfc4b169bb3e1852ce668aa/packages/aws-cdk-lib/aws-cloudfront/lib/distribution.ts
import {
  cloudfrontDistribution,
  dataAwsCloudfrontCachePolicy,
  dataAwsCloudfrontOriginRequestPolicy,
  dataAwsCloudfrontResponseHeadersPolicy,
} from "@cdktf/provider-aws";
import { IResolvable, Token, Lazy } from "cdktf";
import { Construct } from "constructs";
import { ICertificate, IOrigin, FunctionAssociation } from ".";
import { Duration } from "../../duration";
import { ArnFormat } from "../arn";
import {
  AwsConstructBase,
  IAwsConstruct,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import {
  IResponseHeadersPolicy,
  ManagedResponseHeadersPolicy,
} from "./response-headers-policy";

// TODO: Re-add invalidation support
// TODO: Re-add origin group (failover) support
// TODO: Re-add key group support
// TODO: Re-add WAF support
// TODO: Re-add logging support
// TODO: Re-add custom cache, originRequest policy support?

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface DistributionOutputs {
  /**
   * Identifier for the distribution. For example: `EDFDVBD632BHDS5`.
   */
  readonly id: string;

  /**
   * CloudFront Route 53 zone ID that can be used to
   * route an Alias Resource Record Set to.
   *
   * This attribute is simply an alias for the zone ID
   */
  readonly hostedZoneId: string;

  /**
   * Current status of the distribution.
   *
   * `Deployed` if the distribution's information is fully propagated
   * throughout the Amazon CloudFront system.
   */
  readonly status: string;

  /**
   * ARN for the distribution
   */
  readonly arn: string;

  /**
   * Domain name corresponding to the distribution.
   *
   * For example: `d604721fxaaqy9.cloudfront.net`
   */
  readonly domainName: string;
}

/**
 * Imported or created DNS zone attributes
 */
export interface IDistribution extends IAwsConstruct {
  /** Strongly typed outputs
   *
   * @attribute
   */
  readonly distributionOutputs: DistributionOutputs;

  /**
   * Domain name corresponding to the distribution.
   *
   * @attribute
   * For example: `d604721fxaaqy9.cloudfront.net`
   */
  readonly domainName: string;

  /**
   * CloudFront Route 53 zone ID that can be used to
   * route an Alias Resource Record Set to.
   *
   * This attribute is simply an alias for the zone ID
   */
  readonly hostedZoneId: string;
}

/**
 * Properties for a Distribution
 */
export interface DistributionProps extends AwsConstructProps {
  /**
   * Extra CNAMEs (alternate domain names), if any, for this distribution.
   */
  readonly aliases?: string[];

  /**
   * Whether the distribution is enabled to accept end user requests for content.
   *
   * @default true
   */
  readonly enabled?: boolean | IResolvable;

  /**
   * If enabled, the resource will wait for the distribution status to change
   * from InProgress to Deployed.
   *
   * Setting this tofalse will skip the process.
   *
   * @default: true.
   */
  readonly waitForDeployment?: boolean;

  /**
   * The default behavior for the distribution.
   */
  readonly defaultBehavior: BehaviorOptions;

  /**
   * Additional behaviors for the distribution, mapped by the pathPattern that specifies which requests to apply the behavior to.
   *
   * @default - no additional behaviors are added.
   */
  readonly additionalBehaviors?: Record<string, BehaviorOptions>;

  /**
   * A certificate to associate with the distribution. The certificate must be located in N. Virginia (us-east-1).
   *
   * @default - the CloudFront wildcard certificate (*.cloudfront.net) will be used.
   */
  readonly certificate?: ICertificate;

  /**
   * Any comments you want to include about the distribution.
   *
   * @default - no comment
   */
  readonly comment?: string;

  /**
   * The object that you want CloudFront to request from your origin (for example, index.html)
   * when a viewer requests the root URL for your distribution. If no default object is set, the
   * request goes to the origin's root (e.g., example.com/).
   *
   * @default - no default root object
   */
  readonly defaultRootObject?: string;

  /**
   * Controls the countries in which your content is distributed.
   *
   * @default - No geographic restrictions
   */
  readonly geoRestriction?: GeoRestriction;

  /**
   * Specify the maximum HTTP version that you want viewers to use to communicate with CloudFront.
   *
   * For viewers and CloudFront to use HTTP/2, viewers must support TLS 1.2 or later, and must support server name identification (SNI).
   *
   * @default HttpVersion.HTTP2
   */
  readonly httpVersion?: HttpVersion;

  /**
   * The price class that corresponds with the maximum price that you want to pay for CloudFront service.
   * If you specify PriceClass_All, CloudFront responds to requests for your objects from all CloudFront edge locations.
   * If you specify a price class other than PriceClass_All, CloudFront serves your objects from the CloudFront edge location
   * that has the lowest latency among the edge locations in your price class.
   *
   * @default PriceClass.PRICE_CLASS_ALL
   */
  readonly priceClass?: PriceClass;

  /**
   * How CloudFront should handle requests that are not successful (e.g., PageNotFound).
   *
   * @default - No custom error responses.
   */
  readonly errorResponses?: ErrorResponse[];

  /**
   * The minimum version of the SSL protocol that you want CloudFront to use for HTTPS connections.
   *
   * CloudFront serves your objects only to browsers or devices that support at
   * least the SSL version that you specify.
   *
   * @default - SecurityPolicyProtocol.TLS_V1_2_2021.
   */
  readonly minimumProtocolVersion?: SecurityPolicyProtocol;

  /**
   * The SSL method CloudFront will use for your distribution.
   *
   * Server Name Indication (SNI) - is an extension to the TLS computer networking protocol by which a client indicates
   * which hostname it is attempting to connect to at the start of the handshaking process. This allows a server to present
   * multiple certificates on the same IP address and TCP port number and hence allows multiple secure (HTTPS) websites
   * (or any other service over TLS) to be served by the same IP address without requiring all those sites to use the same certificate.
   *
   * CloudFront can use SNI to host multiple distributions on the same IP - which a large majority of clients will support.
   *
   * If your clients cannot support SNI however - CloudFront can use dedicated IPs for your distribution - but there is a prorated monthly charge for
   * using this feature. By default, we use SNI - but you can optionally enable dedicated IPs (VIP).
   *
   * See the CloudFront SSL for more details about pricing : https://aws.amazon.com/cloudfront/custom-ssl-domains/
   *
   * @default SSLMethod.SNI
   */
  readonly sslSupportMethod?: SSLMethod;
}

/**
 * Amazon Cloudfront Distribution
 */
export class Distribution extends AwsConstructBase implements IDistribution {
  // TODO: Add static fromLookup?
  private readonly resource: cloudfrontDistribution.CloudfrontDistribution;

  private readonly _outputs: DistributionOutputs;
  public get distributionOutputs(): DistributionOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.distributionOutputs;
  }
  private readonly _domainName: string;
  public get domainName(): string {
    return this._domainName;
  }
  public readonly hostedZoneId: string;

  private readonly _origins = new Array<OriginIndex>();

  private readonly additionalBehaviors: CacheBehavior[] = [];

  private readonly errorResponses: ErrorResponse[];
  private readonly certificate?: ICertificate;

  constructor(scope: Construct, name: string, props: DistributionProps) {
    super(scope, name, props);

    if (props.certificate) {
      const certificateRegion = AwsStack.ofAwsConstruct(this).splitArn(
        props.certificate.certificateArn,
        ArnFormat.SLASH_RESOURCE_NAME,
      ).region;
      if (
        !Token.isUnresolved(certificateRegion) &&
        certificateRegion !== "us-east-1"
      ) {
        throw new Error(
          `Distribution certificates must be in the us-east-1 region and the certificate you provided is in ${certificateRegion}.`,
        );
      }
    }
    this.certificate = props.certificate;
    this.errorResponses = props.errorResponses ?? [];

    const defaultOriginId = this.addOrigin(props.defaultBehavior.origin);
    if (props.additionalBehaviors) {
      Object.entries(props.additionalBehaviors).forEach(
        ([pathPattern, behaviorOptions]) => {
          this.addBehavior(
            pathPattern,
            behaviorOptions.origin,
            behaviorOptions,
          );
        },
      );
    }

    // Comments have an undocumented limit of 128 characters
    const trimmedComment =
      props.comment && props.comment.length > 128
        ? `${props.comment.slice(0, 128 - 3)}...`
        : props.comment;

    this.resource = new cloudfrontDistribution.CloudfrontDistribution(
      this,
      "Resource",
      {
        enabled: props.enabled ?? true,
        origin: Lazy.anyValue({
          produce: () =>
            this._origins.map((o) =>
              // Lazy producers need additional xxxToTerraform wrap
              cloudfrontDistribution.cloudfrontDistributionOriginToTerraform(
                o.origin.render(o.id),
              ),
            ),
        }),
        defaultCacheBehavior: this._renderDefaultCacheBehavior({
          pathPattern: "*", // ignored for Default Cache Behavior
          targetOriginId: defaultOriginId,
          ...props.defaultBehavior,
        }),
        orderedCacheBehavior: Lazy.anyValue(
          {
            produce: () =>
              this.additionalBehaviors.map((b) =>
                // Lazy producers need additional xxxToTerraform wrap
                cloudfrontDistribution.cloudfrontDistributionOrderedCacheBehaviorToTerraform(
                  {
                    pathPattern: b.pathPattern,
                    ...this._renderDefaultCacheBehavior(b),
                  },
                ),
              ),
          },
          { omitEmptyArray: true },
        ),
        aliases: props.aliases,
        comment: trimmedComment,
        customErrorResponse: this.renderErrorResponses(),
        defaultRootObject: props.defaultRootObject,
        httpVersion: props.httpVersion ?? HttpVersion.HTTP2,
        priceClass: props.priceClass ?? undefined,
        restrictions: this.renderRestrictions(props.geoRestriction),
        viewerCertificate: this.renderViewerCertificate(
          this.certificate,
          props.minimumProtocolVersion,
          props.sslSupportMethod,
        ),
        waitForDeployment: props.waitForDeployment,
      },
    );

    this._domainName = this.resource.domainName;
    this.hostedZoneId = this.resource.hostedZoneId;
    this._outputs = {
      id: this.resource.id,
      hostedZoneId: this.resource.hostedZoneId,
      status: this.resource.status,
      arn: this.resource.arn,
      domainName: this._domainName,
    };
  }

  /**
   * Add an Origin to this Distribution.
   *
   * @param origin The Origin to add.
   * @param originId An optional id to use for the Origin or one will be generated.
   */
  public addOrigin(origin: IOrigin, originId?: string): string {
    const indexedOrigin = this._origins.find(
      (originIndex) => originIndex.origin === origin,
    );
    if (indexedOrigin) {
      if (originId && originId !== indexedOrigin.id) {
        throw new Error(
          `Duplicate origin for ${indexedOrigin.id} and ${originId}.`,
        );
      }
      return indexedOrigin.id;
    }
    const nextIndex = this._origins.length;
    const id = originId ?? `origin-${nextIndex}`;
    // ensure id (if provided) is unique within Distribution
    if (this._origins.some((originIndex) => originIndex.id === id)) {
      throw new Error(
        `Duplicate origin id ${id}. OriginIds must be unique within a distribution`,
      );
    }
    this._origins.push({ origin, id });
    return id;
  }

  private renderErrorResponses():
    | cloudfrontDistribution.CloudfrontDistributionCustomErrorResponse[]
    | undefined {
    if (this.errorResponses.length === 0) {
      return undefined;
    }

    return this.errorResponses.map((errorConfig) => {
      if (
        !errorConfig.responseHttpStatus &&
        !errorConfig.ttl &&
        !errorConfig.responsePagePath
      ) {
        throw new Error(
          "A custom error response without either a 'responseHttpStatus', 'ttl' or 'responsePagePath' is not valid.",
        );
      }

      return {
        errorCachingMinTtl: errorConfig.ttl?.toSeconds(),
        errorCode: errorConfig.httpStatus,
        responseCode: errorConfig.responsePagePath
          ? (errorConfig.responseHttpStatus ?? errorConfig.httpStatus)
          : errorConfig.responseHttpStatus,
        responsePagePath: errorConfig.responsePagePath,
      };
    });
  }

  /**
   * Adds a new behavior to this distribution for the given pathPattern.
   *
   * @param pathPattern the path pattern (e.g., 'images/*') that specifies which requests to apply the behavior to.
   * @param origin the origin to use for this behavior
   * @param behaviorOptions the options for the behavior at this path.
   */
  public addBehavior(
    pathPattern: string,
    origin: IOrigin,
    behaviorOptions: AddBehaviorOptions = {},
  ) {
    if (pathPattern === "*") {
      throw new Error(
        "Only the default behavior can have a path pattern of '*'",
      );
    }
    const targetOriginId = this.addOrigin(origin);
    this.additionalBehaviors.push({
      pathPattern,
      origin,
      targetOriginId,
      ...behaviorOptions,
    });
  }

  /**
   * Creates and returns the Terraform representation of this behavior.
   * This renders as a "CloudfrontDistributionDefaultCacheBehavior"
   * regardless if this is a default cache behavior or not, as the two
   * are identical except the `pathPattern` is omitted for the default
   * cache behavior.
   *
   * @internal
   */
  private _renderDefaultCacheBehavior(
    props: CacheBehavior,
  ): cloudfrontDistribution.CloudfrontDistributionDefaultCacheBehavior {
    // TODO: should it be possible to leave cachePolicy be undefined?
    const managedCachePolicyName =
      props.cachePolicy ?? ManagedCachePolicy.CACHING_OPTIMIZED;
    const cachePolicy = this.dataLookup(
      managedCachePolicyName,
      dataAwsCloudfrontCachePolicy.DataAwsCloudfrontCachePolicy,
      { name: managedCachePolicyName },
    );
    const originRequestPolicy = this.dataLookup(
      props.originRequestPolicy,
      dataAwsCloudfrontOriginRequestPolicy.DataAwsCloudfrontOriginRequestPolicy,
      { name: props.originRequestPolicy },
    );
    let responseHeadersPolicyId: string | undefined;
    if (typeof props.responseHeadersPolicy == "string") {
      const managedPolicy = this.dataLookup(
        props.responseHeadersPolicy,
        dataAwsCloudfrontResponseHeadersPolicy.DataAwsCloudfrontResponseHeadersPolicy,
        { name: props.responseHeadersPolicy },
      );
      responseHeadersPolicyId = managedPolicy?.id;
    } else {
      responseHeadersPolicyId =
        props.responseHeadersPolicy?.responseHeadersPolicyId;
    }

    return {
      targetOriginId: props.targetOriginId,
      allowedMethods:
        props.allowedMethods?.methods ?? AllowedMethods.ALLOW_GET_HEAD.methods,
      cachedMethods:
        props.cachedMethods?.methods ?? CachedMethods.CACHE_GET_HEAD.methods,
      cachePolicyId: cachePolicy?.id,
      compress: props.compress ?? true,
      originRequestPolicyId: originRequestPolicy?.id,
      responseHeadersPolicyId,
      smoothStreaming: props.smoothStreaming,
      viewerProtocolPolicy:
        props.viewerProtocolPolicy ?? ViewerProtocolPolicy.ALLOW_ALL,
    };
  }

  private renderRestrictions(geoRestriction?: GeoRestriction) {
    return geoRestriction
      ? {
          geoRestriction: {
            restrictionType: geoRestriction.restrictionType,
            locations:
              geoRestriction.restrictionType !== GeoRestrictionType.NONE
                ? this.validateLocations(geoRestriction.locations)
                : undefined,
          },
        }
      : {
          geoRestriction: {
            restrictionType: GeoRestrictionType.NONE,
          },
        };
  }

  private validateLocations(locations: string[]) {
    const LOCATION_REGEX = /^[A-Z]{2}$/;
    if (locations.length === 0) {
      throw new Error("Should provide at least 1 location");
    }
    locations.forEach((location) => {
      if (!LOCATION_REGEX.test(location)) {
        throw new Error(
          `Invalid location format for location: ${location}, location should be two-letter and uppercase country ISO 3166-1-alpha-2 code`,
        );
      }
    });
    return locations;
  }

  private renderViewerCertificate(
    certificate?: ICertificate,
    minimumProtocolVersionProp?: SecurityPolicyProtocol,
    sslSupportMethodProp?: SSLMethod,
  ): cloudfrontDistribution.CloudfrontDistributionViewerCertificate {
    const minimumProtocolVersion =
      minimumProtocolVersionProp ?? SecurityPolicyProtocol.TLS_V1_2_2021;
    const sslSupportMethod = sslSupportMethodProp ?? SSLMethod.SNI;

    return {
      ...(certificate
        ? { acmCertificateArn: certificate.certificateArn }
        : { cloudfrontDefaultCertificate: true }),
      minimumProtocolVersion: minimumProtocolVersion,
      sslSupportMethod: sslSupportMethod,
    };
  }

  /**
   * Conditionally lookup or create a child based on the id provided.
   * If the id is undefined, it will return undefined.
   *
   * @param id the id of the child to lookup or create
   * @param constructType the type of the child to create
   * @param config the configuration to pass to the child
   */
  private dataLookup<TConstruct extends Construct>(
    id: string | undefined,
    constructType: new (
      scope: Construct,
      idInput: string,
      config: any,
    ) => TConstruct,
    config?: any,
  ): TConstruct | undefined {
    if (!id) {
      return undefined;
    }
    let child = this.node.tryFindChild(id) as TConstruct | undefined;
    if (!child) {
      child = new constructType(this, id, config);
    }
    return child;
  }
}

export interface GeoRestriction {
  readonly locations: string[];
  readonly restrictionType: GeoRestrictionType;
}

export enum GeoRestrictionType {
  NONE = "none",
  WHITELIST = "whitelist",
  BLACKLIST = "blacklist",
}

// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-cloudfront/lib/distribution.ts

/** Maximum HTTP version to support */
export enum HttpVersion {
  /** HTTP 1.1 */
  HTTP1_1 = "http1.1",
  /** HTTP 2 */
  HTTP2 = "http2",
  /** HTTP 2 and HTTP 3 */
  HTTP2_AND_3 = "http2and3",
  /** HTTP 3 */
  HTTP3 = "http3",
}

/**
 * The price class determines how many edge locations CloudFront will use for your distribution.
 * See https://aws.amazon.com/cloudfront/pricing/ for full list of supported regions.
 */
export enum PriceClass {
  /** USA, Canada, Europe, & Israel */
  PRICE_CLASS_100 = "PriceClass_100",
  /** PRICE_CLASS_100 + South Africa, Kenya, Middle East, Japan, Singapore, South Korea, Taiwan, Hong Kong, & Philippines */
  PRICE_CLASS_200 = "PriceClass_200",
  /** All locations */
  PRICE_CLASS_ALL = "PriceClass_All",
}

/**
 * The SSL method CloudFront will use for your distribution.
 *
 * Server Name Indication (SNI) - is an extension to the TLS computer networking protocol by which a client indicates
 *  which hostname it is attempting to connect to at the start of the handshaking process. This allows a server to present
 *  multiple certificates on the same IP address and TCP port number and hence allows multiple secure (HTTPS) websites
 * (or any other service over TLS) to be served by the same IP address without requiring all those sites to use the same certificate.
 *
 * CloudFront can use SNI to host multiple distributions on the same IP - which a large majority of clients will support.
 *
 * If your clients cannot support SNI however - CloudFront can use dedicated IPs for your distribution - but there is a prorated monthly charge for
 * using this feature. By default, we use SNI - but you can optionally enable dedicated IPs (VIP).
 *
 * See the CloudFront SSL for more details about pricing : https://aws.amazon.com/cloudfront/custom-ssl-domains/
 *
 */
export enum SSLMethod {
  SNI = "sni-only",
  VIP = "vip",
}

/**
 * The minimum version of the SSL protocol that you want CloudFront to use for HTTPS connections.
 * CloudFront serves your objects only to browsers or devices that support at least the SSL version that you specify.
 */
export enum SecurityPolicyProtocol {
  SSL_V3 = "SSLv3",
  TLS_V1 = "TLSv1",
  TLS_V1_2016 = "TLSv1_2016",
  TLS_V1_1_2016 = "TLSv1.1_2016",
  TLS_V1_2_2018 = "TLSv1.2_2018",
  TLS_V1_2_2019 = "TLSv1.2_2019",
  TLS_V1_2_2021 = "TLSv1.2_2021",
}

/**
 * Options for configuring custom error responses.
 */
export interface ErrorResponse {
  /**
   * The minimum amount of time, in seconds, that you want CloudFront to cache the HTTP status code specified in ErrorCode.
   *
   * @default - the default caching TTL behavior applies
   */
  readonly ttl?: Duration;
  /**
   * The HTTP status code for which you want to specify a custom error page and/or a caching duration.
   */
  readonly httpStatus: number;
  /**
   * The HTTP status code that you want CloudFront to return to the viewer along with the custom error page.
   *
   * If you specify a value for `responseHttpStatus`, you must also specify a value for `responsePagePath`.
   *
   * @default - the error code will be returned as the response code.
   */
  readonly responseHttpStatus?: number;
  /**
   * The path to the custom error page that you want CloudFront to return to a viewer when your origin returns the
   * `httpStatus`, for example, /4xx-errors/403-forbidden.html
   *
   * @default - the default CloudFront response is shown.
   */
  readonly responsePagePath?: string;
}

// private interface to keep track of CacheBehaviors
interface CacheBehavior extends BehaviorOptions {
  /**
   * The pattern (e.g., `images/*.jpg`) that specifies which requests to apply the behavior to.
   * There must be exactly one behavior associated with each `Distribution` that has a path pattern
   * of '*', which acts as the catch-all default behavior.
   */
  readonly pathPattern: string;

  /**
   * Value of ID for the origin that you want CloudFront to route requests to when a request matches
   * the path pattern either for a cache behavior or for the default cache behavior.
   */
  readonly targetOriginId: string;
}

// private interface to index origins by id
interface OriginIndex {
  origin: IOrigin;
  id: string;
}

/**
 * Options for creating a new behavior.
 */
export interface BehaviorOptions extends AddBehaviorOptions {
  /**
   * The origin that you want CloudFront to route requests to when they match this behavior.
   */
  readonly origin: IOrigin;
}

/**
 * Options for adding a new behavior to a Distribution.
 */
export interface AddBehaviorOptions {
  /**
   * HTTP methods to allow for this behavior.
   *
   * @default AllowedMethods.ALLOW_GET_HEAD
   */
  readonly allowedMethods?: AllowedMethods;

  /**
   * HTTP methods to cache for this behavior.
   *
   * @default CachedMethods.CACHE_GET_HEAD
   */
  readonly cachedMethods?: CachedMethods;

  /**
   * The cache policy for this behavior. The cache policy determines what values are included in the cache key,
   * and the time-to-live (TTL) values for the cache.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-the-cache-key.html.
   * @default ManagedCachePolicy.CACHING_OPTIMIZED
   */
  readonly cachePolicy?: ManagedCachePolicy; //TODO: support custom cache policies

  /**
   * Whether you want CloudFront to automatically compress certain files for this cache behavior.
   * See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html#compressed-content-cloudfront-file-types
   * for file types CloudFront will compress.
   *
   * @default true
   */
  readonly compress?: boolean;

  /**
   * The origin request policy for this behavior. The origin request policy determines which values (e.g., headers, cookies)
   * are included in requests that CloudFront sends to the origin.
   *
   * @default - none
   */
  readonly originRequestPolicy?: ManagedOriginRequestPolicy; //TODO: support custom origin request policies

  /**
   * The response headers policy for this behavior. The response headers policy determines which headers are included in responses
   *
   * @default - none
   */
  readonly responseHeadersPolicy?:
    | ManagedResponseHeadersPolicy
    | IResponseHeadersPolicy;

  /**
   * Set this to true to indicate you want to distribute media files in the Microsoft Smooth Streaming format using this behavior.
   *
   * @default false
   */
  readonly smoothStreaming?: boolean;

  /**
   * The protocol that viewers can use to access the files controlled by this behavior.
   *
   * @default ViewerProtocolPolicy.ALLOW_ALL
   */
  readonly viewerProtocolPolicy?: ViewerProtocolPolicy;

  /**
   * The CloudFront functions to invoke before serving the contents.
   *
   * @default - no functions will be invoked
   */
  readonly functionAssociations?: FunctionAssociation[];
}

/**
 * The HTTP methods that the Behavior will accept requests on.
 */
export class AllowedMethods {
  /** HEAD and GET */
  public static readonly ALLOW_GET_HEAD = new AllowedMethods(["GET", "HEAD"]);
  /** HEAD, GET, and OPTIONS */
  public static readonly ALLOW_GET_HEAD_OPTIONS = new AllowedMethods([
    "GET",
    "HEAD",
    "OPTIONS",
  ]);
  /** All supported HTTP methods */
  public static readonly ALLOW_ALL = new AllowedMethods([
    "GET",
    "HEAD",
    "OPTIONS",
    "PUT",
    "PATCH",
    "POST",
    "DELETE",
  ]);

  /** HTTP methods supported */
  public readonly methods: string[];

  private constructor(methods: string[]) {
    this.methods = methods;
  }
}

/**
 * The HTTP methods that the Behavior will cache requests on.
 */
export class CachedMethods {
  /** HEAD and GET */
  public static readonly CACHE_GET_HEAD = new CachedMethods(["GET", "HEAD"]);
  /** HEAD, GET, and OPTIONS */
  public static readonly CACHE_GET_HEAD_OPTIONS = new CachedMethods([
    "GET",
    "HEAD",
    "OPTIONS",
  ]);

  /** HTTP methods supported */
  public readonly methods: string[];

  private constructor(methods: string[]) {
    this.methods = methods;
  }
}

/**
 * How HTTPs should be handled with your distribution.
 */
export enum ViewerProtocolPolicy {
  /** HTTPS only */
  HTTPS_ONLY = "https-only",
  /** Will redirect HTTP requests to HTTPS */
  REDIRECT_TO_HTTPS = "redirect-to-https",
  /** Both HTTP and HTTPS supported */
  ALLOW_ALL = "allow-all",
}

/**
 * CloudFront provides a set of managed cache policies that you can attach to any of your distribution's cache behaviors.
 * With a managed cache policy, you don't need to write or maintain your own cache policy. The managed policies use settings that are optimized for specific use cases.
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
 * @link https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/data-sources/cloudfront_cache_policy#aws-managed-policies
 */
export enum ManagedCachePolicy {
  /**
   * This policy is designed for use with an origin that is an AWS Amplify web app.
   */
  AMPLIFY = "Managed-Amplify",
  /**
   * Optimize cache efficiency by minimizing the values that CloudFront includes in the cache key.
   * Query strings and cookies are not included in the cache key, and only the normalized 'Accept-Encoding' header is included.
   */
  CACHING_OPTIMIZED = "Managed-CachingOptimized",
  /**
   * Optimize cache efficiency by minimizing the values that CloudFront includes in the cache key.
   * Query strings and cookies are not included in the cache key, and only the normalized 'Accept-Encoding' header is included.
   * Disables cache compression.
   */
  CACHING_OPTIMIZED_FOR_UNCOMPRESSED_OBJECTS = "Managed-CachingOptimizedForUncompressedObjects",
  /** Disables caching. This policy is useful for dynamic content and for requests that are not cacheable. */
  CACHING_DISABLED = "Managed-CachingDisabled",
  /** Designed for use with an origin that is an AWS Elemental MediaPackage endpoint. */
  ELEMENTAL_MEDIA_PACKAGE = "Managed-Elemental-MediaPackage",
  /**
   * Designed for use with an origin that returns Cache-Control HTTP response headers and does not serve different content based on values present in the query string.
   */
  USE_ORIGIN_CACHE_CONTROL_HEADERS = "Managed-UseOriginCacheControlHeaders",
  /**
   * Designed for use with an origin that returns Cache-Control HTTP response headers and serves different content based on values present in the query string.
   */
  USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS = "Managed-UseOriginCacheControlHeaders-QueryStrings",
}

/**
 * Origin Request Policy configuration.
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html
 * @link https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/data-sources/cloudfront_origin_request_policy#aws-managed-policies
 */
export enum ManagedOriginRequestPolicy {
  /** This policy includes only the User-Agent and Referer headers. It doesn’t include any query strings or cookies. */
  USER_AGENT_REFERER_HEADERS = "Managed-UserAgentRefererHeaders",
  /** This policy includes the header that enables cross-origin resource sharing (CORS) requests when the origin is a custom origin. */
  CORS_CUSTOM_ORIGIN = "Managed-CORS-CustomOrigin",
  /** This policy includes the headers that enable cross-origin resource sharing (CORS) requests when the origin is an Amazon S3 bucket. */
  CORS_S3_ORIGIN = "Managed-CORS-S3Origin",
  /** This policy includes all values (query strings, headers, and cookies) in the viewer request. */
  ALL_VIEWER = "Managed-AllViewer",
  /** This policy is designed for use with an origin that is an AWS Elemental MediaTailor endpoint. */
  ELEMENTAL_MEDIA_TAILOR = "Managed-Elemental-MediaTailor-PersonalizedManifests",
  /** This policy includes all values (headers, cookies, and query strings) in the viewer request, and all CloudFront headers that were released through June 2022 (CloudFront headers released after June 2022 are not included). */
  ALL_VIEWER_AND_CLOUDFRONT_2022 = "Managed-AllViewerAndCloudFrontHeaders-2022-06",
  /** This policy includes all values (query strings, and cookies) except the header in the viewer request. */
  ALL_VIEWER_EXCEPT_HOST_HEADER = "Managed-AllViewerExceptHostHeader",
}
