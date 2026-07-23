// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/proxy-configuration/proxy-configurations.ts

import {
  AppMeshProxyConfiguration,
  AppMeshProxyConfigurationConfigProps,
} from "./app-mesh-proxy-configuration";
import { ProxyConfiguration } from "./proxy-configuration";

/**
 * The base class for proxy configurations.
 */
export class ProxyConfigurations {
  /**
   * Constructs a new instance of the ProxyConfiguration class.
   */
  public static appMeshProxyConfiguration(
    props: AppMeshProxyConfigurationConfigProps,
  ): ProxyConfiguration {
    return new AppMeshProxyConfiguration(props);
  }
}
