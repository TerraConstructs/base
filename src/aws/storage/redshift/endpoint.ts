// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/lib/endpoint.ts

import { Token } from "cdktn";

/**
 * Connection endpoint of a redshift cluster
 *
 * Consists of a combination of hostname and port.
 *
 * TERRACONSTRUCTS DEVIATION: upstream memoizes `socketAddress` via the internal
 * `@memoizedGetter` decorator (`aws-cdk-lib/core/lib/helpers-internal`), which this repo does not
 * port (identical omission to every other `Endpoint` port in this repo, e.g. `../rds/endpoint.ts`,
 * `../docdb/endpoint.ts`, and `../neptune/endpoint.ts`) -- `socketAddress` below is a plain
 * (unmemoized) getter instead.
 */
export class Endpoint {
  /**
   * The hostname of the endpoint
   */
  public readonly hostname: string;

  /**
   * The port of the endpoint
   */
  public readonly port: number;

  constructor(address: string, port: number) {
    this.hostname = address;
    this.port = port;
  }

  /**
   * The combination of "HOSTNAME:PORT" for this endpoint
   */
  public get socketAddress(): string {
    const portDesc = Token.isUnresolved(this.port)
      ? Token.asString(this.port)
      : this.port;
    return `${this.hostname}:${portDesc}`;
  }
}
