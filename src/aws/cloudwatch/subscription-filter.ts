// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-logs/lib/subscription-filter.ts

import { cloudwatchLogSubscriptionFilter } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { ILogGroup, SubscriptionFilterOptions } from "./log-group";
import * as iam from "../iam";
import { KinesisDestination } from "./log-destinations";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface LogSubscriptionDestinationOutputs {
  /**
   * The arn of this log group
   * @attribute
   */
  readonly logGroupArn: string;
  /**
   * The name of this log group
   * @attribute
   */
  readonly logGroupName: string;
}

/**
 * Interface for classes that can be the destination of a log Subscription
 */
export interface ILogSubscriptionDestination {
  /**
   * Return the properties required to send subscription events to this destination.
   *
   * If necessary, the destination can use the properties of the SubscriptionFilter
   * object itself to configure its permissions to allow the subscription to write
   * to it.
   *
   * The destination may reconfigure its own permissions in response to this
   * function call.
   */
  bind(
    scope: Construct,
    sourceLogGroup: ILogGroup,
  ): LogSubscriptionDestinationConfig;
}

/**
 * Properties returned by a Subscription destination
 */
export interface LogSubscriptionDestinationConfig {
  /**
   * The ARN of the subscription's destination
   */
  readonly arn: string;

  /**
   * The role to assume to write log events to the destination
   *
   * @default No role assumed
   */
  readonly role?: iam.IRole;

  /**
   * Dependencies required for subscription filter creation to succeed
   */
  readonly dependencies?: Construct[];
}

/**
 * Properties for a SubscriptionFilter
 */
export interface SubscriptionFilterProps
  extends SubscriptionFilterOptions, AwsConstructProps {
  /**
   * The log group to create the subscription on.
   */
  readonly logGroup: ILogGroup;
}

/**
 * A new Subscription on a CloudWatch log group.
 */
export class SubscriptionFilter extends AwsConstructBase {
  public resource: cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter;
  /**
   * This resource exports no additional attributes.
   */
  public get outputs(): Record<string, any> {
    return {};
  }

  constructor(scope: Construct, id: string, props: SubscriptionFilterProps) {
    super(scope, id, props);
    const name =
      props.filterName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    if (
      props.distribution &&
      !Token.isUnresolved(props.distribution) &&
      !Token.isUnresolved(props.destination) &&
      !(props.destination instanceof KinesisDestination)
    ) {
      throw new Error(
        "distribution property can only be used with KinesisDestination.",
      );
    }

    const destProps = props.destination.bind(this, props.logGroup);

    this.resource =
      new cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter(
        this,
        "Resource",
        {
          name,
          logGroupName: props.logGroup.logGroupName,
          destinationArn: destProps.arn,
          roleArn: destProps.role && destProps.role.roleArn,
          filterPattern: props.filterPattern.logPatternString,
          distribution: props.distribution,
        },
      );
    if (destProps.dependencies) {
      this.resource.node.addDependency(...destProps.dependencies);
    }
  }
}
