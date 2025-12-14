// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/domain-name.ts

import {
  apiGatewayDomainName,
  apigatewayv2ApiMapping,
} from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { BasePathMapping, BasePathMappingOptions } from "./base-path-mapping"; // Assuming this will be converted
import { EndpointType, IRestApi } from "./restapi"; // Assuming these will be converted/available
import { IStage } from "./stage"; // Assuming this will be converted/available
import { UnscopedValidationError } from "../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as acm from "../edge";
import { IBucket } from "../storage";

/**
 * Options for creating an api mapping
 */
export interface ApiMappingOptions {
  /**
   * The api path name that callers of the API must provide in the URL after
   * the domain name (e.g. `example.com/base-path`). If you specify this
   * property, it can't be an empty string.
   *
   * If this is undefined, a mapping will be added for the empty path. Any request
   * that does not match a mapping will get sent to the API that has been mapped
   * to the empty path.
   *
   * @default - map requests from the domain root (e.g. `example.com`).
   */
  readonly basePath?: string;
}

/**
 * The minimum version of the SSL protocol that you want API Gateway to use for HTTPS connections.
 */
export enum SecurityPolicy {
  /** Cipher suite TLS 1.0 */
  TLS_1_0 = "TLS_1_0",

  /** Cipher suite TLS 1.2 */
  TLS_1_2 = "TLS_1_2",
}

export interface DomainNameOptions {
  /**
   * The custom domain name for your API. Uppercase letters are not supported.
   */
  readonly domainName: string;

  /**
   * The reference to an AWS-managed certificate for use by the edge-optimized
   * endpoint for the domain name. For "EDGE" domain names, the certificate
   * needs to be in the US East (N. Virginia) region.
   */
  readonly certificate: acm.ICertificate;

  /**
   * The type of endpoint for this DomainName.
   * @default REGIONAL
   */
  readonly endpointType?: EndpointType;

  /**
   * The Transport Layer Security (TLS) version + cipher suite for this domain name.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-domainname.html
   * @default SecurityPolicy.TLS_1_2
   */
  readonly securityPolicy?: SecurityPolicy;

  /**
   * The mutual TLS authentication configuration for a custom domain name.
   * @default - mTLS is not configured.
   */
  readonly mtls?: MTLSConfig;

  /**
   * The base path name that callers of the API must provide in the URL after
   * the domain name (e.g. `example.com/base-path`). If you specify this
   * property, it can't be an empty string.
   *
   * @default - map requests from the domain root (e.g. `example.com`).
   */
  readonly basePath?: string;
}

export interface DomainNameProps extends DomainNameOptions, AwsConstructProps {
  /**
   * If specified, all requests to this domain will be mapped to the production
   * deployment of this API. If you wish to map this domain to multiple APIs
   * with different base paths, use `addBasePathMapping` or `addApiMapping`.
   *
   * @default - you will have to call `addBasePathMapping` to map this domain to
   * API endpoints.
   */
  readonly mapping?: IRestApi;
}

export interface IDomainName extends IAwsConstruct {
  /**
   * The domain name (e.g. `example.com`)
   *
   * @attribute DomainName
   */
  readonly domainName: string;

  /**
   * The Route53 alias target to use in order to connect a record set to this domain through an alias.
   *
   * @attribute DistributionDomainName,RegionalDomainName
   */
  readonly domainNameAliasDomainName: string;

  /**
   * The Route53 hosted zone ID to use in order to connect a record set to this domain through an alias.
   *
   * @attribute DistributionHostedZoneId,RegionalHostedZoneId
   */
  readonly domainNameAliasHostedZoneId: string;
}

export class DomainName extends AwsConstructBase implements IDomainName {
  /**
   * Imports an existing domain name.
   */
  public static fromDomainNameAttributes(
    scope: Construct,
    id: string,
    attrs: DomainNameAttributes,
  ): IDomainName {
    class Import extends AwsConstructBase implements IDomainName {
      public readonly domainName = attrs.domainName;
      public readonly domainNameAliasDomainName = attrs.domainNameAliasTarget;
      public readonly domainNameAliasHostedZoneId =
        attrs.domainNameAliasHostedZoneId;
      public get outputs(): Record<string, any> {
        return {
          domainName: this.domainName,
          domainNameAliasDomainName: this.domainNameAliasDomainName,
          domainNameAliasHostedZoneId: this.domainNameAliasHostedZoneId,
        };
      }
      constructor(s: Construct, i: string) {
        super(s, i, {
          environmentFromArn: `arn:aws:apigateway:${AwsStack.ofAwsConstruct(s).region}::/restapis`,
        }); // Dummy ARN for region/account context
      }
    }

    return new Import(scope, id);
  }

  public readonly domainName: string;
  public readonly domainNameAliasDomainName: string;
  public readonly domainNameAliasHostedZoneId: string;
  private readonly basePaths = new Set<string | undefined>();
  private readonly securityPolicy?: SecurityPolicy;
  private readonly endpointType: EndpointType;
  private readonly resource: apiGatewayDomainName.ApiGatewayDomainName;

  public get outputs(): Record<string, any> {
    return {
      domainName: this.domainName,
      domainNameAliasDomainName: this.domainNameAliasDomainName,
      domainNameAliasHostedZoneId: this.domainNameAliasHostedZoneId,
    };
  }

