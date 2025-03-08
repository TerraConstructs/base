// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/lib/shared/base-listener.ts

import { lbListener as tfListener } from "@cdktf/provider-aws";
import {
  Annotations,
  // ContextProvider,
  Lazy,
  // Token,
} from "cdktf";
import { Construct } from "constructs";
import {
  LoadBalancerType,
  LoadBalancerListenerProtocol,
} from "./grid-lookup-types";
import { LbListenerConfig } from "./lb-listener-config.generated";
import { IListenerAction } from "./listener-action";
import {
  Attributes,
  // mapTagMapToCxschema,
  // renderAttributes,
  ListenerAttribute as Attribute,
  lookupBoolAttribute,
  lookupNumberAttribute,
} from "./util";
import { IAwsConstruct, AwsConstructBase } from "../../aws-construct";
/**
 * Options for listener lookup
 */
export interface BaseListenerLookupOptions {
  /**
   * Filter listeners by associated load balancer arn
   * @default - does not filter by load balancer arn
   */
  readonly loadBalancerArn?: string;

  /**
   * Filter listeners by associated load balancer tags
   * @default - does not filter by load balancer tags
   */
  readonly loadBalancerTags?: Record<string, string>;

  /**
   * Filter listeners by listener port
   * @default - does not filter by listener port
   */
  readonly listenerPort?: number;
}

/**
 * Options for querying the load balancer listener context provider
 * @internal
 */
export interface ListenerQueryContextProviderOptions {
  /**
   * User's provided options
   */
  readonly userOptions: BaseListenerLookupOptions;

  /**
   * Type of load balancer expected
   */
  readonly loadBalancerType: LoadBalancerType;

  /**
   * ARN of the listener to look up
   * @default - does not filter by listener arn
   */
  readonly listenerArn?: string;

  /**
   * Optional protocol of the listener to look up
   */
  readonly listenerProtocol?: LoadBalancerListenerProtocol;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface ListenerOutputs {
  /**
   * ARN of the listener
   * @attribute
   */
  readonly listenerArn: string;
}

/**
 * Base interface for listeners
 */
export interface IListener extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly listenerOutputs: ListenerOutputs;
  /**
   * ARN of the listener
   * @attribute
   */
  readonly listenerArn: string;
}

/**
 * Base class for listeners
 */
