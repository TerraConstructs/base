// https://github.com/aws/aws-cdk/blob/0f077c0a6adc1e5258d073f6de232d09cbb7ae54/packages/aws-cdk-lib/aws-cloudfront/lib/response-headers-policy.ts
import {
  cloudfrontResponseHeadersPolicy,
  dataAwsCloudfrontResponseHeadersPolicy,
} from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { Duration } from "../../duration";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";

/**
 * Represents a response headers policy.
 */
export interface IResponseHeadersPolicy {
  /**
   * The ID of the response headers policy
   * @attribute
   **/
  readonly responseHeadersPolicyId: string;
}

/**
 * Properties for creating a Response Headers Policy
 */
export interface ResponseHeadersPolicyProps extends AwsConstructProps {
  /**
   * A unique name to identify the response headers policy.
   *
   * @default - generated from the `id`
   */
  readonly responseHeadersPolicyName?: string;

  /**
   * A comment to describe the response headers policy.
   *
   * @default - no comment
   */
  readonly comment?: string;

  /**
   * A configuration for a set of HTTP response headers that are used for cross-origin resource sharing (CORS).
   *
   * @default - no cors behavior
   */
  readonly corsBehavior?: ResponseHeadersCorsBehavior;

  /**
   * A configuration for a set of custom HTTP response headers.
   *
   * @default - no custom headers behavior
   */
  readonly customHeadersBehavior?: ResponseCustomHeadersBehavior;

  /**
   * A configuration for a set of security-related HTTP response headers.
   *
   * @default - no security headers behavior
   */
  readonly securityHeadersBehavior?: ResponseSecurityHeadersBehavior;

  /**
   * A list of HTTP response headers that CloudFront removes from HTTP responses
   * that it sends to viewers.
   *
   * @default - no headers are removed
   */
  readonly removeHeaders?: string[];

  /**
   * The percentage of responses that you want CloudFront to add the Server-Timing
   * header to.
   *
   * @default - no Server-Timing header is added to HTTP responses
   */
  readonly serverTimingSamplingRate?: number;
}

/**
 * A Response Headers Policy configuration
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html
 * @link https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/resources/cloudfront_response_headers_policy
 */
