import { Construct } from "constructs";
import { ArnFormat } from "./arn";
import { AwsSpec } from "./spec";
import { BeaconBase, BeaconProps, IBeacon } from "../beacon-base";

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L15
const RESOURCE_SYMBOL = Symbol.for("@envtio/base/lib/aws.AwsBeacon");

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L21

/**
 * Represents the environment a given AwsBeacon lives in.
 * Used as the return value for the `IResource.env` property.
 */
export interface AwsEnvironment {
  /**
   * The AWS partition that this resource belongs to.
   */
  readonly partition: string;

  /**
   * The AWS account ID that this resource belongs to.
   */
  readonly account: string;

  /**
   * The AWS region that this resource belongs to.
   */
  readonly region: string;
}

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L44

/**
 * Represents an AWS resource similar to the AWS CDK `Resource` class but backed by CDKTF.
 */
export interface IAwsBeacon extends IBeacon {
  /**
   * The stack into which this resource is contructed by the environment toolkit.
   */
  readonly stack: AwsSpec;

  /**
   * The environment this resource belongs to.
   * For resources that are created and managed by the CDKTF
   * (generally, those created by creating new class instances like Environment, EcsDeployment, etc.),
   * this is always the same as the environment of the stack they belong to;
   * however, for imported resources
   * (those obtained from static methods like fromRoleArn, fromBucketName, etc.),
   * that might be different than the stack they were imported into.
   */
  readonly env: AwsEnvironment;
}

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L78

/**
 * Construction properties for `Resource`.
 */
export interface AwsBeaconProps extends BeaconProps {
  /**
   * The AWS account ID this resource belongs to.
   *
   * @default - the resource is in the same account as the stack it belongs to
   */
  readonly account?: string;

  /**
   * The AWS region this resource belongs to.
   *
   * @default - the resource is in the same region as the stack it belongs to
   */
  readonly region?: string;

  /**
   * ARN to deduce region and account from
   *
   * The ARN is parsed and the account and region are taken from the ARN.
   * This should be used for imported resources.
   *
   * Cannot be supplied together with either `account` or `region`.
   *
   * @default - take environment from `account`, `region` parameters, or use Stack environment.
   */
  readonly environmentFromArn?: string;
}

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L122

/**
 * Represents an AWS resource similar to the AWS CDK `Resource` class but backed by CDKTF.
 */
export abstract class AwsBeaconBase extends BeaconBase implements IAwsBeacon {
  public readonly stack: AwsSpec;
  public readonly env: AwsEnvironment;

  constructor(scope: Construct, id: string, props: AwsBeaconProps = {}) {
    super(scope, id, props);

    if (
      (props.account !== undefined || props.region !== undefined) &&
      props.environmentFromArn !== undefined
    ) {
      throw new Error(
        `Supply at most one of 'account'/'region' (${props.account}/${props.region}) and 'environmentFromArn' (${props.environmentFromArn})`,
      );
    }

    Object.defineProperty(this, RESOURCE_SYMBOL, { value: true });

    this.stack = AwsSpec.ofAwsBeacon(this);

    const parsedArn = props.environmentFromArn
      ? // Since we only want the region and account, NO_RESOURCE_NAME is good enough
        this.stack.splitArn(
          props.environmentFromArn,
          ArnFormat.NO_RESOURCE_NAME,
        )
      : undefined;
    this.env = {
      partition: parsedArn?.partition ?? this.stack.partition,
      account: props.account ?? parsedArn?.account ?? this.stack.account,
      region: props.region ?? parsedArn?.region ?? this.stack.region,
    };
  }
}
