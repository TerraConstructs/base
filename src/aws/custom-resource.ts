// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/lib/custom-resource.ts
import { customResource as cfncompatCustomResource } from "@cdktn/provider-cfncompat";
import { Annotations, Token } from "cdktn";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "./aws-construct";
import { Duration } from "../duration";
import { ValidationError } from "../errors";

/**
 * Properties to provide a Lambda- or SNS-backed custom resource.
 */
export interface CustomResourceProps extends AwsConstructProps {
  /**
   * The ARN of the Lambda function or SNS topic which implements this custom
   * resource type.
   *
   * You can implement a provider by listening to raw AWS CloudFormation-shaped
   * events delivered by the `cfncompat_custom_resource` Terraform resource, and
   * specify the ARN of an SNS topic (`topic.topicArn`) or the ARN of an AWS
   * Lambda function (`lambda.functionArn`).
   *
   * Maps to `service_token` on the underlying `cfncompat_custom_resource`.
   */
  readonly serviceToken: string;

  /**
   * The maximum time that can elapse before a custom resource operation times
   * out.
   *
   * The value must be between 1 second and 3600 seconds.
   *
   * A token can be specified for this property, but it must be specified with
   * `Duration.seconds()`.
   *
   * @default Duration.seconds(3600)
   */
  readonly serviceTimeout?: Duration;

  /**
   * Properties to pass to the Lambda.
   *
   * Values in this `properties` dictionary can possibly overwrite other
   * values in `CustomResourceProps` (e.g. `ServiceToken`, `ServiceTimeout`).
   * It is recommended to avoid using the same keys that exist in
   * `CustomResourceProps`.
   *
   * @default - No properties.
   */
  readonly properties?: { [key: string]: any };

  /**
   * For custom resources, you can specify AWS::CloudFormation::CustomResource
   * (the default) as the resource type, or you can specify your own resource
   * type name. For example, you can use "Custom::MyCustomResourceTypeName".
   *
   * Custom resource type names must begin with "Custom::" and can include
   * alphanumeric characters and the following characters: _@-. You can
   * specify a custom resource type name up to a maximum length of 60
   * characters. You cannot change the type during an update.
   *
   * @default - AWS::CloudFormation::CustomResource
   */
  readonly resourceType?: string;

  /**
   * Convert all property keys to pascal case.
   *
   * @default false
   */
  readonly pascalCaseProperties?: boolean;

  /**
   * S3 bucket used to transport the handler's response (the pre-signed PUT
   * URL the handler writes its response to).
   *
   * @default - `stack.customResourceResponseBucket?.bucketName`, or the
   * provider's own `customResourceBucket` if neither is set.
   */
  readonly responseBucket?: string;

  /**
   * Optional S3 key prefix for the response object.
   *
   * @default - no prefix
   */
  readonly responseKeyPrefix?: string;
}

/**
 * Represents a custom resource, whose implementation is provided by a
 * Lambda function or SNS topic backing a `cfncompat_custom_resource`.
 */
export interface ICustomResource extends IAwsConstruct {
  /**
   * The physical name of this custom resource.
   */
  readonly ref: string;
}

/**
 * Instantiation of a custom resource, whose implementation is provided by a
 * Lambda function or SNS topic (identified by `serviceToken`), wrapping the
 * `cfncompat_custom_resource` Terraform resource.
 *
 * This class is intended to be used by construct library authors. Application
 * builders should not be able to tell whether or not a construct is backed by
 * a custom resource, and so the use of this class should be invisible.
 *
 * Instead, construct library authors declare a custom construct that hides
 * the choice of provider, and accepts a strongly-typed properties object with
 * the properties your provider accepts.
 *
 * There is no `removalPolicy` prop: Terraform has no `DeletionPolicy`
 * equivalent, and the underlying `cfncompat_custom_resource` always sends a
 * `Delete` request to the handler on destroy.
 *
 * @resource cfncompat_custom_resource
 */