export class ResponseHeadersPolicy
  extends AwsConstructBase
  implements IResponseHeadersPolicy
{
  /**
   * Import an existing Response Headers Policy from its ID.
   */
  public static fromResponseHeadersPolicyId(
    scope: Construct,
    id: string,
    responseHeadersPolicyId: string,
  ): IResponseHeadersPolicy {
    class Import extends AwsConstructBase implements IResponseHeadersPolicy {
      public readonly outputs: Record<string, any> = {};
      public readonly responseHeadersPolicyId = responseHeadersPolicyId;
    }
    return new Import(scope, id);
  }

  public static fromManagedPolicyName(
    scope: Construct,
    id: string,
    managedResponseHeadersPolicyName: ManagedResponseHeadersPolicy,
  ): IResponseHeadersPolicy {
    class Import extends AwsConstructBase implements IResponseHeadersPolicy {
      public readonly outputs: Record<string, any> = {};
      public readonly responseHeadersPolicyId: string;
      public readonly resource: dataAwsCloudfrontResponseHeadersPolicy.DataAwsCloudfrontResponseHeadersPolicy;
      public constructor() {
        super(scope, id);
        this.resource =
          new dataAwsCloudfrontResponseHeadersPolicy.DataAwsCloudfrontResponseHeadersPolicy(
            this,
            "Resource",
            {
              name: managedResponseHeadersPolicyName,
            },
          );
        this.responseHeadersPolicyId = this.resource.id;
      }
    }
    return new Import();
  }

  public readonly resource: cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicy;
  public readonly responseHeadersPolicyId: string;
  public readonly outputs: Record<string, any> = {};

  constructor(
    scope: Construct,
    id: string,
    props: ResponseHeadersPolicyProps = {},
  ) {
    super(scope, id, props);
    const responseHeadersPolicyName =
      props.responseHeadersPolicyName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
        maxLength: 128,
      });

    this.resource =
      new cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicy(
        this,
        "Resource",
        {
          name: responseHeadersPolicyName,
          comment: props.comment,
          corsConfig: props.corsBehavior
            ? this._renderCorsConfig(props.corsBehavior)
            : undefined,
          customHeadersConfig: props.customHeadersBehavior
            ? this._renderCustomHeadersConfig(props.customHeadersBehavior)
            : undefined,
          securityHeadersConfig: props.securityHeadersBehavior
            ? this._renderSecurityHeadersConfig(props.securityHeadersBehavior)
            : undefined,
          removeHeadersConfig: props.removeHeaders
            ? this._renderRemoveHeadersConfig(props.removeHeaders)
            : undefined,
          serverTimingHeadersConfig: props.serverTimingSamplingRate
            ? this._renderServerTimingHeadersConfig(
                props.serverTimingSamplingRate,
              )
            : undefined,
        },
      );

    this.responseHeadersPolicyId = this.resource.id;
  }

  private _renderCorsConfig(
    behavior: ResponseHeadersCorsBehavior,
  ): cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicyCorsConfig {
    return {
      accessControlAllowCredentials: behavior.accessControlAllowCredentials,
      accessControlAllowHeaders: { items: behavior.accessControlAllowHeaders },
      accessControlAllowMethods: { items: behavior.accessControlAllowMethods },
      accessControlAllowOrigins: { items: behavior.accessControlAllowOrigins },
      accessControlExposeHeaders: behavior.accessControlExposeHeaders
        ? { items: behavior.accessControlExposeHeaders }
        : undefined,
      accessControlMaxAgeSec: behavior.accessControlMaxAge
        ? behavior.accessControlMaxAge.toSeconds()
        : undefined,
      originOverride: behavior.originOverride,
    };
  }

  private _renderCustomHeadersConfig(
    behavior: ResponseCustomHeadersBehavior,
  ): cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicyCustomHeadersConfig {
    return {
      items: behavior.customHeaders,
    };
  }

  private _renderSecurityHeadersConfig(
    behavior: ResponseSecurityHeadersBehavior,
  ): cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicySecurityHeadersConfig {
    return {
      contentSecurityPolicy: behavior.contentSecurityPolicy,
      contentTypeOptions: behavior.contentTypeOptions,
      frameOptions: behavior.frameOptions,
      referrerPolicy: behavior.referrerPolicy,
      strictTransportSecurity: behavior.strictTransportSecurity
        ? {
            ...behavior.strictTransportSecurity,
            accessControlMaxAgeSec:
              behavior.strictTransportSecurity.accessControlMaxAge.toSeconds(),
          }
        : undefined,
      xssProtection: behavior.xssProtection,
    };
  }

  private _renderRemoveHeadersConfig(
    headers: string[],
  ): cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicyRemoveHeadersConfig {
    const readonlyHeaders = [
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "warning",
      "via",
    ];

    return {
      items: headers.map((header) => {
        if (
          !Token.isUnresolved(header) &&
          readonlyHeaders.includes(header.toLowerCase())
        ) {
          throw new Error(`Cannot remove read-only header ${header}`);
        }
        return { header };
      }),
    };
  }

  private _renderServerTimingHeadersConfig(
    samplingRate: number,
  ): cloudfrontResponseHeadersPolicy.CloudfrontResponseHeadersPolicyServerTimingHeadersConfig {
    if (!Token.isUnresolved(samplingRate)) {
      if (samplingRate < 0 || samplingRate > 100) {
        throw new Error(
          `Sampling rate must be between 0 and 100 (inclusive), received ${samplingRate}`,
        );
      }

      if (!hasMaxDecimalPlaces(samplingRate, 4)) {
        throw new Error(
          `Sampling rate can have up to four decimal places, received ${samplingRate}`,
        );
      }
    }

    return {
      enabled: true,
      samplingRate,
    };
  }
}

/**
 * Configuration for a set of HTTP response headers that are used for cross-origin resource sharing (CORS).
 * CloudFront adds these headers to HTTP responses that it sends for CORS requests that match a cache behavior
 * associated with this response headers policy.
 */
export interface ResponseHeadersCorsBehavior {
  /**
   * A Boolean that CloudFront uses as the value for the Access-Control-Allow-Credentials HTTP response header.
   */
  readonly accessControlAllowCredentials: boolean;

  /**
   * A list of HTTP header names that CloudFront includes as values for the Access-Control-Allow-Headers HTTP response header.
   * You can specify `['*']` to allow all headers.
   */
  readonly accessControlAllowHeaders: string[];

  /**
   * A list of HTTP methods that CloudFront includes as values for the Access-Control-Allow-Methods HTTP response header.
   */
  readonly accessControlAllowMethods: string[];

  /**
   * A list of origins (domain names) that CloudFront can use as the value for the Access-Control-Allow-Origin HTTP response header.
   * You can specify `['*']` to allow all origins.
   */
  readonly accessControlAllowOrigins: string[];

  /**
   * A list of HTTP headers that CloudFront includes as values for the Access-Control-Expose-Headers HTTP response header.
   * You can specify `['*']` to expose all headers.
   *
   * @default - no headers exposed
   */
  readonly accessControlExposeHeaders?: string[];

  /**
   * A number that CloudFront uses as the value for the Access-Control-Max-Age HTTP response header.
   *
   * @default - no max age
   */
  readonly accessControlMaxAge?: Duration;

  /**
   * A Boolean that determines whether CloudFront overrides HTTP response headers received from the origin with the ones specified in this response headers policy.
   */
  readonly originOverride: boolean;
}

