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
