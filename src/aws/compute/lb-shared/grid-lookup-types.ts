// https://github.com/cdklabs/cloud-assembly-schema/blob/v39.1.47/lib/cloud-assembly/context-queries.ts#L217

/**
 * Type of load balancer
 */
export enum LoadBalancerType {
  /**
   * Network load balancer
   */
  NETWORK = "network",
  /**
   * Application load balancer
   */
  APPLICATION = "application",
  // /**
  //  * Gateway load balancer
  //  */
  // GATEWAY = "gateway",
}

/**
 * The protocol for connections from clients to the load balancer
 */
export enum LoadBalancerListenerProtocol {
  /**
   * HTTP protocol
   */
  HTTP = "HTTP",
  /**
   * HTTPS protocol
   */
  HTTPS = "HTTPS",
  /**
   * TCP protocol
   */
  TCP = "TCP",
  /**
   * TLS protocol
   */
  TLS = "TLS",
  /**
   * UDP protocol
   * */
  UDP = "UDP",
  /**
   * TCP and UDP protocol
   * */
  TCP_UDP = "TCP_UDP",
}