/**
 * Configuration for a set of HTTP response headers that are sent for requests that match a cache behavior
 * that’s associated with this response headers policy.
 */
export interface ResponseCustomHeadersBehavior {
  /**
   * The list of HTTP response headers and their values.
   */
  readonly customHeaders: ResponseCustomHeader[];
}

/**
 * An HTTP response header name and its value.
 * CloudFront includes this header in HTTP responses that it sends for requests that match a cache behavior that’s associated with this response headers policy.
 */
export interface ResponseCustomHeader {
  /**
   * The HTTP response header name.
   */
  readonly header: string;

  /**
   * A Boolean that determines whether CloudFront overrides a response header with the same name
   * received from the origin with the header specified here.
   */
  readonly override: boolean;

  /**
   * The value for the HTTP response header.
   */
  readonly value: string;
}

/**
 * Configuration for a set of security-related HTTP response headers.
 * CloudFront adds these headers to HTTP responses that it sends for requests that match a cache behavior
 * associated with this response headers policy.
 */
export interface ResponseSecurityHeadersBehavior {
  /**
   * The policy directives and their values that CloudFront includes as values for the Content-Security-Policy HTTP response header.
   *
   * @default - no content security policy
   */
  readonly contentSecurityPolicy?: ResponseHeadersContentSecurityPolicy;

  /**
   * Determines whether CloudFront includes the X-Content-Type-Options HTTP response header with its value set to nosniff.
   *
   * @default - no content type options
   */
  readonly contentTypeOptions?: ResponseHeadersContentTypeOptions;

  /**
   * Determines whether CloudFront includes the X-Frame-Options HTTP response header and the header’s value.
   *
   * @default - no frame options
   */
  readonly frameOptions?: ResponseHeadersFrameOptions;

  /**
   * Determines whether CloudFront includes the Referrer-Policy HTTP response header and the header’s value.
   *
   * @default - no referrer policy
   */
  readonly referrerPolicy?: ResponseHeadersReferrerPolicy;

  /**
   * Determines whether CloudFront includes the Strict-Transport-Security HTTP response header and the header’s value.
   *
   * @default - no strict transport security
   */
  readonly strictTransportSecurity?: ResponseHeadersStrictTransportSecurity;

  /**
   * Determines whether CloudFront includes the X-XSS-Protection HTTP response header and the header’s value.
   *
   * @default - no xss protection
   */
  readonly xssProtection?: ResponseHeadersXSSProtection;
}

/**
 * The policy directives and their values that CloudFront includes as values for the Content-Security-Policy HTTP response header.
 */
export interface ResponseHeadersContentSecurityPolicy {
  /**
   * The policy directives and their values that CloudFront includes as values for the Content-Security-Policy HTTP response header.
   */
  readonly contentSecurityPolicy: string;

  /**
   * A Boolean that determines whether CloudFront overrides the Content-Security-Policy HTTP response header
   * received from the origin with the one specified in this response headers policy.
   */
  readonly override: boolean;
}

/**
 * Determines whether CloudFront includes the X-Content-Type-Options HTTP response header with its value set to nosniff.
 */
export interface ResponseHeadersContentTypeOptions {
  /**
   * A Boolean that determines whether CloudFront overrides the X-Content-Type-Options HTTP response header
   * received from the origin with the one specified in this response headers policy.
   */
  readonly override: boolean;
}

/**
 * Determines whether CloudFront includes the X-Frame-Options HTTP response header and the header’s value.
 */
export interface ResponseHeadersFrameOptions {
  /**
   * The value of the X-Frame-Options HTTP response header.
   */
  readonly frameOption: HeadersFrameOption;

  /**
   * A Boolean that determines whether CloudFront overrides the X-Frame-Options HTTP response header
   * received from the origin with the one specified in this response headers policy.
   */
  readonly override: boolean;
}

/**
 * Determines whether CloudFront includes the Referrer-Policy HTTP response header and the header’s value.
 */
export interface ResponseHeadersReferrerPolicy {
  /**
   * The value of the Referrer-Policy HTTP response header.
   */
  readonly referrerPolicy: HeadersReferrerPolicy;

  /**
   * A Boolean that determines whether CloudFront overrides the Referrer-Policy HTTP response header
   * received from the origin with the one specified in this response headers policy.
   */
  readonly override: boolean;
}

/**
 * Determines whether CloudFront includes the Strict-Transport-Security HTTP response header and the header’s value.
 */
export interface ResponseHeadersStrictTransportSecurity {
  /**
   * A number that CloudFront uses as the value for the max-age directive in the Strict-Transport-Security HTTP response header.
   */
  readonly accessControlMaxAge: Duration;

  /**
   * A Boolean that determines whether CloudFront includes the includeSubDomains directive in the Strict-Transport-Security HTTP response header.
   *
   * @default false
   */
  readonly includeSubdomains?: boolean;