export abstract class BaseListener
  extends AwsConstructBase
  implements IListener
{
  // /**
  //  * Queries the load balancer listener context provider for load balancer
  //  * listener info.
  //  * @internal
  //  */
  // protected static _queryContextProvider(
  //   scope: Construct,
  //   options: ListenerQueryContextProviderOptions,
  // ) {
  //   if (
  //     Token.isUnresolved(options.userOptions.loadBalancerArn) ||
  //     Object.values(options.userOptions.loadBalancerTags ?? {}).some(
  //       Token.isUnresolved,
  //     ) ||
  //     Token.isUnresolved(options.userOptions.listenerPort)
  //   ) {
  //     throw new Error(
  //       "All arguments to look up a load balancer listener must be concrete (no Tokens)",
  //     );
  //   }

  //   let cxschemaTags: cxschema.Tag[] | undefined;
  //   if (options.userOptions.loadBalancerTags) {
  //     cxschemaTags = mapTagMapToCxschema(options.userOptions.loadBalancerTags);
  //   }

  //   const props: cxapi.LoadBalancerListenerContextResponse =
  //     ContextProvider.getValue(scope, {
  //       provider: cxschema.ContextProvider.LOAD_BALANCER_LISTENER_PROVIDER,
  //       props: {
  //         listenerArn: options.listenerArn,
  //         listenerPort: options.userOptions.listenerPort,
  //         listenerProtocol: options.listenerProtocol,
  //         loadBalancerArn: options.userOptions.loadBalancerArn,
  //         loadBalancerTags: cxschemaTags,
  //         loadBalancerType: options.loadBalancerType,
  //       } as cxschema.LoadBalancerListenerContextQuery,
  //       dummyValue: {
  //         // eslint-disable-next-line @cdklabs/no-literal-partition
  //         listenerArn: `arn:aws:elasticloadbalancing:us-west-2:123456789012:listener/${options.loadBalancerType}/my-load-balancer/50dc6c495c0c9188/f2f7dc8efc522ab2`,
  //         listenerPort: 80,
  //         securityGroupIds: ["sg-123456789012"],
  //       } as cxapi.LoadBalancerListenerContextResponse,
  //     }).value;

  //   return props;
  // }

  /**
   * Strongly typed outputs
   */
  public get listenerOutputs(): ListenerOutputs {
    return {
      listenerArn: this.listenerArn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.listenerOutputs;
  }

  /**
   * @attribute
   */
  public readonly listenerArn: string;

  /**
   * Attributes set on this listener
   */
  private readonly attributes: Attributes = {};

  private defaultAction?: IListenerAction;

  constructor(scope: Construct, id: string, additionalProps: LbListenerConfig) {
    super(scope, id);

    const resource = new tfListener.LbListener(this, "Resource", {
      // Reverse CFN LoadBalancerAttributes to Terraform Resource properties
      // https://github.com/hashicorp/terraform-provider-aws/blob/v5.88.0/internal/service/elbv2/listener.go#L880
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-listener-listenerattribute.html
      // notice: https://github.com/hashicorp/terraform-provider-aws/issues/40986
      routingHttpRequestXAmznMtlsClientcertHeaderName: this.lazyStringAttr(
        Attribute.routingHTTPRequestXAmznMtlsClientcertHeaderName,
      ),
      routingHttpRequestXAmznMtlsClientcertIssuerHeaderName:
        this.lazyStringAttr(
          Attribute.routingHTTPRequestXAmznMtlsClientcertIssuerHeaderName,
        ),
      routingHttpRequestXAmznMtlsClientcertLeafHeaderName: this.lazyStringAttr(
        Attribute.routingHTTPRequestXAmznMtlsClientcertLeafHeaderName,
      ),
      routingHttpRequestXAmznMtlsClientcertSerialNumberHeaderName:
        this.lazyStringAttr(
          Attribute.routingHTTPRequestXAmznMtlsClientcertSerialNumberHeaderName,
        ),
      routingHttpRequestXAmznMtlsClientcertSubjectHeaderName:
        this.lazyStringAttr(
          Attribute.routingHTTPRequestXAmznMtlsClientcertSubjectHeaderName,
        ),
      routingHttpRequestXAmznMtlsClientcertValidityHeaderName:
        this.lazyStringAttr(
          Attribute.routingHTTPRequestXAmznMtlsClientcertValidityHeaderName,
        ),
      routingHttpRequestXAmznTlsCipherSuiteHeaderName: this.lazyStringAttr(
        Attribute.routingHTTPRequestXAmznTlsCipherSuiteHeaderName,
      ),
      routingHttpRequestXAmznTlsVersionHeaderName: this.lazyStringAttr(
        Attribute.routingHTTPRequestXAmznTlsVersionHeaderName,
      ),
      routingHttpResponseAccessControlAllowCredentialsHeaderValue:
        this.lazyStringAttr(
          Attribute.routingHTTPResponseAccessControlAllowCredentialsHeaderValue,
        ),
      routingHttpResponseAccessControlAllowHeadersHeaderValue:
        this.lazyStringAttr(
          Attribute.routingHTTPResponseAccessControlAllowHeadersHeaderValue,
        ),
      routingHttpResponseAccessControlAllowMethodsHeaderValue:
        this.lazyStringAttr(
          Attribute.routingHTTPResponseAccessControlAllowMethodsHeaderValue,
        ),
      routingHttpResponseAccessControlAllowOriginHeaderValue:
        this.lazyStringAttr(
          Attribute.routingHTTPResponseAccessControlAllowOriginHeaderValue,
        ),
      routingHttpResponseAccessControlExposeHeadersHeaderValue:
        this.lazyStringAttr(
          Attribute.routingHTTPResponseAccessControlExposeHeadersHeaderValue,
        ),
      routingHttpResponseAccessControlMaxAgeHeaderValue: this.lazyStringAttr(
        Attribute.routingHTTPResponseAccessControlMaxAgeHeaderValue,
      ),
      routingHttpResponseContentSecurityPolicyHeaderValue: this.lazyStringAttr(
        Attribute.routingHTTPResponseContentSecurityPolicyHeaderValue,
      ),
      routingHttpResponseServerEnabled: this.lazyBoolAttr(
        Attribute.routingHTTPResponseServerEnabled,
      ),
      routingHttpResponseStrictTransportSecurityHeaderValue:
        this.lazyStringAttr(
          Attribute.routingHTTPResponseStrictTransportSecurityHeaderValue,
        ),
      routingHttpResponseXContentTypeOptionsHeaderValue: this.lazyStringAttr(
        Attribute.routingHTTPResponseXContentTypeOptionsHeaderValue,
      ),
      routingHttpResponseXFrameOptionsHeaderValue: this.lazyStringAttr(
        Attribute.routingHTTPResponseXFrameOptionsHeaderValue,
      ),
      tcpIdleTimeoutSeconds: this.lazyNumberAttr(
        Attribute.tcpIdleTimeoutSeconds,
      ),
      ...additionalProps,
      defaultAction: Lazy.anyValue({
        produce: (): tfListener.LbListenerDefaultAction[] => {
          const rendered = this.defaultAction?.renderActions() ?? [];
          return rendered.map(tfListener.lbListenerDefaultActionToTerraform);
        },
      }),
      // listenerAttributes: Lazy.anyValue(
      //   { produce: () => renderAttributes(this.attributes) },
      //   { omitEmptyArray: true },
      // ),
    });

    this.listenerArn = resource.arn;
    this.node.addValidation({ validate: () => this.validateListener() });
  }

  /**
   * Set a non-standard attribute on the listener
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-elasticloadbalancingv2-listener-listenerattribute.html
   */
  public setAttribute(key: string, value: string | undefined) {
    this.attributes[key] = value;
  }

  /**
   * Remove an attribute from the listener
   */
  public removeAttribute(key: string) {
    this.setAttribute(key, undefined);
  }

  private lazyStringAttr(key: string) {
    return Lazy.stringValue({
      produce: () => this.attributes[key],
    });
  }
  private lazyBoolAttr(key: string) {
    return Lazy.anyValue({
      produce: () => lookupBoolAttribute(this.attributes, key),
    });
  }
  private lazyNumberAttr(key: string) {
    return Lazy.numberValue({
      produce: () => lookupNumberAttribute(this.attributes, key),
    });
  }

  /**
   * Validate this listener
   */
  protected validateListener(): string[] {
    if (!this.defaultAction) {
      return [
        "Listener needs at least one default action or target group (call addTargetGroups or addAction)",
      ];
    }
    return [];
  }

  /**
   * Configure the default action
   *
   * @internal
   */
  protected _setDefaultAction(action: IListenerAction) {
    // It might make sense to 'throw' here.
    //
    // However, programs may already exist out there which configured an action twice,
    // in which case the second action accidentally overwrite the initial action, and in some
    // way ended up with a program that did what the author intended. If we were to add throw now,
    // the previously working program would be broken.
    //
    // Instead, signal this through a warning.
    // @deprecate: upon the next major version bump, replace this with a `throw`
    if (this.defaultAction) {
      // "@aws-cdk/aws-elbv2:listenerExistingDefaultActionReplaced",
      Annotations.of(this).addWarning(
        "A default Action already existed on this Listener and was replaced. Configure exactly one default Action.",
      );
    }

    this.defaultAction = action;
  }
}
