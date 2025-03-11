// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/shared/listener-certificate.ts

import * as edge from "../../edge";

/**
 * A certificate source for an ELBv2 listener
 */
export interface IListenerCertificate {
  /**
   * The ARN of the certificate to use
   */
  readonly certificateArn: string;
}

/**
 * A certificate source for an ELBv2 listener
 */
export class ListenerCertificate implements IListenerCertificate {
  /**
   * Use an ACM certificate as a listener certificate
   */
  public static fromCertificateManager(acmCertificate: edge.ICertificate) {
    return new ListenerCertificate(acmCertificate.certificateArn);
  }

  /**
   * Use any certificate, identified by its ARN, as a listener certificate
   */
  public static fromArn(certificateArn: string) {
    return new ListenerCertificate(certificateArn);
  }

  /**
   * The ARN of the certificate to use
   */
  public readonly certificateArn: string;

  protected constructor(certificateArn: string) {
    this.certificateArn = certificateArn;
  }
}
