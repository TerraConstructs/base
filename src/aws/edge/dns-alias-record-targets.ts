import { route53Record } from "@cdktf/provider-aws";
import { IRecordSet, IDnsZone, IDistribution } from ".";
import { IDomainName } from "../compute/domain-name";
import {
  ILoadBalancerBaseV2,
  ImportedLoadBalancer,
} from "../compute/lb-shared/base-load-balancer";
import { RestApiBase } from "../compute/restapi";
import { IBucket } from "../storage";

/**
 * Classes that are valid alias record targets, like CloudFront distributions load
 * balancers, should implement this interface.
 */
export interface IAliasRecordTarget {
  /**
   * Return hosted zone ID and DNS name, usable for Route53 alias targets
   */
  bind(record: IRecordSet, zone?: IDnsZone): route53Record.Route53RecordAlias;
}

/**
 * Use a CloudFront Distribution as an alias record target
 */
export class DistributionTarget implements IAliasRecordTarget {
  constructor(private readonly distribution: IDistribution) {}

  public bind(
    _record: IRecordSet,
    _zone?: IDnsZone,
  ): route53Record.Route53RecordAlias {
    return {
      zoneId: this.distribution.hostedZoneId,
      name: this.distribution.domainName,
      evaluateTargetHealth: false,
    };
  }
}

/**
 * Use Bucket as an alias record target
 */
export class BucketWebsiteTarget implements IAliasRecordTarget {
  constructor(private readonly bucket: IBucket) {}

  public bind(
    _record: IRecordSet,
    _zone?: IDnsZone,
  ): route53Record.Route53RecordAlias {
    if (!this.bucket.isWebsite()) {
      throw new Error(
        "Cannot use a non-website bucket as an alias record target",
      );
    }
    this.bucket.bucketOutputs.websiteDomainName;

    return {
      zoneId: this.bucket.hostedZoneId,
      name: this.bucket.websiteDomainName,
      evaluateTargetHealth: true,
    };
  }
}

/**
 * Use an ELBv2 as an alias record target
 */
export class LoadBalancerTarget implements IAliasRecordTarget {
  public static fromAttributes(
    loadBalancerCanonicalHostedZoneId: string,
    loadBalancerDnsName: string,
  ) {
    const imported = new ImportedLoadBalancer(
      loadBalancerCanonicalHostedZoneId,
      loadBalancerDnsName,
    );
    return new LoadBalancerTarget(imported);
  }
  constructor(private readonly loadBalancer: ILoadBalancerBaseV2) {}

  public bind(
    _record: IRecordSet,
    _zone?: IDnsZone,
  ): route53Record.Route53RecordAlias {
    return {
      zoneId: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
      name: `dualstack.${this.loadBalancer.loadBalancerDnsName}`,
      evaluateTargetHealth: true,
    };
  }
}

/**
 * Defines an API Gateway domain name as the alias target.
 *
 * Use the `ApiGatewayTarget` class if you wish to map the alias to an REST API with a
 * domain name defined through the `RestApiProps.domainName` prop.
 */
export class ApiGatewayDomain implements IAliasRecordTarget {
  constructor(private readonly domainName: IDomainName) {}

  public bind(
    _record: IRecordSet,
    _zone?: IDnsZone,
  ): route53Record.Route53RecordAlias {
    return {
      zoneId: this.domainName.domainNameAliasHostedZoneId,
      name: this.domainName.domainNameAliasDomainName,
      evaluateTargetHealth: true,
    };
  }
}

/**
 * Defines an API Gateway REST API as the alias target. Requires that the domain
 * name will be defined through `RestApiProps.domainName`.
 *
 * You can direct the alias to any `apigateway.DomainName` resource through the
 * `ApiGatewayDomain` class.
 */
export class ApiGatewayTarget extends ApiGatewayDomain {
  constructor(api: RestApiBase) {
    if (!api.domainName) {
      throw new Error(`API does not define a default domain name: ${api}`);
    }

    super(api.domainName);
  }
}

/**
 * Defines an API Gateway V2 domain name as the alias target.
 */
export class ApiGatewayv2DomainProperties implements IAliasRecordTarget {
  /**
   * @param regionalDomainName the domain name associated with the regional endpoint for this custom domain name.
   * @param regionalHostedZoneId the region-specific Amazon Route 53 Hosted Zone ID of the regional endpoint.
   */
  constructor(
    private readonly regionalDomainName: string,
    private readonly regionalHostedZoneId: string,
  ) {}

  public bind(
    _record: IRecordSet,
    _zone?: IDnsZone,
  ): route53Record.Route53RecordAlias {
    return {
      name: this.regionalDomainName,
      zoneId: this.regionalHostedZoneId,
      evaluateTargetHealth: true,
    };
  }
}
