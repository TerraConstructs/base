// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/lib/public-dns-namespace.ts

import { serviceDiscoveryPublicDnsNamespace } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { BaseNamespaceProps, INamespace, NamespaceType } from "./namespace";
import { DnsServiceProps, Service } from "./service";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";

export interface PublicDnsNamespaceProps extends BaseNamespaceProps, AwsConstructProps {}

export interface PublicDnsNamespaceAttributes {
  /**
   * A name for the Namespace.
   */
  readonly namespaceName: string;

  /**
   * Namespace Id for the Namespace.
   */
  readonly namespaceId: string;

  /**
   * Namespace ARN for the Namespace.
   */
  readonly namespaceArn: string;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface PublicDnsNamespaceOutputs {
  /** @attribute */
  readonly publicDnsNamespaceArn: string;

  /** @attribute */
  readonly publicDnsNamespaceName: string;

  /** @attribute */
  readonly publicDnsNamespaceId: string;

  /** @attribute */
  readonly namespaceHostedZoneId: string;
}

export interface IPublicDnsNamespace extends INamespace {
  /** Strongly typed outputs */
  readonly publicDnsNamespaceOutputs: PublicDnsNamespaceOutputs;
}

/**
 * Define a Public DNS Namespace
 */
export class PublicDnsNamespace
  extends AwsConstructBase
  implements IPublicDnsNamespace
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.edge.cloudmap.PublicDnsNamespace";

  public static fromPublicDnsNamespaceAttributes(
    scope: Construct,
    id: string,
    attrs: PublicDnsNamespaceAttributes,
  ): IPublicDnsNamespace {
    class Import extends AwsConstructBase implements IPublicDnsNamespace {
      public readonly namespaceName = attrs.namespaceName;
      public readonly namespaceId = attrs.namespaceId;
      public readonly namespaceArn = attrs.namespaceArn;
      public readonly namespaceHostedZoneId: string = "";
      public readonly type = NamespaceType.DNS_PUBLIC;
      public get publicDnsNamespaceOutputs(): PublicDnsNamespaceOutputs {
        return {
          publicDnsNamespaceArn: this.namespaceArn,
          publicDnsNamespaceName: this.namespaceName,
          publicDnsNamespaceId: this.namespaceId,
          namespaceHostedZoneId: this.namespaceHostedZoneId,
        };
      }
      public get outputs(): Record<string, any> {
        return this.publicDnsNamespaceOutputs;
      }
    }
    return new Import(scope, id, {});
  }

  /**
   * A name for the namespace.
   */
  public readonly namespaceName: string;

  /**
   * Namespace Id for the namespace.
   */
  public readonly namespaceId: string;

  /**
   * Namespace Arn for the namespace.
   */
  public readonly namespaceArn: string;

  /**
   * ID of hosted zone created by namespace
   */
  public readonly namespaceHostedZoneId: string;

  /**
   * Type of the namespace.
   */
  public readonly type: NamespaceType;

  /**
   * The underlying L1 resource.
   */
  public readonly resource: serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace;

  constructor(scope: Construct, id: string, props: PublicDnsNamespaceProps) {
    super(scope, id, props);

    this.resource =
      new serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace(
        this,
        "Resource",
        {
          // TERRACONSTRUCTS DEVIATION: unlike most resources, a CloudMap namespace
          // `name` is a semantic, user-owned DNS/service identifier (not an arbitrary
          // generated resource name), so it is honored verbatim here instead of being
          // stack-scoped or prefixed per the naming convention's default fallback branch.
          name: props.name,
          description: props.description,
        },
      );

    this.namespaceName = props.name;
    this.namespaceId = this.resource.id;
    this.namespaceArn = this.resource.arn;
    this.namespaceHostedZoneId = this.resource.hostedZone;
    this.type = NamespaceType.DNS_PUBLIC;
  }

  public get publicDnsNamespaceOutputs(): PublicDnsNamespaceOutputs {
    return {
      publicDnsNamespaceArn: this.namespaceArn,
      publicDnsNamespaceName: this.namespaceName,
      publicDnsNamespaceId: this.namespaceId,
      namespaceHostedZoneId: this.namespaceHostedZoneId,
    };
  }

  public get outputs(): Record<string, any> {
    return this.publicDnsNamespaceOutputs;
  }

  /** @attribute */
  public get publicDnsNamespaceArn() {
    return this.namespaceArn;
  }

  /** @attribute */
  public get publicDnsNamespaceName() {
    return this.namespaceName;
  }

  /** @attribute */
  public get publicDnsNamespaceId() {
    return this.namespaceId;
  }

  /**
   * Creates a service within the namespace
   */
  public createService(id: string, props?: DnsServiceProps): Service {
    return new Service(this, id, {
      namespace: this,
      ...props,
    });
  }
}