export class CustomResource
  extends AwsConstructBase
  implements ICustomResource
{
  /**
   * The underlying `cfncompat_custom_resource`.
   */
  public readonly resource: cfncompatCustomResource.CustomResource;

  constructor(scope: Construct, id: string, props: CustomResourceProps) {
    super(scope, id, props);

    const type = renderResourceType(this, props.resourceType);
    const pascalCaseProperties = props.pascalCaseProperties ?? false;
    const properties = pascalCaseProperties
      ? uppercaseProperties(props.properties ?? {})
      : (props.properties ?? {});

    if (
      props.serviceTimeout !== undefined &&
      !props.serviceTimeout.isUnresolved()
    ) {
      const serviceTimeoutSeconds = props.serviceTimeout.toSeconds();

      if (serviceTimeoutSeconds < 1 || serviceTimeoutSeconds > 3600) {
        throw new ValidationError(
          `serviceTimeout must either be between 1 and 3600 seconds, got ${serviceTimeoutSeconds}`,
          this,
        );
      }
    }

    // Unlike CloudFormation, the cfncompat_custom_resource resource merges
    // ServiceToken into resource_properties itself - do not re-inject it here.
    const constructPropertyKeys = ["ServiceToken", "ServiceTimeout"];
    const conflictingKeys = Object.keys(properties).filter((key) =>
      constructPropertyKeys.includes(key),
    );

    if (conflictingKeys.length > 0) {
      Annotations.of(this).addWarning(
        `The following keys will be overwritten as they exist in the 'properties' prop. Keys found: ${conflictingKeys}`,
      );
    }

    this.resource = new cfncompatCustomResource.CustomResource(
      this,
      "Resource",
      {
        serviceToken: props.serviceToken,
        resourceType: type,
        resourceProperties: properties,
        serviceTimeout: props.serviceTimeout?.toSeconds(),
        stackId: this.stack.gridUUID,
        logicalResourceId: this.stack.uniqueResourceName(this),
        responseBucket:
          props.responseBucket ??
          this.stack.customResourceResponseBucket?.bucketName,
        responseKeyPrefix: props.responseKeyPrefix,
        provider: this.stack.cfncompatProvider,
      },
    );
  }

  public get outputs(): Record<string, any> {
    return {
      physicalResourceId: this.ref,
    };
  }

  /**
   * The physical name of this custom resource.
   */
  public get ref(): string {
    return this.resource.physicalResourceId;
  }

  /**
   * Returns the value of an attribute of the custom resource of an arbitrary
   * type. Attributes are returned from the custom resource provider through
   * the `Data` map where the key is the attribute name.
   *
   * @param attributeName the name of the attribute
   * @returns a lazy value looked up from the resource's `data` map. Use
   * `Token.asXxx` to encode the returned value as a specific type, or use the
   * convenience `getAttString` for string attributes.
   */
  public getAtt(attributeName: string): any {
    return this.resource.data.lookup(attributeName);
  }

  /**
   * Returns the value of an attribute of the custom resource of type string.
   * Attributes are returned from the custom resource provider through the
   * `Data` map where the key is the attribute name.
   *
   * @param attributeName the name of the attribute
   * @returns a token encoded as a string.
   */
  public getAttString(attributeName: string): string {
    return Token.asString(this.getAtt(attributeName));
  }
}

/**
 * Uppercase the first letter of every property name.
 *
 * It's customary for CloudFormation properties to start with capitals, and
 * our properties to start with lowercase, so this function translates from
 * one to the other.
 */
function uppercaseProperties(props: { [key: string]: any }) {
  const ret: { [key: string]: any } = {};
  Object.keys(props).forEach((key) => {
    const upper = key.slice(0, 1).toUpperCase() + key.slice(1);
    ret[upper] = props[key];
  });
  return ret;
}

function renderResourceType(scope: Construct, resourceType?: string) {
  if (!resourceType) {
    return "AWS::CloudFormation::CustomResource";
  }

  if (!resourceType.startsWith("Custom::")) {
    throw new ValidationError(
      `Custom resource type must begin with "Custom::" (${resourceType})`,
      scope,
    );
  }

  if (resourceType.length > 60) {
    throw new ValidationError(
      `Custom resource type length > 60 (${resourceType})`,
      scope,
    );
  }

  const typeName = resourceType.slice(resourceType.indexOf("::") + 2);
  if (!/^[a-z0-9_@-]+$/i.test(typeName)) {
    throw new ValidationError(
      `Custom resource type name can only include alphanumeric characters and _@- (${typeName})`,
      scope,
    );
  }

  return resourceType;
}
