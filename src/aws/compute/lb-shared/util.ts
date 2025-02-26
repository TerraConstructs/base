// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/shared/util.ts

import { Fn, Token } from "cdktf";
import { ApplicationProtocol, LbProtocol } from "./enums";
// import * as cxschema from "../../../cloud-assembly-schema";
import { Arn, ArnFormat } from "../../arn";

export type Attributes = { [key: string]: string | undefined };

/**
 * Render an attribute dict to a list of { key, value } pairs
 */
export function renderAttributes(attributes: Attributes) {
  const ret: any[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      ret.push({ key, value });
    }
  }
  return ret;
}

export function lookupStringAttribute(
  attributes: Attributes,
  key: string,
): string | undefined {
  return attributes[key];
}

export function lookupBoolAttribute(
  attributes: Attributes,
  key: string,
): boolean | undefined {
  return lookupAttribute(attributes, key, parseBool);
}

export function lookupNumberAttribute(
  attributes: Attributes,
  key: string,
): number | undefined {
  return lookupAttribute(attributes, key, parseNumber);
}

function lookupAttribute<T = string>(
  attributes: Attributes,
  key: string,
  conversionFn: (x: string | undefined) => T | undefined,
): T | undefined {
  return conversionFn(attributes[key]);
}

/**
 * Return the appropriate default port for a given protocol
 */
export function defaultPortForProtocol(proto: ApplicationProtocol): number {
  switch (proto) {
    case ApplicationProtocol.HTTP:
      return 80;
    case ApplicationProtocol.HTTPS:
      return 443;
    default:
      throw new Error(`Unrecognized protocol: ${proto}`);
  }
}

/**
 * Return the appropriate default protocol for a given port
 */
export function defaultProtocolForPort(port: number): ApplicationProtocol {
  switch (port) {
    case 80:
    case 8000:
    case 8008:
    case 8080:
      return ApplicationProtocol.HTTP;

    case 443:
    case 8443:
      return ApplicationProtocol.HTTPS;

    default:
      throw new Error(
        `Don't know default protocol for port: ${port}; please supply a protocol`,
      );
  }
}

/**
 * Given a protocol and a port, try to guess the other one if it's undefined
 */
// eslint-disable-next-line max-len
export function determineProtocolAndPort(
  protocol: ApplicationProtocol | undefined,
  port: number | undefined,
): [ApplicationProtocol | undefined, number | undefined] {
  if (protocol === undefined && port === undefined) {
    return [undefined, undefined];
  }

  if (protocol === undefined) {
    protocol = defaultProtocolForPort(port!);
  }
  if (port === undefined) {
    port = defaultPortForProtocol(protocol!);
  }

  return [protocol, port];
}

/**
 * Helper function to default undefined input props
 */
export function ifUndefined<T>(x: T | undefined, def: T) {
  return x ?? def;
}

/**
 * Helper function for ensuring network listeners and target groups only accept valid
 * protocols.
 */
export function validateNetworkProtocol(protocol: LbProtocol) {
  const NLB_PROTOCOLS = [
    LbProtocol.TCP,
    LbProtocol.TLS,
    LbProtocol.UDP,
    LbProtocol.TCP_UDP,
  ];

  if (NLB_PROTOCOLS.indexOf(protocol) === -1) {
    throw new Error(
      `The protocol must be one of ${NLB_PROTOCOLS.join(", ")}. Found ${protocol}`,
    );
  }
}

// /**
//  * Helper to map a map of tags to cxschema tag format.
//  * @internal
//  */
// export function mapTagMapToCxschema(
//   tagMap: Record<string, string>,
// ): cxschema.Tag[] {
//   return Object.entries(tagMap).map(([key, value]) => ({ key, value }));
// }

export function parseLoadBalancerFullName(arn: string): string {
  if (Token.isUnresolved(arn)) {
    // Unfortunately it is not possible to use Arn.split() because the ARNs have this shape:
    //
    //   arn:...:loadbalancer/net/my-load-balancer/123456
    //
    // And the way that Arn.split() handles this situation is not enough to obtain the full name
    const arnParts = Fn.split("/", arn);
    return `${Fn.element(arnParts, 1)}/${Fn.element(arnParts, 2)}/${Fn.element(arnParts, 3)}`;
  } else {
    const arnComponents = Arn.split(arn, ArnFormat.SLASH_RESOURCE_NAME);
    const resourceName = arnComponents.resourceName;
    if (!resourceName) {
      throw new Error(
        `Provided ARN does not belong to a load balancer: ${arn}`,
      );
    }
    return resourceName;
  }
}

