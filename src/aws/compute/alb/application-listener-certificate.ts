// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/alb/application-listener-certificate.ts

import { lbListenerCertificate as tfListenerCertificate } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IApplicationListener } from "./application-listener";
import { IListenerCertificate } from "../lb-shared/listener-certificate";

/**
 * Properties for adding a set of certificates to a listener
 */
export interface ApplicationListenerCertificateProps {
  /**
   * The listener to attach the rule to
   */
  readonly listener: IApplicationListener;

  /**
   * ARNs of certificates to attach
   *
   * Duplicates are not allowed.
   *
   * @deprecated Use `certificates` instead.
   * @default - One of 'certificates' and 'certificateArns' is required.
   */
  readonly certificateArns?: string[];

  /**
   * Certificates to attach
   *
   * Duplicates are not allowed.
   *
   * @default - One of 'certificates' and 'certificateArns' is required.
   */
  readonly certificates?: IListenerCertificate[];
}

/**
 * Add certificates to a listener
 */
export class ApplicationListenerCertificate extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: ApplicationListenerCertificateProps,
  ) {
    super(scope, id);

    if (!props.certificateArns && !props.certificates) {
      throw new Error(
        "At least one of 'certificateArns' or 'certificates' is required",
      );
    }

    const certificates = [
      ...(props.certificates || []).map((c) => ({
        certificateArn: c.certificateArn,
      })),
      ...(props.certificateArns || []).map((certificateArn) => ({
        certificateArn,
      })),
    ];

    new tfListenerCertificate.LbListenerCertificate(this, "Resource", {
      listenerArn: props.listener.listenerArn,
      certificateArn: certificates[0].certificateArn,
    });
  }
}
