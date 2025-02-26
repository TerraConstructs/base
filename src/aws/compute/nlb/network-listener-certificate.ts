// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/nlb/network-listener-certificate.ts

import { lbListenerCertificate as tfListenerCertificate } from "@cdktf/provider-aws";

import { Construct } from "constructs";
import { INetworkListener } from "./network-listener";
import { IListenerCertificate } from "../lb-shared/listener-certificate";

/**
 * Properties for adding a set of certificates to a listener
 */
export interface NetworkListenerCertificateProps {
  /**
   * The listener to attach the rule to
   */
  readonly listener: INetworkListener;

  /**
   * Certificates to attach
   *
   * Duplicates are not allowed.
   */
  readonly certificates: IListenerCertificate[];
}

/**
 * Add certificates to a listener
 */
export class NetworkListenerCertificate extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: NetworkListenerCertificateProps,
  ) {
    super(scope, id);

    const certificates = [
      ...(props.certificates || []).map((c) => ({
        certificateArn: c.certificateArn,
      })),
    ];

    new tfListenerCertificate.LbListenerCertificate(this, "Resource", {
      listenerArn: props.listener.listenerArn,
      certificateArn: certificates[0].certificateArn,
    });
  }
}