/**
 * Transforms:
 *
 *   arn:aws:elasticloadbalancing:us-east-1:123456789:targetgroup/my-target-group/da693d633af407a0
 *
 * Into:
 *
 *   targetgroup/my-target-group/da693d633af407a0
 */
export function parseTargetGroupFullName(arn: string): string {
  const arnComponents = Arn.split(arn, ArnFormat.NO_RESOURCE_NAME);
  const resource = arnComponents.resource;
  if (!resource) {
    throw new Error(`Provided ARN does not belong to a target group: ${arn}`);
  }
  return resource;
}

function parseBool(val: string | undefined): boolean | undefined {
  if (val === undefined) return undefined;
  // TODO: error on invalid values?
  return val === "true";
}

function parseNumber(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const num = parseInt(val, 10);
  if (Number.isNaN(num)) {
    throw new Error(`Expected number but got "${val}"`);
  }
  return num;
}

// See https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_TargetGroupAttribute.html#API_TargetGroupAttribute_Contents.
// https://github.com/hashicorp/terraform-provider-aws/v5.88.0/main/internal/service/elbv2/const.go#L118
export class TargetGroupAttribute {
  // The following attributes are supported by all load balancers:
  static deregistrationDelayTimeoutSeconds: string =
    "deregistration_delay.timeout_seconds";
  static stickinessEnabled = "stickiness.enabled";
  static stickinessType = "stickiness.type";

  // The following attributes are supported by Application Load Balancers and Network Load Balancers:
  static loadBalancingCrossZoneEnabled = "load_balancing.cross_zone.enabled";
  static targetGroupHealthDNSFailoverMinimumHealthyTargetsCount =
    "target_group_health.dns_failover.minimum_healthy_targets.count";
  static targetGroupHealthDNSFailoverMinimumHealthyTargetsPercentage =
    "target_group_health.dns_failover.minimum_healthy_targets.percentage";
  static targetGroupHealthUnhealthyStateRoutingMinimumHealthyTargetsCount =
    "target_group_health.unhealthy_state_routing.minimum_healthy_targets.count";
  static targetGroupHealthUnhealthyStateRoutingMinimumHealthyTargetsPercentage =
    "target_group_health.unhealthy_state_routing.minimum_healthy_targets.percentage";

  // The following attributes are supported only if the load balancer is an Application Load Balancer and the target is an instance or an IP address:
  static loadBalancingAlgorithmType = "load_balancing.algorithm.type";
  static loadBalancingAlgorithmAnomalyMitigation =
    "load_balancing.algorithm.anomaly_mitigation";
  static slowStartDurationSeconds = "slow_start.duration_seconds";
  static stickinessAppCookieCookieName = "stickiness.app_cookie.cookie_name";
  static stickinessAppCookieDurationSeconds =
    "stickiness.app_cookie.duration_seconds";
  static stickinessLBCookieDurationSeconds =
    "stickiness.lb_cookie.duration_seconds";

  // The following attribute is supported only if the load balancer is an Application Load Balancer and the target is a Lambda function:
  static lambdaMultiValueHeadersEnabled = "lambda.multi_value_headers.enabled";

  // The following attributes are supported only by Network Load Balancers:
  static deregistrationDelayConnectionTerminationEnabled =
    "deregistration_delay.connection_termination.enabled";
  static preserveClientIPEnabled = "preserve_client_ip.enabled";
  static proxyProtocolV2Enabled = "proxy_protocol_v2.enabled";
  static targetHealthStateUnhealthyConnectionTerminationEnabled =
    "target_health_state.unhealthy.connection_termination.enabled";
  static targetHealthStateUnhealthyDrainingIntervalSeconds =
    "target_health_state.unhealthy.draining_interval_seconds";

  // The following attributes are supported only by Gateway Load Balancers:
  static targetFailoverOnDeregistration = "target_failover.on_deregistration";
  static targetFailoverOnUnhealthy = "target_failover.on_unhealthy";
}

// See https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_LoadBalancerAttribute.html#API_LoadBalancerAttribute_Contents.
// https://github.com/hashicorp/terraform-provider-aws/blob/main/internal/service/elbv2/const.go#L32
export class LoadBalancerAttribute {
  // The following attributes are supported by all load balancers:
  static deletionProtectionEnabled = "deletion_protection.enabled";
  static loadBalancingCrossZoneEnabled = "load_balancing.cross_zone.enabled";

  // The following attributes are supported by both Application Load Balancers and Network Load Balancers:
  static accessLogsS3Enabled = "access_logs.s3.enabled";
  static accessLogsS3Bucket = "access_logs.s3.bucket";
  static accessLogsS3Prefix = "access_logs.s3.prefix";
  static iPv6DenyAllIGWTraffic = "ipv6.deny_all_igw_traffic";

