import { Construct } from "constructs";
import { ArnFormat } from "./arn";
import { AwsStack } from "./aws-stack";
// import { TagManager, AwsTag } from "./tag-manager";
import {
  TerraConstructBase,
  TerraConstructProps,
  ITerraConstruct,
} from "../construct-base";

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L15
const RESOURCE_SYMBOL = Symbol.for("terraconstructs/lib/aws.AwsConstruct");

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L21

/**
 * Represents the environment a given AwsConstruct lives in.
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
export interface IAwsConstruct extends ITerraConstruct {
  /**
   * The stack into which this resource is constructed by the TerraConstruct.
   */
  readonly stack: AwsStack;

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

  // /**
  //  * Tag Manager which manages the tags for this resource
  //  */
  // readonly cdkTagManager: TagManager;
}

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L78

/**
 * Construction properties for `Resource`.
 */
export interface AwsConstructProps extends TerraConstructProps {
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

// export enum TagType {
//   /**
//    * Standard tags are a list of { key, value } objects
//    */
//   STANDARD = "StandardTag",
//   /**
//    * ASG tags are a list of { key, value, propagateAtLaunch } objects
//    */
//   AUTOSCALING_GROUP = "AutoScalingGroupTag",
//   /**
//    * Some constructs use a { key: value } map for tags
//    */
//   MAP = "StringToStringMap",
//   /**
//    * StackTags are of the format { key: value }
//    */
//   KEY_VALUE = "KeyValue",
//   NOT_TAGGABLE = "NotTaggable",
// }

// ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/resource.ts#L122

/**
 * Represents an AWS resource similar to the AWS CDK `Resource` class but backed by CDKTF.
 */
export abstract class AwsConstructBase
  extends TerraConstructBase
  implements IAwsConstruct
{
  public readonly stack: AwsStack;
  public readonly env: AwsEnvironment;
  // public readonly cdkTagManager: TagManager;

  constructor(scope: Construct, id: string, props: AwsConstructProps = {}) {
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

    this.stack = AwsStack.ofAwsConstruct(this);

    // this.cdkTagManager = new TagManager(
    //   TagType.STANDARD,
    //   "AwsConstruct",
    //   props.tags,
    // );
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
