// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/base/from-service-attributes.ts

import { Fn, Token } from "cdktn";
import { Construct } from "constructs";
import { IBaseService } from "./base-service";
import { ValidationError } from "../../../../errors";
import { ArnFormat } from "../../../arn";
import { AwsConstructBase } from "../../../aws-construct";
import { AwsStack } from "../../../aws-stack";
import { ICluster } from "../cluster";

/**
 * The properties to import from the service.
 */
export interface ServiceAttributes {
  /**
   * The cluster that hosts the service.
   */
  readonly cluster: ICluster;

  /**
   * The service ARN.
   *
   * @default - either this, or `serviceName`, is required
   */
  readonly serviceArn?: string;

  /**
   * The name of the service.
   *
   * @default - either this, or `serviceArn`, is required
   */
  readonly serviceName?: string;
}

export function fromServiceAttributes(
  scope: Construct,
  id: string,
  attrs: ServiceAttributes,
): IBaseService {
  if (
    (attrs.serviceArn && attrs.serviceName) ||
    (!attrs.serviceArn && !attrs.serviceName)
  ) {
    throw new ValidationError(
      "You can only specify either serviceArn or serviceName.",
      scope,
    );
  }

  // TERRACONSTRUCTS DEVIATION: upstream gates the ARN format (cluster-name
  // included in the service resourceName) behind the
  // ECS_ARN_FORMAT_INCLUDES_CLUSTER_NAME feature flag for back-compat with
  // stacks synthesized by older CDK versions. TerraConstructs has no legacy
  // stacks to preserve compatibility with, so the "new" ARN format is always
  // used (equivalent to the feature flag being permanently enabled).
  const newArnFormat = true;

  const stack = AwsStack.ofAwsConstruct(scope);
  let name: string;
  let arn: string;
  if (attrs.serviceName) {
    name = attrs.serviceName as string;
    const resourceName = newArnFormat
      ? `${attrs.cluster.clusterName}/${attrs.serviceName}`
      : (attrs.serviceName as string);
    arn = stack.formatArn({
      partition: stack.partition,
      service: "ecs",
      region: stack.region,
      account: stack.account,
      resource: "service",
      resourceName,
    });
  } else {
    arn = attrs.serviceArn as string;
    name = extractServiceNameFromArn(scope, arn);
  }
  class Import extends AwsConstructBase implements IBaseService {
    public readonly serviceArn = arn;
    public readonly serviceName = name;
    public readonly cluster = attrs.cluster;
    public get outputs(): Record<string, any> {
      return {
        arn: this.serviceArn,
        name: this.serviceName,
      };
    }
  }
  return new Import(scope, id, {
    environmentFromArn: arn,
  });
}

export function extractServiceNameFromArn(
  scope: Construct,
  arn: string,
): string {
  // TERRACONSTRUCTS DEVIATION: see newArnFormat note in fromServiceAttributes
  // above — the "new" (cluster-name-including) ARN format is always assumed.
  const newArnFormat = true;
  const stack = AwsStack.ofAwsConstruct(scope);

  if (Token.isUnresolved(arn)) {
    if (newArnFormat) {
      const components = Fn.split(":", arn);
      const lastComponents = Fn.split("/", Fn.element(components, 5) as string);
      return Fn.element(lastComponents, 2) as string;
    } else {
      return stack.splitArn(arn, ArnFormat.SLASH_RESOURCE_NAME)
        .resourceName as string;
    }
  } else {
    const resourceName = stack.splitArn(arn, ArnFormat.SLASH_RESOURCE_NAME)
      .resourceName as string;
    const resourceNameSplit = resourceName.split("/");
    return resourceNameSplit.length === 1 ? resourceName : resourceNameSplit[1];
  }
}