  // The following attributes are supported by only Application Load Balancers:
  static idleTimeoutTimeoutSeconds = "idle_timeout.timeout_seconds";
  static clientKeepAliveSeconds = "client_keep_alive.seconds";
  static connectionLogsS3Enabled = "connection_logs.s3.enabled";
  static connectionLogsS3Bucket = "connection_logs.s3.bucket";
  static connectionLogsS3Prefix = "connection_logs.s3.prefix";
  static routingHTTPDesyncMitigationMode =
    "routing.http.desync_mitigation_mode";
  static routingHTTPDropInvalidHeaderFieldsEnabled =
    "routing.http.drop_invalid_header_fields.enabled";
  static routingHTTPPreserveHostHeaderEnabled =
    "routing.http.preserve_host_header.enabled";
  static routingHTTPXAmznTLSVersionAndCipherSuiteEnabled =
    "routing.http.x_amzn_tls_version_and_cipher_suite.enabled";
  static routingHTTPXFFClientPortEnabled =
    "routing.http.xff_client_port.enabled";
  static routingHTTPXFFHeaderProcessingMode =
    "routing.http.xff_header_processing.mode";
  static routingHTTP2Enabled = "routing.http2.enabled";
  static wAFFailOpenEnabled = "waf.fail_open.enabled";
  static zonalShiftConfigEnabled = "zonal_shift.config.enabled";

  // The following attributes are supported by only Network Load Balancers:
  static dNSRecordClientRoutingPolicy = "dns_record.client_routing_policy";
}

// https://github.com/hashicorp/terraform-provider-aws/blob/v5.88.0/internal/service/elbv2/listener.go#L880
// see: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-listener-listenerattribute.html
export class ListenerAttribute {
  // Attribute only supported on TCP and GENEVE listeners.
  static tcpIdleTimeoutSeconds = "tcp.idle_timeout.seconds";

  // Attributes only supported on HTTPS listeners.
  static routingHTTPRequestXAmznMtlsClientcertHeaderName =
    "routing.http.request.x_amzn_mtls_clientcert.header_name";
  static routingHTTPRequestXAmznMtlsClientcertIssuerHeaderName =
    "routing.http.request.x_amzn_mtls_clientcert_issuer.header_name";
  static routingHTTPRequestXAmznMtlsClientcertLeafHeaderName =
    "routing.http.request.x_amzn_mtls_clientcert_leaf.header_name";
  static routingHTTPRequestXAmznMtlsClientcertSerialNumberHeaderName =
    "routing.http.request.x_amzn_mtls_clientcert_serial_number.header_name";
  static routingHTTPRequestXAmznMtlsClientcertSubjectHeaderName =
    "routing.http.request.x_amzn_mtls_clientcert_subject.header_name";
  static routingHTTPRequestXAmznMtlsClientcertValidityHeaderName =
    "routing.http.request.x_amzn_mtls_clientcert_validity.header_name";
  static routingHTTPRequestXAmznTlsCipherSuiteHeaderName =
    "routing.http.request.x_amzn_tls_cipher_suite.header_name";
  static routingHTTPRequestXAmznTlsVersionHeaderName =
    "routing.http.request.x_amzn_tls_version.header_name";

  // Attributes only supported on HTTPS and HTTPS listeners.
  static routingHTTPResponseAccessControlAllowCredentialsHeaderValue =
    "routing.http.response.access_control_allow_credentials.header_value";
  static routingHTTPResponseAccessControlAllowHeadersHeaderValue =
    "routing.http.response.access_control_allow_headers.header_value";
  static routingHTTPResponseAccessControlAllowMethodsHeaderValue =
    "routing.http.response.access_control_allow_methods.header_value";
  static routingHTTPResponseAccessControlAllowOriginHeaderValue =
    "routing.http.response.access_control_allow_origin.header_value";

  // Attributes only supported on HTTPS listeners.
  static routingHTTPResponseAccessControlExposeHeadersHeaderValue =
    "routing.http.response.access_control_expose_headers.header_value";
  static routingHTTPResponseAccessControlMaxAgeHeaderValue =
    "routing.http.response.access_control_max_age.header_value";
  static routingHTTPResponseContentSecurityPolicyHeaderValue =
    "routing.http.response.content_security_policy.header_value";
  static routingHTTPResponseServerEnabled =
    "routing.http.response.server.enabled";
  static routingHTTPResponseStrictTransportSecurityHeaderValue =
    "routing.http.response.strict_transport_security.header_value";
  static routingHTTPResponseXContentTypeOptionsHeaderValue =
    "routing.http.response.x_content_type_options.header_value";
  static routingHTTPResponseXFrameOptionsHeaderValue =
    "routing.http.response.x_frame_options.header_value";
}
