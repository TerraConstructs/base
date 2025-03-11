// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-certificatemanager/lib/certificate-base.ts

import { ICertificate, CertificateOutputs } from "./certificate";
import { Duration } from "../../duration";
import { AwsConstructBase } from "../aws-construct";
import * as cloudwatch from "../cloudwatch";
import { Stats } from "../cloudwatch";

/**
 * Shared implementation details of ICertificate implementations.
 *
 * @internal
 */
export abstract class CertificateBase
  extends AwsConstructBase
  implements ICertificate
{
  public abstract readonly certificateArn: string;
  public abstract readonly domainName: string;
  abstract readonly certificateOutputs: CertificateOutputs;

  /**
   * If the certificate is provisionned in a different region than the
   * containing stack, this should be the region in which the certificate lives
   * so we can correctly create `Metric` instances.
   */
  protected readonly region?: string;

  public metricDaysToExpiry(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      period: Duration.days(1),
      ...props,
      dimensionsMap: { CertificateArn: this.certificateArn },
      metricName: "DaysToExpiry",
      namespace: "AWS/CertificateManager",
      region: this.region,
      statistic: Stats.MINIMUM,
    });
  }
}
