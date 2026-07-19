// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/lib/alias-target-instance.ts

import { serviceDiscoveryInstance } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { BaseInstanceProps, InstanceBase } from "./instance";
import { NamespaceType } from "./namespace";
import { DnsRecordType, IService, RoutingPolicy } from "./service";
import { ValidationError } from "../../../errors";
import { AwsStack } from "../../aws-stack";

/*
 * Properties for an AliasTargetInstance
 */
export interface AliasTargetInstanceProps extends BaseInstanceProps {
  /**
   * DNS name of the target
   */
  readonly dnsName: string;

  /**
   * The Cloudmap service this resource is registered to.
   */
  readonly service: IService;
}

/**
 * Instance that uses Route 53 Alias record type. Currently, the only resource types supported are Elastic Load
 * Balancers.
 *
 * @resource AWS::ServiceDiscovery::Instance
 */
export class AliasTargetInstance extends InstanceBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.edge.cloudmap.AliasTargetInstance";
  /**
   * The Id of the instance
   */
  public readonly instanceId: string;

  /**
   * The Cloudmap service to which the instance is registered.
   */
  public readonly service: IService;

  /**
   * The Route53 DNS name of the alias target
   */
  public readonly dnsName: string;

  /**
   * The underlying L1 resource.
   */
  public readonly resource: serviceDiscoveryInstance.ServiceDiscoveryInstance;

  constructor(scope: Construct, id: string, props: AliasTargetInstanceProps) {
    super(scope, id);

    if (props.service.namespace.type === NamespaceType.HTTP) {
      throw new ValidationError(
        "Namespace associated with Service must be a DNS Namespace.",
        this,
      );
    }

    // Should already be enforced when creating service, but validates if service is not instantiated with #createService
    const dnsRecordType = props.service.dnsRecordType;
    if (
      dnsRecordType !== DnsRecordType.A &&
      dnsRecordType !== DnsRecordType.AAAA &&
      dnsRecordType !== DnsRecordType.A_AAAA
    ) {
      throw new ValidationError(
        "Service must use `A` or `AAAA` records to register an AliasRecordTarget.",
        this,
      );
    }

    if (props.service.routingPolicy !== RoutingPolicy.WEIGHTED) {
      throw new ValidationError(
        "Service must use `WEIGHTED` routing policy.",
        this,
      );
    }

    this.resource = new serviceDiscoveryInstance.ServiceDiscoveryInstance(
      this,
      "Resource",
      {
        attributes: {
          AWS_ALIAS_DNS_NAME: props.dnsName,
          ...props.customAttributes,
        },
        instanceId: props.instanceId || AwsStack.uniqueId(this),
        serviceId: props.service.serviceId,
      },
    );

    this.service = props.service;
    this.instanceId = this.resource.id;
    this.dnsName = props.dnsName;
  }

  public get outputs(): Record<string, any> {
    return {
      instanceId: this.instanceId,
      dnsName: this.dnsName,
    };
  }
}
