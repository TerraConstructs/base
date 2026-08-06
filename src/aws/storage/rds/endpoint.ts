// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/endpoint.ts

import { Token } from "cdktn";

/**
 * Connection endpoint of a database cluster or instance
 *
 * Consists of a combination of hostname and port.
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
