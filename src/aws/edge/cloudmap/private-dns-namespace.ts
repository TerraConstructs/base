// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/lib/private-dns-namespace.ts

import { serviceDiscoveryPrivateDnsNamespace } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { BaseNamespaceProps, INamespace, NamespaceType } from "./namespace";
import { DnsServiceProps, Service } from "./service";
import { ValidationError } from "../../../errors";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as ec2 from "../../compute";

export interface PrivateDnsNamespaceProps
  extends BaseNamespaceProps,
    AwsConstructProps {
  /**
   * The Amazon VPC that you want to associate the namespace with.
   */
  readonly vpc: ec2.IVpc;
}

export interface PrivateDnsNamespaceAttributes {
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
export interface PrivateDnsNamespaceOutputs {
  /** @attribute */
  readonly privateDnsNamespaceArn: string;

  /** @attribute */
  readonly privateDnsNamespaceName: string;

  /** @attribute */
  readonly privateDnsNamespaceId: string;

  /** @attribute */
  readonly namespaceHostedZoneId: string;
}

export interface IPrivateDnsNamespace extends INamespace {
  /** Strongly typed outputs */
  readonly privateDnsNamespaceOutputs: PrivateDnsNamespaceOutputs;
}

/**
 * Define a Service Discovery HTTP Namespace
 */
export class PrivateDnsNamespace
  extends AwsConstructBase
  implements IPrivateDnsNamespace
{
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.edge.cloudmap.PrivateDnsNamespace";

  public static fromPrivateDnsNamespaceAttributes(
    scope: Construct,
    id: string,
    attrs: PrivateDnsNamespaceAttributes,
  ): IPrivateDnsNamespace {
    class Import extends AwsConstructBase implements IPrivateDnsNamespace {
      public readonly namespaceName = attrs.namespaceName;
      public readonly namespaceId = attrs.namespaceId;
      public readonly namespaceArn = attrs.namespaceArn;
      public readonly namespaceHostedZoneId: string = "";
      public readonly type = NamespaceType.DNS_PRIVATE;
      public get privateDnsNamespaceOutputs(): PrivateDnsNamespaceOutputs {
        return {
          privateDnsNamespaceArn: this.namespaceArn,
          privateDnsNamespaceName: this.namespaceName,
          privateDnsNamespaceId: this.namespaceId,
          namespaceHostedZoneId: this.namespaceHostedZoneId,
        };
      }
      public get outputs(): Record<string, any> {
        return this.privateDnsNamespaceOutputs;
      }
    }
    return new Import(scope, id, {});
  }

  /**
   * The name of the PrivateDnsNamespace.
   */
  public readonly namespaceName: string;

  /**
   * Namespace Id of the PrivateDnsNamespace.
   */
  public readonly namespaceId: string;

  /**
   * Namespace Arn of the namespace.
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
  public readonly resource: serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace;

  constructor(scope: Construct, id: string, props: PrivateDnsNamespaceProps) {
    super(scope, id, props);
    if (props.vpc === undefined) {
      throw new ValidationError(
        "VPC must be specified for PrivateDNSNamespaces",
        this,
      );
    }

    this.resource =
      new serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace(
        this,
        "Resource",
        {
          // TERRACONSTRUCTS DEVIATION: unlike most resources, a CloudMap namespace
          // `name` is a semantic, user-owned DNS/service identifier (not an arbitrary
          // generated resource name), so it is honored verbatim here instead of being
          // stack-scoped or prefixed per the naming convention's default fallback branch.
          name: props.name,
          description: props.description,
          vpc: props.vpc.vpcId,
        },
      );

    this.namespaceName = props.name;
    this.namespaceId = this.resource.id;
    this.namespaceArn = this.resource.arn;
    this.namespaceHostedZoneId = this.resource.hostedZone;
    this.type = NamespaceType.DNS_PRIVATE;
  }

  public get privateDnsNamespaceOutputs(): PrivateDnsNamespaceOutputs {
    return {
      privateDnsNamespaceArn: this.namespaceArn,
      privateDnsNamespaceName: this.namespaceName,
      privateDnsNamespaceId: this.namespaceId,
      namespaceHostedZoneId: this.namespaceHostedZoneId,
    };
  }

  public get outputs(): Record<string, any> {
    return this.privateDnsNamespaceOutputs;
  }

  /** @attribute */
  public get privateDnsNamespaceArn() {
    return this.namespaceArn;
  }

  /** @attribute */
  public get privateDnsNamespaceName() {
    return this.namespaceName;
  }

  /** @attribute */
  public get privateDnsNamespaceId() {
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
