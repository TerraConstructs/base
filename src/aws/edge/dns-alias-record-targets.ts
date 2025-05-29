import { route53Record } from "@cdktf/provider-aws";
import { IRecordSet, IDnsZone, IDistribution } from ".";
import { IBucket } from "../storage";

/**
 * Classes that are valid alias record targets, like CloudFront distributions and load
 * balancers, should implement this interface.
 */
export interface IAliasRecordTarget {
  /**
   * Return hosted zone ID and DNS name, usable for Route53 alias targets
   */
  bind(record: IRecordSet, zone?: IDnsZone): route53Record.Route53RecordAlias;
}

export interface ILoadBalancerV2 {
  /**
   * The canonical hosted zone ID of this load balancer
   *
   * Example value: `Z2P70J7EXAMPLE`
   *
   * @attribute
   */
  readonly loadBalancerCanonicalHostedZoneId: string;
  /**
   * The DNS name of this load balancer
   *
   * Example value: `my-load-balancer-424835706.us-west-2.elb.amazonaws.com`
   *
   * @attribute
   */
  readonly loadBalancerDnsName: string;
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

// /**
//  * Use an ELBv2 as an alias record target
//  */
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
  constructor(private readonly loadBalancer: ILoadBalancerV2) {}

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
 * A helper class to instantiate an ILoadBalancerV2
 */
export class ImportedLoadBalancer implements ILoadBalancerV2 {
  constructor(
    public readonly loadBalancerCanonicalHostedZoneId: string,
    public readonly loadBalancerDnsName: string,
  ) {}
}
