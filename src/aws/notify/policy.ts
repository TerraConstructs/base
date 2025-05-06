// https://github.com/aws/aws-cdk/blob/6b9e47a1529319561bc1040739fe02bac15895bf/packages/aws-cdk-lib/aws-sns/lib/policy.ts

import { snsTopicPolicy } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { ITopic } from "./topic-base";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { Effect, PolicyDocument, PolicyStatement, StarPrincipal } from "../iam";

/**
 * Properties to associate SNS topics with a policy
 */
export interface TopicPolicyProps extends AwsConstructProps {
  /**
   * The set of topics this policy applies to.
   */
  readonly topics: ITopic[];

  /**
   * IAM policy document to apply to topic(s).
   * @default empty policy document
   */
  readonly policyDocument?: PolicyDocument;

  /**
   * Adds a statement to enforce encryption of data in transit when publishing to the topic.
   *
   * For more information, see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit.
   *
   * @default false
   */
  readonly enforceSSL?: boolean;
}

/**
 * The policy for an SNS Topic
 *
 * Policies define the operations that are allowed on this resource.
 *
 * You almost never need to define this construct directly.
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * Prefer to use `addToResourcePolicy()` instead.
 *
 * @resource aws_sns_topic_policy
 */
export class TopicPolicy extends AwsConstructBase {
  /**
   * The IAM policy document associated with this policy.
   */
  public readonly document: PolicyDocument;

  // Outputs are minimal as this construct manages multiple policies
  public get outputs(): Record<string, any> {
    return {
      policyJson: this.document.json,
    };
  }

  constructor(scope: Construct, id: string, props: TopicPolicyProps) {
    super(scope, id, props);

    this.document =
      props.policyDocument ??
      new PolicyDocument({
        // statements must be unique, so we use the statement index.
        // potentially SIDs can change as a result of order change, but this should
        // not have an impact on the policy evaluation.
        // https://docs.aws.amazon.com/sns/latest/dg/AccessPolicyLanguage_SpecialInfo.html
        assignSids: true,
      });

    props.topics.forEach((topic, index) => {
      // Create a policy document specific to this topic if SSL enforcement is needed
      let topicSpecificDocument = this.document;
      if (props.enforceSSL) {
        // Clone the base document to avoid modifying it for other topics
        topicSpecificDocument = this.document.copy();
        topicSpecificDocument.addStatements(
          this.createSSLPolicyStatement(topic.topicArn),
        );
      }

      new snsTopicPolicy.SnsTopicPolicy(this, `Resource-${index}`, {
        arn: topic.topicArn,
        policy: topicSpecificDocument.json,
      });
    });
  }

  /**
   * Creates a statement to enforce encryption of data in transit when publishing to the topic.
   *
   * For more information, see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit.
   */
  protected createSSLPolicyStatement(topicArn: string): PolicyStatement {
    return new PolicyStatement({
      sid: "EnforcePublishSSL", // SID needs to be unique within the policy for each topic
      actions: ["sns:Publish"],
      effect: Effect.DENY,
      resources: [topicArn],
      condition: [
        {
          test: "Bool",
          variable: "aws:SecureTransport",
          values: ["false"],
        },
      ],
      principals: [new StarPrincipal()],
    });
  }
}