  constructor(scope: Construct, id: string, props: DomainNameProps) {
    super(scope, id, props);

    this.endpointType = props.endpointType || EndpointType.REGIONAL;
    const edge = this.endpointType === EndpointType.EDGE;
    this.securityPolicy = props.securityPolicy;

    if (
      !Token.isUnresolved(props.domainName) &&
      /[A-Z]/.test(props.domainName)
    ) {
      throw new UnscopedValidationError(
        `Domain name does not support uppercase letters. Got: ${props.domainName}`,
      );
    }

    const mtlsConfig = this.configureMTLS(props.mtls);
    this.resource = new apiGatewayDomainName.ApiGatewayDomainName(
      this,
      "Resource",
      {
        domainName: props.domainName,
        certificateArn: edge ? props.certificate.certificateArn : undefined,
        regionalCertificateArn: !edge
          ? props.certificate.certificateArn
          : undefined,
        endpointConfiguration: { types: [this.endpointType] },
        mutualTlsAuthentication: mtlsConfig,
        securityPolicy: props.securityPolicy,
      },
    );

    this.domainName = this.resource.domainName;

    this.domainNameAliasDomainName = edge
      ? this.resource.cloudfrontDomainName
      : this.resource.regionalDomainName;

    this.domainNameAliasHostedZoneId = edge
      ? this.resource.cloudfrontZoneId
      : this.resource.regionalZoneId;

    const multiLevel = this.validateBasePath(props.basePath);
    if (props.mapping && !multiLevel) {
      this.addBasePathMapping(props.mapping, {
        basePath: props.basePath,
      });
    } else if (props.mapping && multiLevel) {
      this.addApiMapping(props.mapping.deploymentStage, {
        basePath: props.basePath,
      });
    }
  }

  private validateBasePath(path?: string): boolean {
    if (this.isMultiLevel(path)) {
      if (this.endpointType === EndpointType.EDGE) {
        throw new UnscopedValidationError(
          "multi-level basePath is only supported when endpointType is EndpointType.REGIONAL",
        );
      }
      if (
        this.securityPolicy &&
        this.securityPolicy !== SecurityPolicy.TLS_1_2
      ) {
        throw new UnscopedValidationError(
          "securityPolicy must be set to TLS_1_2 if multi-level basePath is provided",
        );
      }
      return true;
    }
    return false;
  }

  private isMultiLevel(path?: string): boolean {
    return (path?.split("/").filter((x) => !!x) ?? []).length >= 2;
  }

  public addBasePathMapping(
    targetApi: IRestApi,
    options: BasePathMappingOptions = {},
  ): BasePathMapping {
    if (this.basePaths.has(options.basePath)) {
      throw new UnscopedValidationError(
        `DomainName ${this.friendlyName} already has a mapping for path ${options.basePath}`,
      );
    }
    if (this.isMultiLevel(options.basePath)) {
      throw new UnscopedValidationError(
        'BasePathMapping does not support multi-level paths. Use "addApiMapping instead.',
      );
    }

    this.basePaths.add(options.basePath);
    const basePathIdPart = options.basePath
      ? options.basePath.replace(/\//g, "_")
      : "root";
    const id = `Map-${basePathIdPart}-${AwsStack.ofAwsConstruct(this).uniqueResourceName(targetApi.node)}`;

    // Assuming BasePathMapping is a TerraConstruct that wraps apiGatewayBasePathMapping.ApiGatewayBasePathMapping
    return new BasePathMapping(this, id, {
      domainName: this, // Pass the DomainName construct itself
      restApi: targetApi,
      ...options,
    });
  }

  public addApiMapping(
    targetStage: IStage,
    options: ApiMappingOptions = {},
  ): void {
    if (this.basePaths.has(options.basePath)) {
      throw new UnscopedValidationError(
        `DomainName ${this.node.id} already has a mapping for path ${options.basePath}. (${this.node.path})`,
      );
    }
    this.validateBasePath(options.basePath);
    this.basePaths.add(options.basePath);
    const basePathIdPart = options.basePath
      ? options.basePath.replace(/\//g, "_")
      : "root";
    const id = `ApiMap-${basePathIdPart}-${AwsStack.ofAwsConstruct(this).uniqueResourceName(targetStage.node)}`;

    new apigatewayv2ApiMapping.Apigatewayv2ApiMapping(this, id, {
      apiId: targetStage.restApi.restApiId,
      stage: targetStage.stageName,
      domainName: this.domainName,
      apiMappingKey: options.basePath,
    });
  }

  private configureMTLS(
    mtlsConfig?: MTLSConfig,
  ):
    | apiGatewayDomainName.ApiGatewayDomainNameMutualTlsAuthentication
    | undefined {
    if (!mtlsConfig) return undefined;
    return {
      truststoreUri: mtlsConfig.bucket.s3UrlForObject(mtlsConfig.key),
      truststoreVersion: mtlsConfig.version,
    };
  }
}

export interface DomainNameAttributes {
  /**
   * The domain name (e.g. `example.com`)
   */
  readonly domainName: string;

  /**
   * The Route53 alias target to use in order to connect a record set to this domain through an alias.
   */
  readonly domainNameAliasTarget: string;

  /**
   * The Route53 hosted zone ID to use in order to connect a record set to this domain through an alias.
   */
  readonly domainNameAliasHostedZoneId: string;
}

/**
 * The mTLS authentication configuration for a custom domain name.
 */
export interface MTLSConfig {
  /**
   * The bucket that the trust store is hosted in.
   */
  readonly bucket: IBucket;

  /**
   * The key in S3 to look at for the trust store.
   */
  readonly key: string;

  /**
   *  The version of the S3 object that contains your truststore.
   *  To specify a version, you must have versioning enabled for the S3 bucket.
   *  @default - latest version
   */
  readonly version?: string;
}