  /**
   * A Boolean that determines whether CloudFront overrides the Strict-Transport-Security HTTP response header
   * received from the origin with the one specified in this response headers policy.
   */
  readonly override: boolean;

  /**
   * A Boolean that determines whether CloudFront includes the preload directive in the Strict-Transport-Security HTTP response header.
   *
   * @default false
   */
  readonly preload?: boolean;
}

/**
 * Determines whether CloudFront includes the X-XSS-Protection HTTP response header and the header’s value.
 */
export interface ResponseHeadersXSSProtection {
  /**
   * A Boolean that determines whether CloudFront includes the mode=block directive in the X-XSS-Protection header.
   *
   * @default false
   */
  readonly modeBlock?: boolean;

  /**
   * A Boolean that determines whether CloudFront overrides the X-XSS-Protection HTTP response header
   * received from the origin with the one specified in this response headers policy.
   */
  readonly override: boolean;

  /**
   * A Boolean that determines the value of the X-XSS-Protection HTTP response header.
   * When this setting is true, the value of the X-XSS-Protection header is 1.
   * When this setting is false, the value of the X-XSS-Protection header is 0.
   */
  readonly protection: boolean;

  /**
   * A reporting URI, which CloudFront uses as the value of the report directive in the X-XSS-Protection header.
   * You cannot specify a ReportUri when ModeBlock is true.
   *
   * @default - no report uri
   */
  readonly reportUri?: string;
}

/**
 * Enum representing possible values of the X-Frame-Options HTTP response header.
 */
export enum HeadersFrameOption {
  /**
   * The page can only be displayed in a frame on the same origin as the page itself.
   */
  DENY = "DENY",

  /**
   * The page can only be displayed in a frame on the specified origin.
   */
  SAMEORIGIN = "SAMEORIGIN",
}

/**
 * Enum representing possible values of the Referrer-Policy HTTP response header.
 */
export enum HeadersReferrerPolicy {
  /**
   * The referrer policy is not set.
   */
  NO_REFERRER = "no-referrer",

  /**
   * The referrer policy is no-referrer-when-downgrade.
   */
  NO_REFERRER_WHEN_DOWNGRADE = "no-referrer-when-downgrade",

  /**
   * The referrer policy is origin.
   */
  ORIGIN = "origin",

  /**
   * The referrer policy is origin-when-cross-origin.
   */
  ORIGIN_WHEN_CROSS_ORIGIN = "origin-when-cross-origin",

  /**
   * The referrer policy is same-origin.
   */
  SAME_ORIGIN = "same-origin",

  /**
   * The referrer policy is strict-origin.
   */
  STRICT_ORIGIN = "strict-origin",

  /**
   * The referrer policy is strict-origin-when-cross-origin.
   */
  STRICT_ORIGIN_WHEN_CROSS_ORIGIN = "strict-origin-when-cross-origin",

  /**
   * The referrer policy is unsafe-url.
   */
  UNSAFE_URL = "unsafe-url",
}

function hasMaxDecimalPlaces(num: number, decimals: number): boolean {
  const parts = num.toString().split(".");
  return parts.length === 1 || parts[1].length <= decimals;
}

/**
 * A Response Headers Policy configuration
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html
 * @link https://registry.terraform.io/providers/hashicorp/aws/5.60.0/docs/data-sources/cloudfront_response_headers_policy#aws-managed-policies
 */
export enum ManagedResponseHeadersPolicy {
  /** Use this managed policy to allow simple CORS requests from any origin. */
  CORS_ALLOW_ALL_ORIGINS = "Managed-SimpleCORS", //60669652-455b-4ae9-85a4-c4c02393f86c
  /** Use this managed policy to allow CORS requests from any origin, including preflight requests. */
  CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT = "Managed-CORS-With-Preflight", //5cc3b908-e619-4b99-88e5-2cf7f45965bd
  /** Use this managed policy to add a set of security headers to all responses that CloudFront sends to viewers. */
  SECURITY_HEADERS = "Managed-SecurityHeadersPolicy", //67f7725c-6f97-4210-82d7-5512b31e9d03
  /** Use this managed policy to allow simple CORS requests from any origin and add a set of security headers to all responses that CloudFront sends to viewers. */
  CORS_ALLOW_ALL_ORIGINS_AND_SECURITY_HEADERS = "Managed-CORS-and-SecurityHeadersPolicy", //e61eb60c-9c35-4d20-a928-2b84e02af89c
  /** Use this managed policy to allow CORS requests from any origin, including preflight requests, and add a set of security headers to all responses that CloudFront sends to viewers. */
  CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS = "Managed-CORS-with-preflight-and-SecurityHeadersPolicy", //eaab4381-ed33-4a86-88ca-d9558dc6cd63
}
