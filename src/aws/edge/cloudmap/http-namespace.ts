// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/lib/http-namespace.ts

import { serviceDiscoveryHttpNamespace } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { BaseNamespaceProps, INamespace, NamespaceType } from "./namespace";
import { BaseServiceProps, Service } from "./service";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";

export interface HttpNamespaceProps extends BaseNamespaceProps, AwsConstructProps {}

export interface HttpNamespaceAttributes {
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
export interface HttpNamespaceOutputs {
  /** @attribute */
  readonly httpNamespaceArn: string;

  /** @attribute */
  readonly httpNamespaceName: string;

  /** @attribute */
  readonly httpNamespaceId: string;
}

export interface IHttpNamespace extends INamespace {
  /** Strongly typed outputs */
  readonly httpNamespaceOutputs: HttpNamespaceOutputs;
}

/**
 * Define an HTTP Namespace
 */
export class HttpNamespace extends AwsConstructBase implements IHttpNamespace {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.edge.cloudmap.HttpNamespace";

  public static fromHttpNamespaceAttributes(
    scope: Construct,
    id: string,
    attrs: HttpNamespaceAttributes,
  ): IHttpNamespace {
    class Import extends AwsConstructBase implements IHttpNamespace {
      public readonly namespaceName = attrs.namespaceName;
      public readonly namespaceId = attrs.namespaceId;
      public readonly namespaceArn = attrs.namespaceArn;
      public readonly type = NamespaceType.HTTP;
      public get httpNamespaceOutputs(): HttpNamespaceOutputs {
        return {
          httpNamespaceArn: this.namespaceArn,
          httpNamespaceName: this.namespaceName,
          httpNamespaceId: this.namespaceId,
        };
      }
      public get outputs(): Record<string, any> {
        return this.httpNamespaceOutputs;
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
   * Type of the namespace.
   */
  public readonly type: NamespaceType;

  /**
   * The underlying L1 resource.
   */
  public readonly resource: serviceDiscoveryHttpNamespace.ServiceDiscoveryHttpNamespace;

  constructor(scope: Construct, id: string, props: HttpNamespaceProps) {
    super(scope, id, props);

    this.resource = new serviceDiscoveryHttpNamespace.ServiceDiscoveryHttpNamespace(
      this,
      "Resource",
      {
        // TERRACONSTRUCTS DEVIATION: unlike most resources, a CloudMap namespace `name`
        // is a semantic, user-owned DNS/service identifier (not an arbitrary generated
        // resource name), so it is honored verbatim here instead of being stack-scoped
        // or prefixed per the naming convention's default fallback branch.
        name: props.name,
        description: props.description,
      },
    );

    this.namespaceName = props.name;
    this.namespaceId = this.resource.id;
    this.namespaceArn = this.resource.arn;
    this.type = NamespaceType.HTTP;
  }

  public get httpNamespaceOutputs(): HttpNamespaceOutputs {
    return {
      httpNamespaceArn: this.namespaceArn,
      httpNamespaceName: this.namespaceName,
      httpNamespaceId: this.namespaceId,
    };
  }

  public get outputs(): Record<string, any> {
    return this.httpNamespaceOutputs;
  }

  /** @attribute */
  public get httpNamespaceArn() {
    return this.namespaceArn;
  }

  /** @attribute */
  public get httpNamespaceName() {
    return this.namespaceName;
  }

  /** @attribute */
  public get httpNamespaceId() {
    return this.namespaceId;
  }

  /**
   * Creates a service within the namespace
   */
  public createService(id: string, props?: BaseServiceProps): Service {
    return new Service(this, id, {
      namespace: this,
      ...props,
    });
  }
}
