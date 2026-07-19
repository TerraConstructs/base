// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/lib/cname-instance.ts

import { serviceDiscoveryInstance } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { BaseInstanceProps, InstanceBase } from "./instance";
import { NamespaceType } from "./namespace";
import { DnsRecordType, IService } from "./service";
import { ValidationError } from "../../../errors";

/*
 * Properties for a CnameInstance used for service#registerCnameInstance
 */
export interface CnameInstanceBaseProps extends BaseInstanceProps {
  /**
   * If the service configuration includes a CNAME record, the domain name that you want Route 53 to
   * return in response to DNS queries, for example, example.com. This value is required if the
   * service specified by ServiceId includes settings for an CNAME record.
   */
  readonly instanceCname: string;
}

/*
 * Properties for a CnameInstance
 */
export interface CnameInstanceProps extends CnameInstanceBaseProps {
  /**
   * The Cloudmap service this resource is registered to.
   */
  readonly service: IService;
}

/**
 * Instance that is accessible using a domain name (CNAME).
 * @resource AWS::ServiceDiscovery::Instance
 */
export class CnameInstance extends InstanceBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.edge.cloudmap.CnameInstance";
  /**
   * The Id of the instance
   */
  public readonly instanceId: string;

  /**
   * The Cloudmap service to which the instance is registered.
   */
  public readonly service: IService;

  /**
   * The domain name returned by DNS queries for the instance
   */
  public readonly cname: string;

  /**
   * The underlying L1 resource.
   */
  public readonly resource: serviceDiscoveryInstance.ServiceDiscoveryInstance;

  constructor(scope: Construct, id: string, props: CnameInstanceProps) {
    super(scope, id);

    if (props.service.namespace.type === NamespaceType.HTTP) {
      throw new ValidationError(
        "Namespace associated with Service must be a DNS Namespace.",
        this,
      );
    }

    if (props.service.dnsRecordType !== DnsRecordType.CNAME) {
      throw new ValidationError(
        "A `CnameIntance` can only be used with a service using a `CNAME` record.",
        this,
      );
    }

    this.resource = new serviceDiscoveryInstance.ServiceDiscoveryInstance(
      this,
      "Resource",
      {
        instanceId: props.instanceId || this.uniqueInstanceId(),
        serviceId: props.service.serviceId,
        attributes: {
          AWS_INSTANCE_CNAME: props.instanceCname,
          ...props.customAttributes,
        },
      },
    );

    this.service = props.service;
    this.instanceId = this.resource.id;
    this.cname = props.instanceCname;
  }

  public get outputs(): Record<string, any> {
    return {
      instanceId: this.instanceId,
      cname: this.cname,
    };
  }
}
