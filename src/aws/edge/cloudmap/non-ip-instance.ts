// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/lib/non-ip-instance.ts

import { serviceDiscoveryInstance } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { BaseInstanceProps, InstanceBase } from "./instance";
import { defaultDiscoveryType } from "./private/utils";
import { IService, DiscoveryType } from "./service";
import { ValidationError } from "../../../errors";

export interface NonIpInstanceBaseProps extends BaseInstanceProps {}

/*
 * Properties for a NonIpInstance
 */
export interface NonIpInstanceProps extends NonIpInstanceBaseProps {
  /**
   * The Cloudmap service this resource is registered to.
   */
  readonly service: IService;
}

/**
 * Instance accessible using values other than an IP address or a domain name (CNAME).
 * Specify the other values in Custom attributes.
 *
 * @resource AWS::ServiceDiscovery::Instance
 */
export class NonIpInstance extends InstanceBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.edge.cloudmap.NonIpInstance";
  /**
   * The Id of the instance
   */
  public readonly instanceId: string;

  /**
   * The Cloudmap service to which the instance is registered.
   */
  public readonly service: IService;

  /**
   * The underlying L1 resource.
   */
  public readonly resource: serviceDiscoveryInstance.ServiceDiscoveryInstance;

  constructor(scope: Construct, id: string, props: NonIpInstanceProps) {
    super(scope, id);

    const discoveryType =
      props.service.discoveryType ||
      defaultDiscoveryType(props.service.namespace);
    if (discoveryType !== DiscoveryType.API) {
      throw new ValidationError(
        "This type of instance can only be registered for HTTP namespaces.",
        this,
      );
    }

    if (
      props.customAttributes === undefined ||
      Object.keys(props.customAttributes).length === 0
    ) {
      throw new ValidationError(
        "You must specify at least one custom attribute for this instance type.",
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
          ...props.customAttributes,
        },
      },
    );

    this.service = props.service;
    this.instanceId = this.resource.id;
  }

  public get outputs(): Record<string, any> {
    return {
      instanceId: this.instanceId,
    };
  }
}
